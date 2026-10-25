"""Probe the running HTTP server and its database using only the standard library."""

import json
import sys
from urllib.request import urlopen


def main():
    try:
        with urlopen('http://127.0.0.1:3000/api/health', timeout=3) as response:
            data = json.load(response)
        return int(data != {'status': 'ok', 'database': 'connected', 'engine': 'sqlite'})
    except (OSError, ValueError):
        return 1


if __name__ == '__main__':
    sys.exit(main())
