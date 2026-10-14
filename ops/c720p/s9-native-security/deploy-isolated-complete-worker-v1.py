#!/usr/bin/env python3
"""Guarded local deployment of the isolated S9 4K+prebuffer joiner.

Refuse enabling automation until a genuine first production worker has
verified and atomically published a joined H.264 MP4. Installer never modifies
phone APKs or their video originals.
"""
from pathlib import Path
import datetime,json,os,subprocess,tempfile,urllib.request,hashlib
BASE=Path("/home/jespern/c720p-home-hub")
UNIT=Path("/home/jespern/.config/systemd/user")
WORKER=BASE/"bin/s9-complete-worker-v1.py"
SERVICE=UNIT/"c720p-s9-complete-clip-worker.service"
TIMER=UNIT/"c720p-s9-complete-clip-worker.timer"
RECEIPTS=BASE/"build/s9-complete-worker-v1/receipts"
EXPECTED_COMMIT="8d2a6e14095ca1df638b809695f26f28ae8bb81c"
URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/"+EXPECTED_COMMIT+"/ops/c720p/s9-native-security/s9-complete-worker-v1.py"
SERVICE_TEXT="""[Unit]
Description=Isolated low-priority S9 microSD pre-event + 4K combined MP4 worker
After=network-online.target
ConditionPathExists=/home/jespern/c720p-home-hub/bin/s9-complete-worker-v1.py

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/s9-complete-worker-v1.py
TimeoutStartSec=780
Nice=18
CPUQuota=45%
IOSchedulingClass=idle
MemoryMax=900M
TasksMax=90
UMask=0077
"""
TIMER_TEXT="""[Unit]
Description=Process one eligible S9 4K+pre-event MP4 when safely idle

[Timer]
OnBootSec=6min
OnUnitInactiveSec=3min
AccuracySec=30s
RandomizedDelaySec=10s
Unit=c720p-s9-complete-clip-worker.service

[Install]
WantedBy=timers.target
"""
def cmd(*args):
 x=subprocess.run(args,text=True,capture_output=True,timeout=28)
 if x.returncode:raise RuntimeError(str(args)+":"+x.stderr[-400:])
 return x.stdout
def write(path,data,mode=0o644):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix=".s9worker-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def main():
 # No recorded proof = no automatic processing.
 verified=[]
 for file in RECEIPTS.glob("motion_*.mp4.json"):
  try:
   j=json.loads(file.read_text())
   if j.get("verified") and j.get("backend")=="bounded_c720p_isolated_worker":
    verified.append((file,j))
  except Exception:pass
 if not verified:raise RuntimeError("no_real_streaming_worker_join_proven__timer_remains_off")
 first=verified[0][1]
 if first.get("both_segments_decoded") is not True or first.get("original_4k_unchanged") is not True:
  raise RuntimeError("incomplete_acceptance_proof")
 unit=cmd("systemctl","--user","is-active","c720p-s9-joined-preroll-safe-upgrade.timer")
 if unit.strip()=="active":raise RuntimeError("unsafe_old_phone_ffmpeg_timer_active")
 with urllib.request.urlopen(URL,timeout=35) as response:body=response.read(17000)
 text=body.decode()
 if not all(term in text for term in ("JOINER_VERIFIED_PUBLISHED","live_recording_or_camera_health_changed",
   "source_files_changed_after_encoding","published_sha256_mismatch")):
  raise RuntimeError("unrecognized_worker_release")
 compile(text,str(WORKER),"exec")
 new={WORKER:body,SERVICE:SERVICE_TEXT.encode(),TIMER:TIMER_TEXT.encode()}
 backups={p:p.read_bytes() if p.exists() else None for p in new}
 archive=BASE/"backups/s9-complete-worker-autonomous-v1"/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 archive.mkdir(parents=True,exist_ok=True)
 for p,contents in backups.items():
  if contents is not None:(archive/p.name).write_bytes(contents)
 written=[]
 try:
  for p,contents in new.items():
   write(p,contents,0o700 if p==WORKER else 0o644);written.append(p)
  cmd("systemctl","--user","daemon-reload")
  cmd("systemctl","--user","enable","--now",TIMER.name)
  st=cmd("systemctl","--user","show","-p","UnitFileState","-p","ActiveState",TIMER.name)
  if "ActiveState=active" not in st or "UnitFileState=enabled" not in st:
   raise RuntimeError("systemd_timer_not_verified")
  print("S9_PRODUCTION_JOINER_ENABLED",json.dumps({
    "systemd_timer":TIMER.name,"interval":"3 minutes, one job at a time",
    "isolated_from_phone_recorder":True,"input":"ADB-local read-only HTTP 4K+prebuffer",
    "output":"SHA-verified atomic S9 microSD H264 720p30",
    "max_memory":"900 MiB","cpu_quota":"45%",
    "rollback":str(archive),"prior_proof":first.get("name"),
    "no_chatgpt_automation":True}),flush=True)
 except BaseException:
  try:cmd("systemctl","--user","disable","--now",TIMER.name)
  except Exception:pass
  for p in reversed(written):
   if backups[p] is None:
    if p.exists():p.unlink()
   else:write(p,backups[p],0o700 if p==WORKER else 0o644)
  try:cmd("systemctl","--user","daemon-reload")
  except Exception:pass
  raise
if __name__=="__main__":main()
