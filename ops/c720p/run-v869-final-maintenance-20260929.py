#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, subprocess, time, os, urllib.request, urllib.parse, hashlib, tarfile, shutil

HOME=pathlib.Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
REPORT={"started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"steps":{}}

def run(cmd, timeout=120, shell=False):
    try:
        p=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout,shell=shell)
        return {"rc":p.returncode,"stdout":p.stdout[-20000:],"stderr":p.stderr[-5000:]}
    except Exception as e:
        return {"rc":99,"error":repr(e)}

def df():
    return run(["df","-B1","/"],30)

REPORT["df_before"]=df()

# 1. Execute the reviewed safe cache reclaimer.
try:
    url="https://raw.githubusercontent.com/JesperOaths/kale-nel/main/ops/c720p/run-v869-cache-reclaim-20260929.py"
    p=pathlib.Path("/tmp/run-v869-cache-reclaim-20260929.py")
    p.write_bytes(urllib.request.urlopen(url,timeout=30).read())
    REPORT["steps"]["cache_reclaim"]=run(["python3",str(p)],300)
except Exception as e:
    REPORT["steps"]["cache_reclaim"]={"rc":99,"error":repr(e)}

# 2. Execute quota trim: saved clips and six newest are protected.
try:
    url="https://raw.githubusercontent.com/JesperOaths/kale-nel/main/ops/c720p/run-v869-archive-quota-trim-20260929.py"
    p=pathlib.Path("/tmp/run-v869-archive-quota-trim-20260929.py")
    p.write_bytes(urllib.request.urlopen(url,timeout=30).read())
    REPORT["steps"]["archive_trim"]=run(["python3",str(p)],180)
except Exception as e:
    REPORT["steps"]["archive_trim"]={"rc":99,"error":repr(e)}

# 3. Normalize historical 'missing' archive records into preserved tombstones.
idx=BASE/"state/drive-security-archive.json"
try:
    data=json.loads(idx.read_text())
    items=data.get("items",[])
    before={}
    for x in items: before[str(x.get("state"))]=before.get(str(x.get("state")),0)+1
    changed=0
    now=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
    backup=idx.with_name("drive-security-archive.json.before-v869-missing-normalize")
    if not backup.exists(): shutil.copy2(idx,backup)
    for x in items:
        if x.get("state")=="missing":
            x["state"]="deleted"
            x.setdefault("deleted_at",now)
            x["delete_reason"]="historical_missing_normalized_v869"
            x["historical_missing"]=True
            changed+=1
    if changed:
        tmp=idx.with_suffix(".json.tmp-v869")
        tmp.write_text(json.dumps(data,indent=2,sort_keys=True)+"\n")
        os.replace(tmp,idx)
    after={}
    for x in items: after[str(x.get("state"))]=after.get(str(x.get("state")),0)+1
    REPORT["steps"]["archive_normalize"]={"rc":0,"changed":changed,"states_before":before,"states_after":after}
    run(["systemctl","--user","restart","c720p-drive-security-archive.service"],45)
except Exception as e:
    REPORT["steps"]["archive_normalize"]={"rc":99,"error":repr(e)}

