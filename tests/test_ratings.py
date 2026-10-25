import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import Mock, patch

from app import create_app
from database import INTEGRITY_ERRORS, get_db, parameter
from tests.support import RatingsTestCase


class RatingsIntegrationTests(RatingsTestCase):
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
            self.assertEqual(get_db().execute('SELECT COUNT(*) AS count FROM song_ratings').fetchone()['count'], 1)

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
            with self.assertRaises(INTEGRITY_ERRORS):
                placeholders = ', '.join([parameter()] * 5)
                get_db().execute(f'INSERT INTO song_ratings (song_key, listener_id, title, artist, rating) VALUES ({placeholders})', ('song', 'listener', 'Song', 'Artist', 0))

    def test_a_token_without_its_session_cannot_save_a_vote(self):
        token = self.read().json['csrf_token']
        stranger = self.app.test_client()
        response = stranger.post('/api/ratings', json={**self.song, 'rating': 1},
                                 headers={'X-CSRF-Token': token})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.read().json['thumbs_up'], 0)

    def test_tampered_cookie_cannot_read_or_change_the_original_choice(self):
        self.vote(1)
        token = self.read().json['csrf_token']
        cookie_name = self.app.config['SESSION_COOKIE_NAME']
        cookie = self.client.get_cookie(cookie_name).value
        payload, signature = cookie.rsplit('.', 1)
        corrupted = payload + '.' + ('A' if signature[0] != 'A' else 'B') + signature[1:]
        stranger = self.app.test_client()
        stranger.set_cookie(cookie_name, corrupted)
        response = stranger.post('/api/ratings', json={**self.song, 'rating': -1},
                                 headers={'X-CSRF-Token': token})
        self.assertEqual(response.status_code, 403)
        self.assertIsNone(self.read(stranger).json['user_rating'])
        self.assertEqual(self.read().json['user_rating'], 1)

    def test_malformed_and_non_object_json_is_rejected_without_writes(self):
        token = self.read().json['csrf_token']
        for body in ('{', 'null', '[]', '"text"', '1', 'true'):
            with self.subTest(body=body):
                response = self.client.post('/api/ratings', data=body, content_type='application/json',
                                            headers={'X-CSRF-Token': token})
                self.assertEqual(response.status_code, 400)
                self.assertIn('error', response.json)
        self.assertEqual(self.read().json['thumbs_up'], 0)

    def test_non_json_and_oversized_authenticated_requests_are_rejected(self):
        token = self.read().json['csrf_token']
        headers = {'X-CSRF-Token': token}
        self.assertEqual(self.client.post('/api/ratings', data='rating=1', headers=headers).status_code, 415)
        response = self.client.post('/api/ratings', json={**self.song, 'rating': 1, 'padding': 'x' * 4096},
                                    headers=headers)
        self.assertEqual(response.status_code, 413)
        self.assertIn('error', response.json)
        self.assertEqual(self.read().json['thumbs_up'], 0)

    def test_get_rejects_missing_blank_and_oversized_song_fields(self):
        for song in ({}, {'title': 'Song'}, {'artist': 'Artist'},
                     {'title': ' \t ', 'artist': 'Artist'},
                     {'title': 'Song', 'artist': 'x' * 301}):
            with self.subTest(song=song):
                self.assertEqual(self.read(song=song).status_code, 400)

    def test_api_accepts_300_characters_and_rejects_301_for_each_field(self):
        token = self.read().json['csrf_token']
        for field in ('title', 'artist'):
            with self.subTest(field=field):
                song = {**self.song, field: 'x' * 300}
                self.assertEqual(self.read(song=song).status_code, 200)
                self.assertEqual(self.vote(1, song=song, token=token).status_code, 200)
                invalid = {**song, field: 'x' * 301}
                self.assertEqual(self.read(song=invalid).status_code, 400)
                self.assertEqual(self.vote(-1, song=invalid, token=token).status_code, 400)
                self.assertEqual(self.read(song=song).json['user_rating'], 1)

    def test_sql_and_commit_failures_roll_back_and_preserve_the_previous_vote(self):
        token = self.read().json['csrf_token']
        self.vote(-1, token=token)
        for method in ('execute', 'commit'):
            with self.subTest(method=method), self.app.app_context():
                database = Mock(wraps=get_db())
                getattr(database, method).side_effect = sqlite3.OperationalError('injected failure')
                with patch('ratings.get_db', return_value=database), self.assertLogs(self.app.logger, level='ERROR'):
                    response = self.vote(1, token=token)
                self.assertEqual(response.status_code, 503)
                database.rollback.assert_called_once()
            self.assertEqual(self.read().json['user_rating'], -1)
            self.assertEqual(self.read().json['thumbs_up'], 0)

    def test_read_failure_after_commit_can_be_confirmed_and_retried_without_duplicates(self):
        token = self.read().json['csrf_token']
        with patch('ratings.totals', side_effect=sqlite3.OperationalError('read failed after commit')):
            with self.assertLogs(self.app.logger, level='ERROR'):
                self.assertEqual(self.vote(1, token=token).status_code, 503)
        self.assertEqual(self.read().json['user_rating'], 1)
        self.assertEqual(self.vote(1, token=token).status_code, 200)
        self.assertEqual(self.read().json['thumbs_up'], 1)
        with self.app.app_context():
            self.assertEqual(get_db().execute('SELECT COUNT(*) AS count FROM song_ratings').fetchone()['count'], 1)

    def test_rollback_failure_still_returns_an_actionable_database_error(self):
        token = self.read().json['csrf_token']
        database = Mock()
        database.execute.side_effect = sqlite3.OperationalError('connection lost')
        database.rollback.side_effect = sqlite3.OperationalError('connection is closed')
        with patch('ratings.get_db', return_value=database), self.assertLogs(self.app.logger, level='ERROR'):
            response = self.vote(1, token=token)
        self.assertEqual(response.status_code, 503)
        self.assertIn('error', response.json)

    def test_changing_a_vote_preserves_its_creation_timestamp(self):
        self.vote(1)
        with self.app.app_context():
            database = get_db()
            database.execute(f'UPDATE song_ratings SET created_at = {parameter()}', ('2000-01-01T00:00:00Z',))
            database.commit()
        self.vote(-1)
        with self.app.app_context():
            self.assertEqual(get_db().execute('SELECT created_at FROM song_ratings').fetchone()['created_at'],
                             '2000-01-01T00:00:00Z')
