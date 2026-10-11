#!/usr/bin/env python3
"""Read-only, bounded production audit of C720P Home Assistant Security.

Does not alter services, clips, phone, config, secrets, or backups.
No private media bytes, credentials, arbitrary file content or LAN addresses
are printed. Only aggregate diagnostic results are returned.
"""
import collections
import datetime as dt
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request

WWW=pathlib.Path("/opt/homeassistant/config/www")
PAGES={
 "home_security":"c720p-surveillance.html",
 "recordings":"frontyard-security-new/clips.html",
 "people_faces":"frontyard-security-new/face-appearances.html",
 "tracks_clothing":"frontyard-security-new/security-tracks-v7.html",
 "archive":"frontyard-security-new/security-archive-v7.html",
 "review_today_evidence":"frontyard-security-new/security-review-v8.html",
}
BASE="http://127.0.0.1:8795"
HA="http://127.0.0.1:8123"
RESULT={"at":dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
 "mode":"read_only","ui":{},"catalogs":{},"media":{},"camera":{},"services":{},
 "disk":{},"issues":[],"tested":{}}
def issue(severity,code,detail):
 RESULT["issues"].append({"severity":severity,"code":code,"detail":detail})
def fetch(uri,timeout=12,limit=2000000,headers=None):
 req=urllib.request.Request(uri,headers=headers or {},method="GET")
 with urllib.request.urlopen(req,timeout=timeout) as resp:
  data=resp.read(limit+1)
  if len(data)>limit:raise RuntimeError("response_oversize")
  return resp.status,dict(resp.headers),data
def test_page(label,rel):
 p=WWW/rel
 if p.is_symlink() or not p.is_file():
  issue("high","missing_page_"+label,"Required Security page missing or symlinked");return
 try:
  original=p.read_bytes()
  status,headers,body=fetch(HA+"/local/"+rel+"?security_audit=1",timeout=15)
  text=original.decode("utf-8","replace")
  RESULT["ui"][label]={
   "status":status,"matches_disk":hashlib.sha256(body).digest()==hashlib.sha256(original).digest(),
   "bytes":len(body),"signed_relay":("C720PSecureRelay" in text),
   "auth_gate":("gejast-auth-gate.js" in text),
   "v8_tabs":("s9v8-tabs-script" in text),
   "v7_navigation":("s9v7-root-script" in text),
   "version_watermark":("v817 - Made by Bruis" in text),
  }
  if body!=original:issue("medium","page_readback_"+label,"Home Assistant differs from local file")
  if status!=200:issue("high","page_http_"+label,"Page does not return 200")
  if label=="archive":
   checks={"native_v10":"data-archive-ui-version=\"v10\"" in text,
    "drive_and_sd_tabs":all(x in text for x in ('id="driveTab"','id="localTab"')),
    "drive_catalog":"/new/api/drive-saved" in text,
    "microSD_catalog":"/new/api/saved" in text,
    "drive_clip":"/new/drive/saved/clip/" in text,
    "microSD_clip":"/new/saved/clip/" in text,
    "no_nested_drive_iframe":'id="driveArchiveFrame"' not in text,
    "smaller_player":"max-height:min(55dvh,420px)" in text}
   RESULT["ui"][label]["checks"]=checks
   for name,ok in checks.items():
    if not ok:issue("medium","archive_"+name,"Archive template contract absent")
  if label=="home_security":
   checks={"navigation_v5":"s9v5-command-script" in text,
    "tracks_v7":"s9v7-root-script" in text,
    "recording_review_v8":"s9v8-tabs-script" in text,
    "archive_v10_cache_key":"drive-archive-v10" in text,
    "camera_settings":"Camera settings" in text or "camera_settings" in text}
   RESULT["ui"][label]["checks"]=checks
   for name,ok in checks.items():
    if not ok:issue("medium","navigation_"+name,"Expected nav route is not in source")
 except Exception as ex:
  RESULT["ui"][label]={"error":type(ex).__name__}
  issue("high","page_failed_"+label,"Readback failed")
