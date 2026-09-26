#!/usr/bin/env python3
from pathlib import Path
import subprocess

HOME=Path("/home/jespern")
UNITDIR=HOME/".config/systemd/user"
STATE=HOME/"c720p-home-hub/state"
STATE.mkdir(parents=True,exist_ok=True)

drop=UNITDIR/"c720p-frontyard-security.service.d"/"99-s3-retired-v866.conf"
drop.parent.mkdir(parents=True,exist_ok=True)
drop.write_text("""[Unit]
# S3 is deliberately retired. Generic recovery automation may not restart it
# unless an administrator explicitly creates this marker.
ConditionPathExists=/home/jespern/c720p-home-hub/state/ENABLE_RETIRED_S3
""")
drop.chmod(0o644)

def run(args):
    return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,check=False)

for unit in ("c720p-s3-profile-guard.timer","c720p-s3-battery-camera-gate.timer","c720p-frontyard-security.service"):
    run(["systemctl","--user","disable","--now",unit])
run(["systemctl","--user","daemon-reload"])
run(["systemctl","--user","stop","c720p-frontyard-security.service"])

active=run(["systemctl","--user","is-active","c720p-frontyard-security.service"]).stdout.strip()
enabled=run(["systemctl","--user","is-enabled","c720p-frontyard-security.service"]).stdout.strip()
condition=run(["systemctl","--user","show","c720p-frontyard-security.service","-p","ConditionResult","--value"]).stdout.strip()
print("S3_STATE="+active)
print("S3_ENABLED="+enabled)
print("S3_CONDITION_RESULT="+condition)
print("S3_DROPIN="+str(drop))
if active=="active":
    raise SystemExit("retired_s3_still_active")
print("RESULT=S3_RETIREMENT_V866_APPLIED")
