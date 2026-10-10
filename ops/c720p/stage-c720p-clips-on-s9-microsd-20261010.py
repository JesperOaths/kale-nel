#!/usr/bin/env python3
"""S9+ microSD copy-and-verify of indexed C720P MP4 clips.

Default is read-only. --copy writes to a separate imported-clips subdirectory,
verifies on-phone SHA-256, and NEVER removes C720P originals or changes playback.
"""
from __future__ import annotations
import argparse,hashlib,json,pathlib,re,shutil,subprocess,sys,time
ROOT=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new")
CLIPS=ROOT/"clips";EVENTS=ROOT/"events.json"
PHONE="192.168.178.250:5555";MODEL="SM-G965F"
SD="/storage/9C33-6BBD"
DEST=SD+"/Android/data/nl.kalenel.s9security/files/C720PMigrated"
NAME=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4\Z")
RESERVE=15*1024**3
def run(args,timeout=30):
 p=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError("subprocess_"+str(p.returncode)+"_"+pathlib.Path(args[0]).name)
 return p.stdout.strip()
def adb(*args,timeout=30):return run(["adb","-s",PHONE,*args],timeout=timeout)
def sha(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for piece in iter(lambda:f.read(1024*1024),b""):h.update(piece)
 return h.hexdigest()
def indexed():
 doc=json.loads(EVENTS.read_text(encoding="utf8"))
 if isinstance(doc,dict):doc=next((doc[k] for k in ("events","items","clips") if isinstance(doc.get(k),list)),[])
 if not isinstance(doc,list):raise ValueError("events_schema_unexpected")
 paths={}
 for e in doc:
  if not isinstance(e,dict):continue
  raw=e.get("clip") or e.get("clip_name")
  if not raw:continue
  name=pathlib.Path(str(raw)).name
  if not NAME.fullmatch(name):continue
  p=CLIPS/name
  if not p.is_file() or p.is_symlink() or p.resolve().parent!=CLIPS.resolve():continue
  st=p.stat()
  if st.st_size<10000 or time.time()-st.st_mtime<180:continue
  paths[name]=p
 return list(paths.values())
def free_bytes():
 rows=[x.split() for x in adb("shell","df","-k",SD).splitlines() if x.strip()]
 valid=[x for x in rows if len(x)>=6 and SD in x[-1]]
 if not valid:raise RuntimeError("microSD_mount_not_verified")
 return int(valid[-1][3])*1024
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--copy",action="store_true",help="Copy and hash-verify; never delete source files")
 args=ap.parse_args()
 if not shutil.which("adb"):raise RuntimeError("adb_binary_missing")
 if adb("get-state")!="device":raise RuntimeError("s9_adb_not_connected")
 if adb("shell","getprop","ro.product.model").strip()!=MODEL:raise RuntimeError("not_the_expected_s9plus")
 free=free_bytes()
 clips=indexed()
 total=sum(p.stat().st_size for p in clips)
 result={"mode":"copy" if args.copy else "preview","phone":PHONE,"microSD":SD,
  "sd_free_before":free,"source_mp4_count":len(clips),"source_bytes":total,
  "preserves_all_local_originals":True,"playback_remapping_still_required":True,
  "items":[],"copied_bytes":0}
 if args.copy and free-total<RESERVE:raise RuntimeError("minimum_15GiB_sd_reserve")
 if args.copy:adb("shell","mkdir","-p",DEST)
 for src in clips:
  digest=sha(src);dest=DEST+"/"+src.name
  item={"name":src.name,"bytes":src.stat().st_size,"sha256_prefix":digest[:12],"sd_verified":False}
  result["items"].append(item)
  if not args.copy:continue
  exists=subprocess.run(["adb","-s",PHONE,"shell","test","-f",dest],capture_output=True,timeout=12)
  if exists.returncode==0:
   item["sd_verified"]=adb("shell","sha256sum",dest).split()[0].lower()==digest
   item["status"]="already_matching" if item["sd_verified"] else "collision_no_overwrite"
   continue
  partial=dest+".partial"
  adb("push",str(src),partial,timeout=240)
  if adb("shell","sha256sum",partial).split()[0].lower()!=digest:
   item["status"]="partial_checksum_mismatch_preserved";continue
  adb("shell","mv",partial,dest)
  item["sd_verified"]=adb("shell","sha256sum",dest).split()[0].lower()==digest
  item["status"]="copied_and_verified" if item["sd_verified"] else "final_hash_mismatch"
  if item["sd_verified"]:result["copied_bytes"]+=item["bytes"]
 result["sd_free_after"]=free_bytes()
 result["all_verified"]=bool(result["items"]) and all(x["sd_verified"] for x in result["items"]) if args.copy else False
 result["local_deleted_bytes"]=0
 print(json.dumps(result,indent=2))
 return 0 if not args.copy or result["all_verified"] else 3
if __name__=="__main__":
 try:sys.exit(main())
 except Exception as exc:
  print(json.dumps({"ok":False,"error_type":type(exc).__name__,"detail":str(exc)}))
  sys.exit(2)
