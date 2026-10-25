"""SQLite connections belong to the current Flask application context."""

import sqlite3
import secrets
from pathlib import Path

from flask import current_app, g


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(current_app.config['DATABASE_PATH'], timeout=5)
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA foreign_keys = ON')
    return g.db


def close_db(_error=None):
    database = g.pop('db', None)
    if database is not None:
        database.close()


def init_db():
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
