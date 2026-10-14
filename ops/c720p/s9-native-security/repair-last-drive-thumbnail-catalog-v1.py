#!/usr/bin/env python3
"""Complete the missing historical Drive preview, without modifying Drive media.

Only applies to one exact verified catalog record with no thumbnail filename.
Reads the original Drive MP4 to tmpfs, validates its MD5, extracts a JPEG,
writes that JPEG to the existing private C720P thumbnail cache, and adds only
the snapshot filename to the verified local index via checked atomic replace.
Validates both historical backend and relay routes and the full 173/173 index.
"""
from __future__ import annotations
import datetime,hashlib,json,os,pathlib,runpy,shutil,tempfile,urllib.request,sys
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
INDEX=BASE/"state/drive-security-archive.json"
CACHE=BASE/"drive-archive-thumbs/new"
BACK=BASE/"backups/drive-last-missing-thumb-v1"
SOURCE="S9PHONE_rec_2026-10-09_20-42.mp4"
SNAP="S9PHONE_rec_2026-10-09_20-42.jpg"
SIZE=17683356
MD5="3160247c3767756fd8bdb2da8c07c133"
def sha(x):return hashlib.sha256(x).hexdigest()
def read_rows():
 data=json.loads(INDEX.read_bytes())
 rows=[x for x in data.get("items",[]) if x.get("camera")=="new" and x.get("state")=="verified" and x.get("remote_name")==SOURCE]
 if len(rows)!=1:raise RuntimeError("expected_exactly_one_verified_video_row")
 row=rows[0]
 if int(row.get("size") or 0)!=SIZE or str(row.get("md5") or "").lower()!=MD5:
  raise RuntimeError("source_media_contract_changed")
 return data,row
def main():
 if not INDEX.is_file() or INDEX.is_symlink() or not CACHE.is_dir():raise RuntimeError("catalog_or_cache_missing")
 module=runpy.run_path(str(BASE/"bin/c720p-drive-archive-thumb-backfill-v1.py"))
 d,row=read_rows()
 if row.get("snapshot_name")==SNAP and module["valid"](CACHE/SNAP):
  print(json.dumps({"already_done":True,"thumbnail":SNAP}));return 0
 if row.get("snapshot_name") not in (None,""):raise RuntimeError("snapshot_already_set_to_other_name")
 if any(x.get("snapshot_name")==SNAP for x in d["items"]):raise RuntimeError("synthetic_snapshot_name_not_unique")
 cfg=module["read_json"](module["CONFIG"])
 remote=module["remote_inventory"](cfg)
 if remote.get(SOURCE)!=SIZE:raise RuntimeError("remote_original_size_mismatch")
 if shutil.disk_usage("/tmp").free<SIZE+300_000_000:raise RuntimeError("insufficient_tmpfs_reserve")
 if shutil.disk_usage("/").free<300_000_000:raise RuntimeError("insufficient_root_reserve")
 before=INDEX.read_bytes();before_sha=sha(before)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 folder=BACK/stamp;folder.mkdir(parents=True,exist_ok=False)
 # Byte-identical rollback copy, original recording untouched.
 fp=folder/"drive-security-archive.json.before";fp.write_bytes(before);fp.chmod(0o600)
 added_cache=False;index_updated_sha=None
 try:
  with tempfile.TemporaryDirectory(prefix="drive-last-thumb-",dir="/tmp") as dirname:
   tmp=pathlib.Path(dirname);video=tmp/"original.mp4";jpg=tmp/"preview.jpg"
   if not module["rclone_copy"](cfg,SOURCE,video,limit=90):raise RuntimeError("read_only_rclone_download_failed")
   if video.stat().st_size!=SIZE:raise RuntimeError("downloaded_video_size_mismatch")
   digest=hashlib.md5(video.read_bytes()).hexdigest()
   if digest!=MD5:raise RuntimeError("downloaded_video_md5_mismatch")
   if not module["video_frame"](video,jpg):raise RuntimeError("ffmpeg_thumbnail_extraction_failed")
   if not module["valid"](jpg):raise RuntimeError("generated_jpeg_invalid")
   target=CACHE/SNAP
   if target.exists() and not module["valid"](target):raise RuntimeError("refuse_overwrite_unknown_cache")
   if not target.exists():
    staged=CACHE/("."+SNAP+".incoming")
    try:
     shutil.copyfile(jpg,staged);staged.chmod(0o644)
     if not module["valid"](staged):raise RuntimeError("staged_thumbnail_invalid")
     os.replace(staged,target);added_cache=True
    finally:
     staged.unlink(missing_ok=True)
   preview_bytes=target.stat().st_size
  if INDEX.read_bytes()!=before:raise RuntimeError("index_changed_concurrently_before_write")
  # Update exactly one field within the original complete JSON document.
  row["snapshot_name"]=SNAP
  updated=json.dumps(d,ensure_ascii=False,indent=2).encode("utf-8")+b"\n"
  out=INDEX.with_name(".drive-security-archive-last-thumbnail-tmp")
  try:
   with out.open("wb") as f:f.write(updated);f.flush();os.fsync(f.fileno())
   out.chmod(INDEX.stat().st_mode&0o777)
   if INDEX.read_bytes()!=before:raise RuntimeError("index_changed_during_stage")
   os.replace(out,INDEX);index_updated_sha=sha(updated)
  finally:
   out.unlink(missing_ok=True)
  for port in (8794,8795):
   route=("new/saved/snap/" if port==8794 else "new/drive/saved/snap/")+SNAP
   with urllib.request.urlopen("http://127.0.0.1:"+str(port)+"/"+route,timeout=12) as response:
    head=response.read(2)
    if response.status!=200 or "image/jpeg" not in response.headers.get("Content-Type","") or head!=b"\xff\xd8":
     raise RuntimeError("legacy_or_relay_thumbnail_http_failed")
  with urllib.request.urlopen("http://127.0.0.1:8795/new/api/drive-saved",timeout=14) as response:
   catalog=json.load(response)
  rows=catalog.get("events",[])
  missing=sum(not x.get("snapshot_name") for x in rows)
  if len(rows)!=173 or missing!=0:raise RuntimeError("drive_catalog_not_173_of_173")
  receipt={"ok":True,"version":"DRIVE_ARCHIVE_LAST_MISSING_THUMB_V1",
    "video":SOURCE,"preview":SNAP,"preview_bytes":preview_bytes,
    "catalog_with_thumbnails":len(rows),"catalog_missing":missing,
    "backed_up_index":str(fp),"original_drive_video_modified":False,
    "original_s9_recordings_modified":False}
  (folder/"receipt.json").write_text(json.dumps(receipt,indent=2))
  print(json.dumps(receipt,sort_keys=True))
  return 0
 except Exception:
  if index_updated_sha and sha(INDEX.read_bytes())==index_updated_sha:
   restored=INDEX.with_name(".drive-index-last-thumb-rollback")
   restored.write_bytes(before);restored.chmod(INDEX.stat().st_mode&0o777)
   os.replace(restored,INDEX)
  if added_cache and row.get("snapshot_name")==SNAP:
   # Leave valid temporary cache rather than deleting footage; the catalog
   # rollback makes it unreachable until a later verified attempt.
   pass
  raise
if __name__=="__main__":sys.exit(main())
