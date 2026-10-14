#!/usr/bin/env python3
"""Persist RAM-only Drive archive preview JPEGs on C720P using modest disk space.

Original Drive videos, original remote snapshots, 48 existing durable cache
JPEGs, and the index stay unchanged. New derived 960x540-or-less JPEGs are
stored only when byte/image validation and disk budget checks pass. All work
is low priority; the invocation should hold the existing thumbnailer flock.
"""
from __future__ import annotations
import datetime,hashlib,json,os,pathlib,re,shutil,subprocess,sys,tempfile,time,urllib.request
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
LOCAL=BASE/"drive-archive-thumbs/new"
RAM=pathlib.Path("/tmp/c720p-drive-archive-thumbs-new")
INDEX=BASE/"state/drive-security-archive.json"
REPORT=BASE/"reports"
MAX_NEW_BYTES=22*1024*1024
MIN_ROOT_FREE=640*1024*1024
NAME=re.compile(r"^[A-Za-z0-9._-]{1,180}\.jpg$",re.I)
def digest(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  while b:=f.read(262144):h.update(b)
 return h.hexdigest()
def jpeg_ok(p):
 if not p.is_file() or p.is_symlink():return False
 s=p.stat().st_size
 if s<2500 or s>8000000:return False
 with p.open("rb") as f:
  if f.read(2)!=bytes.fromhex("ffd8"):return False
  f.seek(-2,os.SEEK_END)
  return f.read(2)==bytes.fromhex("ffd9")
def roster():
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/drive-saved",timeout=15) as r:raw=json.load(r)
 if not raw.get("ok"):raise RuntimeError("verified_archive_unavailable")
 rows=raw.get("events",[])
 if len(rows)<170:raise RuntimeError("incomplete_catalog")
 names=[str(x.get("snapshot_name") or "") for x in rows]
 if len(names)!=len(set(names)):raise RuntimeError("ambiguous_snapshot_names")
 if not all(NAME.fullmatch(n) and ".." not in n for n in names):raise RuntimeError("bad_snapshot_name")
 return names
def main():
 start=time.monotonic()
 names=roster()
 missing=[n for n in names if not jpeg_ok(LOCAL/n)]
 if not missing:
  print(json.dumps({"ok":True,"already_durable":len(names),"new":0}));return 0
 if len(missing)>180:raise RuntimeError("unexpected_number_of_missing_previews")
 if shutil.disk_usage("/").free<MIN_ROOT_FREE+MAX_NEW_BYTES:
  raise RuntimeError("root_disk_floor_requires_more_space")
 if shutil.disk_usage("/tmp").free<128*1024*1024:
  raise RuntimeError("temporary_memory_space_insufficient")
 sources={}
 for name in missing:
  src=RAM/name
  if not jpeg_ok(src):raise RuntimeError("ram_jpeg_absent_or_invalid_"+name)
  sources[name]=src
 existing={n:(LOCAL/n).stat().st_size for n in names if jpeg_ok(LOCAL/n)}
 if not LOCAL.is_dir() or LOCAL.is_symlink():raise RuntimeError("cache_dir_is_not_safe")
 before_sha={n:digest(p) for n,p in sources.items()}
 staged={}
 sizes={}
 # Temp files stay entirely memory-backed until size checks pass. Avoid
 # partial snapshots across failed ffmpeg/validation runs.
 with tempfile.TemporaryDirectory(prefix="c720p-drive-preview-persist-",dir="/tmp") as temp:
  root=pathlib.Path(temp)
  for idx,(name,src) in enumerate(sources.items(),1):
   dst=root/name
   cmd=["/usr/bin/ffmpeg","-v","error","-nostdin","-threads","1",
        "-i",str(src),"-vf",
        "scale=960:540:force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-frames:v","1","-q:v","4","-y",str(dst)]
   try:
    run=subprocess.run(cmd,capture_output=True,text=True,timeout=20)
   except subprocess.TimeoutExpired:raise RuntimeError("ffmpeg_timeout_"+name)
   if run.returncode!=0 or not jpeg_ok(dst):
    raise RuntimeError("derived_jpeg_invalid_"+name+":"+run.stderr[-110:])
   # If source was already small, losslessly retain its exact JPEG.
   if dst.stat().st_size>=src.stat().st_size:
    shutil.copy2(src,dst)
   if not jpeg_ok(dst):raise RuntimeError("final_jpeg_invalid_"+name)
   sizes[name]=dst.stat().st_size
   staged[name]=dst
   if sum(sizes.values())>MAX_NEW_BYTES:raise RuntimeError("new_preview_disk_budget_exceeded")
  if any(not jpeg_ok(p) for p in staged.values()):raise RuntimeError("staged_jpegs_not_valid")
  if any(digest(sources[n])!=before_sha[n] for n in missing):raise RuntimeError("source_changed_during_staging")
  if set(roster())!=set(names):raise RuntimeError("verified_catalog_changed")
  free=shutil.disk_usage("/").free
  if free<MIN_ROOT_FREE+sum(sizes.values())+1024*1024:
   raise RuntimeError("not_enough_disk_for_durable_previews")
  installed=[]
  try:
   for name,stage in staged.items():
    target=LOCAL/name
    if target.exists():raise RuntimeError("new_disk_snapshot_race_"+name)
    incoming=LOCAL/("."+name+".persist-incoming")
    if incoming.exists():raise RuntimeError("previous_incoming_exists_"+name)
    try:
     shutil.copyfile(stage,incoming)
     incoming.chmod(0o644)
     if not jpeg_ok(incoming) or digest(incoming)!=digest(stage):
      raise RuntimeError("persist_copy_corrupted_"+name)
     if target.exists():raise RuntimeError("target_created_while_copying_"+name)
     os.replace(incoming,target)
    finally:
     incoming.unlink(missing_ok=True)
    installed.append(target)
   # All new files must be reachable via the same secure relay as the
   # Home Assistant Archive, not merely exist in the directory.
   for name in (missing[0],missing[len(missing)//2],missing[-1]):
    url="http://127.0.0.1:8795/new/drive/saved/snap/"+name
    with urllib.request.urlopen(url,timeout=12) as r:
     if r.status!=200 or "image/jpeg" not in r.headers.get("Content-Type",""):
      raise RuntimeError("post_deploy_media_http_fail_"+name)
     if r.read(2)!=bytes.fromhex("ffd8"):raise RuntimeError("post_deploy_not_a_jpeg_"+name)
   if any(not jpeg_ok(LOCAL/n) for n in names):raise RuntimeError("not_all_previews_durable")
   if any(digest(sources[n])!=before_sha[n] for n in missing):raise RuntimeError("original_ram_preview_changed")
  except Exception:
   for target in installed:
    if target.exists() and target.name in staged and digest(target)==digest(staged[target.name]):
     target.unlink()
   raise
  report={"ok":True,"version":"C720P_DRIVE_PREVIEW_DURABLE_COMPACT_V1",
   "at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
   "catalog":len(names),"already_persistent":len(existing),"persisted_new":len(installed),
   "previews_persistent_after":len(names),"new_disk_bytes":sum(sizes.values()),
   "previous_ram_bytes":sum(s.stat().st_size for s in sources.values()),
   "disk_reduction_factor":round(sum(s.stat().st_size for s in sources.values())/max(1,sum(sizes.values())),2),
   "root_free_bytes":shutil.disk_usage("/").free,
   "all_drive_orig_media_unchanged":True,"index_unchanged":True,
   "elapsed_s":round(time.monotonic()-start,2)}
  REPORT.mkdir(parents=True,exist_ok=True)
  receipt=REPORT/("drive-preview-durable-"+datetime.datetime.now().strftime("%Y%m%dT%H%M%SZ")+".json")
  receipt.write_text(json.dumps(report,indent=2))
  print(json.dumps(report,sort_keys=True))
  return 0
if __name__=="__main__":sys.exit(main())
