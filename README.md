# Radio Calico — Flask, PostgreSQL and Nginx

Radio Calico uses Flask 3.1.3 and Python 3.11. Development uses SQLite; Production uses PostgreSQL 17 and Nginx in front of the Gunicorn API. Open **http://127.0.0.1:3000** while the server is running. Local commands and Docker Compose bind to this computer by default.

## Docker Development and Production

With GNU Make available (Linux, macOS, or WSL), the shortcuts are:

```bash
make dev          # Development in the foreground
make env          # Create .env.docker once; set POSTGRES_PASSWORD before Production
make prod         # Production in the background
make test         # All tests in Docker; no host Python/Node needed
```

Run `make help` for all targets. `make dev-down` / `make prod-down` stop containers and preserve database volumes; `make dev-status` / `make prod-status` show status, and `make dev-logs` / `make prod-logs` follow logs. `make env` preserves an existing environment file. `make test-ratings`, `make test-backend`, and `make test-frontend` select a Docker test suite. Use `make test-local` for local Python/Node tests or `make test-docker` for isolated container smoke tests including real PostgreSQL (requires host Python 3). Tests without `TEST_DATABASE_URL` report the PostgreSQL integration cases as skipped; `make test-docker` runs them against a disposable database.

Override settings as needed, for example `make prod ENV_FILE=.env.docker` or `make test-local PYTHON=.venv/bin/python TEST_ARGS=--ratings`. Make inherits Docker environment variables such as `DOCKER_CONFIG`, `DEV_PORT`, and `PROD_PORT`. Development and Production default to the same host port, so stop one or select a different port before starting the other.

With Docker Engine/Desktop, Compose, and Buildx installed, run either environment without installing application dependencies on the host:

```bash
# Development: Flask reload, source mount, Python and Node test tools
docker compose -f compose.dev.yaml up --build

# Production: first copy .env.docker.example to .env.docker and set POSTGRES_PASSWORD
docker compose --env-file .env.docker -f compose.prod.yaml up --build -d --wait
```

Both default to port 3000; stop one before starting the other or set different `DEV_PORT`/`PROD_PORT` values. Production publishes only Nginx, which serves HTML/static files and proxies `/api/*` to Gunicorn. PostgreSQL has a persistent volume and no published port. It starts a new database; existing SQLite files/volumes remain untouched. `docker compose --env-file .env.docker -f compose.prod.yaml down` keeps saved votes and the cookie signing secret. See [DOCKER.md](DOCKER.md) for environment settings, tests inside Docker, backups, and shipping a prebuilt image to another server. Production requires a private `POSTGRES_PASSWORD`; see the example environment file and DOCKER.md before starting.

## Radio player

Press play to connect to `https://d3d4yli4hf5bmh.cloudfront.net/hls/live.m3u8`. The player loads pinned HLS.js 1.6.19 from jsDelivr and prefers it when supported, even if the browser also advertises native HLS support. Playback starts after HLS.js parses the manifest. Native HLS is the fallback when HLS.js is unsupported or the library cannot load. The original audio is played directly, without server transcoding. Lossless codec support depends on the browser and device. The stream server must permit cross-origin requests for HLS.js playback.

One compact playback control combines play/pause with an always-visible elapsed listening time and a Live label. The timer counts actual audio progress, stays visible while paused, and continues from the accumulated total on resume. Buffering and jumps to the live edge do not add listening time. Pausing releases the connection; resuming reconnects to the live broadcast. Connection failures and unsupported codecs display a retry or compatibility message. The sound details section includes a direct stream link for external HLS players. Audio only starts after a user action. External fonts use system fallbacks if unavailable.

The interface uses the supplied Radio Calico logo and brand colors. `static/player.js` controls playback; helpers in `static/player/` handle library loading, listening time, and diagnostics. `static/style.css` imports component styles from `static/styles/` in their original cascade order, including responsive layout, focus indicators, and reduced-motion support.

`static/metadata.js` loads the current title and artist from `https://d3d4yli4hf5bmh.cloudfront.net/metadatav2.json` on page load and refreshes ten seconds after each completed request while the page is visible. The Recently played widget displays the feed's `prev_title_1`/`prev_artist_1` through `prev_title_5`/`prev_artist_5` in that order (newest to oldest), independently of whether audio is playing. Track names render as plain text. Unavailable metadata shows an explicit message and retries automatically; previously loaded tracks remain visible with a stale-data message. The station feed schema is documented by the [Radio Calico reference implementation](https://github.com/fkane/radio-calico/blob/master/public/script.js).

