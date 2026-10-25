"""Reusable Flask clients backed by a separate temporary SQLite database per test."""

from pathlib import Path
import tempfile
import unittest

from app import create_app


class RatingsTestCase(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='radiocalico-ratings-')
        self.addCleanup(self.directory.cleanup)
        self.database_path = Path(self.directory.name) / 'ratings.sqlite'
        self.config = {'TESTING': True, 'DATABASE_PATH': self.database_path, 'DATABASE_URL': ''}
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.song = {'title': 'A Song', 'artist': 'An Artist'}

    def read(self, client=None, song=None):
        client = self.client if client is None else client
        return client.get('/api/ratings', query_string=self.song if song is None else song)

    def vote(self, value, client=None, song=None, token=None):
        client = self.client if client is None else client
        song = self.song if song is None else song
        if token is None:
            token = self.read(client, song).json['csrf_token']
        return client.post('/api/ratings', json={**song, 'rating': value},
                           headers={'X-CSRF-Token': token})
