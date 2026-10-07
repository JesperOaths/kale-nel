#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, subprocess, time

HOME=Path("/home/jespern")
ROOT=Path("/opt/homeassistant/config/www")
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"camera-naming-v87-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)

files=[
 HOME/"c720p-security-camera-new/c720p-frontyard-security-new.py",
 ROOT/"frontyard-security-new/events.json",
 ROOT/"frontyard-security-new/index.html",
 ROOT/"frontyard-security-new/clips.html",
 ROOT/"c720p-drive-saved.html",
 ROOT/"c720p-release/home-live-primary-v2.html",
 HOME/"c720p-home-hub/bin/verify-home-primary-security-contract.py",
 HOME/"c720p-home-hub/state/drive-security-archive.json",
 HOME/".config/systemd/user/c720p-frontyard-security-new.service",
]
for p in files:
    if p.exists():
        shutil.copy2(p,BACK/(p.name+".before"))

def replace_text(path,repls):
    if not path.exists():
        return 0
    s=path.read_text(encoding="utf-8",errors="replace")
    old=s
    for a,b in repls:
        s=s.replace(a,b)
    if s!=old:
        path.write_text(s,encoding="utf-8")
        return 1
    return 0

changed=0
src=HOME/"c720p-security-camera-new/c720p-frontyard-security-new.py"
changed+=replace_text(src,[
 ("<title>New Camera Security</title>","<title>Camera Security</title>"),
 ("<h2>New Camera Security</h2>","<h2>Camera Security</h2>"),
 ("software motion detection from the new IP Webcam","software motion detection from the camera"),
 ("New camera motion detected","Camera motion detected"),
])
# Existing live event metadata and archive metadata should use the new neutral name too.
for p in [ROOT/"frontyard-security-new/events.json", HOME/"c720p-home-hub/state/drive-security-archive.json"]:
    changed+=replace_text(p,[("New camera motion detected","Camera motion detected"),("New camera","Camera")])

# Current generated/playback pages.
changed+=replace_text(ROOT/"frontyard-security-new/index.html",[
 ("New Camera Security","Camera Security"),
 ("New camera motion detected","Camera motion detected"),
 ("from the new IP Webcam","from the camera"),
])
changed+=replace_text(ROOT/"frontyard-security-new/clips.html",[
 ("C720P New Camera Playback","C720P Camera Playback"),
 ("New camera clips","Camera clips"),
 ("New camera","Camera"),
])

# Saved archive UI: normalize any remote legacy reason without mutating the remote file.
saved=ROOT/"c720p-drive-saved.html"
if saved.exists():
    s=saved.read_text(encoding="utf-8",errors="replace")
    old=s
    s=s.replace("(e.reason?' — '+e.reason:'')","(e.reason?' — '+String(e.reason).replace(/^New camera/i,'Camera'):'')")
    if s!=old:
        saved.write_text(s,encoding="utf-8")
        changed+=1

# Home live card and its contract verifier.
changed+=replace_text(ROOT/"c720p-release/home-live-primary-v2.html",[
 ("Live · New camera","Live · Camera"),
 ("New camera","Camera"),
])
changed+=replace_text(HOME/"c720p-home-hub/bin/verify-home-primary-security-contract.py",[
 ("Live · New camera","Live · Camera"),
])
changed+=replace_text(HOME/".config/systemd/user/c720p-frontyard-security-new.service",[
 ("Description=C720P New Primary Camera motion clips","Description=C720P Camera motion clips"),
])

# Syntax-check the recorder before touching its running service.
subprocess.run(["python3","-m","py_compile",str(src)],check=True)
subprocess.run(["systemctl","--user","daemon-reload"],check=True)
subprocess.run(["systemctl","--user","restart","c720p-frontyard-security-new.service"],check=True)
time.sleep(4)
state=subprocess.run(["systemctl","--user","is-active","c720p-frontyard-security-new.service"],text=True,capture_output=True).stdout.strip()
if state!="active":
    raise SystemExit("camera recorder did not return active: "+state)

# If the service has not yet regenerated index.html, current HTML was already patched above.
print("BACKUP="+str(BACK))
print("FILES_CHANGED="+str(changed))
print("RECORDER_STATE="+state)
print("RESULT=CAMERA_NAMING_V87_APPLIED")