def catalog(kind,path):
 try:
  status,headers,body=fetch(BASE+path,timeout=55,limit=2200000)
  doc=json.loads(body)
  if status!=200 or doc.get("ok") is not True or not isinstance(doc.get("events"),list):
   raise ValueError("bad_catalog_contract")
  events=doc["events"]
  counts=collections.Counter(str(x.get("scene_category") or x.get("person_status") or "unspecified") for x in events)
  dates=sorted({str(x.get("timestamp") or x.get("date") or "")[:10] for x in events if re.match(r"^20[0-9]{2}-",str(x.get("timestamp") or x.get("date") or ""))})
  names=[str(x.get("remote_name") or x.get("clip_no") or "") for x in events]
  valid=[n for n in names if re.fullmatch(r"[A-Za-z0-9._-]{1,180}[.]mp4",n) and ".." not in n]
  stats={"http":status,"count":len(events),"archive_mode":doc.get("archive_mode"),
    "date_count":len(dates),"oldest_date":dates[0] if dates else None,"newest_date":dates[-1] if dates else None,
    "valid_mp4_names":len(valid),"categories":dict(counts.most_common(7)),
    "person_rows":sum(1 for x in events if int(x.get("person_count") or 0)>0),
    "track_rows":sum(1 for x in events if len(x.get("anonymous_tracks") or [])>0),
    "face_candidate_rows":sum(1 for x in events if len(x.get("face_candidates") or [])>0),
    "with_thumbnails":sum(1 for x in events if bool(x.get("snapshot_name")))}
  RESULT["catalogs"][kind]=stats
  if kind=="microSD" and doc.get("archive_mode")!="S9-microSD-only":issue("high","microSD_wrong_source","microSD index returns another source")
  if kind=="drive" and doc.get("archive_mode")=="S9-microSD-only":issue("high","drive_wrong_source","Drive index shadows microSD")
  if not events:issue("high","empty_"+kind,"Recordings index unexpectedly empty")
  return events
 except Exception as ex:
  RESULT["catalogs"][kind]={"error":type(ex).__name__}
  issue("high","index_unavailable_"+kind,"Recording listing unavailable")
  return []
def media_probe(kind,events,prefix):
 for row in events:
  n=str(row.get("remote_name") or row.get("clip_no") or "")
  if not re.fullmatch(r"[A-Za-z0-9._-]{1,180}[.]mp4",n) or ".." in n:continue
  try:
   status,headers,chunk=fetch(BASE+prefix+urllib.parse.quote(n),timeout=38,limit=4096,headers={"Range":"bytes=0-1023"})
   ok=status==206 and len(chunk)==1024 and headers.get("Content-Range","").startswith("bytes 0-1023/") and chunk[4:8] in (b"ftyp",b"moov",b"free",b"wide")
   RESULT["media"][kind]={"status":status,"bytes":len(chunk),"range_seek":ok,"mime":headers.get("Content-Type","")}
   if not ok:issue("high","video_range_"+kind,"Original MP4 byte-range playback check failed")
  except Exception as ex:
   RESULT["media"][kind]={"error":type(ex).__name__}
   issue("high","video_unavailable_"+kind,"Sample MP4 playback unavailable")
  return
 RESULT["media"][kind]={"error":"no_indexed_mp4"}
