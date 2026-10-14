#!/usr/bin/env python3
"""Install a bounded C720P-local cold/idle S9 v9 upgrade retry timer.

This action DOES NOT replace the currently installed S9 APK. Only a later
verified, cool and idle service run may call deploy-person-motion-v9.py.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request

HOME = Path("/home/jespern/c720p-home-hub")
BUILD = HOME / "build/s9-pedestrian-v9-cool-idle"
UNIT_DIR = Path.home() / ".config/systemd/user"
UNIT = "s9-pedestrian-v9-cool-idle"
MODEL = "nl.kalenel.s9security"
HEAD = "https://raw.githubusercontent.com/JesperOaths/kale-nel/"

RUNNER = r'''#!/usr/bin/env python3
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

base = Path(__file__).resolve().parent
config = json.loads((base / "config.json").read_text())
unit = "s9-pedestrian-v9-cool-idle.timer"

def report(kind, more=None):
    payload = {"event":kind,"timestamp":int(time.time()),"sha":config["sha"]}
    payload.update(more or {})
    target = base / "result.json"
    tmp = base / "result.json.tmp"
    tmp.write_text(json.dumps(payload,sort_keys=True) + "\n")
    os.chmod(tmp,0o600)
    os.replace(tmp,target)
    print("S9_V9_COOL_IDLE_"+kind,json.dumps(payload),flush=True)

def disarm():
    subprocess.run(["systemctl","--user","disable","--now",unit],
                   capture_output=True,text=True,timeout=18)

def main():
    with (base / "lock").open("a+") as lock:
        try: fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: return
        if time.time()>float(config["expires"]):
            report("EXPIRED_NOT_INSTALLED")
            disarm()
            return
        with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=11) as resp:
            s=json.load(resp)
        if s.get("motion_detector")=="person_spatiotemporal_transport_v9":
            report("ALREADY_ACTIVE")
            disarm()
            return
        # Never restart a phone running the high-power continuous 4K ring above
        # its documented 37.5 C auto-resume ceiling. Provide margin for boot.
        safe=(s.get("ok") is True and s.get("mode")=="watching" and
              s.get("continuous_4k_trial_active") is True and
              s.get("continuous_4k_production_persisted") is True and
              s.get("continuous_4k_ready") is True and
              int(s.get("continuous_4k_buffered_ms") or 0)>=5000 and
              s.get("garden_person_gate_ready") is True and
              s.get("garden_person_gate_backend")=="gpu" and
              float(s.get("temperature_c",100))<36.7 and
              int(s.get("sd_free_bytes") or 0)>15*1024**3)
        if not safe:
            report("DEFERRED_GUARDED",{"temperature_c":s.get("temperature_c"),
                 "mode":s.get("mode"),"continuous_4k_ready":s.get("continuous_4k_ready")})
            return
        deploy=base/"deploy-person-motion-v9.py"
        if hashlib.sha256(deploy.read_bytes()).hexdigest()!=config["deploy_sha256"]:
            report("SOURCE_DRIFT_ABORTED")
            disarm()
            return
        env={**os.environ,"S9_SECURITY_REF":config["sha"]}
        try:
            proc=subprocess.run([sys.executable,str(deploy)],env=env,
                 capture_output=True,text=True,timeout=740)
        except subprocess.TimeoutExpired:
            report("DEPLOY_TIMEOUT_ABORTED")
            disarm()
            return
        out=proc.stdout[-3000:]
        if proc.returncode==0 and ("S9_PEDESTRIAN_V9_LIVE_HEALTH_PASS" in out or
                 "S9_PEDESTRIAN_V9_ALREADY_ACTIVE" in out):
            report("INSTALLED_VERIFIED",{"details":out[-1900:]})
            disarm()
        elif proc.returncode==0 and "S9_PEDESTRIAN_V9_DEFERRED_" in out:
            report("DEFERRED_FROM_DEPLOYER",{"details":out[-800:]})
        else:
            report("DEPLOY_FAILED_RETRY_DISABLED",{
               "exit_code":proc.returncode,"stdout":out[-1300:],
               "stderr":proc.stderr[-1200:]})
            disarm()

if __name__=="__main__":
    try: main()
    except BaseException as error:
        report("EXCEPTION_RETRY_DISABLED",{"type":type(error).__name__,
                                            "reason":str(error)[:300]})
        disarm()
        raise
'''

def atomic_write(path, data, mode=0o600):
    if path.is_symlink():raise RuntimeError("refuse_symlink_target")
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+".v9-stage")
    if tmp.exists():tmp.unlink()
    with tmp.open("xb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp,mode)
    os.replace(tmp,path)

def main():
    sha=os.environ.get("S9_SECURITY_REF","")
    expected=os.environ.get("S9_V9_DEPLOY_SHA256","")
    if not re.fullmatch("[0-9a-f]{40}",sha) or not re.fullmatch("[0-9a-f]{64}",expected):
        raise RuntimeError("pinned_release_and_sha256_required")
    if MODEL != "nl.kalenel.s9security":
        raise RuntimeError("unexpected_package")
    prior=BUILD/"config.json"
    if prior.is_file():
        old=json.loads(prior.read_text())
        if old.get("sha")==sha and old.get("deploy_sha256")==expected and old.get("expires",0)>time.time():
            print("S9_V9_COOL_IDLE_TIMER_ALREADY_ARMED",flush=True)
            return
    path="ops/c720p/s9-native-security/deploy-person-motion-v9.py"
    request=urllib.request.Request(HEAD+sha+"/"+path,
      headers={"User-Agent":"C720P-v9-immutable-release/1"})
    with urllib.request.urlopen(request,timeout=45) as resp: body=resp.read(24001)
    if len(body)<2000 or len(body)>24000:
        raise RuntimeError("unexpected_deployer_source_size")
    if hashlib.sha256(body).hexdigest()!=expected:
        raise RuntimeError("pinned_deployer_hash_mismatch")
    if len(RUNNER)<2000:raise RuntimeError("runner_missing")
    BUILD.mkdir(parents=True,exist_ok=True)
    BUILD.chmod(0o700)
    now=time.time()
    cfg={"sha":sha,"deploy_sha256":expected,"created":now,
         "expires":now+24*3600}
    atomic_write(BUILD/"deploy-person-motion-v9.py",body)
    atomic_write(BUILD/"runner.py",RUNNER.encode("utf-8"),0o700)
    atomic_write(prior,(json.dumps(cfg,sort_keys=True)+"\n").encode("utf-8"))
    service=f"""[Unit]
