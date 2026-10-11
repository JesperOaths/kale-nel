#!/usr/bin/env python3
"""Atomic one-time C720P systemd setup, *not* a ChatGPT automation."""
import datetime,os,pathlib,shutil,subprocess,time,urllib.request,json
HOME=pathlib.Path("/home/jespern")
PROJECT=HOME/"c720p-home-hub"
SRC=PROJECT/"build/security-v8/c720p-preroll-verify-local.py"
DST=PROJECT/"bin/c720p-preroll-verify-local.py"
SYS=HOME/".config/systemd/user"
SERVICE=SYS/"c720p-s9-preroll-verification.service"
TIMER=SYS/"c720p-s9-preroll-verification.timer"
BACK=PROJECT/"backups/s9-preroll-local-checker"
SERVICE_CONTENT="""[Unit]
Description=Verify genuine S9+ Camera2 microSD pre-event pairs (read only)
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/c720p-preroll-verify-local.py
TimeoutStartSec=100
Nice=15
CPUWeight=10
IOWeight=10
MemoryMax=100M
NoNewPrivileges=true
"""
TIMER_CONTENT="""[Unit]
Description=Local S9+ pre-event recording verification, no cloud/ChatGPT task

[Timer]
OnBootSec=3min
OnUnitInactiveSec=5min
AccuracySec=40s
Persistent=true
Unit=c720p-s9-preroll-verification.service

[Install]
WantedBy=timers.target
"""
def ctl(*args):
 return subprocess.run(["systemctl","--user",*args],capture_output=True,text=True,check=True,timeout=35).stdout.strip()
def main():
 if not SRC.is_file():raise RuntimeError("local_checker_staging_missing")
 if "CUTOFF_MS" not in SRC.read_text():raise RuntimeError("local_checker_invalid")
 if not SYS.is_dir():raise RuntimeError("user_systemd_missing")
 timestamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 backup=BACK/timestamp;backup.mkdir(parents=True,mode=0o700,exist_ok=False)
 orig={}
 for p in [DST,SERVICE,TIMER]:
  orig[p]=p.read_bytes() if p.exists() else None
  if p.exists():shutil.copy2(p,backup/p.name)
 try:
  values={DST:SRC.read_text(),SERVICE:SERVICE_CONTENT,TIMER:TIMER_CONTENT}
  for p,txt in values.items():
   temp=p.with_name(p.name+".s9-validator-stage")
   temp.write_text(txt,encoding="utf-8");temp.chmod(0o700 if p==DST else 0o644)
   os.replace(temp,p)
  subprocess.run(["python3","-m","py_compile",str(DST)],check=True,timeout=10)
  # One read-only validation pass now; no recordings required.
  run=subprocess.run(["python3",str(DST)],capture_output=True,text=True,timeout=65)
  if run.returncode:raise RuntimeError("local_validator_first_run_failed_"+run.stderr[-280:])
  statepath=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new/preroll-validation.json")
  status=json.loads(statepath.read_text())
  if status.get("test_recording_triggered") is not False:raise RuntimeError("validation_not_read_only")
  ctl("daemon-reload");ctl("enable","--now",TIMER)
  if ctl("is-active",TIMER)!="active":raise RuntimeError("local_timer_inactive")
  print("C720P_LOCAL_PREROLL_VERIFICATION_ACTIVE",json.dumps({"timer":"5 minutes",
    "initial_status":status.get("status"),"first_run":run.stdout[-400:],
    "archive_count":status.get("archive_clips"),"backup":str(backup),
    "no_ChatGPT_tasks":True,"no_camera_modification":True,
    "media_changed":False},sort_keys=True))
 except Exception:
  try:ctl("disable","--now",TIMER.name)
  except Exception:pass
  for p,body in orig.items():
   if body is None:p.unlink(missing_ok=True)
   else:p.write_bytes(body)
  try:ctl("daemon-reload")
  except Exception:pass
  raise
if __name__=="__main__":main()
