#!/usr/bin/env python3
from pathlib import Path
import os,subprocess,urllib.request

BASE=Path("/home/jespern/c720p-home-hub")
BIN=BASE/"bin"
STATE=BASE/"state"
SRC="https://raw.githubusercontent.com/JesperOaths/kale-nel/main/ops/c720p/c720p-google-oauth-ui.py"
TARGET=BIN/"c720p-google-oauth-ui.py"
UNIT=Path("/home/jespern/.config/systemd/user/c720p-google-oauth-ui.service")
candidates=[
 Path("/opt/inbox-triage-agent/.venv/bin/python"),
 Path("/opt/inbox-triage-agent/venv/bin/python"),
 Path("/opt/inbox-triage-agent/.venv/bin/python3"),
 Path("/opt/inbox-triage-agent/venv/bin/python3"),
]
py=next((p for p in candidates if p.is_file() and os.access(p,os.X_OK)),None)
if py is None:
    raise SystemExit("triage_agent_python_not_found")
BIN.mkdir(parents=True,exist_ok=True);STATE.mkdir(parents=True,exist_ok=True);UNIT.parent.mkdir(parents=True,exist_ok=True)
with urllib.request.urlopen(SRC,timeout=30) as r:
    data=r.read()
if len(data)<5000:raise SystemExit("oauth_ui_download_incomplete")
tmp=TARGET.with_suffix(".py.tmp");tmp.write_bytes(data);tmp.chmod(0o700);tmp.replace(TARGET)
unit=f"""[Unit]
Description=C720P private Google OAuth repair UI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/inbox-triage-agent
Environment=OAUTHLIB_INSECURE_TRANSPORT=1
ExecStart={py} {TARGET}
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/opt/inbox-triage-agent /home/jespern/c720p-home-hub/state
ProtectHome=read-only

[Install]
WantedBy=default.target
"""
UNIT.write_text(unit);UNIT.chmod(0o644)
subprocess.run(["systemctl","--user","daemon-reload"],check=True)
subprocess.run(["systemctl","--user","enable","--now","c720p-google-oauth-ui.service"],check=True)
