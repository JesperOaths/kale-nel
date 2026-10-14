#!/usr/bin/env python3
"""Read-only end-to-end audit of every current historical Google Drive thumbnail.

Checks inventory, names, date coverage, local cache contents, actual HTTP
responses via the Security relay, JPEG framing and decodability using ffmpeg.
No edits to the Drive index, original clips, devices, or Home Assistant.
"""
from __future__ import annotations
import concurrent.futures,collections,datetime,hashlib,json,pathlib,subprocess,time,urllib.request,urllib.error,sys
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
INDEX=BASE/"state/drive-security-archive.json"
ROOTS=(BASE/"drive-archive-thumbs/new",pathlib.Path("/tmp/c720p-drive-archive-thumbs-new"))
API="http://127.0.0.1:8795/new/api/drive-saved"
def fetch(url,timeout=15):
 with urllib.request.urlopen(url,timeout=timeout) as r:return r.status,r.headers.get("Content-Type",""),r.read(9000000)
def check(e):
 name=str(e.get("snapshot_name") or "")
 if not name or not name.endswith(".jpg") or len(name)>180 or ".." in name:return {"issue":"invalid_snapshot_name","name":name[:80]}
 path="/new/drive/saved/snap/"+urllib.parse.quote(name,safe="")
 st=time.monotonic()
 try:
  status,ct,data=fetch("http://127.0.0.1:8795"+path,timeout=18)
 except Exception as ex:return {"issue":"failed_media_http","name":name,"error":str(ex)[:110]}
 if status!=200 or "image/jpeg" not in ct.lower():return {"issue":"non_image_http","name":name,"status":status,"ct":ct}
 if not (2500<=len(data)<=8000000 and data.startswith(b"\xff\xd8") and data.rstrip().endswith(b"\xff\xd9")):
  return {"issue":"invalid_image_bytes","name":name,"length":len(data)}
 # Each entry should have independently readable cached storage rather than
 # rclone streaming an uncached original on each request.
 cached=next((x/name for x in ROOTS if (x/name).is_file()),None)
 if cached is None:return {"issue":"not_locally_cached","name":name}
 if cached.stat().st_size!=len(data):return {"issue":"cache_http_size_disagree","name":name}
 return {"ok":True,"name":name,"size":len(data),"latency_ms":round((time.monotonic()-st)*1000),
         "sha256":hashlib.sha256(data).hexdigest(),"cached_root":"disk" if cached.parent==ROOTS[0] else "tmpfs"}
def main():
 st=time.monotonic()
 status,ct,raw=fetch(API,timeout=15)
 if status!=200 or "application/json" not in ct:raise RuntimeError("catalog_http_not_ok")
 catalog=json.loads(raw)
 events=catalog.get("events",[])
 if not catalog.get("ok") or len(events)<150:raise RuntimeError("expected_complete_verified_drive_archive")
 valid=[e for e in events if e.get("snapshot_name")]
 names=[str(e.get("snapshot_name")) for e in valid]
 duplicate=sorted(x for x,c in collections.Counter(names).items() if c>1)
 if duplicate:raise RuntimeError("snapshot_filename_not_unique:"+str(duplicate[:5]))
 results=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  for item in pool.map(check,valid):results.append(item)
 failures=[x for x in results if not x.get("ok")]
 # Decode representative JPEGs across every historical date, not only the
 # newest 9 October group. Avoid spawning 173 ffmpeg instances on old CPU.
 dates={}
 for e in valid:
  day=str(e.get("timestamp") or "")[:10]
  if day and day not in dates:dates[day]=str(e.get("snapshot_name"))
 decode_errors=[]
 for day,name in dates.items():
  path=next((x/name for x in ROOTS if (x/name).is_file()),None)
  if path is None:decode_errors.append([day,name,"absent"]);continue
  p=subprocess.run(["/usr/bin/ffmpeg","-v","error","-nostdin","-threads","1",
      "-i",str(path),"-frames:v","1","-f","null","-"],capture_output=True,text=True,timeout=12)
  if p.returncode!=0:decode_errors.append([day,name,p.stderr[-180:]])
 rows=collections.Counter(x["cached_root"] for x in results if x.get("ok"))
 report={"version":"DRIVE_ARCHIVE_FULL_THUMBNAIL_AUDIT_V1",
   "at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
   "verified_drive_clips":len(events),"named_snapshots":len(valid),
   "missing_names":len(events)-len(valid),"actual_http_200_jpeg":sum(bool(x.get("ok")) for x in results),
   "failed_http_or_cache":failures[:16],"failed_count":len(failures),
   "fully_decoded_sampled_dates":len(dates)-len(decode_errors),
   "unique_dates":len(dates),"date_decode_errors":decode_errors[:8],
   "duplicate_names":duplicate,"cached_disk":rows.get("disk",0),
   "cached_tmpfs":rows.get("tmpfs",0),"max_latency_ms":max((x["latency_ms"] for x in results if x.get("ok")),default=0),
   "total_http_bytes":sum(x["size"] for x in results if x.get("ok")),
   "elapsed_s":round(time.monotonic()-st,2),
   "original_media_modified":False}
 print(json.dumps(report,sort_keys=True),flush=True)
 if report["missing_names"] or failures or decode_errors:return 2
 return 0
if __name__=="__main__":
 import urllib.parse
 sys.exit(main())
