"""Request-scoped SQLite (development) or PostgreSQL (production) connections."""

from datetime import datetime, timezone
import sqlite3
import secrets
from pathlib import Path

from flask import current_app, g

try:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg import sql
except ImportError:
    psycopg = None

DATABASE_ERRORS = (sqlite3.Error,) + ((psycopg.Error,) if psycopg else ())
INTEGRITY_ERRORS = (sqlite3.IntegrityError,) + ((psycopg.IntegrityError,) if psycopg else ())


def database_engine():
    return 'postgresql' if current_app.config.get('DATABASE_URL') else 'sqlite'


def parameter():
    return '%s' if database_engine() == 'postgresql' else '?'


def get_db():
    if 'db' not in g:
        if database_engine() == 'postgresql':
            if psycopg is None:
                raise RuntimeError('PostgreSQL requires requirements-production.txt.')
            connection = psycopg.connect(current_app.config['DATABASE_URL'], connect_timeout=5, row_factory=dict_row)
            try:
                if current_app.config.get('DATABASE_SCHEMA'):
                    connection.execute(sql.SQL('SET search_path TO {}').format(
                        sql.Identifier(current_app.config['DATABASE_SCHEMA'])))
                    connection.commit()
            except Exception:
                connection.close()
                raise
            g.db = connection
        else:
            g.db = sqlite3.connect(current_app.config['DATABASE_PATH'], timeout=5)
            g.db.row_factory = sqlite3.Row
            g.db.execute('PRAGMA foreign_keys = ON')
    return g.db


def close_db(_error=None):
    database = g.pop('db', None)
    if database is not None:
        database.close()


def init_db():
    if database_engine() == 'postgresql':
        init_postgres()
        return
    Path(current_app.config['DATABASE_PATH']).parent.mkdir(parents=True, exist_ok=True)
    database = get_db()
    database.execute('PRAGMA journal_mode = WAL')
    database.executescript('''
        CREATE TABLE IF NOT EXISTS app_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        ) STRICT;
        INSERT OR IGNORE INTO app_metadata (key, value)
        VALUES ('created_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        CREATE TABLE IF NOT EXISTS song_ratings (
            song_key TEXT NOT NULL,
            listener_id TEXT NOT NULL,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK (rating IN (-1, 1)),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            PRIMARY KEY (song_key, listener_id)
        ) STRICT;
    ''')
    database.execute('INSERT OR IGNORE INTO app_metadata (key, value) VALUES (?, ?)',
                     ('rating_session_secret', secrets.token_hex(32)))
    database.commit()


def init_postgres():
    database = get_db()
    # Serialize schema initialization across backend processes on first startup.
    database.execute('SELECT pg_advisory_xact_lock(726234101)')
    database.execute('''
        CREATE TABLE IF NOT EXISTS app_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    ''')
    database.execute('''
        CREATE TABLE IF NOT EXISTS song_ratings (
            song_key TEXT NOT NULL,
            listener_id TEXT NOT NULL,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            rating SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
            created_at TEXT NOT NULL DEFAULT
                to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            PRIMARY KEY (song_key, listener_id)
        )
    ''')
    created_at = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
    for key, value in (('created_at', created_at), ('rating_session_secret', secrets.token_hex(32))):
        database.execute('INSERT INTO app_metadata (key, value) VALUES (%s, %s) ON CONFLICT (key) DO NOTHING',
                         (key, value))
    database.commit()