# 4. Saved-list + multi-clip byte-range playback verification.
tests=[]
try:
    with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=45) as r:
        saved_body=r.read()
        REPORT["steps"]["saved_list"]={"rc":0,"status":r.status,"bytes":len(saved_body)}
    data=json.loads(idx.read_text())
    rows=[x for x in data.get("items",[]) if x.get("camera")=="new" and x.get("state")=="verified"
          and x.get("remote_name") and int(x.get("size") or 0)>0]
    rows=sorted(rows,key=lambda x:str(x.get("timestamp","")),reverse=True)[:8]
    for i,row in enumerate(rows[:3]):
        name=str(row["remote_name"]); size=int(row.get("size") or 0)
        starts=[0,size//2,max(0,size-1048576)]
        start=max(0,min(size-1,starts[i]))
        end=min(size-1,start+1048575)
        req=urllib.request.Request("http://127.0.0.1:8795/new/clip/"+urllib.parse.quote(name),
                                   headers={"Range":f"bytes={start}-{end}","Cache-Control":"no-cache"})
        t=time.time()
        with urllib.request.urlopen(req,timeout=45) as r:
            body=r.read()
            tests.append({"name":name,"status":r.status,"bytes":len(body),
                          "content_range":r.headers.get("Content-Range"),
                          "accept_ranges":r.headers.get("Accept-Ranges"),
                          "elapsed_seconds":round(time.time()-t,3)})
    REPORT["steps"]["playback"]={"rc":0,"tests":tests,
        "pass":len(tests)==3 and all(x["status"]==206 and x["bytes"]>0 for x in tests)}
except Exception as e:
    REPORT["steps"]["playback"]={"rc":99,"tests":tests,"error":repr(e)}

# 5. Allow the already-retried mail queue to fall back locally after attempt 4.
triage=pathlib.Path("/opt/inbox-triage-agent/triage_agent.py")
try:
    s=triage.read_text()
    backup=triage.with_name("triage_agent.py.before-v869-local-after4")
    if not backup.exists(): shutil.copy2(triage,backup)
    changed=False
    if 'local_last_resort = int(retry_before.get("attempt") or 0) >= 6' in s:
        s=s.replace('local_last_resort = int(retry_before.get("attempt") or 0) >= 6',
                    'local_last_resort = int(retry_before.get("attempt") or 0) >= 4',1)
        triage.write_text(s)
        changed=True
    comp=run(["/opt/inbox-triage-agent/.venv/bin/python","-m","py_compile",str(triage)],30)
    retry_state={}
    rp=BASE/"state/inbox-triage-cloud-retry.json"
    if rp.exists():
        try: retry_state=json.loads(rp.read_text())
        except Exception: pass
    started=run(["systemctl","--user","start","--no-block","inbox-triage-agent.service"],30)
    # Wait for completion, bounded to 12 minutes.
    deadline=time.time()+720
    last={}
    while time.time()<deadline:
        q=run(["systemctl","--user","show","inbox-triage-agent.service","-p","ActiveState","-p","Result","-p","ExecMainStatus"],15)
        last=q
        txt=q.get("stdout","")
        if "ActiveState=inactive" in txt or "ActiveState=failed" in txt:
            break
        time.sleep(10)
    hp=BASE/"state/inbox-triage-health.json"
    health={}
    if hp.exists():
        try: health=json.loads(hp.read_text())
        except Exception: pass
    REPORT["steps"]["mail_local_fallback"]={"rc":0 if comp.get("rc")==0 else comp.get("rc"),
        "threshold_changed":changed,"retry_state_before":retry_state,
        "start":started,"service_final":last,"health_after":health}
except Exception as e:
    REPORT["steps"]["mail_local_fallback"]={"rc":99,"error":repr(e)}

# 6. Fresh compact recovery checkpoint.
try:
    outdir=HOME/"c720p-backups"; outdir.mkdir(parents=True,exist_ok=True)
    stamp=time.strftime("%Y%m%d_%H%M%S")
    out=outdir/f"c720p-final-v869-{stamp}.tar.gz"
    candidates=[
      HOME/"c720p-security-camera-new/c720p-frontyard-security-new.py",
      HOME/"c720p-security-camera-new/frontyard-security-config.json",
      BASE/"bin/c720p-drive-security-archive.py",
      BASE/"bin/c720p-drive-security-upload.py",
      BASE/"bin/c720p-drive-value-retention.py",
      BASE/"state/drive-security-archive.json",
      triage,
      HOME/".config/systemd/user/inbox-triage-agent.service",
      HOME/".config/systemd/user/inbox-triage-agent.timer",
      HOME/".config/systemd/user/inbox-triage-retry.service",
      HOME/".config/systemd/user/inbox-triage-retry.timer",
    ]
    added=[]
    with tarfile.open(out,"w:gz") as tar:
        for p in candidates:
            if p.exists():
                tar.add(p,arcname=str(p).lstrip("/"))
                added.append(str(p))
    digest=hashlib.sha256(out.read_bytes()).hexdigest()
    out.with_suffix(out.suffix+".sha256").write_text(digest+"  "+out.name+"\n")
    # Verify tar can be reopened/listed.
    with tarfile.open(out,"r:gz") as tar: names=tar.getnames()
    REPORT["steps"]["backup"]={"rc":0,"path":str(out),"sha256":digest,"entries":len(names),"sources":added}
except Exception as e:
    REPORT["steps"]["backup"]={"rc":99,"error":repr(e)}

# 7. Refresh local health reporter if available.
for cmd in [
    [str(BASE/"bin/c720p-cloud-health-report.py")],
    ["systemctl","--user","start","c720p-cloud-health-report.service"],
]:
    try:
        if pathlib.Path(cmd[0]).exists() or cmd[0]=="systemctl":
            REPORT["steps"].setdefault("health_refresh",[]).append(run(cmd,120))
    except Exception: pass

REPORT["df_after"]=df()
REPORT["finished_at"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())

# Final explicit maintenance report.
try:
    token=(HOME/".config/c720p-agent/security-token").read_text().strip()
    payload={"observed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
             "maintenance":{"v869_final_maintenance_990035":REPORT}}
    req=urllib.request.Request(
      "https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-control?action=health",
      data=json.dumps(payload,separators=(",",":")).encode(),method="POST",
      headers={"content-type":"application/json","x-c720p-token":token})
    with urllib.request.urlopen(req,timeout=20) as r: REPORT["health_post_status"]=r.status
except Exception as e: REPORT["health_post_error"]=repr(e)

print(json.dumps(REPORT,indent=2,sort_keys=True))
