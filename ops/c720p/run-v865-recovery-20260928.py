#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, subprocess, time, urllib.request, traceback, os

BASE_URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/main/ops/c720p"
WORK=pathlib.Path("/home/jespern/.cache/c720p-agent/remote-fixes")
WORK.mkdir(parents=True,exist_ok=True)
steps=[
    "install-google-oauth-ui-v865.py",
    "patch-drive-archive-v865.py",
    "hide-s3-controls-v865.py",
    "test-drive-playback-v865.py",
]
report={"started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"steps":{}}

def run(cmd, timeout=180):
    p=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout)
    return {"rc":p.returncode,"stdout":p.stdout[-6000:],"stderr":p.stderr[-3000:]}

def fetch(name):
    out=WORK/name
    with urllib.request.urlopen(f"{BASE_URL}/{name}",timeout=30) as r:
        data=r.read()
    if len(data)<200:
        raise RuntimeError(f"download too small: {name}")
    out.write_bytes(data)
    out.chmod(0o700)
    return out

try:
    for name in steps:
        try:
            path=fetch(name)
            if name=="test-drive-playback-v865.py":
                continue
            report["steps"][name]=run(["python3",str(path)],240)
        except Exception as e:
            report["steps"][name]={"rc":99,"error":repr(e)}

    time.sleep(2)
    report["oauth_service"]=run(["systemctl","--user","is-active","c720p-google-oauth-ui.service"],15)
    report["drive_service"]=run(["systemctl","--user","is-active","c720p-drive-security-archive.service"],15)
    report["s3_profile_timer_enabled"]=run(["systemctl","--user","is-enabled","c720p-s3-profile-guard.timer"],15)
    report["s3_battery_timer_enabled"]=run(["systemctl","--user","is-enabled","c720p-s3-battery-camera-gate.timer"],15)

    try:
        body=urllib.request.urlopen("http://127.0.0.1:8796/",timeout=8).read().decode("utf-8","ignore")
        report["oauth_http"]=200
        report["oauth_new_ui"]="C720P Google OAuth Repair" in body
        report["oauth_old_private_page"]="Private C720P OAuth page" in body
        report["oauth_has_authorize"]="Authorize this Gmail account" in body
        report["oauth_has_platform_link"]="Google Auth Platform" in body
    except Exception as e:
        report["oauth_http_error"]=repr(e)

    try:
        report["playback_test"]=run(["python3",str(WORK/"test-drive-playback-v865.py")],45)
    except Exception as e:
        report["playback_test"]={"rc":99,"error":repr(e)}

    try:
        idx=json.loads(pathlib.Path("/home/jespern/c720p-home-hub/state/drive-security-archive.json").read_text())
        counts={}
        for x in idx.get("items",[]):
            st=str(x.get("state"))
            counts[st]=counts.get(st,0)+1
        report["archive_states"]=counts
        report["verified_new"]=sum(1 for x in idx.get("items",[]) if x.get("camera")=="new" and x.get("state")=="verified")
    except Exception as e:
        report["archive_state_error"]=repr(e)

    report["finished_at"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
    report["ok"]=bool(
        report.get("oauth_new_ui")
        and report.get("oauth_service",{}).get("rc")==0
        and report.get("drive_service",{}).get("rc")==0
        and report.get("steps",{}).get("hide-s3-controls-v865.py",{}).get("rc")==0
    )
except Exception as e:
    report["fatal"]=repr(e)
    report["traceback"]=traceback.format_exc()[-4000:]
    report["ok"]=False

# Report through the hub's existing authenticated health bridge.
try:
    token=pathlib.Path("/home/jespern/.config/c720p-agent/security-token").read_text().strip()
    payload={
        "observed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
        "maintenance":{"v865_recovery_990031":report},
    }
    req=urllib.request.Request(
        "https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-control?action=health",
        data=json.dumps(payload,separators=(",",":")).encode(),
        method="POST",
        headers={"content-type":"application/json","x-c720p-token":token},
    )
    with urllib.request.urlopen(req,timeout=15) as r:
        report["health_post_status"]=getattr(r,"status",200)
except Exception as e:
    report["health_post_error"]=repr(e)

print(json.dumps(report,indent=2,sort_keys=True))
raise SystemExit(0 if report.get("ok") else 2)
