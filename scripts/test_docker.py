"""Build and smoke-test both Compose environments using disposable projects and data."""

import json
import os
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
message = Request('http://127.0.0.1:3000' + request['path'], data=data,
                  headers=headers, method=request['method'])
try:
    response = urlopen(message, timeout=5)
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


def http(container, path, environment, method='GET', body=None, cookie=None, csrf=None):
    request = dict(path=path, method=method, body=body, cookie=cookie, csrf=csrf)
    result = docker('exec', '-i', container, 'python', '-c', HTTP_PROBE,
                    environment=environment, capture=True, input=json.dumps(request))
    return json.loads(result.stdout)


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def smoke_test(mode):
    project = f'radiocalico-smoke-{mode}-{uuid.uuid4().hex[:10]}'
    environment = {**os.environ, 'DEV_PORT': '0', 'PROD_PORT': '0',
                   'PROD_BIND': '127.0.0.1', 'RADIO_CALICO_IMAGE': project}
    compose_args = ['compose', '-p', project, '-f', f'compose.{mode}.yaml']

    def compose(*arguments, **kwargs):
        return docker(*compose_args, *arguments, environment=environment, **kwargs)

    try:
        compose('config', '--quiet')
        compose('up', '--build', '--detach', '--wait', '--wait-timeout', '90')
        container = compose('ps', '-q', 'app', capture=True).stdout.strip()
        uid = docker('exec', container, 'id', '-u', environment=environment, capture=True).stdout.strip()
        require(uid == '10001', f'{mode}: application is not running as the expected non-root user')
        health = http(container, '/api/health', environment)
        require(health['status'] == 200 and json.loads(health['body'])['database'] == 'connected',
                f'{mode}: health check failed')
        for path in ('/', '/static/main.js', '/static/ratings-api.js', '/static/style.css'):
            require(http(container, path, environment)['status'] == 200, f'{mode}: cannot serve {path}')
        require(http(container, '/.env', environment)['status'] == 404, f'{mode}: private file was served')

        song = {'title': 'Docker smoke song', 'artist': 'Temporary listener'}
        query = '/api/ratings?' + urlencode(song)
        first = http(container, query, environment)
        summary = json.loads(first['body'])
        require(first['status'] == 200 and summary['thumbs_up'] == 0, f'{mode}: unexpected initial totals')
        cookie = first['headers']['set-cookie'].split(';', 1)[0]
        csrf = summary['csrf_token']
        for rating in (1, 1, -1):
            response = http(container, '/api/ratings', environment, 'POST',
                            {**song, 'rating': rating}, cookie, csrf)
            totals = json.loads(response['body'])
            require(response['status'] == 200 and totals['user_rating'] == rating,
                    f'{mode}: vote was not saved')
            require(totals['thumbs_up'] + totals['thumbs_down'] == 1, f'{mode}: duplicate vote')
        forbidden = http(container, '/api/ratings', environment, 'POST', {**song, 'rating': 1}, cookie)
        require(forbidden['status'] == 403, f'{mode}: missing CSRF token was accepted')

        compose('up', '--detach', '--force-recreate', '--wait', '--wait-timeout', '90')
        container = compose('ps', '-q', 'app', capture=True).stdout.strip()
        persisted = json.loads(http(container, query, environment, cookie=cookie)['body'])
        require(persisted['user_rating'] == -1 and persisted['thumbs_down'] == 1,
                f'{mode}: database or signed listener identity did not survive recreation')
        require(persisted['csrf_token'] == csrf, f'{mode}: session signing secret changed')
        docker('exec', container, 'python', '/usr/local/bin/radio-calico-healthcheck.py', environment=environment)

        if mode == 'dev':
            compose('run', '--rm', '--no-deps', 'app', 'python', 'scripts/test.py')
        else:
            config = json.loads(docker('inspect', container, environment=environment, capture=True).stdout)[0]
            require(config['HostConfig']['ReadonlyRootfs'], 'prod: root filesystem is writable')
            require(not any(mount['Type'] == 'bind' for mount in config['Mounts']), 'prod: source bind mount found')
            docker('exec', container, 'python', '-c',
                   "from pathlib import Path; paths = ['.env', '.git', '.venv', 'tests', 'test']; "
                   "assert not any((Path('/app') / path).exists() for path in paths)", environment=environment)
        print(f'{mode}: HTTP, assets, votes, CSRF, health, non-root user and persistence PASS', flush=True)
    except Exception:
        compose('logs', '--no-color', check=False)
        raise
    finally:
        # These randomly named projects contain only data generated by this test.
        compose('down', '--volumes', '--remove-orphans', check=False)
        tag = 'development' if mode == 'dev' else 'production'
        docker('image', 'rm', f'{project}:{tag}', environment=environment, check=False)


if __name__ == '__main__':
    for mode in ('dev', 'prod'):
        smoke_test(mode)
