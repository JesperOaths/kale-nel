from pathlib import Path
import datetime, re, shutil, subprocess

HOME=Path("/home/jespern")
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"security-v110-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)

SU=HOME/".config/systemd/user/c720p-saved-thumbnailer-v106.service"
TU=HOME/".config/systemd/user/c720p-saved-thumbnailer-v106.timer"

for p in (SU,TU):
    shutil.copy2(p,BACK/(p.name+".before"))

s=SU.read_text()
s,n=re.subn(r"^Environment=C720P_THUMB_LIMIT=.*$","Environment=C720P_THUMB_LIMIT=1",s,flags=re.M)
if n!=1: raise SystemExit("thumbnail limit setting not found")
s,n=re.subn(r"^Environment=C720P_THUMB_MAX_SECONDS=.*$","Environment=C720P_THUMB_MAX_SECONDS=150",s,flags=re.M)
if n!=1: raise SystemExit("thumbnail max-seconds setting not found")
s,n=re.subn(r"^TimeoutStartSec=.*$","TimeoutStartSec=3min",s,flags=re.M)
if n!=1: raise SystemExit("thumbnail timeout setting not found")
SU.write_text(s)

t=TU.read_text()
t,n=re.subn(r"^OnUnitInactiveSec=.*$","OnUnitInactiveSec=6min",t,flags=re.M)
if n!=1: raise SystemExit("thumbnail interval setting not found")
t,n=re.subn(r"^RandomizedDelaySec=.*$","RandomizedDelaySec=45s",t,flags=re.M)
if n!=1: raise SystemExit("thumbnail randomized delay setting not found")
TU.write_text(t)

# End any still-running V109 batch before loading the lighter worker.
subprocess.run(["systemctl","--user","stop","c720p-saved-thumbnailer-v106.service"],text=True,capture_output=True,timeout=35)
subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
subprocess.run(["systemctl","--user","reset-failed","c720p-saved-thumbnailer-v106.service"],text=True,capture_output=True,timeout=15)
subprocess.run(["systemctl","--user","restart","c720p-saved-thumbnailer-v106.timer"],check=True,timeout=20)
subprocess.run(["systemctl","--user","start","--no-block","c720p-saved-thumbnailer-v106.service"],text=True,capture_output=True,timeout=10)

print(f"BACKUP={BACK}")
print("THUMB_LIMIT=1")
print("THUMB_MAX_SECONDS=150")
print("THUMB_TIMEOUT=3min")
print("THUMB_INTERVAL=6min")
print("SECURITY_V110=OK")
