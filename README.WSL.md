# Radio Calico in Ubuntu-22.04

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
