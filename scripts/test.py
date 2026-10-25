"""Run backend and frontend tests from any working directory, without npm dependencies."""

import argparse
from pathlib import Path
import subprocess
import sys

PROJECT_DIRECTORY = Path(__file__).resolve().parents[1]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ratings', action='store_true', help='Run only rating tests')
    suites = parser.add_mutually_exclusive_group()
    suites.add_argument('--backend', action='store_true', help='Run only Python tests')
    suites.add_argument('--frontend', action='store_true', help='Run only JavaScript tests')
    args = parser.parse_args(argv)
    commands = []
    if not args.frontend:
        pattern = 'test_ratings*.py' if args.ratings else 'test*.py'
        commands.append(('Backend', [sys.executable, '-m', 'unittest', 'discover',
                                    '-s', 'tests', '-t', '.', '-p', pattern, '-v']))
    if not args.backend:
        pattern = 'ratings*.test.cjs' if args.ratings else '*.test.cjs'
        files = sorted((PROJECT_DIRECTORY / 'test').glob(pattern))
        if not files:
            parser.error('No frontend test files found.')
        commands.append(('Frontend', ['node', '--test', *map(str, files)]))
    results = []
    for name, command in commands:
        print(f'Running {name} tests', flush=True)
        try:
            code = subprocess.run(command, cwd=PROJECT_DIRECTORY, check=False).returncode
        except OSError as error:
            print(f'{name}: {error}', file=sys.stderr, flush=True)
            code = 1
        results.append((name, code))
    for name, code in results:
        print(f'{name}: {"PASS" if code == 0 else "FAIL"}', flush=True)
    return int(any(code != 0 for _, code in results))


if __name__ == '__main__':
    sys.exit(main())
