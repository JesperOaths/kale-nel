#!/usr/bin/env python3
from pathlib import Path
import subprocess, time, stat

HOME=Path("/home/jespern")
ROOT=Path("/opt/homeassistant/config/www")

def replace_text(path,repls,restore_mode=None):
    if not path.exists(): return False
    old_mode=stat.S_IMODE(path.stat().st_mode)
    if not (old_mode & stat.S_IWUSR):
        path.chmod(old_mode | stat.S_IWUSR)
    s=path.read_text(encoding="utf-8",errors="replace")
    old=s
    for a,b in repls:
        s=s.replace(a,b)
    if s!=old:
        path.write_text(s,encoding="utf-8")
    path.chmod(restore_mode if restore_mode is not None else old_mode)
    return s!=old

src=HOME/"c720p-security-camera-new/c720p-frontyard-security-new.py"
replace_text(src,[
 ("<title>New Camera Security</title>","<title>Camera Security</title>"),
 ("<h2>New Camera Security</h2>","<h2>Camera Security</h2>"),
 ("software motion detection from the new IP Webcam","software motion detection from the camera"),
 ("New camera motion detected","Camera motion detected"),
])
for p in [ROOT/"frontyard-security-new/events.json", HOME/"c720p-home-hub/state/drive-security-archive.json"]:
    replace_text(p,[("New camera motion detected","Camera motion detected"),("New camera","Camera")])
replace_text(ROOT/"frontyard-security-new/index.html",[
 ("New Camera Security","Camera Security"),
 ("New camera motion detected","Camera motion detected"),
 ("from the new IP Webcam","from the camera"),
])
replace_text(ROOT/"frontyard-security-new/clips.html",[
 ("C720P New Camera Playback","C720P Camera Playback"),
 ("New camera clips","Camera clips"),
 ("New camera","Camera"),
])
replace_text(ROOT/"c720p-drive-saved.html",[
 ("(e.reason?' — '+e.reason:'')","(e.reason?' — '+String(e.reason).replace(/^New camera/i,'Camera'):'')"),
])
replace_text(ROOT/"c720p-release/home-live-primary-v2.html",[
 ("Live · New camera","Live · Camera"),
 ("New camera","Camera"),
],restore_mode=0o444)
replace_text(HOME/"c720p-home-hub/bin/verify-home-primary-security-contract.py",[
 ("Live · New camera","Live · Camera"),
])
replace_text(HOME/".config/systemd/user/c720p-frontyard-security-new.service",[
 ("Description=C720P New Primary Camera motion clips","Description=C720P Camera motion clips"),
])

subprocess.run(["python3","-m","py_compile",str(src)],check=True)
subprocess.run(["systemctl","--user","daemon-reload"],check=True)
subprocess.run(["systemctl","--user","restart","c720p-frontyard-security-new.service"],check=True)
time.sleep(4)
state=subprocess.run(["systemctl","--user","is-active","c720p-frontyard-security-new.service"],text=True,capture_output=True).stdout.strip()
if state!="active": raise SystemExit("recorder state="+state)
print("RECORDER_STATE="+state)
print("HOME_LIVE_MODE="+oct(stat.S_IMODE((ROOT/"c720p-release/home-live-primary-v2.html").stat().st_mode)))
print("RESULT=CAMERA_NAMING_V87B_APPLIED")
