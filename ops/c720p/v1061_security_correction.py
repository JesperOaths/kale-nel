#!/usr/bin/env python3
from pathlib import Path
import urllib.request,shutil,datetime,re,subprocess,py_compile,json,time

HOME=Path("/home/jespern");BASE=HOME/"c720p-home-hub";WWW=Path("/opt/homeassistant/config/www")
BIN=BASE/"bin";UNIT=HOME/".config/systemd/user"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"security-v1061-correction-{STAMP}";BACK.mkdir(parents=True,exist_ok=True)

def fetch(url):
    req=urllib.request.Request(url,headers={"User-Agent":"c720p-v1061"})
    with urllib.request.urlopen(req,timeout=30) as r:return r.read()
def put(url,dst,mode=0o755):
    dst=Path(dst)
    if dst.exists():shutil.copy2(dst,BACK/(dst.name+".before"))
    dst.write_bytes(fetch(url));dst.chmod(mode)
    if dst.suffix==".py":py_compile.compile(str(dst),doraise=True)

thumb=BIN/"c720p-saved-thumbnailer-v106.py"
drive=BIN/"c720p-drive-value-retention.py"
put("https://raw.githubusercontent.com/JesperOaths/kale-nel/ba183353c8d860a46803fe9075e83422af2d5ab6/ops/c720p/v106_saved_thumbnailer.py",thumb)
put("https://raw.githubusercontent.com/JesperOaths/kale-nel/348fcc5f49f613274b100ecf11f1bfea62de4700/ops/c720p/v106_drive_retention.py",drive)

# Keep thumbnail generation bounded and incremental.
svc=UNIT/"c720p-saved-thumbnailer-v106.service"
if svc.exists():shutil.copy2(svc,BACK/(svc.name+".before"))
svc.write_text("""[Unit]
Description=C720P saved clip representative thumbnail generator
After=c720p-drive-security-archive.service network-online.target
[Service]
Type=oneshot
Environment=C720P_THUMB_LIMIT=12
ExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/c720p-saved-thumbnailer-v106.py
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
""")

# Ensure live archive server always reconciles external Drive deletions on Saved Clips refresh.
server=BIN/"c720p-drive-security-archive.py"
if server.exists():shutil.copy2(server,BACK/(server.name+".before"))
s=server.read_text()
s=re.sub(r"REMOTE_INV_TTL\s*=\s*\d+","REMOTE_INV_TTL=30",s)
if "def reconcile_remote(cam,force=False):" not in s:
    s=s.replace("def reconcile_remote(cam):\n names=remote_inventory(cam)","def reconcile_remote(cam,force=False):\n names=remote_inventory(cam,force)",1)
s=s.replace("if ok:reconcile_remote(cam)\n   for x in sorted(items(cam)","if ok:reconcile_remote(cam,True)\n   for x in sorted(items(cam)",1)
server.write_text(s);py_compile.compile(str(server),doraise=True)

# Ensure UI delete payload and dead-row filtering are correct even if first install stopped early.
ui=WWW/"c720p-drive-saved.html"
if ui.exists():shutil.copy2(ui,BACK/(ui.name+".before"))
u=ui.read_text()
u=u.replace("JSON.stringify({name:e.remote_name})","JSON.stringify({remote_name:e.remote_name})")
u=u.replace("events=Array.isArray(d.events)?d.events:[];","events=(Array.isArray(d.events)?d.events:[]).filter(e=>e&&(!e.state||e.state==='verified'));",1)
ui.write_text(u)

subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
subprocess.run(["systemctl","--user","enable","--now","c720p-saved-thumbnailer-v106.timer"],check=True,timeout=30)
subprocess.run(["systemctl","--user","restart","c720p-drive-security-archive.service"],check=True,timeout=45)

# Generate only a small batch now; timer fills the rest progressively.
r=subprocess.run(["env","C720P_THUMB_LIMIT=6","python3",str(thumb)],text=True,capture_output=True,timeout=240)
print("THUMB_RC="+str(r.returncode))
print("THUMB_OUT="+r.stdout[-8000:])
print("THUMB_ERR="+r.stderr[-2000:])
if r.returncode:raise SystemExit(r.returncode)

subprocess.run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"],check=False,timeout=25)
print("CORRECTION_V1061=OK")
print("BACKUP="+str(BACK))
