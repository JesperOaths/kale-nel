#!/usr/bin/env python3
"""Phone-link dropout grace: prevent C720P duplicate motion captures on transient ADB failures."""
import datetime,json,os,pathlib,shutil,subprocess,time,urllib.request
S=pathlib.Path("/home/jespern/c720p-security-camera-new/c720p-frontyard-security-new.py")
BASE=S.parent
URL="http://127.0.0.1:8793/health.json"
def health():
 with urllib.request.urlopen(URL,timeout=6) as r:return json.load(r)
txt=S.read_text()
if "S9_ML_LINK_GRACE_V2" in txt:
 print("ALREADY_S9_GRACE_V2");raise SystemExit(0)
assert "S9_GPU_PERSON_OFFLOAD_V1" in txt,"previous S9 ML offload missing"
assert "last_motion_source=\"s9-gpu-ml-offload\"," in txt,"healthy block changed"
a='    if str(cfg.get("motion_mode","")).lower() == "s9_ml_edge":\n        try:'
b='    if str(cfg.get("motion_mode","")).lower() == "s9_ml_edge":\n        # S9_ML_LINK_GRACE_V2: a short ADB failure is not evidence of camera motion.\n        if not hasattr(get_motion,"_s9_started"):\n            get_motion._s9_started=time.monotonic()\n        try:'
assert txt.count(a)==1,"phone branch anchor changed"
txt=txt.replace(a,b,1)
a='            if ml_ok and edge_ok:\n                conf='
b='            if ml_ok and edge_ok:\n                get_motion._s9_last_good=time.monotonic()\n                conf='
assert txt.count(a)==1,"healthy anchor changed"
txt=txt.replace(a,b,1)
a='        # Hard failover: existing hub detector executes below, unchanged.'
b='''        # The phone remains autonomous when ADB disconnects. A short link failure
        # must not cause extra hub MPEG encoding and low-value false captures.
        last=getattr(get_motion,"_s9_last_good",get_motion._s9_started)
        if time.monotonic()-last < 90.0:
            set_runtime(last_motion_source="s9-phone-link-grace",
                        last_motion_mode="s9-person-ml",
                        s9_ml_camera_capture_owned_by_phone=True,
                        s9_link_grace_remaining_seconds=round(90-(time.monotonic()-last),1))
            return False,0.0
        # Hard failover only after a sustained phone-link outage.
'''
assert txt.count(a)==1,"fallback anchor changed"
txt=txt.replace(a,b,1)
compile(txt,str(S),"exec")
before=health()
if before.get("recording"):
 print("DEFER_S9_GRACE_PATCH_CAMERA_RECORDING",flush=True);raise SystemExit(2)
stamp=datetime.datetime.now().strftime("%Y%m%d%H%M%S")
backup=BASE/"backups"/("camera-before-link-grace-"+stamp+".py")
backup.parent.mkdir(parents=True,exist_ok=True)
shutil.copy2(S,backup)
tmp=S.with_suffix(".py.s9tmp")
tmp.write_text(txt);tmp.chmod(S.stat().st_mode & 0o777)
try:
 os.replace(tmp,S)
 subprocess.run(["systemctl","--user","restart","c720p-frontyard-security-new.service"],check=True,timeout=35)
 time.sleep(7)
 state=health()
 if not state.get("camera_ok"):raise RuntimeError("camera unhealthy after restart")
 print("S9_GRACE_DEPLOYED",{"camera_ok":state.get("camera_ok"),"backed_up":str(backup)})
except Exception:
 shutil.copy2(backup,S)
 subprocess.run(["systemctl","--user","restart","c720p-frontyard-security-new.service"],check=True,timeout=35)
 print("S9_GRACE_ROLLED_BACK")
 raise
