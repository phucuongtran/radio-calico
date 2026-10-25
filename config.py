"""Read local settings, with environment overrides for database and HTTP configuration."""

import configparser
import os
from pathlib import Path
from urllib.parse import urlsplit

PROJECT_DIRECTORY = Path(__file__).resolve().parent


def load_settings():
    settings = configparser.ConfigParser(interpolation=None)
    env_file = PROJECT_DIRECTORY / '.env'
    settings.read_string('[local]\n' + (env_file.read_text(encoding='utf-8') if env_file.exists() else ''))

    def value(name, default):
        return os.environ.get(name, settings.get('local', name, fallback=default)).strip().strip('\"\'')

    port = int(value('PORT', '3000'))
    if not 1 <= port <= 65535:
        raise ValueError('PORT must be between 1 and 65535.')
    database_url = value('DATABASE_URL', '')
    if database_url and urlsplit(database_url).scheme not in ('postgresql', 'postgres'):
        raise ValueError('DATABASE_URL must use postgresql:// or postgres://.')
    return {'PORT': port, 'DATABASE_PATH': value('DATABASE_PATH', './data/radiocalico.sqlite'),
            'DATABASE_URL': database_url}
