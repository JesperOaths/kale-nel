#!/usr/bin/env python3
from __future__ import annotations
import json, os, sys, subprocess, pathlib, time
from datetime import datetime, timezone

APP=pathlib.Path("/opt/inbox-triage-agent")
print("RESULT_BEGIN=GMAIL_OAUTH_DIAG_V867")
print("UID="+str(os.getuid()))
print("HOME="+str(pathlib.Path.home()))
print("APP_EXISTS="+str(APP.exists()).lower())

os.chdir(APP)
os.environ["TOKEN_DIR"]="/opt/inbox-triage-agent/data/tokens"
print("CWD="+str(pathlib.Path.cwd()))
print("TOKEN_DIR="+os.environ["TOKEN_DIR"])
sys.path.insert(0,str(APP))
try:
    import triage_agent
    from triage_agent import load_config, gmail_service, token_path
    print("MODULE="+str(pathlib.Path(triage_agent.__file__).resolve()))
    print("SCOPES="+json.dumps(list(getattr(triage_agent,"SCOPES",[]))))
    cfg=load_config()
    accounts=[str(x).strip() for x in cfg.get("gmail_accounts",[]) if str(x).strip()]
    print("ACCOUNTS_TOTAL="+str(len(accounts)))
    print("ACCOUNTS="+json.dumps(accounts))
except Exception as e:
    print("BOOT_ERR="+type(e).__name__+":"+str(e)[:500])
    raise SystemExit(2)

try:
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
except Exception as e:
    print("GOOGLE_IMPORT_ERR="+type(e).__name__+":"+str(e)[:300])
    raise SystemExit(3)

all_ok=True
for i,account in enumerate(accounts,1):
    print(f"---ACCOUNT_{i}---")
    try:
        p=pathlib.Path(token_path(account))
        print(f"TOKEN_{i}_PATH={p}")
        print(f"TOKEN_{i}_EXISTS={str(p.exists()).lower()}")
        if not p.exists():
            all_ok=False
            continue
        st=p.stat()
        print(f"TOKEN_{i}_MTIME={datetime.fromtimestamp(st.st_mtime,timezone.utc).isoformat()}")
        print(f"TOKEN_{i}_SIZE={st.st_size}")
        try:
            data=json.loads(p.read_text())
        except Exception as e:
            print(f"TOKEN_{i}_JSON_ERR={type(e).__name__}:{str(e)[:200]}")
            all_ok=False
            continue
        print(f"TOKEN_{i}_HAS_REFRESH={str(bool(data.get('refresh_token'))).lower()}")
        print(f"TOKEN_{i}_HAS_TOKEN={str(bool(data.get('token'))).lower()}")
        print(f"TOKEN_{i}_TOKEN_URI={data.get('token_uri','')}")
        print(f"TOKEN_{i}_SCOPES={json.dumps(data.get('scopes') or [])}")
        print(f"TOKEN_{i}_EXPIRY={data.get('expiry','')}")
        creds=Credentials.from_authorized_user_file(str(p), getattr(triage_agent,"SCOPES",None))
        print(f"TOKEN_{i}_VALID_BEFORE={str(bool(creds.valid)).lower()}")
        print(f"TOKEN_{i}_EXPIRED_BEFORE={str(bool(creds.expired)).lower()}")
        try:
            creds.refresh(Request())
            print(f"TOKEN_{i}_REFRESH_OK=true")
            p.write_text(creds.to_json())
            os.chmod(p,0o600)
            print(f"TOKEN_{i}_REFRESHED_EXPIRY={getattr(creds,'expiry',None)}")
        except Exception as e:
            print(f"TOKEN_{i}_REFRESH_OK=false")
            print(f"TOKEN_{i}_REFRESH_ERR={type(e).__name__}:{str(e)[:500]}")
            all_ok=False
            continue
        try:
            svc=gmail_service(account)
            prof=svc.users().getProfile(userId="me").execute()
            actual=str(prof.get("emailAddress") or "")
            print(f"ACCOUNT_{i}_PROFILE_OK=true")
            print(f"ACCOUNT_{i}_MATCH={str(actual.lower()==account.lower()).lower()}")
            if actual.lower()!=account.lower():
                all_ok=False
        except Exception as e:
            print(f"ACCOUNT_{i}_PROFILE_OK=false")
            print(f"ACCOUNT_{i}_PROFILE_ERR={type(e).__name__}:{str(e)[:500]}")
            all_ok=False
    except Exception as e:
        print(f"ACCOUNT_{i}_ERR={type(e).__name__}:{str(e)[:500]}")
        all_ok=False

def run(cmd):
    try:
        p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=20,check=False)
        return p.stdout.strip()
    except Exception as e:
        return "ERR "+type(e).__name__+":"+str(e)

print("===OAUTH_UI_UNIT===")
print(run(["systemctl","--user","cat","c720p-google-oauth-ui.service"]))
print("===MAIL_UNIT===")
print(run(["systemctl","--user","cat","inbox-triage-agent.service"]))
print("===MAIL_TIMER===")
print(run(["systemctl","--user","cat","inbox-triage-agent.timer"]))
print("===MAIL_STATUS===")
print(run(["systemctl","--user","show","inbox-triage-agent.service","-p","ActiveState","-p","Result","-p","ExecMainStatus","-p","ExecMainStartTimestamp","-p","ExecMainExitTimestamp"]))
print("===MAIL_JOURNAL===")
journal=run(["journalctl","--user","-u","inbox-triage-agent.service","-n","120","--no-pager","-o","cat"])
# Keep only useful lines and avoid dumping message content.
for line in journal.splitlines():
    low=line.lower()
    if any(k in low for k in ("auth","oauth","token","gmail","error","invalid_grant","refresh","account","traceback")):
        print(line[:1000])
print("ALL_ACCOUNTS_OK="+str(all_ok and len(accounts)>0).lower())
print("RESULT=GMAIL_OAUTH_DIAG_V867_DONE")
