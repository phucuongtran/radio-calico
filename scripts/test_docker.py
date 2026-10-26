"""Build and smoke-test both Compose environments using disposable projects and data."""

import argparse
import json
import os
import secrets
from pathlib import Path
import subprocess
import uuid
from urllib.parse import urlencode

PROJECT_DIRECTORY = Path(__file__).resolve().parents[1]
HTTP_PROBE = '''
import json
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

request = json.load(sys.stdin)
headers = {}
if request['cookie']:
    headers['Cookie'] = request['cookie']
if request['csrf']:
    headers['X-CSRF-Token'] = request['csrf']
data = None
if request['body'] is not None:
    data = json.dumps(request['body']).encode()
    headers['Content-Type'] = 'application/json'
message = Request(request['origin'] + request['path'], data=data,
                  headers=headers, method=request['method'])
try:
    # Allow the backend's five-second database connection timeout to complete.
    response = urlopen(message, timeout=15)
except HTTPError as error:
    response = error
with response:
    print(json.dumps({'status': response.status,
                      'headers': {key.lower(): value for key, value in response.headers.items()},
                      'body': response.read().decode()}))
'''


def docker(*arguments, environment, capture=False, input=None, check=True):
    return subprocess.run(['docker', *arguments], cwd=PROJECT_DIRECTORY, env=environment,
                          text=True, input=input, stdout=subprocess.PIPE if capture else None,
                          check=check)


def http(container, path, environment, method='GET', body=None, cookie=None, csrf=None,
         origin='http://127.0.0.1:3000'):
    request = dict(path=path, method=method, body=body, cookie=cookie, csrf=csrf, origin=origin)
    result = docker('exec', '-i', container, 'python', '-c', HTTP_PROBE,
                    environment=environment, capture=True, input=json.dumps(request))
    return json.loads(result.stdout)


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def build_images():
    """Check every deployable target without starting services or touching volumes."""
    environment = os.environ.copy()
    prefix = f'radiocalico-build-{uuid.uuid4().hex[:10]}'
    images = []
    try:
        for target in ('development', 'production', 'frontend'):
            image = f'{prefix}:{target}'
            images.append(image)
            print(f'Building Docker target: {target}', flush=True)
            docker('build', '--target', target, '--tag', image, '.', environment=environment)
    finally:
        # Remove only this run's tags; shared layers/cache remain available.
        for image in images:
            docker('image', 'rm', image, environment=environment, check=False)


