"""Keep the shared test command from hiding failed suites or missing runtimes."""

from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from scripts.test import main


class TestRunnerTests(unittest.TestCase):
    def run_runner(self, args, results):
        with patch('scripts.test.subprocess.run', side_effect=results) as run:
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                code = main(args)
        return code, run.call_args_list

    def test_backend_failure_still_runs_frontend_and_returns_failure(self):
        code, calls = self.run_runner([], [SimpleNamespace(returncode=1), SimpleNamespace(returncode=0)])
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1].args[0][0], 'node')

    def test_frontend_failure_is_not_hidden_by_backend_success(self):
        code, _ = self.run_runner([], [SimpleNamespace(returncode=0), SimpleNamespace(returncode=1)])
        self.assertEqual(code, 1)

    def test_missing_node_returns_failure(self):
        code, _ = self.run_runner(['--frontend'], [FileNotFoundError('node')])
        self.assertEqual(code, 1)

    def test_ratings_selection_includes_unit_integration_and_api_tests(self):
        code, calls = self.run_runner(['--ratings'], [SimpleNamespace(returncode=0)] * 2)
        self.assertEqual(code, 0)
        self.assertIn('test_ratings*.py', calls[0].args[0])
        files = [Path(argument).name for argument in calls[1].args[0][2:]]
        self.assertIn('ratings-api.test.cjs', files)
        self.assertIn('ratings.test.cjs', files)
        self.assertNotIn('player.test.cjs', files)
        self.assertNotIn('metadata.test.cjs', files)

    def test_backend_selection_does_not_require_node(self):
        code, calls = self.run_runner(['--backend'], [SimpleNamespace(returncode=0)])
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 1)