Description=Single guarded S9+ pedestrian-gate v9 upgrade attempt during safe idle
ConditionPathExists={BUILD}/config.json

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 {BUILD}/runner.py
TimeoutStartSec=820
Nice=12
"""
    timer=f"""[Unit]
Description=Bounded cool-idle S9+ person-gate upgrade retry

[Timer]
OnActiveSec=120
OnUnitInactiveSec=1800
AccuracySec=2min
Unit={UNIT}.service
Persistent=false

[Install]
WantedBy=timers.target
"""
    atomic_write(UNIT_DIR/(UNIT+".service"),service.encode("utf-8"),0o644)
    atomic_write(UNIT_DIR/(UNIT+".timer"),timer.encode("utf-8"),0o644)
    subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=15)
    subprocess.run(["systemctl","--user","enable","--now",UNIT+".timer"],
                   check=True,timeout=25,capture_output=True,text=True)
    enabled=subprocess.run(["systemctl","--user","is-active",UNIT+".timer"],
                           capture_output=True,text=True,timeout=10)
    if enabled.returncode!=0 or enabled.stdout.strip()!="active":
        raise RuntimeError("deferred_timer_not_active")
    print("S9_V9_COOL_IDLE_TIMER_ARMED",json.dumps({
         "ref":sha,"service":UNIT+".service","timer":UNIT+".timer",
         "window_hours":24,"temperature_preflight_max_c":36.7,
         "first_attempt_after_seconds":120,
         "retry_interval_seconds":1800,
         "backup_and_rollback_by":"deploy-person-motion-v9.py",
         "phone_apk_changed":False}),flush=True)

if __name__=="__main__":
    main()
