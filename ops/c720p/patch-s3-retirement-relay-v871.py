#!/usr/bin/env python3
"""v871 S3 retirement + S9+ LAN relay route repair."""
from pathlib import Path
import subprocess, time, shutil

home=Path("/home/jespern")
base=home/"c720p-home-hub"
relay=base/"bin/c720p-lan-camera-relay.py"
stamp=time.strftime("%Y%m%d_%H%M%S")
backup=home/"c720p-backups"/f"v871-s3-relay-{stamp}"
backup.mkdir(parents=True,exist_ok=True)
shutil.copy2(relay,backup/"c720p-lan-camera-relay.py.before")
s=relay.read_text()

old="cam,kind=parts; url=('http://127.0.0.1:8796/'+kind if cam=='new' and kind in ('live.mjpg','health.json') else ('http://127.0.0.1:8797/live.mjpg' if cam=='s3' and kind=='live.mjpg' else f'http://127.0.0.1:{UP[cam]}/{kind}'))"
if old in s:
    s=s.replace(old,"cam,kind=parts; url=f'http://127.0.0.1:{UP[cam]}/{kind}'",1)
for needle,repl in [
 ("def do_POST(self):\n  path=urllib.parse.urlsplit(self.path).path\n",
  "def do_POST(self):\n  path=urllib.parse.urlsplit(self.path).path\n  if path.startswith('/s3/'):\n   return self.empty(410)\n"),
 ("def go(self,head=False):\n  path=urllib.parse.urlsplit(self.path).path\n",
  "def go(self,head=False):\n  path=urllib.parse.urlsplit(self.path).path\n  if path.startswith('/s3/'):\n   return self.empty(410)\n"),
]:
    if needle in s and repl not in s:
        s=s.replace(needle,repl,1)
relay.write_text(s)
subprocess.run(["python3","-m","py_compile",str(relay)],check=True)

retire=base/"state/S3_RETIRED"
retire.write_text(f"S3 retired permanently from active C720P camera operations at {time.strftime('%Y-%m-%dT%H:%M:%S%z')}\n")
unitdir=home/".config/systemd/user"
out=subprocess.check_output(["systemctl","--user","list-unit-files","--no-legend","--no-pager"],text=True)
units=sorted({line.split()[0] for line in out.splitlines() if line and (line.split()[0].startswith("c720p-s3-") or line.split()[0].startswith("c720p-newcam-s3-relay-guard."))})
for unit in units:
    subprocess.run(["systemctl","--user","disable","--now",unit],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    d=unitdir/f"{unit}.d"; d.mkdir(parents=True,exist_ok=True)
    (d/"90-s3-retired.conf").write_text(f"[Unit]\nConditionPathExists=!{retire}\n")
subprocess.run(["systemctl","--user","daemon-reload"],check=True)
subprocess.run(["systemctl","--user","restart","c720p-lan-camera-relay.service"],check=True)
print(f"retired_units={len(units)} backup={backup}")
