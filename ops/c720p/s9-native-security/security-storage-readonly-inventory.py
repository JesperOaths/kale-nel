#!/usr/bin/env python3
"""Bounded read-only disk pressure inventory, no deletion or data copying."""
import json,pathlib,shutil,subprocess
DIRS=[
 "/home/jespern/.cache",
 "/home/jespern/c720p-home-hub/build",
 "/home/jespern/c720p-home-hub/backups",
 "/opt/homeassistant/config/www/frontyard-security-new",
 "/var/cache/apt",
 "/var/log",
 "/home/jespern/.local/share/Trash",
]
def du(p):
 cmd=["du","-x","-m","--max-depth=1","--",p]
 try:
  x=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=22,text=True)
  result=[]
  for line in x.stdout.splitlines():
   parts=line.split("\t",1)
   if len(parts)!=2:continue
   value=int(parts[0]);name=parts[1]
   if name==p:continue
   if not name.startswith(p+"/"):continue
   relative=name[len(p)+1:]
   if "/" in relative:continue
   result.append({"type":relative,"mb":value})
  return sorted(result,key=lambda d:-d["mb"])[:14]
 except Exception as e:return [{"error":type(e).__name__}]
d=shutil.disk_usage("/")
payload={"mode":"read_only","filesystem":{"free_mb":round(d.free/(1024**2),2),
"total_gb":round(d.total/(1024**3),2)},"areas":{}}
for p in DIRS:
 if pathlib.Path(p).is_dir():
  payload["areas"][p.rsplit("/",1)[-1]]=du(p)
# Secondary, low-priority summary of major disk consumers and actual headless cache layout.
# Never reads the content of any file or traverses another mounted filesystem.
TOP_AREAS=[
 ("root","/",1,85),
 ("home","/home/jespern",1,45),
 ("opt","/opt",1,45),
 ("headless_cache","/home/jespern/.cache/chromium-headless",3,35),
]
broad={}
for label,path,depth,timeout in TOP_AREAS:
 if not pathlib.Path(path).is_dir():continue
 cmd=["nice","-n","15","ionice","-c","3","du","-x","-m",
      "--max-depth="+str(depth),"--",path]
 try:
  proc=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout)
  items=[]
  for line in proc.stdout.splitlines():
   parts=line.split("\t",1)
   if len(parts)!=2:continue
   num=int(parts[0]);name=parts[1]
   if name==path or not name.startswith(path.rstrip("/")+"/"):continue
   short=name[len(path.rstrip("/"))+1:]
   if short.startswith(".ssh") or short.startswith(".gnupg") or short.startswith(".config"):continue
   if short.count("/")>=depth:continue
   items.append({"path":short[:110],"mb":num})
  broad[label]={"status":"complete" if proc.returncode==0 else "partial",
                "largest":sorted(items,key=lambda x:-x["mb"])[:17]}
 except Exception as exc:broad[label]={"status":type(exc).__name__}
payload["disk_rootcause"]=broad
# A large root-level file (often swap) is not printed as a du child directory.
# Report the allocated bytes, not just the logical length of sparse files.
topfiles=[]
for p in pathlib.Path("/").iterdir():
 try:
  if p.is_symlink() or not p.is_file():continue
  st=p.stat()
  topfiles.append({"file":p.name[:60],"allocated_mb":round(st.st_blocks*512/(1024**2),1),
                   "logical_mb":round(st.st_size/(1024**2),1)})
 except OSError:continue
payload["root_regular_files"]=sorted(topfiles,key=lambda x:-x["allocated_mb"])[:12]
try:
 lines=pathlib.Path("/proc/swaps").read_text().splitlines()[1:]
 rows=[]
 for line in lines:
  fields=line.split()
  if len(fields)>=5:
   rows.append({"device":pathlib.Path(fields[0]).name,"type":fields[1],
                "total_mb":round(int(fields[2])/1024,1),
                "used_mb":round(int(fields[3])/1024,1),
                "priority":int(fields[4])})
 payload["active_swap"]=rows
except Exception as exc:payload["active_swap_error"]=type(exc).__name__
try:
 wanted={"MemTotal","MemAvailable","SwapTotal","SwapFree","Cached"}
 vals={}
 for line in pathlib.Path("/proc/meminfo").read_text().splitlines():
  key,_,rest=line.partition(":")
  if key in wanted:
   vals[key+"_mb"]=round(int(rest.strip().split()[0])/1024,1)
 payload["memory"]=vals
except Exception as exc:payload["memory_error"]=type(exc).__name__
v=__import__("os").statvfs("/")
payload["filesystem_reserved_mb"]=round((v.f_bfree-v.f_bavail)*v.f_frsize/(1024**2),1)
# Specific, bounded disk consumers. This reports metadata only and never reads file contents.
# Directory contents are restricted to top-level entries; do not traverse secrets.
SCAN_ROOTS={
 "tmp":"/tmp",
 "build":"/home/jespern/c720p-home-hub/build",
 "rollback_backups":"/home/jespern/c720p-home-hub/backups",
 "reports":"/home/jespern/c720p-home-hub/reports",
 "var_cache":"/var/cache",
 "var_log":"/var/log",
 "user_cache":"/home/jespern/.cache",
 "ha_config_backups":"/opt/homeassistant/config/backups",
 "home_bin":"/home/jespern/c720p-home-hub/bin",
}
focused={}
for label,path in SCAN_ROOTS.items():
 root=pathlib.Path(path)
 if not root.is_dir() or root.is_symlink():continue
 entries=[]
 try:
  for item in root.iterdir():
   try:
    if item.is_symlink():continue
    if item.is_file():
     st=item.stat()
     entries.append({"entry":item.name[:90],"kind":"file","allocated_mb":round(st.st_blocks*512/(1024**2),1),
                     "age_days":round((__import__("time").time()-st.st_mtime)/86400,1)})
   except OSError:continue
 except OSError:continue
 focused[label]=sorted(entries,key=lambda e:-e["allocated_mb"])[:18]
payload["large_direct_files"]=focused
# Reads only capped metadata from /proc: no process command lines or environment secrets.
payload["mounts"]={}
for label,path in (("root","/"),("shared_memory","/dev/shm")):
 try:
  disk=shutil.disk_usage(path)
  payload["mounts"][label]={"used_mib":round(disk.used/(1024**2),1),"free_mib":round(disk.free/(1024**2),1)}
 except OSError:pass
print("C720P_SAFE_STORAGE_INVENTORY_V1 "+json.dumps(payload,separators=(",",":"),sort_keys=True),flush=True)
