# Radio Calico — Flask and SQLite

Radio Calico's responsive live radio page uses Flask 3.1.3, Python 3.11, and Python's built-in `sqlite3` module. Open **http://127.0.0.1:3000** while the server is running. It listens only on this computer.

## Radio player

Press play to connect to `https://d3d4yli4hf5bmh.cloudfront.net/hls/live.m3u8`. The player loads pinned HLS.js 1.6.19 from jsDelivr and prefers it when supported, even if the browser also advertises native HLS support. Playback starts after HLS.js parses the manifest. Native HLS is the fallback when HLS.js is unsupported or the library cannot load. The original audio is played directly, without server transcoding. Lossless codec support depends on the browser and device. The stream server must permit cross-origin requests for HLS.js playback.

One compact playback control combines play/pause with an always-visible elapsed listening time and a Live label. The timer counts actual audio progress, stays visible while paused, and continues from the accumulated total on resume. Buffering and jumps to the live edge do not add listening time. Pausing releases the connection; resuming reconnects to the live broadcast. Connection failures and unsupported codecs display a retry or compatibility message. The sound details section includes a direct stream link for external HLS players. Audio only starts after a user action. External fonts use system fallbacks if unavailable.

The interface uses the supplied Radio Calico logo and brand colors. `static/player.js` controls playback; helpers in `static/player/` handle library loading, listening time, and diagnostics. `static/style.css` imports component styles from `static/styles/` in their original cascade order, including responsive layout, focus indicators, and reduced-motion support.

`static/metadata.js` loads the current title and artist from `https://d3d4yli4hf5bmh.cloudfront.net/metadatav2.json` on page load and refreshes ten seconds after each completed request while the page is visible. The Recently played widget displays the feed's `prev_title_1`/`prev_artist_1` through `prev_title_5`/`prev_artist_5` in that order (newest to oldest), independently of whether audio is playing. Track names render as plain text. Unavailable metadata shows an explicit message and retries automatically; previously loaded tracks remain visible with a stale-data message. The station feed schema is documented by the [Radio Calico reference implementation](https://github.com/fkane/radio-calico/blob/master/public/script.js).

Now playing includes album art from `https://d3d4yli4hf5bmh.cloudfront.net/cover.jpg`. The image URL refreshes when the current title, artist, or album changes, bypassing the previous cover's browser cache. Failed images fall back to the Radio Calico logo and retry on the next metadata update. The current cover is also provided to the browser's media session.

Now playing also includes thumbs-up and thumbs-down buttons with shared totals from every listener using this server. Ratings are saved in SQLite's `song_ratings` table. Listeners can change their choice as often as they like: each submission atomically replaces their previous rating for that song. A database primary key on the song and listener identity keeps exactly one current vote per listener, including concurrent requests from multiple tabs. Selecting the same thumb again does not add a vote. Songs are identified by artist and title, normalizing Unicode, whitespace, and case. Totals refresh with the station metadata and immediately after voting. The selected thumb stays highlighted and both buttons remain available after saving. Buttons are disabled while saving or waiting for reliable current-song information.

Listener identity uses a signed, HttpOnly, SameSite=Lax browser cookie lasting up to one year, with a signing secret persisted in the private SQLite database. A session-bound CSRF token is required to submit votes. No account or browser fingerprint is required. Duplicate prevention applies to that browser identity: clearing cookies, using a different browser/device, or letting the cookie expire creates a new identity. Enforcing one vote per human across devices would require sign-in.

`GET /api/ratings?title=...&artist=...` returns `thumbs_up`, `thumbs_down`, `user_rating` (`1`, `-1`, or `null`), and a `csrf_token`. `POST /api/ratings` accepts JSON `{ "title": "...", "artist": "...", "rating": 1 }` (or `-1`) with `X-CSRF-Token`. Successful ratings and changes return HTTP 200 with the current choice and shared totals. Repeated submissions of the same choice leave the totals unchanged. The server issues the listener identity; client-supplied listener IDs are ignored.

The HLS.js configuration favors uninterrupted radio playback over minimum latency, targeting four segment durations behind the live edge and allowing up to 60 seconds of forward buffering (subject to the available playlist and the library's buffer limits). A fetch `stalled` event does not stop playable buffered audio; actual playback progress clears the stall timer. A decode error on the HLS.js path gets one MediaSource recovery attempt, followed by an explicit playback restart after reattachment. Further decoder failures require a manual retry. Browser console messages prefixed `[Radio Calico]` include HLS error details, HTTP response status when supplied by HLS.js, and media error details to distinguish network failures from decoder problems.

When playback does not resume within 25 seconds, the player stops the session and logs `[Radio Calico] Playback timeout` with the playback engine, current position, buffered/seekable ranges, native media error, and the last HLS error (including HTTP status when available). That timeout alone does not establish that the listener's network is faulty. Playback diagnostics also go to `/api/playback-diagnostics`, which writes them into the local server error log. Engine selection, manifest parsing, buffering, HLS errors, and timeouts include downloaded/buffered fragment counters to help distinguish downloads from decoding or buffer-append problems. These reports do not include listener identities or rating tokens. The audio itself still goes directly from CloudFront to the browser.

Player controller tests use Node's built-in test runner, without installing dependencies:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test test/player.test.cjs test/metadata.test.cjs test/ratings.test.cjs
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
```

Process environment variables take precedence. Relative database paths resolve from the project folder. Restart the server after changing `.env`; if it is missing, run `Copy-Item .env.example .env`.

| Path | Purpose |
| --- | --- |
| `app.py` | Flask application factory, routes, server entry point, and SQL command. |
| `database.py` | SQLite connections, teardown, and initial schema. |
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

```powershell
.\.venv\Scripts\python.exe -m unittest discover -v
.\.venv\Scripts\python.exe -m pip check
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

Tests cover pages and assets, database connectivity and failure handling, persistence across application restarts, database settings, and private-file access. The health endpoint executes an actual database query and returns `status: ok`, `database: connected`, and `engine: sqlite` when healthy.

If the port is occupied, stop the existing server or change `PORT` in `.env` and restart. Refresh the browser after changing styles or browser JavaScript. This is a local development setup.
