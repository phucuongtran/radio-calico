import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from config import load_settings


class DatabaseConfigurationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='radiocalico-config-')
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        patches = [patch('config.PROJECT_DIRECTORY', self.root),
                   patch.dict(os.environ, {'PORT': '3000', 'DATABASE_URL': '',
                                           'DATABASE_PATH': './data/radiocalico.sqlite'})]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_empty_url_keeps_sqlite_settings(self):
        settings = load_settings()
        self.assertEqual(settings['DATABASE_URL'], '')
        self.assertEqual(settings['DATABASE_PATH'], './data/radiocalico.sqlite')

    def test_postgresql_urls_and_libpq_environment_configuration_are_supported(self):
        for url in ('postgresql://', 'postgres://user:password@db/example'):
            with self.subTest(url=url), patch.dict(os.environ, {'DATABASE_URL': url}):
                self.assertEqual(load_settings()['DATABASE_URL'], url)

    def test_environment_takes_precedence_over_dotenv(self):
        (self.root / '.env').write_text('DATABASE_URL=postgresql://file-db/example\n')
        with patch.dict(os.environ, {'DATABASE_URL': 'postgresql://environment-db/example'}):
            self.assertEqual(load_settings()['DATABASE_URL'], 'postgresql://environment-db/example')

    def test_unsupported_url_is_rejected_without_echoing_credentials(self):
        with patch.dict(os.environ, {'DATABASE_URL': 'mysql://user:private-password@db/example'}):
            with self.assertRaises(ValueError) as error:
                load_settings()
        self.assertNotIn('private-password', str(error.exception))
