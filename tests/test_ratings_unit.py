"""Rating domain and session tests; no database or HTTP server is needed."""

import unittest

from flask import Flask, session

from ratings import ensure_listener, song_identity


class SongIdentityTests(unittest.TestCase):
    def test_equivalent_unicode_case_and_whitespace_share_a_key(self):
        title, artist, key = song_identity({'title': '  Ａ\tSONG ', 'artist': ' Straße\n '})
        self.assertEqual((title, artist), ('A SONG', 'Straße'))
        self.assertEqual(key, song_identity({'title': 'a song', 'artist': 'STRASSE'})[2])

    def test_composed_and_decomposed_unicode_share_a_key(self):
        self.assertEqual(song_identity({'title': 'Café', 'artist': 'Artist'})[2],
                         song_identity({'title': 'Cafe\u0301', 'artist': 'Artist'})[2])

    def test_distinct_title_artist_pairs_do_not_collide_at_field_boundaries(self):
        keys = {song_identity(song)[2] for song in (
            {'title': 'ab', 'artist': 'c'}, {'title': 'a', 'artist': 'bc'},
            {'title': 'ab', 'artist': 'other'}, {'title': 'other', 'artist': 'c'},
        )}
        self.assertEqual(len(keys), 4)

    def test_length_limits_apply_after_normalization(self):
        for field in ('title', 'artist'):
            for value in ('x', 'x' * 300, '  ' + 'x' * 300 + '  ', 'é' * 300):
                with self.subTest(field=field, length=len(value)):
                    song_identity({'title': 'Song', 'artist': 'Artist', field: value})
            for value in ('x' * 301, 'ﬃ' * 101):
                with self.subTest(field=field, value=value[:5]):
                    with self.assertRaises(ValueError):
                        song_identity({'title': 'Song', 'artist': 'Artist', field: value})

    def test_missing_blank_and_non_string_fields_are_rejected(self):
        for field in ('title', 'artist'):
            for value in (None, '', ' \t\n\u3000', 1, True, [], {}):
                with self.subTest(field=field, value=value):
                    with self.assertRaises(ValueError):
                        song_identity({'title': 'Song', 'artist': 'Artist', field: value})
            with self.assertRaises(ValueError):
                song_identity({other: 'value' for other in ('title', 'artist') if other != field})


class ListenerSessionTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config['SECRET_KEY'] = 'unit-test-only-secret'

    def test_first_use_creates_a_permanent_identity_and_csrf_token(self):
        with self.app.test_request_context('/'):
            ensure_listener()
            self.assertTrue(session['listener_id'])
            self.assertTrue(session['rating_csrf'])
            self.assertNotEqual(session['listener_id'], session['rating_csrf'])
            self.assertTrue(session.permanent)

    def test_repeat_use_preserves_identity_and_csrf_token(self):
        with self.app.test_request_context('/'):
            ensure_listener()
            original = dict(session)
            ensure_listener()
            self.assertEqual(dict(session), original)

    def test_separate_sessions_have_independent_identities_and_tokens(self):
        identities = []
        tokens = []
        for _ in range(2):
            with self.app.test_request_context('/'):
                ensure_listener()
                identities.append(session['listener_id'])
                tokens.append(session['rating_csrf'])
        self.assertNotEqual(*identities)
        self.assertNotEqual(*tokens)