Now playing includes album art from `https://d3d4yli4hf5bmh.cloudfront.net/cover.jpg`. The image URL refreshes when the current title, artist, or album changes, bypassing the previous cover's browser cache. Failed images fall back to the Radio Calico logo and retry on the next metadata update. The current cover is also provided to the browser's media session.

Now playing also includes thumbs-up and thumbs-down buttons with shared totals from every listener using this server. Ratings are saved in the `song_ratings` table of SQLite in Development or PostgreSQL in Production. Listeners can change their choice as often as they like: each submission atomically replaces their previous rating for that song. A database primary key on the song and listener identity keeps exactly one current vote per listener, including concurrent requests from multiple tabs. Selecting the same thumb again does not add a vote. Songs are identified by artist and title, normalizing Unicode, whitespace, and case. Totals refresh with the station metadata and immediately after voting. The selected thumb stays highlighted and both buttons remain available after saving. Buttons are disabled while saving or waiting for reliable current-song information.

Listener identity uses a signed, HttpOnly, SameSite=Lax browser cookie lasting up to one year, with a signing secret persisted in the private database. A session-bound CSRF token is required to submit votes. No account or browser fingerprint is required. Duplicate prevention applies to that browser identity: clearing cookies, using a different browser/device, or letting the cookie expire creates a new identity. Enforcing one vote per human across devices would require sign-in.

`GET /api/ratings?title=...&artist=...` returns `thumbs_up`, `thumbs_down`, `user_rating` (`1`, `-1`, or `null`), and a `csrf_token`. `POST /api/ratings` accepts JSON `{ "title": "...", "artist": "...", "rating": 1 }` (or `-1`) with `X-CSRF-Token`. Successful ratings and changes return HTTP 200 with the current choice and shared totals. Repeated submissions of the same choice leave the totals unchanged. The server issues the listener identity; client-supplied listener IDs are ignored.

