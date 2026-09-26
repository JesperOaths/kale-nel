#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
from datetime import datetime, timezone
import json, os, re, shutil, subprocess, sys

APP=Path("/opt/inbox-triage-agent")
SRC=APP/"tokens"
DST=APP/"data/tokens"
UNITDIR=Path("/home/jespern/.config/systemd/user")
DROP=UNITDIR/"c720p-google-oauth-ui.service.d"/"60-canonical-token-dir-v867.conf"

os.chdir(APP)
sys.path.insert(0,str(APP))
import triage_agent
from triage_agent import load_config, SCOPES
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

accounts=[str(x).strip() for x in load_config().get("gmail_accounts",[]) if str(x).strip()]
if not accounts:
    raise SystemExit("no_gmail_accounts")
DST.mkdir(parents=True,exist_ok=True)
stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

def safe(account:str)->str:
    return re.sub(r"[^a-zA-Z0-9_.-]","_",account)+".json"

ok=0
for idx,account in enumerate(accounts,1):
    src=SRC/safe(account)
    dst=DST/safe(account)
    if not src.exists():
        print(f"ACCOUNT_{idx}_SOURCE_MISSING=true")
        continue
    creds=Credentials.from_authorized_user_file(str(src),SCOPES)
    creds.refresh(Request())
    svc=build("gmail","v1",credentials=creds,cache_discovery=False,static_discovery=False)
    profile=svc.users().getProfile(userId="me").execute()
    actual=str(profile.get("emailAddress") or "")
    if actual.lower()!=account.lower():
        print(f"ACCOUNT_{idx}_SOURCE_MATCH=false")
        continue
    if dst.exists():
        backup=dst.with_name(dst.name+f".pre-v867-{stamp}")
        shutil.copy2(dst,backup)
        backup.chmod(0o600)
    dst.write_text(creds.to_json(),encoding="utf-8")
    dst.chmod(0o600)
    print(f"ACCOUNT_{idx}_MIGRATED=true")
    ok+=1

if ok!=len(accounts):
    raise SystemExit(f"verified_token_migration_incomplete:{ok}/{len(accounts)}")

# Eliminate the historical split permanently. Legacy code that omits TOKEN_DIR
# now lands on the exact same canonical directory used by the systemd service.
if SRC.is_symlink():
    pass
elif SRC.exists():
    legacy_backup=APP/f"tokens.pre-v867-{stamp}"
    SRC.rename(legacy_backup)
    SRC.symlink_to(Path("data/tokens"), target_is_directory=True)
    print("LEGACY_TOKEN_DIR_BACKUP="+str(legacy_backup))
else:
    SRC.symlink_to(Path("data/tokens"), target_is_directory=True)
print("LEGACY_TOKEN_DIR_TARGET="+str(SRC.resolve()))

DROP.parent.mkdir(parents=True,exist_ok=True)
DROP.write_text("""[Service]
Environment=TOKEN_DIR=/opt/inbox-triage-agent/data/tokens
""",encoding="utf-8")
DROP.chmod(0o644)
subprocess.run(["systemctl","--user","daemon-reload"],check=True)
subprocess.run(["systemctl","--user","restart","c720p-google-oauth-ui.service"],check=True)

# Verify the same canonical token path used by the real triage service.
os.environ["TOKEN_DIR"]=str(DST)
for idx,account in enumerate(accounts,1):
    path=DST/safe(account)
    creds=Credentials.from_authorized_user_file(str(path),SCOPES)
    creds.refresh(Request())
    svc=build("gmail","v1",credentials=creds,cache_discovery=False,static_discovery=False)
    actual=str(svc.users().getProfile(userId="me").execute().get("emailAddress") or "")
    print(f"ACCOUNT_{idx}_CANONICAL_OK={str(actual.lower()==account.lower()).lower()}")
    if actual.lower()!=account.lower():
        raise SystemExit(f"canonical_account_mismatch_{idx}")
    path.write_text(creds.to_json(),encoding="utf-8")
    path.chmod(0o600)

print("ACCOUNTS_CANONICAL_OK="+str(ok))
print("TOKEN_DIR="+str(DST))
print("RESULT=GMAIL_TOKEN_PATH_V867_FIXED")
