#!/usr/bin/env python3
"""Conservatively deduplicate exact S9 APK recovery copies on the C720P.

Only /home/jespern/c720p-home-hub/backups/**/*.apk; never original recordings,
installed applications, signed release APKs, Home Assistant, or Docker.
Content SHA-256, uid, gid and permissions must match. Preserve all paths.
Backup file original timestamps and digests in append-only audit receipts.
"""
import argparse,collections,datetime,hashlib,json,os,pathlib,stat,sys,uuid

BACK=pathlib.Path("/home/jespern/c720p-home-hub/backups")
AUDIT=pathlib.Path("/home/jespern/c720p-home-hub/reports")
def sha(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  while chunk:=f.read(1024*1024):h.update(chunk)
 return h.hexdigest()
def current(p):
 st=p.lstat()
 if not stat.S_ISREG(st.st_mode) or p.is_symlink():
  raise RuntimeError("not_regular_nonsymlink")
 return st
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--apply",action="store_true")
 args=parser.parse_args()
 if not BACK.is_dir() or BACK.is_symlink():raise RuntimeError("backup_root_changed")
 files=sorted(p for p in BACK.rglob("*.apk") if p.is_file() and not p.is_symlink())
 buckets=collections.defaultdict(list)
 for p in files:
  st=current(p)
  if st.st_size <1024*1024:continue
  fingerprint=(st.st_size,sha(p),st.st_uid,st.st_gid,stat.S_IMODE(st.st_mode))
  buckets[fingerprint].append((p,st))
 operations=[]
 for (size,digest,uid,gid,mode),items in buckets.items():
  # Canonical is oldest copy, so later backups keep their original paths.
  items.sort(key=lambda x:(x[1].st_mtime_ns,str(x[0])))
  primary,primary_stat=items[0]
  for p,st in items[1:]:
   if st.st_dev!=primary_stat.st_dev or st.st_ino==primary_stat.st_ino:continue
   operations.append(dict(source=str(primary),dest=str(p),bytes=st.st_blocks*512,
                          sha256=digest,source_mtime_ns=primary_stat.st_mtime_ns,
                          original_mtime_ns=st.st_mtime_ns,uid=uid,gid=gid,
                          mode=mode,size=size))
 summary=dict(files=len(files),unique_content=len(buckets),
              dedupe_paths=len(operations),
              possible_recover_mib=round(sum(x["bytes"] for x in operations)/1048576,2))
 print("APK_DEDUPE_AUDIT",json.dumps(summary,sort_keys=True),flush=True)
 if not args.apply:return
 before=os.statvfs(BACK)
 completed=[];skipped=[]
 for item in operations:
  src=pathlib.Path(item["source"]);dst=pathlib.Path(item["dest"])
  if src.resolve().parent!=src.parent.resolve() or dst.resolve().parent!=dst.parent.resolve():
   skipped.append((str(dst),"unsafe_symlink_parent"));continue
  a=current(src);b=current(dst)
  if a.st_dev!=b.st_dev or a.st_ino==b.st_ino or (a.st_size,b.st_size)!=(item["size"],item["size"]):
   skipped.append((str(dst),"changed_size_or_inode"));continue
  if (a.st_uid,a.st_gid,stat.S_IMODE(a.st_mode))!=(item["uid"],item["gid"],item["mode"]):
   skipped.append((str(dst),"changed_source_metadata"));continue
  if (b.st_uid,b.st_gid,stat.S_IMODE(b.st_mode))!=(item["uid"],item["gid"],item["mode"]):
   skipped.append((str(dst),"changed_destination_metadata"));continue
  if sha(src)!=item["sha256"] or sha(dst)!=item["sha256"]:
   skipped.append((str(dst),"changed_hash"));continue
  temp=dst.with_name(".apk-dedupe-"+uuid.uuid4().hex+".tmp")
  try:
   os.link(src,temp)
   os.replace(temp,dst)
   if current(dst).st_ino!=current(src).st_ino or sha(dst)!=item["sha256"]:
    raise RuntimeError("dedupe_readback_failed")
   completed.append(item)
  finally:
   if temp.exists():temp.unlink()
 after=os.statvfs(BACK)
 result=dict(**summary,completed=len(completed),skipped=skipped,
             recovered_mib=round(((after.f_bavail-before.f_bavail)*after.f_frsize)/1048576,2))
 AUDIT.mkdir(parents=True,exist_ok=True)
 receipt=AUDIT/("s9-apk-dedupe-"+datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".json")
 fd=os.open(receipt,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,"w") as f:
  json.dump(dict(summary=result,consolidated_files=completed),f,indent=2)
  f.flush();os.fsync(f.fileno())
 print("APK_DEDUPE_APPLIED",json.dumps(dict(**result,receipt=str(receipt)),sort_keys=True),flush=True)
if __name__=="__main__":main()
