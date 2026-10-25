# Radio Calico in Ubuntu-22.04

With GNU Make installed, use `make dev`, `make prod`, and `make test` from this folder. Before Production, run `make env` and set `POSTGRES_PASSWORD` in `.env.docker`. `make test` runs in Docker; `make test-local` uses the local Python/Node environment. `make help` lists all targets. Make inherits `DOCKER_CONFIG`, including the WSL workaround below.

For Docker Development and Production without installing Python dependencies in WSL, see [DOCKER.md](DOCKER.md). With Docker Engine or Docker Desktop WSL integration, use `docker compose -f compose.dev.yaml up --build` or `docker compose --env-file .env.docker -f compose.prod.yaml up --build -d --wait`. Production uses Nginx/Gunicorn/PostgreSQL and requires POSTGRES_PASSWORD in a private .env.docker copied from the example. The setup below is for running Python directly on WSL with SQLite.

If Compose reports a missing `/usr/local/lib/docker/cli-plugins/docker-buildx` while `docker buildx version` works, check for stale Docker Desktop WSL plugin links. Repair the Docker CLI plugin installation or use a separate `DOCKER_CONFIG` directory with working plugins in `cli-plugins/`. Local Docker verification in this workspace used `DOCKER_CONFIG=/tmp/radiocalico-docker-tools` to bypass those stale links; this temporary directory is not part of the application or its images.

The distro disk is stored at E:\WSL\Ubuntu-22.04. This project is in the Linux home directory.
The original E:\radiocalico remains as a backup. Use this Linux copy for future work.
Every source file was copied and verified by SHA-256. A Windows .venv, if present, was renamed .venv-windows.

## Create the Linux environment

Ubuntu 22.04 normally provides Python 3.10; this project documents Python 3.11 or newer.
Check `python3 --version` and `python3 -c "import sqlite3; print(sqlite3.sqlite_version)"`.
Use an installed Python 3.11+ interpreter with its venv support:

```bash
cd ~/radiocalico
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python scripts/test.py
.venv/bin/python app.py --debug
```

Dependency installation requires network access. Node is needed only for JavaScript tests.
Run `.venv/bin/python scripts/test.py --ratings` for just the backend and frontend rating suites; add `--backend` or `--frontend` to select one side. See [README.md](README.md#verify) for test organization and helper usage. The runner uses the Python interpreter that launched it and returns a nonzero status if a selected suite fails.
Open http://localhost:3000 while the server runs. Stop it with Ctrl+C.
PowerShell background.ps1 manages the Windows server only.
The existing README files describe the previous Windows setup.
