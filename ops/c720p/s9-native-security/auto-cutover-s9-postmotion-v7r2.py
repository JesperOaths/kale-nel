#!/usr/bin/env python3
"""C720P-native deferred guarded upgrade for S9+ post-motion v7r2.

Invoked by the C720P's own systemd user timer, not a ChatGPT reminder.
Never touches the phone during a motion event; never bypasses thermal guards.
After two verified cool and idle probes, optionally reboots *only the camera
app* if the prior 4K ring remains in a thermal fallback, then runs the same
rollback-protected on-phone MP4 proof used for an interactive deployment.
Every unsuccessful attempt preserves v6 and is rate-limited.
"""
from __future__ import annotations
import datetime,fcntl,json,os,pathlib,re,subprocess,time,urllib.request
HOME=pathlib.Path("/home/jespern/c720p-home-hub")
STATE=HOME/"reports/s9-postmotion-v7r2-auto-cutover.json"
SIGNED=HOME/"build/s9-postmotion-v7r2/s9-postmotion-v7r2.apk"
PROOF=HOME/"build/s9-postmotion-v7r2/deployment-report.json"
SCRIPT=HOME/"bin/deploy-guarded-s9-postmotion-v7r2.py"
TIMER="c720p-s9-postmotion-v7r2-cutover.timer"
SERIAL="192.168.178.250:5555"
PACKAGE="nl.kalenel.s9security"
OLD="b11b9b07632f8d31e0a254225876fccf09ccae9448417d92350b9f11c9bb4090"
def note(stage,extra=None):
 p=STATE.with_suffix(".tmp")
 STATE.parent.mkdir(parents=True,exist_ok=True)
 d={"stage":stage,"at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
 if extra:d.update(extra)
 p.write_text(json.dumps(d,sort_keys=True,indent=2)+"\n")
 os.replace(p,STATE)
 print("S9_POSTMOTION_CUTOVER",json.dumps(d,sort_keys=True),flush=True)
def adb(*args,timeout=20):
 p=subprocess.run(["adb","-s",SERIAL,*args],text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError("adb_failed:"+str(args[:3])+":"+p.stderr[-120:])
 return p.stdout
def temp():
 raw=adb("shell","dumpsys","battery",timeout=14)
 m=re.search(r"^\s*temperature:\s*(\d+)\s*$",raw,re.M)
 if not m:raise RuntimeError("battery_temperature_missing")
 return int(m.group(1))/10
def status():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=12) as f:
  return json.load(f)
def healthy(d,full=True):
 return (d.get("ok") is True and d.get("mode")=="watching" and
  d.get("garden_person_gate_backend")=="gpu" and
  0<=d.get("last_frame_age_ms",99999)<1500 and
  (not full or (d.get("continuous_4k_ready") is True and
   d.get("continuous_4k_production_persisted") is True and
   d.get("continuous_4k_dropped_output_frames")==0 and
   not d.get("continuous_4k_error"))))
def stop_timer():
 p=subprocess.run(["systemctl","--user","disable","--now",TIMER],
                  text=True,capture_output=True,timeout=25)
 print("TIMER_DISABLED",p.returncode,p.stderr[-120:],flush=True)
def main():
 lock=pathlib.Path("/run/user/1000/c720p-s9-postmotion-v7r2-cutover.lock")
 with lock.open("a+") as f:
  try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:return
  if PROOF.exists():
   try:
    report=json.loads(PROOF.read_text())
    if report.get("production_deployed") and report.get("post_motion_hold_ms")==30000:
     note("installed_verified",{"apk":report.get("apk_sha256")})
     stop_timer()
     return
   except Exception:pass
  if not(SIGNED.is_file() and SCRIPT.is_file()):
   note("staged_artifacts_unavailable");return
  # Abort before modifying anything if available disk or signed dependencies
  # are gone. This is a cheap periodic condition probe, never a forced install.
  root=os.statvfs(str(HOME))
  if root.f_bavail*root.f_frsize<350*1024*1024:
   note("disk_below_guard");return
  try:
   one=status();start_t=temp()
  except Exception as e:
   note("camera_unreachable",{"error_type":type(e).__name__});return
  if not healthy(one,False):
   note("camera_not_idle_or_gpu_not_ready",{"mode":one.get("mode")});return
  if start_t>37.0:
   note("waiting_for_natural_cooling",{"battery_c":start_t,
      "encoder_mode":one.get("continuous_4k_last_result")});return
  if one.get("recordings_this_hour",0)>22:
   note("recording_rate_budget_busy");return
  time.sleep(9)
  try:two=status();new_t=temp()
  except Exception:
   note("second_probe_failed");return
  if (not healthy(two,False) or new_t>37.0 or
      two.get("recorded")!=one.get("recorded") or
      two.get("motion_events")!=one.get("motion_events")):
   note("safe_idle_window_changed",{"battery_c":new_t});return
  # A transient thermal fall-back in v6 does not rearm until battery<35C.
  # Rebooting the app while <37.0C is the verified way to reinitialize it.
  if not healthy(two,True):
   note("rearming_previous_verified_4k_under_cool_guard",{"battery_c":new_t})
   adb("shell","am","force-stop",PACKAGE,timeout=22)
   adb("shell","am","start","-n",PACKAGE+"/.CameraActivity","--ez",
       "enable_native_camera","true",timeout=40)
   ok=False
   for i in range(55):
    time.sleep(2)
    try:
     d=status()
     if healthy(d,True) and temp()<38.2:
      ok=True;break
    except Exception:pass
   if not ok:
    note("existing_4k_rearm_not_ready");return
  if not healthy(status(),True) or temp()>=38.2:
   note("temperature_or_ring_changed_before_install");return
  # The installer backs up the actual signed package, verifies source and
  # signer, requires a 14-second idle window, proves an unbroken >=36s 4K
  # MP4, then tests restart persistence. Failure restores the v6 APK.
  note("starting_guarded_install")
  run=subprocess.run(["/usr/bin/python3",str(SCRIPT)],text=True,capture_output=True,timeout=780)
  print("GUARDED_INSTALL_EXIT",run.returncode,flush=True)
  print("GUARDED_INSTALL_STDOUT_TAIL",run.stdout[-5000:],flush=True)
  if run.stderr:print("GUARDED_INSTALL_ERROR_TAIL",run.stderr[-1800:],flush=True)
  if run.returncode!=0:
   note("deployment_failed_guarded_rollback",{"exit_code":run.returncode})
   # Do not automatically retry a failed real-install test: investigate
   # the stored outcome first instead of thrashing an already hot phone.
   stop_timer()
   return
  if not PROOF.exists():
   note("deployment_deferred_during_run");return
  try:report=json.loads(PROOF.read_text())
  except Exception:
   note("deployment_report_unreadable");return
  if not(report.get("production_deployed") and report.get("post_motion_hold_ms")==30000):
   note("deployment_not_proven");return
  end=status()
  if not healthy(end,True) or end.get("person_post_motion_hold_ms")!=30000:
   note("deployment_post_report_health_not_verified");return
  note("installed_verified",{"apk":report.get("apk_sha256"),
      "tail_ms":30000,"buffer_ms":end.get("continuous_4k_buffered_ms"),
      "temperature_c":end.get("temperature_c")})
  stop_timer()
if __name__=="__main__":
 try:main()
 except Exception as error:
  note("retry_check_failed",{"error_type":type(error).__name__,"error":str(error)[:220]})
  raise
