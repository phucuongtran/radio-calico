"""Local Flask website. Run the project's Python interpreter with app.py --debug."""

import argparse
import json
import os
from datetime import timedelta
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from config import PROJECT_DIRECTORY, load_settings
from database import DATABASE_ERRORS, close_db, database_engine, get_db, init_db
from diagnostics import MAX_DIAGNOSTIC_BYTES, filter_diagnostic
from ratings import ensure_listener, ratings


def create_app(test_config=None):
    app = Flask(__name__)
    app.config.update(
        SESSION_COOKIE_NAME='radiocalico_listener',
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Lax',
        PERMANENT_SESSION_LIFETIME=timedelta(days=365),
        SESSION_REFRESH_EACH_REQUEST=False,
    )
    app.config.update(load_settings())
    if test_config is not None:
        app.config.update(test_config)
    if not app.config.get('DATABASE_URL'):
        app.config['DATABASE_PATH'] = str((PROJECT_DIRECTORY / Path(app.config['DATABASE_PATH'])).resolve())
    app.teardown_appcontext(close_db)

    with app.app_context():
        init_db()
        if not app.secret_key:
            app.secret_key = get_db().execute(
                "SELECT value FROM app_metadata WHERE key = 'rating_session_secret'"
            ).fetchone()['value']

    app.register_blueprint(ratings)

    @app.get('/')
    def index():
        ensure_listener()
        return render_template('index.html')

    @app.get('/api/health')
    def health():
        try:
            get_db().execute('SELECT 1 AS connected').fetchone()
            return jsonify(status='ok', database='connected', engine=database_engine())
        except DATABASE_ERRORS:
            app.logger.exception('Database health check failed')
            return jsonify(status='error', database='unavailable'), 503

    @app.post('/api/playback-diagnostics')
    def playback_diagnostics():
        request.max_content_length = MAX_DIAGNOSTIC_BYTES
        if not request.is_json:
            return jsonify(error='Send diagnostic details as JSON.'), 415
        try:
            diagnostic = filter_diagnostic(request.get_json(silent=True))
        except ValueError as error:
            return jsonify(error=str(error)), 400
        app.logger.warning('Playback diagnostic: %s', json.dumps(diagnostic, ensure_ascii=True))
        return '', 204

    @app.after_request
    def development_headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        # Keep headers such as Allow on a 405 response.
        response = error.get_response()
        if request.path.startswith('/api/'):
            response.data = app.json.dumps({'error': error.name})
            response.content_type = 'application/json'
        return response

    return app


def main():
    parser = argparse.ArgumentParser(description='Radio Calico Flask development server')
    parser.add_argument('command', nargs='?', choices=['serve', 'db'], default='serve')
    parser.add_argument('sql', nargs='?', default=None)
    parser.add_argument('--debug', action='store_true', help='Enable the local debugger and automatic reload')
    parser.add_argument('--pid-file', help=argparse.SUPPRESS)
    args = parser.parse_args()
    app = create_app()
    if args.command == 'db':
        with app.app_context():
            database = get_db()
            statement = args.sql
            if statement is None:
                statement = ("SELECT table_name AS name FROM information_schema.tables "
                             "WHERE table_schema = current_schema() ORDER BY table_name"
                             if database_engine() == 'postgresql' else
                             "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
            cursor = database.execute(statement)
            if cursor.description:
                for row in cursor.fetchall():
                    print(dict(row))
            else:
                print(f'Rows changed: {cursor.rowcount}')
            database.commit()
    else:
        if args.pid_file:
            Path(args.pid_file).write_text(str(os.getpid()), encoding='ascii')
        app.run(host='127.0.0.1', port=app.config['PORT'], debug=args.debug)


if __name__ == '__main__':
    main()
