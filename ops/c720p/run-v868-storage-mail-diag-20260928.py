#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, subprocess, time, urllib.request, urllib.parse, os, shlex

HOME=pathlib.Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
REPORT={"started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())}

def run(cmd, timeout=30):
    try:
        p=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout)
        return {"rc":p.returncode,"stdout":p.stdout[-12000:],"stderr":p.stderr[-3000:]}
    except Exception as e:
        return {"rc":99,"error":repr(e)}

REPORT["df_before"]=run(["df","-B1","/"])
REPORT["du_home"]=run(["du","-x","-BM","--max-depth=2",str(HOME)],120)
REPORT["du_major_roots"]=run(["bash","-lc","du -x -BM --max-depth=2 /home/jespern /opt /var 2>/dev/null | sort -n | tail -120"],180)
REPORT["backup_inventory"]=run(["bash","-lc","du -sh /home/jespern/c720p-backups 2>/dev/null || true; find /home/jespern/c720p-backups -maxdepth 1 -type f -printf '%s %T@ %p\\n' 2>/dev/null | sort -nr | head -60"],90)
REPORT["large_files"]=run(["bash","-lc",
    "find /home/jespern -xdev -type f -size +20M -printf '%s %p\\n' 2>/dev/null | sort -nr | head -80"
],120)
REPORT["failed_units"]=run(["systemctl","--user","--failed","--no-pager"],20)
REPORT["mail_timer_cat"]=run(["systemctl","--user","cat","inbox-triage-agent.timer"],20)
REPORT["mail_retry_timer_cat"]=run(["systemctl","--user","cat","inbox-triage-retry.timer"],20)
REPORT["mail_retry_timer_show"]=run(["systemctl","--user","show","inbox-triage-retry.timer","-p","ActiveState","-p","UnitFileState","-p","LastTriggerUSec","-p","NextElapseUSecRealtime"],20)
REPORT["mail_retry_service_show"]=run(["systemctl","--user","show","inbox-triage-retry.service","-p","ActiveState","-p","Result","-p","ExecMainStatus","-p","ExecMainStartTimestamp","-p","ExecMainExitTimestamp"],20)
REPORT["mail_retry_state"]=run(["bash","-lc","cat /home/jespern/c720p-home-hub/state/inbox-triage-cloud-retry.json 2>/dev/null || true"],20)
REPORT["mail_service_show"]=run(["systemctl","--user","show","inbox-triage-agent.service",
    "-p","ActiveState","-p","Result","-p","ExecMainStatus","-p","ExecMainStartTimestamp","-p","ExecMainExitTimestamp"],20)
REPORT["mail_journal"]=run(["journalctl","--user","-u","inbox-triage-agent.service","-n","120","--no-pager"],30)
REPORT["gemini_models_test"]=run(["bash","-lc","cd /opt/inbox-triage-agent && FORCE_IPV4=true timeout 45 ./.venv/bin/python scripts/test_gemini_models.py 2>&1 | sed -E 's/key=[^& ]+/key=<REDACTED>/g' | head -40"],60)
REPORT["new_camera_unit"]=run(["systemctl","--user","cat","c720p-frontyard-security-new.service"],20)
REPORT["archive_unit"]=run(["systemctl","--user","cat","c720p-drive-security-archive.service"],20)

# Archive summary and safe cache sizing.
try:
    idx=json.loads((BASE/"state/drive-security-archive.json").read_text())
    items=idx.get("items",[])
    states={}
    for x in items:
        states[str(x.get("state"))]=states.get(str(x.get("state")),0)+1
    REPORT["archive"]={
        "states":states,
        "verified_new":sum(1 for x in items if x.get("camera")=="new" and x.get("state")=="verified"),
        "missing_new":sum(1 for x in items if x.get("camera")=="new" and x.get("state")=="missing"),
        "deleted_new":sum(1 for x in items if x.get("camera")=="new" and x.get("state")=="deleted"),
    }
except Exception as e:
    REPORT["archive_error"]=repr(e)

def dir_bytes(p):
    total=0
    if p.exists():
        for q in p.rglob("*"):
            try:
                if q.is_file(): total+=q.stat().st_size
            except Exception: pass
    return total
REPORT["playback_cache_bytes"]=dir_bytes(BASE/"drive-playback-cache")

# Multi-clip byte-range regression through the Drive relay.
tests=[]
try:
    idx=json.loads((BASE/"state/drive-security-archive.json").read_text())
    rows=[x for x in idx.get("items",[]) if x.get("camera")=="new" and x.get("state")=="verified" and x.get("remote_name") and int(x.get("size") or 0)>0]
    rows=sorted(rows,key=lambda x:str(x.get("timestamp","")),reverse=True)[:12]
    for row in rows[:3]:
        name=str(row["remote_name"]); size=int(row.get("size") or 0)
        start=0 if not tests else max(0,min(size-1,(size//2 if len(tests)==1 else max(0,size-1048576))))
        end=min(size-1,start+1048575)
        req=urllib.request.Request(
            "http://127.0.0.1:8795/new/clip/"+urllib.parse.quote(name),
            headers={"Range":f"bytes={start}-{end}","Cache-Control":"no-cache"}
        )
        t=time.time()
        try:
            with urllib.request.urlopen(req,timeout=35) as r:
                data=r.read()
                tests.append({"name":name,"status":r.status,"start":start,"end":end,
                              "bytes":len(data),"content_range":r.headers.get("Content-Range"),
                              "accept_ranges":r.headers.get("Accept-Ranges"),
                              "elapsed_seconds":round(time.time()-t,3)})
        except Exception as e:
            tests.append({"name":name,"error":repr(e),"start":start,"end":end})
except Exception as e:
    REPORT["playback_setup_error"]=repr(e)
REPORT["playback_tests"]=tests

REPORT["finished_at"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())

# Persist locally so a later recovery job can inspect it even if health_latest rotates.
try:
    out=HOME/".cache/c720p-agent/remote-fixes/v868-storage-mail-diag-990032.json"
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(REPORT,indent=2,sort_keys=True))
    REPORT["local_report"]=str(out)
except Exception as e:
    REPORT["local_report_error"]=repr(e)

# Report through the existing authenticated health bridge.
try:
    token=(HOME/".config/c720p-agent/security-token").read_text().strip()
    payload={"observed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
             "maintenance":{"v868_storage_mail_diag_990032":REPORT}}
    req=urllib.request.Request(
        "https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-control?action=health",
        data=json.dumps(payload,separators=(",",":")).encode(),
        method="POST",
        headers={"content-type":"application/json","x-c720p-token":token},
    )
    with urllib.request.urlopen(req,timeout=20) as r:
        REPORT["health_post_status"]=getattr(r,"status",200)
except Exception as e:
    REPORT["health_post_error"]=repr(e)

print(json.dumps(REPORT,indent=2,sort_keys=True))
