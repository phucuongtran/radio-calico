"""Build verification must propagate errors and remove only its temporary tags."""

from contextlib import redirect_stdout
from io import StringIO
import subprocess
import unittest
from unittest.mock import patch

from scripts.test_docker import build_images


class BuildRunnerTests(unittest.TestCase):
    def test_success_builds_all_targets_and_cleans_only_its_tags(self):
        with patch('scripts.test_docker.docker') as docker, redirect_stdout(StringIO()):
            build_images()
        calls = docker.call_args_list
        builds = [call.args for call in calls if call.args[0] == 'build']
        removals = [call for call in calls if call.args[:2] == ('image', 'rm')]
        self.assertEqual([args[2] for args in builds], ['development', 'production', 'frontend'])
        self.assertEqual([call.args[2] for call in removals], [args[4] for args in builds])
        self.assertTrue(all(args[4].startswith('radiocalico-build-') for args in builds))
        self.assertTrue(all(call.kwargs['check'] is False for call in removals))
        self.assertEqual(len(calls), 6)

    def test_failed_build_is_not_hidden_and_attempted_tags_are_cleaned(self):
        error = subprocess.CalledProcessError(1, ['docker', 'build'])
        with patch('scripts.test_docker.docker', side_effect=[None, error, None, None]) as docker:
            with redirect_stdout(StringIO()), self.assertRaises(subprocess.CalledProcessError):
                build_images()
        calls = docker.call_args_list
        self.assertEqual(len(calls), 4)
        self.assertEqual([call.args[2] for call in calls[2:]], [call.args[4] for call in calls[:2]])