def smoke_test(mode):
    project = f'radiocalico-smoke-{mode}-{uuid.uuid4().hex[:10]}'
    environment = {**os.environ, 'DEV_PORT': '0', 'PROD_PORT': '0',
                   'PROD_BIND': '127.0.0.1', 'RADIO_CALICO_IMAGE': project,
                   'POSTGRES_PASSWORD': secrets.token_urlsafe(32) + ':/@?#%$'}
    compose_args = ['compose', '-p', project, '-f', f'compose.{mode}.yaml']

    def compose(*arguments, **kwargs):
        return docker(*compose_args, *arguments, environment=environment, **kwargs)

    try:
        compose('config', '--quiet')
        compose('up', '--build', '--detach', '--wait', '--wait-timeout', '90')
        container = compose('ps', '-q', 'app', capture=True).stdout.strip()
        origin = 'http://web:8080' if mode == 'prod' else 'http://127.0.0.1:3000'

        def request(path, method='GET', body=None, cookie=None, csrf=None):
            return http(container, path, environment, method, body, cookie, csrf, origin)

        uid = docker('exec', container, 'id', '-u', environment=environment, capture=True).stdout.strip()
        require(uid == '10001', f'{mode}: application is not running as the expected non-root user')
        health = request('/api/health')
        require(health['status'] == 200 and json.loads(health['body'])['database'] == 'connected',
                f'{mode}: health check failed')
        engine = 'postgresql' if mode == 'prod' else 'sqlite'
        require(json.loads(health['body'])['engine'] == engine, f'{mode}: wrong database engine')
        for path in ('/', '/static/main.js', '/static/ratings-api.js', '/static/style.css'):
            require(request(path)['status'] == 200, f'{mode}: cannot serve {path}')
        require(request('/.env')['status'] == 404, f'{mode}: private file was served')

        song = {'title': 'Docker smoke song', 'artist': 'Temporary listener'}
        query = '/api/ratings?' + urlencode(song)
        first = request(query)
        summary = json.loads(first['body'])
        require(first['status'] == 200 and summary['thumbs_up'] == 0, f'{mode}: unexpected initial totals')
        cookie = first['headers']['set-cookie'].split(';', 1)[0]
        csrf = summary['csrf_token']
        for rating in (1, 1, -1):
            response = request('/api/ratings', 'POST', {**song, 'rating': rating}, cookie, csrf)
            totals = json.loads(response['body'])
            require(response['status'] == 200 and totals['user_rating'] == rating,
                    f'{mode}: vote was not saved')
            require(totals['thumbs_up'] + totals['thumbs_down'] == 1, f'{mode}: duplicate vote')
        forbidden = request('/api/ratings', 'POST', {**song, 'rating': 1}, cookie)
        require(forbidden['status'] == 403, f'{mode}: missing CSRF token was accepted')

        compose('up', '--detach', '--force-recreate', '--wait', '--wait-timeout', '90')
        container = compose('ps', '-q', 'app', capture=True).stdout.strip()
        persisted = json.loads(request(query, cookie=cookie)['body'])
        require(persisted['user_rating'] == -1 and persisted['thumbs_down'] == 1,
                f'{mode}: database or signed listener identity did not survive recreation')
        require(persisted['csrf_token'] == csrf, f'{mode}: session signing secret changed')
        docker('exec', container, 'python', '/usr/local/bin/radio-calico-healthcheck.py', environment=environment)

        if mode == 'dev':
            compose('run', '--rm', '--no-deps', 'app', 'python', 'scripts/test.py')
        else:
            compose('run', '--rm', '--no-deps',
                    '--volume', str(PROJECT_DIRECTORY / 'tests') + ':/app/tests:ro',
                    '--env', 'TEST_DATABASE_URL=postgresql://', 'app',
                    'python', '-m', 'unittest', 'tests.test_ratings_postgres', '-v')
            config = json.loads(docker('inspect', container, environment=environment, capture=True).stdout)[0]
            require(config['HostConfig']['ReadonlyRootfs'], 'prod: root filesystem is writable')
            require(not any(mount['Type'] == 'bind' for mount in config['Mounts']), 'prod: source bind mount found')
            require(not config['HostConfig']['PortBindings'], 'prod: backend port is published')
            web = compose('ps', '-q', 'web', capture=True).stdout.strip()
            web_config = json.loads(docker('inspect', web, environment=environment, capture=True).stdout)[0]
            require(web_config['HostConfig']['ReadonlyRootfs'], 'prod: frontend filesystem is writable')
            web_uid = docker('exec', web, 'id', '-u', environment=environment, capture=True).stdout.strip()
            require(web_uid != '0', 'prod: Nginx is running as root')
            db = compose('ps', '-q', 'db', capture=True).stdout.strip()
            db_config = json.loads(docker('inspect', db, environment=environment, capture=True).stdout)[0]
            require(not db_config['HostConfig']['PortBindings'], 'prod: PostgreSQL port is published')
            page = request('/')
            require('nginx' in page['headers'].get('server', ''), 'prod: homepage is not served by Nginx')
            require('{{' not in page['body'], 'prod: homepage still contains unrendered Jinja')
            oversized = request('/api/ratings', 'POST', {**song, 'rating': 1, 'padding': 'x' * 9000}, cookie, csrf)
            require(oversized['status'] == 413 and 'error' in json.loads(oversized['body']),
                    'prod: Nginx body limit does not return an API error')
            docker('exec', container, 'python', '-c',
                   "from pathlib import Path; paths = ['.env', '.git', '.venv', 'tests', 'test']; "
                   "assert not any((Path('/app') / path).exists() for path in paths)", environment=environment)
            # A database outage must surface as 503, then recover on the next request.
            compose('stop', 'db')
            require(request('/api/health')['status'] == 503, 'prod: database failure was not reported')
            compose('up', '--detach', '--wait', '--wait-timeout', '90', 'db')
            require(request('/api/health')['status'] == 200, 'prod: database recovery failed')
            # Static frontend remains available without the Python backend.
            compose('stop', 'app')
            static_page = docker('exec', web, 'wget', '-qO-', 'http://127.0.0.1:8080/',
                                 environment=environment, capture=True).stdout
            require('Radio Calico' in static_page, 'prod: static frontend depends on backend availability')
        print(f'{mode}: HTTP, assets, votes, CSRF, health, non-root user and persistence PASS', flush=True)
    except Exception:
        compose('logs', '--no-color', check=False)
        raise
    finally:
        # These randomly named projects contain only data generated by this test.
        compose('down', '--volumes', '--remove-orphans', check=False)
        tags = ['development'] if mode == 'dev' else ['production', 'frontend']
        for tag in tags:
            docker('image', 'rm', f'{project}:{tag}', environment=environment, check=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-only', action='store_true', help='Only build all three Docker targets')
    args = parser.parse_args()
    if args.build_only:
        build_images()
    else:
        for mode in ('dev', 'prod'):
            smoke_test(mode)
