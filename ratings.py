"""Shared song votes, with one changeable rating per signed browser identity."""

import hashlib
import hmac
import json
import secrets
import sqlite3
import unicodedata

from flask import Blueprint, current_app, jsonify, request, session

from database import get_db

ratings = Blueprint('ratings', __name__)


def ensure_listener():
    if 'listener_id' not in session:
        session['listener_id'] = secrets.token_urlsafe(32)
        session['rating_csrf'] = secrets.token_urlsafe(32)
        session.permanent = True


def song_identity(data):
    values = []
    for field in ('title', 'artist'):
        value = data.get(field)
        if not isinstance(value, str):
            raise ValueError('A song title and artist are required.')
        value = ' '.join(unicodedata.normalize('NFKC', value).split())
        if not value or len(value) > 300:
            raise ValueError('Song title and artist must contain between 1 and 300 characters.')
        values.append(value)
    canonical = json.dumps([value.casefold() for value in values], ensure_ascii=False)
    return (*values, hashlib.sha256(canonical.encode('utf-8')).hexdigest())


def totals(song_key, title, artist):
    row = get_db().execute('''
        SELECT COALESCE(SUM(rating = 1), 0) AS thumbs_up,
               COALESCE(SUM(rating = -1), 0) AS thumbs_down,
               MAX(CASE WHEN listener_id = ? THEN rating END) AS user_rating
        FROM song_ratings WHERE song_key = ?
    ''', (session['listener_id'], song_key)).fetchone()
    return dict(row, title=title, artist=artist, csrf_token=session['rating_csrf'])


@ratings.get('/api/ratings')
def get_ratings():
    try:
        title, artist, song_key = song_identity(request.args)
    except ValueError as error:
        return jsonify(error=str(error)), 400
    ensure_listener()
    try:
        return jsonify(totals(song_key, title, artist))
    except sqlite3.Error:
        current_app.logger.exception('Could not read song ratings')
        return jsonify(error='Ratings are temporarily unavailable.'), 503


@ratings.post('/api/ratings')
def submit_rating():
    request.max_content_length = 4096
    if not request.is_json:
        return jsonify(error='Send the rating as JSON.'), 415
    token = request.headers.get('X-CSRF-Token', '')
    expected = session.get('rating_csrf', '')
    if not session.get('listener_id') or not expected or not hmac.compare_digest(token.encode('utf-8'), expected.encode('utf-8')):
        return jsonify(error='Refresh the page and enable cookies before rating a song.'), 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error='Send a song title, artist, and rating.'), 400
    try:
        title, artist, song_key = song_identity(data)
    except ValueError as error:
        return jsonify(error=str(error)), 400
    rating = data.get('rating')
    if type(rating) is not int or rating not in (-1, 1):
        return jsonify(error='Rating must be 1 (thumbs up) or -1 (thumbs down).'), 400
    database = None
    try:
        database = get_db()
        # Replace the listener's choice atomically, without adding another vote.
        database.execute('''
            INSERT INTO song_ratings (song_key, listener_id, title, artist, rating)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (song_key, listener_id) DO UPDATE SET rating = excluded.rating
        ''', (song_key, session['listener_id'], title, artist, rating))
        database.commit()
        result = totals(song_key, title, artist)
        return jsonify(result), 200
    except sqlite3.Error:
        if database is not None:
            database.rollback()
        current_app.logger.exception('Could not save song rating')
        return jsonify(error='Your rating could not be saved. Please try again.'), 503
