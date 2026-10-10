#!/usr/bin/env python3
"""Conservative C720P cache cleanup. Preview by default; --apply for approved caches only."""
import argparse, json, os, pathlib, shutil, subprocess, time
HOME=pathlib.Path("/home/jespern")
TARGETS=[
 HOME/".cache/pip", HOME/".cache/mesa_shader_cache_db",HOME/".cache/mesa_shader_cache",
 HOME/".cache/c720p-kiosk-chromium", HOME/".cache/c720p-spotify-chromium",
 HOME/".config/c720p-kiosk-chromium/Default/Cache",
 HOME/".config/c720p-kiosk-chromium/Default/Code Cache",
 HOME/".config/c720p-kiosk-chromium/Default/GPUCache",
 HOME/".config/c720p-kiosk-chromium/Default/Service Worker/CacheStorage",
 HOME/".config/c720p-spotify-chromium/Default/Cache",
 HOME/".config/c720p-spotify-chromium/Default/Code Cache",
 HOME/".config/c720p-spotify-chromium/Default/GPUCache",
 HOME/".config/c720p-spotify-chromium/Default/Service Worker/CacheStorage",
]
def command(args,timeout=35):
 try:
  p=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
  return {"exit":p.returncode,"out":p.stdout[-1200:],"err":p.stderr[-300:]}
 except Exception as e:return {"error_type":type(e).__name__}
def size(path):
 if not path.exists() or path.is_symlink():return 0
 result=command(["du","-s","-x","-B1",str(path)],25)
 if result.get("exit")==0:
  try:return int(result["out"].split()[0])
  except (ValueError,IndexError):pass
 return None
def guard(path):
 if path not in TARGETS or path.is_symlink() or not path.is_dir():return False
 current=path
 while current!=HOME and current!=current.parent:
  if current.is_symlink():return False
  current=current.parent
 return current==HOME and not HOME.is_symlink()
def in_use(path):
 s=str(path)
 if "chromium" not in s:return False
 r=command(["pgrep","-af","chromium"],5)
 if r.get("exit") not in (0,1):return True
 prefix="c720p-kiosk-chromium" if "kiosk" in s else "c720p-spotify-chromium"
 return prefix in r.get("out","")
def large_dirs():
 output=[]
 for path in ["/home/jespern","/opt/homeassistant","/var/log","/var/cache","/tmp"]:
  r=command(["du","-x","-B1","-d","1",path],45)
  if r.get("exit") in (0,1):
   for line in r.get("out","").splitlines():
    try:
     amount,name=line.split(None,1)
     output.append({"bytes":int(amount),"path":name})
    except ValueError:pass
 return sorted(output,key=lambda x:x["bytes"],reverse=True)[:30]
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--apply",action="store_true")
 args=p.parse_args()
 before=shutil.disk_usage("/")
 report={"version":"cache-reclaim-20261010","timestamp":time.strftime("%Y-%m-%dT%H:%M:%S%z"),"mode":"apply" if args.apply else "preview",
         "free_before_bytes":before.free,"candidates":[],"deletions":[],"commands":[],
         "protected":"All recordings, databases, HA configuration, phone SD and browser profiles"}
 for path in TARGETS:
  ok=guard(path)
  if not path.exists() and not path.is_symlink():continue
  busy=in_use(path) if ok else False
  candidate={"path":str(path),"bytes":size(path),"approved_cache":ok,"browser_in_use":busy}
  report["candidates"].append(candidate)
  if not args.apply or not ok or busy:continue
  try:
   shutil.rmtree(path)
   candidate["result"]="removed"
   report["deletions"].append({"path":str(path),"bytes_estimate":candidate["bytes"]})
  except OSError as e:candidate["result"]="skipped_"+type(e).__name__
 if args.apply:
  report["commands"].append({"apt_clean":command(["sudo","-n","apt-get","clean"],45)})
  report["commands"].append({"journal_vacuum":command(["sudo","-n","journalctl","--vacuum-size=50M"],45)})
 after=shutil.disk_usage("/")
 report["free_after_bytes"]=after.free
 report["reclaimed_bytes"]=max(0,after.free-before.free)
 report["largest_directories"]=large_dirs()
 print(json.dumps(report,indent=2))
if __name__=="__main__":main()
