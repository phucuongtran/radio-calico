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
.venv/bin/python -m unittest discover -v
node --test test/player.test.cjs test/metadata.test.cjs test/ratings.test.cjs
.venv/bin/python app.py --debug
```

Dependency installation requires network access. Node is needed only for JavaScript tests.
Open http://localhost:3000 while the server runs. Stop it with Ctrl+C.
PowerShell background.ps1 manages the Windows server only.
The existing README files describe the previous Windows setup.
