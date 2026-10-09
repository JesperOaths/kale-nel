#!/usr/bin/env python3
"""Install S9 SD-only replay in the existing secure Saved Clips proxy."""
import datetime,shutil,subprocess,time,urllib.request
from pathlib import Path
HOME=Path("/home/jespern/c720p-home-hub/bin")
SERVER=HOME/"c720p-drive-security-archive.py"
EXT=HOME/"s9_sd_proxy_extension.py"
STAGED=Path("/tmp/s9_sd_proxy_extension.py")
def check():
 with urllib.request.urlopen("http://127.0.0.1:8795/health.json",timeout=8) as x:return x.status==200
if not STAGED.is_file():raise SystemExit("Extension not staged")
subprocess.run(["python3","-m","py_compile",str(STAGED)],check=True)
source=SERVER.read_text()
marker="c=cfg();ThreadingHTTPServer"
if not EXT.is_file():shutil.copy2(STAGED,EXT)
else:shutil.copy2(STAGED,EXT)
if "s9_sd_proxy_extension.install_local_sd(H)" in source:
 print("S9_SD_PROXY_PREVIOUSLY_PATCHED")
else:
 if source.count(marker)!=1:raise SystemExit("Source anchor changed, no modifications made")
 stamp=datetime.datetime.now().strftime("%Y%m%d%H%M%S")
 backup=SERVER.with_name(SERVER.name+".before-s9-local-"+stamp)
 shutil.copy2(SERVER,backup)
 edited=source.replace(marker,"import s9_sd_proxy_extension\ns9_sd_proxy_extension.install_local_sd(H)\n"+marker)
 subprocess.run(["python3","-c","compile(open('"+str(SERVER)+"').read(), 'archive', 'exec')"],check=True)
 part=SERVER.with_suffix(".py.s9localtmp")
 part.write_text(edited);part.chmod(SERVER.stat().st_mode & 0o777)
 subprocess.run(["python3","-m","py_compile",str(part)],check=True)
 part.replace(SERVER)
 print("PROXY_BACKUP",backup,flush=True)
try:
 subprocess.run(["systemctl","--user","restart","c720p-drive-security-archive.service"],check=True,timeout=30)
 time.sleep(3)
 if not check():raise RuntimeError("archive proxy health check failed")
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=12) as r:
  import json
  d=json.load(r)
  assert d.get("archive_mode")=="S9-microSD-only","archive not in SD mode"
  print("LOCAL_SAVED_EVENTS",len(d.get("events",[])),flush=True)
except Exception:
 if "backup" in locals():
  shutil.copy2(backup,SERVER)
  subprocess.run(["systemctl","--user","restart","c720p-drive-security-archive.service"],timeout=30)
 print("S9_SD_PROXY_INSTALL_ROLLBACK",flush=True)
 raise
