#!/usr/bin/env python3
"""Install the S9+ evidence quality audit as a local low-impact systemd timer.

No video decoding, no biometric content, no phone app replacement. All
operations are on C720P and change only one audit script and two units.
"""
import datetime,os,pathlib,subprocess,tempfile,urllib.request
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
SCRIPT=BASE/"bin/s9_evidence_quality_watchdog_v1.py"
UNIT=pathlib.Path("/home/jespern/.config/systemd/user")
SERVICE=UNIT/"c720p-s9-evidence-quality-audit.service"
TIMER=UNIT/"c720p-s9-evidence-quality-audit.timer"
URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/34b72d688e8d9cab3eb72d1f2904803ffd2ee772/ops/c720p/s9-native-security/s9_evidence_quality_watchdog_v1.py"
S='''[Unit]
Description=Read-only S9 face posture clothing evidence coverage audit
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/s9_evidence_quality_watchdog_v1.py
TimeoutStartSec=65
Nice=18
CPUQuota=8%
MemoryMax=130M
UMask=0077
'''
T='''[Unit]
Description=Local 15-minute S9 evidence quality check

[Timer]
OnBootSec=6min
OnUnitInactiveSec=15min
AccuracySec=45s
Unit=c720p-s9-evidence-quality-audit.service

[Install]
WantedBy=timers.target
'''
def call(*a):
 p=subprocess.run(a,text=True,capture_output=True,timeout=30)
 if p.returncode:raise RuntimeError(str(a[:3])+": "+p.stderr[-300:])
 return p.stdout
def save(path,data,mode):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix=".s9watch-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def main():
 with urllib.request.urlopen(URL,timeout=30) as r:body=r.read(12000)
 if not all(z in body for z in (
  b"cannot_infer_person_from_absence_of_frontal_face",
  b"observations_with_measured_gait_cadence",
  b"face_review_status_counts",
  b"S9_FACE_POSE_EVIDENCE_AUDIT")):
  raise RuntimeError("watchdog_contract_mismatch")
 compile(body.decode(),str(SCRIPT),"exec")
 original={x:x.read_bytes() if x.is_file() else None for x in (SCRIPT,SERVICE,TIMER)}
 backup=BASE/"backups/s9-evidence-audit"/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 backup.mkdir(parents=True,exist_ok=True)
 for p,b in original.items():
  if b is not None:(backup/p.name).write_bytes(b)
 changed=[]
 try:
  for path,data,mode in ((SCRIPT,body,0o700),(SERVICE,S.encode(),0o644),(TIMER,T.encode(),0o644)):
   save(path,data,mode);changed.append(path)
  # First sample must run successfully before the timer can be enabled.
  print(call("python3",str(SCRIPT))[-1500:],flush=True)
  call("systemctl","--user","daemon-reload")
  call("systemctl","--user","enable","--now",TIMER.name)
  v=call("systemctl","--user","is-active",TIMER.name)
  if v.strip()!="active":raise RuntimeError("timer_not_active")
  print("S9_EVIDENCE_QUALITY_AUDIT_LOCAL_TIMER_ENABLED",TIMER.name,flush=True)
 except BaseException:
  try:call("systemctl","--user","disable","--now",TIMER.name)
  except Exception:pass
  for path in reversed(changed):
   if original[path] is None:path.unlink(missing_ok=True)
   else:save(path,original[path],0o700 if path==SCRIPT else 0o644)
  try:call("systemctl","--user","daemon-reload")
  except Exception:pass
  raise
if __name__=="__main__":main()
