"""Run the shared rating API suite in disposable schemas on an explicit test PostgreSQL server."""

import os
import unittest
import uuid

from app import create_app
from database import get_db
from tests import test_ratings


@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'), 'Set TEST_DATABASE_URL to run PostgreSQL integration tests')
class PostgresRatingsIntegrationTests(test_ratings.RatingsIntegrationTests):
    def setUp(self):
        import psycopg
        from psycopg import sql

        url = os.environ['TEST_DATABASE_URL']
        schema = 'ratings_test_' + uuid.uuid4().hex
        admin = psycopg.connect(url, autocommit=True)
        self.addCleanup(admin.close)
        admin.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        self.addCleanup(lambda: admin.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema))))
        self.config = {'TESTING': True, 'DATABASE_URL': url, 'DATABASE_SCHEMA': schema}
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.song = {'title': 'A Song', 'artist': 'An Artist'}

    def test_health_reports_postgresql(self):
        self.assertEqual(self.client.get('/api/health').json,
                         {'status': 'ok', 'database': 'connected', 'engine': 'postgresql'})

    def test_postgresql_driver_failure_returns_503(self):
        from unittest.mock import patch
        import psycopg

        token = self.read().json['csrf_token']
        with patch('ratings.get_db', side_effect=psycopg.OperationalError('injected failure')):
            with self.assertLogs(self.app.logger, level='ERROR'):
                self.assertEqual(self.read().status_code, 503)
            with self.assertLogs(self.app.logger, level='ERROR'):
                self.assertEqual(self.vote(1, token=token).status_code, 503)

    def test_reinitialization_preserves_the_session_signing_secret(self):
        with self.app.app_context():
            original = get_db().execute("SELECT value FROM app_metadata WHERE key = 'rating_session_secret'").fetchone()['value']
        second = create_app(self.config)
        with second.app_context():
            self.assertEqual(get_db().execute("SELECT value FROM app_metadata WHERE key = 'rating_session_secret'").fetchone()['value'], original)