The HLS.js configuration favors uninterrupted radio playback over minimum latency, targeting four segment durations behind the live edge and allowing up to 60 seconds of forward buffering (subject to the available playlist and the library's buffer limits). A fetch `stalled` event does not stop playable buffered audio; actual playback progress clears the stall timer. A decode error on the HLS.js path gets one MediaSource recovery attempt, followed by an explicit playback restart after reattachment. Further decoder failures require a manual retry. Browser console messages prefixed `[Radio Calico]` include HLS error details, HTTP response status when supplied by HLS.js, and media error details to distinguish network failures from decoder problems.

When playback does not resume within 25 seconds, the player stops the session and logs `[Radio Calico] Playback timeout` with the playback engine, current position, buffered/seekable ranges, native media error, and the last HLS error (including HTTP status when available). That timeout alone does not establish that the listener's network is faulty. Playback diagnostics also go to `/api/playback-diagnostics`, which writes them into the local server error log. Engine selection, manifest parsing, buffering, HLS errors, and timeouts include downloaded/buffered fragment counters to help distinguish downloads from decoding or buffer-append problems. These reports do not include listener identities or rating tokens. The audio itself still goes directly from CloudFront to the browser.

Player controller tests use Node's built-in test runner, without installing dependencies:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test test/player.test.cjs test/metadata.test.cjs test/ratings.test.cjs test/ratings-api.test.cjs
```

These controller tests simulate media events; check actual playback with an internet-connected browser to verify the station, CDN availability, CORS headers, and codec support end to end.

## Frontend modules

The page loads `static/main.js` as a native ES module. It initializes the player, ratings, then metadata so rating controls subscribe before the first track update. Controllers export initialization functions accepting a browser environment; tests call them with simulated media, DOM, timers, and requests. Feed normalization lives in `static/metadata-data.js`; rating requests, cancellation, and timeouts live in `static/ratings-api.js`.

There is no bundler or asset build step. Serve the page through Flask. `package.json` declares ES module syntax for Node tests and provides an optional `npm test` shortcut; no `npm install` is needed. See [ARCHITECTURE.md](ARCHITECTURE.md) for the file tree and API contracts.

Vietnamese guide: [README.vi.md](README.vi.md).

## Version control

The project is hosted in the private GitHub repository [phucuongtran/radio-calico](https://github.com/phucuongtran/radio-calico). The `main` branch tracks `origin/main`.

Commit source code, tests, documentation, and supplied brand assets. Local `.env` settings, databases in `data/`, logs, Python virtual environments (`.venv/` and `.venv-windows/`), and the machine-specific `migration-wsl-receipt.json` are excluded by `.gitignore`.

## Run

In PowerShell:

```powershell
Set-Location E:\radiocalico
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/background.ps1 stop
.\.venv\Scripts\python.exe app.py --debug
```

Debug mode enables automatic reload and the local Flask debugger. Press **Ctrl+C** to stop. To run without debug mode, use `.\.venv\Scripts\python.exe app.py`.

To run in the background without debug mode:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/background.ps1 start
```

To stop the background server:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/background.ps1 stop
```

Logs are in `logs/server.log` and `logs/server-error.log`. The script tracks the actual Python server process and checks its name and creation time before stopping it. The server does not start with Windows. Stop the background server before starting a foreground server on the same port.

## Python environment

The project's `.venv` is already configured. Since PyPI downloads were blocked, Flask and its dependencies were copied from the existing local environment at `E:\conda_env\mlflow-env\Lib\site-packages` into a separate Python 3.11 virtual environment. The source environment was left unchanged. The virtual environment uses the Python installation in `E:\conda_env\mlflow-env`; keep that installation available.

On another machine with Python 3.11 or newer and package registry access:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

No virtual environment activation is needed when using the explicit interpreter path. SQLite is included with Python. Node.js is needed only for JavaScript controller tests; npm is optional.

## Configuration and files

`.env` supports simple `KEY=value` entries for these settings:

```dotenv
PORT=3000
DATABASE_PATH=./data/radiocalico.sqlite
DATABASE_URL=
```

Process environment variables take precedence. Relative database paths resolve from the project folder. Restart the server after changing `.env`; if it is missing, run `Copy-Item .env.example .env`.

| Path | Purpose |
| --- | --- |
| `app.py` | Flask application factory, routes, server entry point, and SQL command. |
| `database.py` | SQLite/PostgreSQL connections, teardown, and initial schemas. |
| `diagnostics.py` | Allowed playback diagnostic events, fields, and payload filtering. |
| `ratings.py` | Shared rating totals, signed browser identity, validation, and changeable rating API. |
| `config.py` | Loads local settings. |
| `templates/index.html` | Jinja HTML template for the home page. |
| `static/` | CSS, browser JavaScript, and other public assets. |
| `static/main.js` | Native ES module entry point for the three controllers. |
| `static/player/` | HLS library loading, listening time, and playback diagnostics. |
| `static/styles/` | Component styles imported by `static/style.css`. |
| `data/radiocalico.sqlite` | Persistent SQLite database. |
| `requirements.txt` | Pinned Python dependencies. |
| `tests/test_app.py` | Integration tests using temporary databases. |
| `tests/test_ratings.py` | Rating changes, persistence, validation, and concurrent update checks. |
| `test/ratings.test.cjs` | Rating controls, shared counts, network failures, and track-change races. |

Flask serves the home page and assets from `static/`; project files and the database are not exposed as static files. Database connections are scoped to each application context and closed during teardown. WAL journaling, foreign keys, and a five-second lock timeout are enabled. The original database and its creation timestamp are preserved.

## Inspect SQLite

List tables:

```powershell
.\.venv\Scripts\python.exe app.py db
```

Run a SQL statement:

```powershell
.\.venv\Scripts\python.exe app.py db "SELECT * FROM app_metadata"
```

The command accepts one statement at a time, including writes, and commits changes. Add website tables in `database.py`; use parameterized SQL for user input. To back up the database, stop the server and copy the entire `data/` folder, including any SQLite sidecar files.

## Verify

Run all backend and frontend tests with the Python interpreter containing the dependencies from `requirements.txt` and `node` on PATH:

```powershell
.\.venv\Scripts\python.exe scripts/test.py
.\.venv\Scripts\python.exe scripts/test.py --ratings
```

On Linux/WSL:

```bash
.venv/bin/python scripts/test.py
.venv/bin/python scripts/test.py --ratings
```

The shared runner works from any working directory when invoked by its path, uses that same Python interpreter for backend tests, discovers JavaScript files without shell wildcard expansion, and reports each suite separately. It returns a nonzero exit code if either suite fails or Node is missing; a backend failure still allows frontend tests to run. Combine `--ratings` with `--backend` or `--frontend` to select one side. `npm test` runs all frontend tests; `npm run test:ratings` runs just the rating controller and API client tests.

Run the npm dependency security scan separately:

```bash
make test-security
# Without Make (also works in PowerShell):
npm run test:security
```

This requires local Node.js/npm (Node 22 in CI) and access to the configured npm registry when dependencies are present. The Development image contains Node but not npm, so run this command on the host. `make test-security NPM=/path/to/npm` selects another npm executable. The scan uses `npm audit --package-lock-only --include=dev --audit-level=low`: it checks the committed lockfile, including development dependencies, and fails for reported vulnerabilities of low severity or higher, or audit errors. It reports findings without applying fixes. See the [npm audit documentation](https://docs.npmjs.com/cli/v11/commands/npm-audit/).

There are currently no npm dependencies, so a clean audit checks **zero dependency packages**. This does not scan Python dependencies, Docker images, application code, or HLS.js loaded directly from the CDN. After changing npm dependencies, update and commit `package-lock.json` with `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`, then rerun the scan. Security scanning is separate from the normal application test runner.

| Test file | Responsibility |
| --- | --- |
| `tests/test_ratings_unit.py` | Song normalization, identity boundaries, and listener/CSRF session creation without a database. |
| `tests/test_ratings.py` | Flask API and real temporary SQLite: votes, concurrency, persistence, cookie/CSRF checks, invalid bodies, size limits, and database failures. |
| `test/ratings-api.test.cjs` | HTTP payloads, Unicode query strings, credentials, CSRF headers, errors, cancellation, and timeout cleanup. |
| `test/ratings.test.cjs` | Button state, accessible labels, response validation, track races, and confirmation after an uncertain POST. |
| `tests/test_ratings_postgres.py` | Reuses the rating API suite against real PostgreSQL in disposable test schemas; requires `TEST_DATABASE_URL`. |
| `tests/test_test_runner.py` | Suite selection, failure propagation, and missing runtime handling. |

Extend backend integration tests using `tests/support.py`, which creates and cleans up a separate SQLite database per test. Frontend tests import helpers from `test/helpers/ratings.cjs` and call `initRatings` with simulated DOM, queued HTTP responses, and manually triggered timers. `settle()` flushes promise continuations; `abortableResponse` simulates a fetch that rejects on abort. For late-response races, queue a deferred response that intentionally ignores abort. Tests make no station/CDN requests and never open the project's database. They do not verify real browser keyboard interaction or playback.

The workflow in `.github/workflows/tests.yml` runs the same complete command on pushes and pull requests, on Ubuntu and Windows with Python 3.11/3.12 and Node 22. Its Docker job runs `python scripts/test_docker.py` to build the application images, test Nginx/PostgreSQL HTTP and persistence, run the complete suite inside Development, and run the rating API suite against real PostgreSQL. A separate security job validates the npm manifest/lockfile with `npm ci --ignore-scripts --no-audit --no-fund`, then runs `make test-security`; audit failures fail the job. No API secrets are needed. CI results must be checked after pushing the workflow.

Individual backend checks and the local server health check remain available:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -v
.\.venv\Scripts\python.exe -m pip check
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

Tests cover pages and assets, database connectivity and failure handling, persistence across application restarts, database settings, and private-file access. The health endpoint executes an actual database query and returns `status: ok`, `database: connected`, and `engine: sqlite` in Development or `engine: postgresql` in Production when healthy.

If the port is occupied for a local Flask process, stop the existing server or change `PORT` in `.env` and restart. Docker host ports use `DEV_PORT`/`PROD_PORT` instead. Refresh the browser after changing styles or browser JavaScript. The direct Flask commands are for local development; use the Production Compose stack for Nginx, Gunicorn, and PostgreSQL.
