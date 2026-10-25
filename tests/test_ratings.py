import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

from app import create_app
from database import get_db


class RatingsIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='radiocalico-ratings-')
        self.addCleanup(self.directory.cleanup)
        self.database_path = Path(self.directory.name) / 'ratings.sqlite'
        self.config = {'TESTING': True, 'DATABASE_PATH': self.database_path}
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.song = {'title': 'A Song', 'artist': 'An Artist'}

    def read(self, client=None, song=None):
        return (client or self.client).get('/api/ratings', query_string=self.song if song is None else song)

    def vote(self, value, client=None, song=None, token=None):
        client = client or self.client
        song = song or self.song
        token = token or self.read(client, song).json['csrf_token']
        return client.post('/api/ratings', json={**song, 'rating': value}, headers={'X-CSRF-Token': token})

    def test_first_read_returns_zero_totals_and_a_persistent_private_cookie(self):
        response = self.read()
        self.assertEqual(response.status_code, 200)
        self.assertEqual((response.json['thumbs_up'], response.json['thumbs_down'], response.json['user_rating']), (0, 0, None))
        self.assertTrue(response.json['csrf_token'])
        cookie = response.headers['Set-Cookie']
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Lax', cookie)
        self.assertIn('Expires=', cookie)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_vote_can_change_repeatedly_without_adding_votes(self):
        for value in (1, 1, -1, -1, 1, -1, 1):
            response = self.vote(value)
            self.assertEqual(response.status_code, 200)
            self.assertEqual((response.json['thumbs_up'], response.json['thumbs_down'], response.json['user_rating']),
                             (int(value == 1), int(value == -1), value))
        with self.app.app_context():
            self.assertEqual(get_db().execute('SELECT COUNT(*) FROM song_ratings').fetchone()[0], 1)

    def test_shared_totals_keep_each_listeners_vote_separate(self):
        second = self.app.test_client()
        self.vote(1)
        self.assertEqual(self.read(second).json['user_rating'], None)
        self.assertEqual(self.vote(-1, second).status_code, 200)
        for client, expected in ((self.client, 1), (second, -1)):
            response = self.read(client).json
            self.assertEqual((response['thumbs_up'], response['thumbs_down'], response['user_rating']), (1, 1, expected))
        self.vote(-1)
        self.assertEqual((self.read().json['thumbs_up'], self.read().json['thumbs_down']), (0, 2))
        self.assertEqual(self.read(second).json['user_rating'], -1)

    def test_same_title_by_different_artists_is_a_different_song(self):
        self.vote(1)
        other = {'title': self.song['title'], 'artist': 'Other Artist'}
        self.assertEqual(self.vote(-1, song=other).status_code, 200)
        self.assertEqual(self.read().json['thumbs_down'], 0)
        self.assertEqual(self.read(song=other).json['thumbs_up'], 0)

    def test_case_whitespace_and_unicode_variations_update_the_same_vote(self):
        self.vote(1)
        equivalent = {'title': '  Ａ   SONG ', 'artist': ' an   ARTIST '}
        self.assertEqual(self.vote(-1, song=equivalent).status_code, 200)
        self.assertEqual(self.read(song=equivalent).json['thumbs_up'], 0)
        self.assertEqual(self.read(song=equivalent).json['thumbs_down'], 1)

    def test_votes_and_browser_identity_survive_application_restart(self):
        self.vote(-1)
        cookie = self.client.get_cookie(self.app.config['SESSION_COOKIE_NAME'])
        reopened = create_app(self.config)
        client = reopened.test_client()
        client.set_cookie(self.app.config['SESSION_COOKIE_NAME'], cookie.value)
        response = client.get('/api/ratings', query_string=self.song)
        self.assertEqual((response.json['thumbs_down'], response.json['user_rating']), (1, -1))
        self.assertEqual(self.vote(1, client).status_code, 200)
        self.assertEqual(self.read(client).json['thumbs_down'], 0)
        self.assertEqual(self.read(client).json['thumbs_up'], 1)

    def test_missing_foreign_and_invalid_csrf_tokens_cannot_save_votes(self):
        own = self.read().json['csrf_token']
        foreign = self.read(self.app.test_client()).json['csrf_token']
        for token in ('', 'wrong', foreign, 'é'):
            response = self.client.post('/api/ratings', json={**self.song, 'rating': 1}, headers={'X-CSRF-Token': token})
            self.assertEqual(response.status_code, 403)
        self.assertEqual(self.vote(1, token=own).status_code, 200)

    def test_invalid_ratings_and_song_fields_are_rejected(self):
        token = self.read().json['csrf_token']
        headers = {'X-CSRF-Token': token}
        for value in (0, 2, -2, True, 1.0, '1', None):
            response = self.client.post('/api/ratings', json={**self.song, 'rating': value}, headers=headers)
            self.assertEqual(response.status_code, 400)
        for song in ({}, {'title': '', 'artist': 'Artist'}, {'title': 'Song', 'artist': 5}, {'title': 'x' * 301, 'artist': 'Artist'}):
            response = self.client.post('/api/ratings', json={**song, 'rating': 1}, headers=headers)
            self.assertEqual(response.status_code, 400)
        for payload in ([], None, 'not an object'):
            response = self.client.post('/api/ratings', json=payload, headers=headers)
            self.assertIn(response.status_code, (400, 415))
        self.assertEqual(self.read().json['thumbs_up'], 0)

    def test_client_cannot_select_another_listener_identity(self):
        token = self.read().json['csrf_token']
        for listener_id in ('first', 'second'):
            response = self.client.post('/api/ratings', json={**self.song, 'rating': 1, 'listener_id': listener_id}, headers={'X-CSRF-Token': token})
            self.assertEqual(response.status_code, 200)
        self.assertEqual(self.read().json['thumbs_up'], 1)

    def test_concurrent_votes_from_the_same_browser_save_one_row(self):
        token = self.read().json['csrf_token']
        cookie = self.client.get_cookie(self.app.config['SESSION_COOKIE_NAME'])
        barrier = Barrier(2)

        def send(value):
            client = self.app.test_client()
            client.set_cookie(self.app.config['SESSION_COOKIE_NAME'], cookie.value)
            barrier.wait(timeout=5)
            return self.vote(value, client, token=token).status_code

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(send, (1, -1)))
        self.assertEqual(results, [200, 200])
        totals = self.read().json
        self.assertEqual(totals['thumbs_up'] + totals['thumbs_down'], 1)

    def test_sql_like_song_names_are_saved_as_data(self):
        song = {'title': "Song'); DROP TABLE song_ratings; --", 'artist': '<script>artist</script>'}
        self.assertEqual(self.vote(1, song=song).status_code, 200)
        self.assertEqual(self.read(song=song).json['thumbs_up'], 1)

    def test_database_failure_returns_an_actionable_error(self):
        token = self.read().json['csrf_token']
        with patch('ratings.get_db', side_effect=sqlite3.OperationalError('unavailable')):
            with self.assertLogs(self.app.logger, level='ERROR'):
                self.assertEqual(self.read().status_code, 503)
            with self.assertLogs(self.app.logger, level='ERROR'):
                self.assertEqual(self.vote(1, token=token).status_code, 503)

    def test_database_itself_rejects_invalid_ratings(self):
        with self.app.app_context():
            with self.assertRaises(sqlite3.IntegrityError):
                get_db().execute('INSERT INTO song_ratings (song_key, listener_id, title, artist, rating) VALUES (?, ?, ?, ?, ?)', ('song', 'listener', 'Song', 'Artist', 0))
