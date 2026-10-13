#!/usr/bin/env python3
"""Install a LOCAL C720P systemd timer for guarded S9+ pre-roll completion.

Timer never asks ChatGPT to run. It reuses the existing S9 authenticated ADB
bridge, defers any APK cutover until healthy idle, and verifies joined media
read-only on later local timer ticks.
"""
from pathlib import Path
import datetime,hashlib,os,stat,subprocess,tempfile,urllib.request
HOME=Path("/home/jespern")
ROOT=HOME/"c720p-home-hub"
UNITDIR=HOME/".config/systemd/user"
SCRIPT=ROOT/"bin/s9-v1c-one-time-cutover.py"
SERVICE=UNITDIR/"c720p-s9-joined-preroll-safe-upgrade.service"
TIMER=UNITDIR/"c720p-s9-joined-preroll-safe-upgrade.timer"
BACK=ROOT/"backups/s9-joined-v1c-local-watch"
URI="https://raw.githubusercontent.com/JesperOaths/kale-nel/273be1909379653d885645bab4ccac5d5bbf0a9c/ops/c720p/s9-native-security/s9-v1c-one-time-cutover.py"
SERVICE_BODY="""[Unit]
Description=S9+ guarded pre-event MP4 v1c cutover and merged-video verification
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/s9-v1c-one-time-cutover.py
TimeoutStartSec=420
Nice=13
CPUQuota=18%
IOSchedulingClass=idle
"""
TIMER_BODY="""[Unit]
Description=Local guarded S9+ pre-event single-file completion check

[Timer]
OnBootSec=4min
OnUnitInactiveSec=5min
AccuracySec=45s
Unit=c720p-s9-joined-preroll-safe-upgrade.service

[Install]
WantedBy=timers.target
"""
def call(*args,seconds=26):
 p=subprocess.run(args,capture_output=True,text=True,timeout=seconds)
 if p.returncode:raise RuntimeError("local_service_failed:"+str(args[:4])+p.stderr[-240:])
 return p.stdout
def save(p,raw,mode):
 p.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix=".s9-joined-v1c-",dir=p.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(raw);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,mode);os.replace(tmp,p)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def main():
 with urllib.request.urlopen(URI,timeout=35) as r:payload=r.read(22000)
 if not 5000<len(payload)<20000:raise RuntimeError("unexpected_installer_length")
 text=payload.decode()
 if not all(t in text for t in ("S9_AUTO_CUTOVER","one_complete_pre_event_mp4_verified",
     "healthy","model_hashes","rollback_completed")):
  # Instead of trusting the text shape, bail before any install.
  raise RuntimeError("source_contract_check")
 compile(text,str(SCRIPT),"exec")
 checks={SCRIPT:payload,SERVICE:SERVICE_BODY.encode(),TIMER:TIMER_BODY.encode()}
 old={p:p.read_bytes() if p.is_file() else None for p in checks}
 BACK.mkdir(parents=True,mode=0o700,exist_ok=True)
 folder=BACK/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 folder.mkdir(mode=0o700)
 for p,raw in old.items():
  if raw is not None:(folder/p.name).write_bytes(raw)
 wrote=[]
 try:
  for p,data in checks.items():
   save(p,data,0o700 if p==SCRIPT else 0o644);wrote.append(p)
  call("systemctl","--user","daemon-reload")
  call("systemctl","--user","enable","--now",TIMER.name)
  unit=call("systemctl","--user","show","-p","UnitFileState","-p","ActiveState",TIMER.name)
  svc=call("systemctl","--user","show","-p","ExecStart",SERVICE.name)
  if "ActiveState=active" not in unit or str(SCRIPT) not in svc:
   raise RuntimeError("local_timer_activation_not_verified")
  print("S9_PREPENDED_VIDEO_LOCAL_AUTONOMOUS_CUTOVER_READY",{
   "script":str(SCRIPT),"timer":TIMER.name,
   "frequency":"5 minutes after service becomes idle",
   "signed_apk_only":True,
   "health_and_rollback_guards":True,
   "merged_video_range_verification":True,
   "no_chatgpt_scheduled_task":True,
   "backup":str(folder)},flush=True)
 except BaseException:
  try:call("systemctl","--user","disable","--now",TIMER.name)
  except Exception:pass
  for p in reversed(wrote):
   if old[p] is None:
    if p.exists():p.unlink()
   else:save(p,old[p],0o700 if p==SCRIPT else 0o644)
  try:call("systemctl","--user","daemon-reload")
  except Exception:pass
  raise
if __name__=="__main__":main()