def shot():
 try:
  s,h,b=fetch("http://127.0.0.1:18808/status",timeout=9,limit=50000)
  j=json.loads(b)
  keys=("ok","mode","motion_detector","garden_roi_mask_version","garden_zone",
  "native_4k_enabled","recording_in_progress","sensor_result_fps","last_frame_age_ms",
  "garden_person_gate_ready","garden_person_gate_backend","garden_person_gate_checked",
  "garden_person_gate_matches","garden_person_gate_errors","frame_count","temperature_c",
  "sd_free_bytes","face_backfill_completed","face_backfill_errors",
  "face_reviewed_clips","face_snapshots_saved","camera_allowed")
  RESULT["camera"]={k:j.get(k) for k in keys if k in j}
  RESULT["camera"]["status_http"]=s
  if j.get("ok") is not True or j.get("mode") not in ("watching","recording"):
   issue("high","native_camera_health","S9+ native detector is not in watching/recording state")
  if float(j.get("last_frame_age_ms") or 999999)>9000:
   issue("high","camera_frame_stale","Last native camera frame older than nine seconds")
  try:
   status,head,blob=fetch("http://127.0.0.1:18808/shot.jpg",timeout=8,limit=1000000)
   good=status==200 and blob.startswith(bytes.fromhex("ffd8ff")) and len(blob)>3000
   RESULT["camera"]["live_jpeg"]={"ok":good,"bytes":len(blob)}
   if not good:issue("high","live_jpeg_broken","Latest on-phone live JPEG invalid")
  except Exception as ex:
   RESULT["camera"]["live_jpeg"]={"error":type(ex).__name__}
   issue("medium","live_jpeg_unavailable","On-phone still image probe failed")
 except Exception as ex:
  RESULT["camera"]={"error":type(ex).__name__}
  issue("high","native_status_unavailable","On-phone Camera2 status unreachable")
def service_audit():
 units=("c720p-agent-runner.service","c720p-security-web.service",
 "c720p-security-tunnel.service","c720p-lan-camera-relay.service",
 "c720p-frontyard-security-new.service","c720p-drive-security-archive.service")
 for unit in units:
  try:
   p=subprocess.run(["systemctl","--user","is-active",unit],capture_output=True,text=True,timeout=6)
   state=p.stdout.strip()[:25]
   RESULT["services"][unit.removesuffix(".service")]=state
   if state!="active":issue("high","service_"+unit.removesuffix(".service"),"Required security service not active")
  except Exception as ex:RESULT["services"][unit.removesuffix(".service")]=type(ex).__name__
def disk_audit():
 root=shutil.disk_usage("/")
 RESULT["disk"]["filesystem"]={"total_gb":round(root.total/(1024**3),2),"free_mb":round(root.free/(1024**2),1),"used_percent":round(100*root.used/root.total,1)}
 if root.free<500*1024*1024:issue("high","hub_disk_critical","Less than 500 MiB free; do not delete protected evidence")
 prefixes=[
 "/home/jespern/c720p-home-hub/backups",
 "/home/jespern/c720p-home-hub/state",
 "/home/jespern/c720p-security-camera-new",
 "/home/jespern/.cache",
 "/home/jespern/.local/share/Trash",
 "/var/cache/apt/archives",
 "/var/log/journal",
 "/opt/homeassistant/config/www/frontyard-security-new",
 "/home/jespern/c720p-home-hub/build"
 ]
 entries={}
 for path in prefixes:
  if not pathlib.Path(path).exists():continue
  try:
   p=subprocess.run(["du","-sm","--",path],capture_output=True,text=True,timeout=12)
   if p.returncode==0:
    entries[path.rsplit("/",1)[-1]]=int(p.stdout.split()[0])
  except Exception:continue
 RESULT["disk"]["areas_mb"]=entries
def main():
 for k,v in PAGES.items():test_page(k,v)
 sd=catalog("microSD","/new/api/saved")
 drive=catalog("drive","/new/api/drive-saved")
 media_probe("microSD",sd,"/new/saved/clip/")
 media_probe("drive",drive,"/new/drive/saved/clip/")
 shot();service_audit();disk_audit()
 RESULT["issues"].sort(key=lambda x:{"high":0,"medium":1,"low":2}.get(x["severity"],3))
 RESULT["tested"]["privacy"]="No recording content, token, host secret or biometric crop was exported"
 RESULT["tested"]["operations"]="No write, deletion, restart, APK change or on-phone inference performed"
 print("SECURITY_FULL_FINAL_AUDIT_V1 "+json.dumps(RESULT,separators=(",",":"),sort_keys=True),flush=True)
if __name__=="__main__":main()
