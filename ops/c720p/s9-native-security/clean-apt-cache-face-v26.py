#!/usr/bin/env python3
"""Guarded reclaim of ONLY downloaded APT .deb cache, never installed packages.

Don't modify recordings, models, HA data, rollback APKs, running services or
actual package configuration. Verify the live native S9 4K/GPU camera before
and after, and report net reclaimed root bytes.
"""
import argparse,json,os,pathlib,shutil,subprocess,urllib.request
APT=pathlib.Path("/var/cache/apt/archives")
def health():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=10) as stream:
  d=json.load(stream)
 if not(d.get("ok") is True and d.get("mode")=="watching" and
   d.get("native_4k_enabled") is True and
   d.get("garden_person_gate_backend")=="gpu" and
   int(d.get("last_frame_age_ms") or 999999)<3000):
  raise RuntimeError("native_camera_not_healthy")
 return {"camera":"watching","gpu":True,"4k":True,"temp_c":d.get("temperature_c")}
def subprocess_checked(args,timeout=60):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 return p.returncode,(p.stdout or "")[-450:],(p.stderr or "")[-450:]
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--apply",action="store_true")
 a=p.parse_args()
 before=shutil.disk_usage("/").free
 result={"mode":"apply" if a.apply else "dry_run",
  "root_free_before_mib":round(before/1048576,1),
  "recordings_changed":False,"camera_apk_changed":False,
  "rollback_backups_changed":False,"installed_packages_changed":False}
 if not APT.is_dir() or APT.is_symlink():raise RuntimeError("apt_cache_path_invalid")
 debs=[]
 for x in APT.iterdir():
  if x.is_symlink() or not x.is_file() or x.suffix!=".deb":continue
  st=x.stat()
  if st.st_nlink!=1 or st.st_size<=0:continue
  debs.append(st.st_blocks*512)
 result["cached_deb_files"]=len(debs)
 result["cached_deb_allocated_mib"]=round(sum(debs)/1048576,1)
 result["camera_pre"]=health()
 if a.apply:
  ps=subprocess.run(["ps","-eo","comm="],capture_output=True,text=True,timeout=15)
  if ps.returncode:raise RuntimeError("apt_process_inventory_failed")
  running={n.strip() for n in ps.stdout.splitlines()}
  if {"apt","apt-get","aptitude","dpkg","unattended-upgr","dpkg-deb"}.intersection(running):
   raise RuntimeError("package_manager_currently_active")
  # /usr/bin/apt-get clean only discards downloaded package archives.
  # It does not uninstall, upgrade, or reconfigure software.
  rc,output,error=subprocess_checked(["sudo","-n","/usr/bin/apt-get","clean"],95)
  if rc:raise RuntimeError("apt_cache_cleanup_failed:"+error[-180:])
  result["cleanup"]="apt_get_clean_successful"
 result["camera_post"]=health()
 after=shutil.disk_usage("/").free
 result["root_free_after_mib"]=round(after/1048576,1)
 result["root_net_reclaimed_mib"]=round((after-before)/1048576,1)
 print("C720P_FACE_V26_APT_RECLAIM "+json.dumps(result,sort_keys=True),flush=True)
if __name__=="__main__":main()
