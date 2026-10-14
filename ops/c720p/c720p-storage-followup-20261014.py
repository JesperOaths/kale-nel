#!/usr/bin/env python3
"""Read-only C720P follow-up: root filesystem and specific major cache paths."""
import json, os, pathlib, shutil, subprocess, time

CHECK=[
 ("tmp","/tmp",1),("home","/home/jespern",1),
 ("hub","/home/jespern/c720p-home-hub",1),
 ("hub_build","/home/jespern/c720p-home-hub/build",1),
 ("hub_backups","/home/jespern/c720p-home-hub/backups",1),
 ("old_apks_v5","/home/jespern/c720p-home-hub/backups/s9-continuous4k-v5",1),
 ("old_apks_v6","/home/jespern/c720p-home-hub/backups/s9-continuous4k-v6",1),
 ("old_apks_prepend","/home/jespern/c720p-home-hub/backups/s9-onphone-prepend-v1",1),
 ("user_cache","/home/jespern/.cache",1),
 ("user_config","/home/jespern/.config",1),
 ("chromium_profile","/home/jespern/.config/chromium",2),
 ("kiosk_profile","/home/jespern/.config/c720p-kiosk-chromium",2),
 ("spotify_profile","/home/jespern/.config/c720p-spotify-chromium",2),
 ("kiosk_default","/home/jespern/.config/c720p-kiosk-chromium/Default",1),
 ("spotify_default","/home/jespern/.config/c720p-spotify-chromium/Default",1),
 ("chromium_default","/home/jespern/.config/chromium/Default",1),
 ("var","/var",1),("docker","/var/lib/docker",1),
 ("containerd","/var/lib/containerd",1),
 ("log","/var/log",1),
 ("opt","/opt",1),("usr","/usr",1)
]
def limited_du(path,depth):
 try:
  p=subprocess.run(["nice","-n","15","ionice","-c","3","du","-x","-m",
      "--max-depth="+str(depth),"--",path],capture_output=True,text=True,timeout=75)
  parsed=[]
  for line in p.stdout.splitlines():
   if "\t" not in line:continue
   size,name=line.split("\t",1)
   if name!=path and name.startswith(path.rstrip("/")+"/"):
    item=name[len(path.rstrip("/"))+1:]
    if "/" not in item:
     parsed.append({"name":item[:85],"mib":int(size)})
  return {"state":"complete" if p.returncode==0 else "partial",
       "top":sorted(parsed,key=lambda a:-a["mib"])[:18]}
 except Exception as e:return {"state":type(e).__name__}
r={"timestamp":time.time(),"mode":"read_only","dirs":{},"files":{}}
for label,path,depth in CHECK:
 if pathlib.Path(path).is_dir():r["dirs"][label]=limited_du(path,depth)
for label,path in [("tmp","/tmp"),("var_log","/var/log"),
   ("hub_build","/home/jespern/c720p-home-hub/build")]:
 root=pathlib.Path(path)
 if not root.is_dir():continue
 entries=[]
 for f in root.iterdir():
  try:
   if f.is_file() and not f.is_symlink():
    s=f.stat()
    entries.append({"name":f.name[:80],"mib":round(s.st_blocks*512/1048576,2),
           "age_hours":round((time.time()-s.st_mtime)/3600,1)})
  except OSError:continue
 r["files"][label]=sorted(entries,key=lambda x:-x["mib"])[:20]
for label,argv in [
 ("df_inodes",["df","-i","/"]),("docker_df",["docker","system","df"]),
 ("journal_usage",["journalctl","--disk-usage"])]:
 try:
  p=subprocess.run(argv,capture_output=True,text=True,timeout=18)
  r[label]={"rc":p.returncode,"stdout":p.stdout[:1300]}
 except Exception as e:r[label]={"error":type(e).__name__}
d=shutil.disk_usage("/")
r["root"]={"free_bytes":d.free,"used_bytes":d.used,"total_bytes":d.total}
# Read-only historical APK assessment; restrict to old, superseded release directories.
HISTORICAL=("s9-continuous4k-v5","s9-continuous4k-v6",
 "s9-onphone-prepend-v1","s9-face-roi-movement-v1","smooth-video",
 "s9-5s10s-v9","s9-continuous4k-v4","s9-preroll-v3",
 "s9-person-evidence-v31","s9-prepended-v1c-one-time")
apks=[]
for gen in HISTORICAL:
 root=pathlib.Path("/home/jespern/c720p-home-hub/backups")/gen
 if not root.is_dir() or root.is_symlink():continue
 for file in root.rglob("*.apk"):
  try:
   if file.is_symlink() or not file.is_file():continue
   st=file.stat()
   apks.append({"path":str(file),"mib":round(st.st_size/1048576,1),
                "age_hours":round((time.time()-st.st_mtime)/3600,1),
                "link_count":st.st_nlink})
  except OSError:continue
r["historical_apk_candidates"]=apks
# Read-only S9 health diagnosis after high-volume microSD archive copying.
try:
 import urllib.request
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as response:
  health=json.load(response)
 r["phone_after_archive"]={
  key:health.get(key) for key in (
   "ok","mode","continuous_4k_ready","garden_person_gate_ready",
   "garden_person_gate_backend","last_frame_age_ms","temperature_c",
   "sd_free_bytes","recording_active","last_error",
   "continuous_4k_buffered_ms"
  )}
except Exception as exc:r["phone_after_archive"]={"error":type(exc).__name__}
try:
 adb=subprocess.run(["adb","-s","192.168.178.250:5555","get-state"],
  capture_output=True,text=True,timeout=8)
 r["phone_adb"]={"exit_code":adb.returncode,"state":adb.stdout.strip()[:40]}
except Exception as exc:r["phone_adb"]={"error":type(exc).__name__}
print("C720P_STORAGE_FOLLOWUP_V2 "+json.dumps(r,separators=(",",":"),sort_keys=True),flush=True)
