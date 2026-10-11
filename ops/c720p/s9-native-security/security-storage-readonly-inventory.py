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
print("C720P_SAFE_STORAGE_INVENTORY_V1 "+json.dumps(payload,separators=(",",":"),sort_keys=True),flush=True)
