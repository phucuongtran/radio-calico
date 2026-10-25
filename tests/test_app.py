import json
import re
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urljoin

from app import create_app
from database import get_db


class AppIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='radiocalico-test-')
        self.addCleanup(self.directory.cleanup)
        self.database_path = Path(self.directory.name) / 'test.sqlite'
        self.app = create_app({'TESTING': True, 'DATABASE_PATH': self.database_path, 'DATABASE_URL': ''})
        self.client = self.app.test_client()

    def test_website_and_static_assets(self):
        page = self.client.get('/')
        self.assertEqual(page.status_code, 200)
        self.assertIn(b'Radio Calico', page.data)
        self.assertIn(b'id="radio-audio"', page.data)
        self.assertIn(b'id="current-track-title"', page.data)
        self.assertIn(b'id="current-track-artist"', page.data)
        self.assertIn(b'id="current-album-art"', page.data)
        self.assertIn(b'id="recent-tracks"', page.data)
        self.assertIn(b'id="thumbs-up"', page.data)
        self.assertIn(b'id="thumbs-down"', page.data)
        self.assertIn(b'https://d3d4yli4hf5bmh.cloudfront.net/hls/live.m3u8', page.data)
        with self.client.get('/static/style.css') as style:
            self.assertEqual(style.status_code, 200)
        with self.client.get('/static/player.js') as script:
            self.assertIn('javascript', script.content_type)
            self.assertIn(b'https://d3d4yli4hf5bmh.cloudfront.net/hls/live.m3u8', script.data)
        with self.client.get('/static/metadata.js') as metadata:
            self.assertEqual(metadata.status_code, 200)
            self.assertIn('javascript', metadata.content_type)
        with self.client.get('/static/ratings.js') as ratings_script:
            self.assertEqual(ratings_script.status_code, 200)
            self.assertIn('javascript', ratings_script.content_type)
        with self.client.get('/static/images/radio-calico-logo.png') as logo:
            self.assertEqual(logo.status_code, 200)
            self.assertEqual(logo.content_type, 'image/png')
        self.assertEqual(self.client.head('/').data, b'')
        self.assertEqual(self.client.post('/').status_code, 405)

    def test_health_queries_database(self):
        health = self.client.get('/api/health')
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json, {'status': 'ok', 'database': 'connected', 'engine': 'sqlite'})

    def test_module_and_stylesheet_imports_are_served(self):
        page = self.client.get('/').get_data(as_text=True)
        self.assertIn('type="module" src="/static/main.js"', page)
        visited = set()

        def check_asset(url):
            if url in visited:
                return
            visited.add(url)
            with self.client.get(url) as response:
                self.assertEqual(response.status_code, 200, url)
                source = response.get_data(as_text=True)
                if url.endswith('.js'):
                    self.assertIn('javascript', response.content_type)
                    imports = re.findall(r"from ['\"]([^'\"]+)['\"]", source)
                else:
                    self.assertIn('text/css', response.content_type)
                    imports = re.findall(r"@import url\(['\"]([^'\"]+)['\"]\)", source)
            for target in imports:
                if not target.startswith('https://'):
                    check_asset(urljoin(url, target))

        check_asset('/static/main.js')
        check_asset('/static/style.css')
        self.assertIn('/static/player/hls-loader.js', visited)
        self.assertIn('/static/ratings-api.js', visited)
        self.assertIn('/static/styles/responsive.css', visited)

    def test_playback_diagnostics_log_only_playback_fields(self):
        with self.assertLogs(self.app.logger, level='WARNING') as log:
            response = self.client.post('/api/playback-diagnostics', json={
                'event': 'waiting', 'engine': 'HLS.js', 'fragmentsLoaded': 2,
                'fragmentsBuffered': 1, 'unrelated': 'must not appear',
            })
        self.assertEqual(response.status_code, 204)
        self.assertIn('HLS.js', log.output[0])
        self.assertIn('fragmentsLoaded', log.output[0])
        self.assertNotIn('must not appear', log.output[0])
        self.assertEqual(self.client.post('/api/playback-diagnostics', json=[]).status_code, 400)
        self.assertEqual(self.client.post('/api/playback-diagnostics', json={'event': 'other'}).status_code, 400)

    def test_playback_diagnostics_reject_invalid_bodies(self):
        for payload in ({}, {'event': []}, {'event': {}}, {'event': True}, None):
            with self.subTest(payload=payload):
                response = self.client.post('/api/playback-diagnostics', data=json.dumps(payload),
                                            content_type='application/json')
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json, {'error': 'Invalid playback diagnostic.'})
        self.assertEqual(self.client.post('/api/playback-diagnostics', data='plain text').status_code, 415)
        response = self.client.post('/api/playback-diagnostics', json={'event': 'waiting', 'engine': 'x' * 8192})
        self.assertEqual(response.status_code, 413)

    def test_health_reports_database_failure(self):
        with patch('app.get_db', side_effect=sqlite3.OperationalError('unavailable')):
            with self.assertLogs(self.app.logger, level='ERROR'):
                response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json['database'], 'unavailable')

    def test_private_files_are_not_served(self):
        for url in ['/.env', '/app.py', '/database.py', '/data/radiocalico.sqlite', '/static/../.env', '/api/missing']:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)

    def test_database_persists_across_application_restarts(self):
        with self.app.app_context():
            database = get_db()
            created_at = database.execute("SELECT value FROM app_metadata WHERE key = 'created_at'").fetchone()[0]
            database.execute('INSERT INTO app_metadata (key, value) VALUES (?, ?)', ('test', 'persisted'))
            database.commit()
        reopened_app = create_app({'TESTING': True, 'DATABASE_PATH': self.database_path, 'DATABASE_URL': ''})
        with reopened_app.app_context():
            database = get_db()
            self.assertEqual(database.execute("SELECT value FROM app_metadata WHERE key = 'test'").fetchone()[0], 'persisted')
            self.assertEqual(database.execute("SELECT value FROM app_metadata WHERE key = 'created_at'").fetchone()[0], created_at)
            self.assertEqual(database.execute('PRAGMA foreign_keys').fetchone()[0], 1)
            self.assertEqual(database.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
            self.assertEqual(database.execute('PRAGMA busy_timeout').fetchone()[0], 5000)


if __name__ == '__main__':
    unittest.main()
