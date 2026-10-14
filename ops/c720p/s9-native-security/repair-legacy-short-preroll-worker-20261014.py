#!/usr/bin/env python3
"""Re-enable two valid legacy short pre-roll+4K pairs for isolated C720P combiner.

The phone's old v1 buffer exported a sub-1-second prelude for two recordings.
The worker's one-second *input* threshold quarantined them, although their
native 4K events are safely longer. Preserve both original segments and permit
0.55s minimum solely for these *existing* cases; future Camera2 v3 intentionally
rejects creating such short pre-rolls on the S9.
"""
import argparse,datetime,json,os,py_compile,shutil,subprocess,tempfile
from pathlib import Path
ROOT=Path("/home/jespern/c720p-home-hub")
WORKER=ROOT/"bin/s9-complete-worker-v1.py"
STATE=ROOT/"build/s9-complete-worker-v1/state.json"
BAD=["motion_1791909129333.mp4","motion_1791909155089.mp4"]
OLD='if not(1<=p["duration"]<=10 and 0.9<=main["duration"]<=125):'
NEW='if not(0.55<=p["duration"]<=10 and 0.9<=main["duration"]<=125):'
def atomic(p,content):
    p.parent.mkdir(parents=True,exist_ok=True)
    s=p.stat()
    fd,tmp=tempfile.mkstemp(dir=p.parent,prefix=".s9-pre-legacy-")
    try:
        with os.fdopen(fd,"wb") as f:f.write(content);f.flush();os.fsync(f.fileno())
        os.chmod(tmp,s.st_mode&0o777);os.replace(tmp,p)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
def main():
    p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true");args=p.parse_args()
    before=WORKER.read_text()
    if OLD not in before:
        if NEW in before:print("ALREADY_PATCHED");return
        raise RuntimeError("unknown_worker_source")
    if before.count(OLD)!=1:raise RuntimeError("unexpected_duration_guard")
    after=before.replace(OLD,NEW,1)
    # Check exact 4K/H.264 input and derived-output duration integrity guards remain.
    assert 'merged["duration"]' in after and "invalid_source_durations" in after
    with tempfile.NamedTemporaryFile(mode="w",suffix=".py") as temp:
        temp.write(after);temp.flush();py_compile.compile(temp.name,doraise=True)
    d=json.loads(STATE.read_text())
    eligible={k:v for k,v in d.items() if k in BAD and v.get("last_error")=="invalid_source_durations" and v.get("failures",0)>=3}
    print("LEGACY_PREROLL_WORKER_PLAN",json.dumps({"worker":str(WORKER),"eligible":eligible,"modified":False}),flush=True)
    if not args.apply:return
    back=ROOT/"backups/s9-complete-worker-short-preroll"/datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
    back.mkdir(parents=True)
    shutil.copy2(WORKER,back/"worker.before.py")
    shutil.copy2(STATE,back/"state.before.json")
    # Systemd may already have imported old worker script; the atomic write
    # only affects the *next* iteration. Never stop or restart the camera.
    try:
        atomic(WORKER,after.encode())
        current=json.loads(STATE.read_text())
        for n in eligible:
            if n in current and current[n].get("last_error")=="invalid_source_durations":
                current[n].pop("failures",None)
                current[n].pop("last_error",None)
                current[n]["last_attempt"]=0
        if subprocess.run(["systemctl","--user","is-active","--quiet","c720p-s9-complete-clip-worker.service"]).returncode==0:
            # Active instance might write this state at completion; avoid a race
            # by retaining failure counts for later guarded replay.
            print("LEGACY_WORKER_ACTIVE_KEEP_RETRY_STATE",flush=True)
        else:
            atomic(STATE,(json.dumps(current,indent=2,sort_keys=True)+"\n").encode())
        py_compile.compile(str(WORKER),doraise=True)
        enabled=subprocess.run(["systemctl","--user","is-enabled","c720p-s9-complete-clip-worker.timer"],capture_output=True,text=True,timeout=12)
        if enabled.returncode:raise RuntimeError("complete_worker_timer_not_enabled")
        print("LEGACY_PREROLL_WORKER_DEPLOYED",json.dumps({"backup":str(back),"source_updated":True,"retry_candidates":list(eligible)}),flush=True)
    except Exception:
        atomic(WORKER,before.encode())
        if subprocess.run(["systemctl","--user","is-active","--quiet","c720p-s9-complete-clip-worker.service"]).returncode!=0:
            atomic(STATE,(back/"state.before.json").read_bytes())
        raise
if __name__=="__main__":main()
