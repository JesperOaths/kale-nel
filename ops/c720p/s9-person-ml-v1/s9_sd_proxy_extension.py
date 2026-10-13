"""S9 microSD replay extension for the existing C720P secure archive proxy."""
import json,re,urllib.parse,urllib.request,urllib.error,subprocess,hashlib
from pathlib import Path
BASE=Path("/opt/homeassistant/config/www/frontyard-security-new")
CAT=BASE/"s9-phone-events.json"
PREVIEW_CAT=Path("/home/jespern/c720p-home-hub/state/s9-fallback-evidence.json")
PREVIEW_NAME=re.compile(r"preview_motion_[0-9]{13}[.]jpg")
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9edge/files/SecurityClips"
NATIVE_SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9nativefourk/files/Native4K"
SECURITY_SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
PHONE="192.168.178.250:5555"
RE_NAME=re.compile(r"(?:rec_20[0-9]{2}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}|native4k_[0-9]{13}|motion_[0-9]{13})[.]mp4")
BLOCK=65536
def rows():
 try:
  d=json.loads(CAT.read_text())
  return {r["name"]:r for r in d.get("phone_recordings",[]) if RE_NAME.fullmatch(str(r.get("name",""))) and r.get("sd_verified")}
 except Exception:return {}
def preview_rows():
 try:
  d=json.loads(PREVIEW_CAT.read_text())
  return {r["name"]:r for r in d.get("previews",[]) if
    PREVIEW_NAME.fullmatch(str(r.get("name",""))) and
    r.get("kind")=="preview_only_motion_evidence" and
    r.get("sd_verified") is True and r.get("sd_only") is True and
    r.get("person_status")=="not_evaluated" and
    3000<int(r.get("size",0))<2500000 and
    re.fullmatch(r"[0-9a-f]{64}",str(r.get("sha256","")))}
 except (ValueError,TypeError,OSError,KeyError):return {}

def serve_preview(handler,name,item):
 # Only the authenticated archive relay can reach this handler externally.
 # Source bytes are read fresh from the phone; no JPEG is stored on the hub.
 expected=int(item["size"])
 try:
  p=subprocess.run(["adb","-s",PHONE,"exec-out","cat",SECURITY_SD+"/"+name],
                   stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=16,check=True)
  blob=p.stdout
  if (len(blob)!=expected or
      hashlib.sha256(blob).hexdigest()!=item["sha256"] or
      not (blob.startswith(b"\xff\xd8\xff") and blob.endswith(b"\xff\xd9"))):
   raise ValueError("preview_integrity_mismatch")
 except (OSError,ValueError,subprocess.SubprocessError):
  handler.js(503,{"ok":False,"error":"preview_unavailable_or_mismatch"});return
 handler.send_response(200)
 handler.send_header("Content-Type","image/jpeg")
 handler.send_header("Content-Length",str(len(blob)))
 handler.send_header("Cache-Control","private,no-store")
 handler.send_header("X-Content-Type-Options","nosniff")
 handler.end_headers()
 if handler.command!="HEAD":handler.wfile.write(blob)

FACE_NAME=re.compile(r"motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg")
def serve_face_snapshot(handler,name,record):
 """Relay indexed S9 microSD JPEG only on signed request, with SHA-256 verification.
 Not a face inference service; never writes image data to the C720P filesystem.
 """
 evidence=next((entry for entry in record.get("face_candidates",[]) if
                entry.get("snapshot_name")==name and entry.get("snapshot_on_s9")
                and isinstance(entry.get("snapshot_size"),int)
                and 2000<=entry["snapshot_size"]<=2200000
                and re.fullmatch(r"[a-f0-9]{64}",str(entry.get("snapshot_sha256","")))),None)
 if evidence is None:
  handler.js(404,{"ok":False,"error":"face_snapshot_not_indexed"});return
 try:
  p=subprocess.run(["adb","-s",PHONE,"exec-out","cat",SECURITY_SD+"/FaceSnapshots/"+name],
    stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=16,check=True)
  data=p.stdout
  if (len(data)!=evidence["snapshot_size"] or
      hashlib.sha256(data).hexdigest()!=evidence["snapshot_sha256"] or
      not (data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"))):
   raise ValueError("face_snapshot_integrity_mismatch")
 except (OSError,ValueError,subprocess.SubprocessError):
  handler.js(503,{"ok":False,"error":"phone_face_snapshot_unavailable"});return
 handler.send_response(200)
 handler.send_header("Content-Type","image/jpeg")
 handler.send_header("Content-Length",str(len(data)))
 handler.send_header("Cache-Control","private,no-store")
 handler.send_header("X-Content-Type-Options","nosniff")
 handler.end_headers()
 if handler.command!="HEAD":handler.wfile.write(data)

def safe_thumbnail_revision(row):
 """Return a bounded cache key from validated thumbnail digests only."""
 digest=row.get("thumbnail_sha256")
 if isinstance(digest,str) and re.fullmatch(r"[a-f0-9]{64}",digest):return digest[:16]
 revision=row.get("thumbnail_revision")
 return revision if isinstance(revision,str) and re.fullmatch(r"[a-f0-9]{16}",revision) else None

def safe_detection_timeline(row):
 """Bounded sampled model observations, never identities or raw frame bytes."""
 import math
 raw=row.get("person_sample_timeline")
 result={"person_sample_timeline":[],"person_timeline_status":"not_in_original_review",
         "person_first_sample_ms":None,"person_last_sample_ms":None}
 if raw is None:return result
 duration=row.get("duration_ms")
 frames=row.get("sampled_frames",row.get("sampled_frame_count"))
 if (not isinstance(raw,list) or len(raw)>12 or type(duration) is not int or
     not 0<duration<=120000 or type(frames) is not int or not 0<=frames<=32 or len(raw)>frames):
  return {**result,"person_timeline_status":"invalid_sample_timeline"}
 clean=[];previous=-1
 for point in raw:
  if not isinstance(point,dict):return {**result,"person_timeline_status":"invalid_sample_timeline"}
  ms=point.get("time_ms");score=point.get("person_peak_score")
  counts=[point.get(k) for k in ("people_at_050","vehicles_at_050","animals_at_050")]
  if (type(ms) is not int or not previous<ms<=duration or
      any(type(n) is not int or not 0<=n<=64 for n in counts) or
      type(score) not in (int,float) or not math.isfinite(score) or not 0<=score<=1):
   return {**result,"person_timeline_status":"invalid_sample_timeline"}
  clean.append({"time_ms":ms,"people_at_050":counts[0],"vehicles_at_050":counts[1],
                "animals_at_050":counts[2],"person_peak_score":round(float(score),3)})
  previous=ms
 positive=[p["time_ms"] for p in clean if p["people_at_050"]>0]
 return {"person_sample_timeline":clean,"person_timeline_status":"sampled_model_evidence",
         "person_first_sample_ms":positive[0] if positive else None,
         "person_last_sample_ms":positive[-1] if positive else None}

def capture_event_metrics(row):
 """Preserve verified logical event grouping while validating catalog readback."""
 result={"capture_evidence_status":"not_in_original_manifest"}
 if row.get("capture_evidence_status")!="recording_segment_verified":return result
 event=row.get("capture_event_id");index=row.get("capture_segment_index")
 transition=row.get("capture_segment_transition");prior=row.get("capture_previous_segment")
 if (not isinstance(event,str) or not re.fullmatch(r"garden_[0-9]{13}",event) or
     type(index) is not int or not 1<=index<=250 or
     transition not in ("new_event","reentry_after_quiet","max_duration_continuation") or
     (index==1 and transition!="new_event")):
  return {"capture_evidence_status":"invalid_event_metadata"}
 gap=row.get("capture_segment_gap_ms")
 if index>1 and (not isinstance(prior,str) or not re.fullmatch(r"motion_[0-9]{13}[.]mp4",prior) or
                 prior==row.get("name") or type(gap) is not int or not 0<=gap<=60000):
  return {"capture_evidence_status":"invalid_event_link"}
 return {"capture_evidence_status":"recording_segment_verified","capture_event_id":event,
         "capture_segment_index":index,"capture_previous_segment":prior if index>1 else None,
         "capture_segment_transition":transition,"capture_segment_gap_ms":gap if index>1 else None,
         "capture_has_physical_transition_gaps":True}

def detection_metrics(row):
 """Bounded model evidence. Never expose person identity or appearance vectors."""
 import math
 s=row.get("person_score")
 if isinstance(s,bool) or not isinstance(s,(int,float)) or not math.isfinite(s) or not 0<=s<=1:
  s=None
 n=row.get("sampled_frames")
 if isinstance(n,bool) or not isinstance(n,int) or not 0<=n<=32:n=None
 duration=row.get("duration_ms")
 if isinstance(duration,bool) or not isinstance(duration,int) or not 0<duration<=120000:duration=None
 backend=row.get("review_backend")
 if backend not in ("cpu","gpu"):backend=None
 event=row.get("person_event_category")
 allowed={"single_person_repeated_candidate","single_frame_person_candidate",
  "multiple_people_candidate","possible_group_needs_frame_review",
  "possible_person_below_standard_threshold","no_person_model_detection"}
 if event not in allowed:event=None
 hits=row.get("person_detected_frames_050")
 if isinstance(hits,bool) or not isinstance(hits,int) or n is None or n<1 or not 0<=hits<=n:
  hits=None
 coverage=round(100*hits/n,1) if hits is not None else None
 return {"person_score":round(float(s),3) if s is not None else None,
         "sampled_frames":n,"person_detected_frames_050":hits,
         "person_presence_percent":coverage,"duration_ms":duration,
         "review_backend":backend,"person_event_category":event,"thumbnail_revision":safe_thumbnail_revision(row),**safe_detection_timeline(row),**capture_event_metrics(row)}

def install_local_sd(H):
 original=H.go
 def go(self):
  url=urllib.parse.urlsplit(self.path)
  path=url.path
  data=rows()
  previews=preview_rows()
  if path=="/new/api/live-person-watch":
   # S9+ owns the person model, GPU inference, and garden ROI. The hub only
   # forwards metadata from the already-authenticated Camera2 loopback API.
   import s9_phone_garden_status
   try:self.js(200,s9_phone_garden_status.read_report())
   except (OSError,TypeError,ValueError,OverflowError,urllib.error.URLError):
    self.js(200,s9_phone_garden_status.unavailable())
   return
  if path=="/new/api/saved":
   events=[]
   for name,r in sorted(data.items(),reverse=True):
    tracks=r.get("anonymous_tracks",[])
    valid_statuses={"not_available_in_original_review","invalid_tracking_scope","invalid_tracking_manifest",
      "invalid_tracking_duration","sampled_tracks_available","none_detected_in_sampled_frames"}
    track_status=r.get("anonymous_tracking_status","not_available_in_original_review")
    if track_status not in valid_statuses:track_status="invalid_tracking_manifest"
    if not isinstance(tracks,list) or len(tracks)>64:tracks=[];track_status="invalid_tracking_manifest"
    if track_status!="sampled_tracks_available":tracks=[]
    tracks=[t for t in tracks if isinstance(t,dict) and
      isinstance(t.get("id"),str) and re.fullmatch(r"Person (?:[1-9]|[1-5][0-9]|6[0-4])",t["id"])]
    events.append({"camera":"new","clip_no":name,"timestamp":r.get("timestamp"),"reason":"S9+ microSD local recording",
      "method":"s9-microSD","remote_name":name,"snapshot_name":(name+".thumb.jpg" if r.get("thumbnail") else None),
      "size":r.get("size"),"person_status":r.get("scene_category","unreviewed"),
      "scene_category":r.get("scene_category","unreviewed"),"content_categories":r.get("content_categories",[]),
      "person_count":r.get("person_count",0),
      "anonymous_tracking_status":track_status,
      "anonymous_track_count":len(tracks) if track_status=="sampled_tracks_available" else
        (0 if track_status=="none_detected_in_sampled_frames" else None),
      "anonymous_tracks":tracks,
      "anonymous_id_scope":"clip_only_never_across_recordings",
      "movement_evidence_scope":"camera_image_only_not_gait_identity",
      "face_gallery_epoch":r.get("face_gallery_epoch"),
      "face_capture_algorithm":r.get("face_capture_algorithm"),
      "face_review_status":r.get("face_review_status","not_available_in_original_review"),
      "face_review_sampled_frames":r.get("face_review_sampled_frames"),
      "face_deep_review_version":r.get("face_deep_review_version"),
      "face_snapshots_saved":r.get("face_snapshots_saved",0),
      "face_candidates":r.get("face_candidates",[]),**detection_metrics(r)})
   self.js(200,{"ok":True,"camera":"new","archive_mode":"S9-microSD-only","drive_ready":False,
     "events":events,"fallback_previews":list(previews.values())})
   return
  face=re.fullmatch(r"/new/saved/face/(motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg)",path)
  if face:
   name=face.group(1)
   clip=name.split("__",1)[0]+".mp4"
   record=data.get(clip)
   if record and FACE_NAME.fullmatch(name):
    return serve_face_snapshot(self,name,record)
   self.js(404,{"ok":False,"error":"face_snapshot_not_indexed"});return
  still=re.fullmatch(r"/new/saved/still/(preview_motion_[0-9]{13}[.]jpg)",path)
  if still:
   name=still.group(1);item=previews.get(name)
   if item:return serve_preview(self,name,item)
   self.js(404,{"ok":False,"error":"preview_not_indexed"});return
  # Optional on-phone H.264 RAM-ring preroll, bound to a verified primary
  # recording and never exposed by arbitrary filenames.
  preroll=re.fullmatch(r"/new/saved/preroll/(motion_[0-9]{13}[.]mp4)",path)
  if preroll:
   original_name=preroll.group(1);item=data.get(original_name)
   if not item:
    self.js(404,{"ok":False,"error":"original_not_indexed"});return
   companion=original_name+".preroll.mp4"
   try:
    request=urllib.request.Request("http://127.0.0.1:18808/clip/"+companion,method="HEAD")
    with urllib.request.urlopen(request,timeout=8) as response:
     size=int(response.headers.get("Content-Length","0"))
    if not 10000<size<60000000:raise ValueError("preroll_size_invalid")
    return play_sd(self,companion,{**item,"size":size})
   except (ValueError,urllib.error.HTTPError,urllib.error.URLError,TimeoutError):
    self.js(404,{"ok":False,"error":"no_verified_preroll_for_clip"});return
  match=re.fullmatch(r"/new/saved/clip/([A-Za-z0-9._-]+[.]mp4)",path)
  if match:
   name=match.group(1);item=data.get(name)
   if item:return play_sd(self,name,item)
  # S9_JOINED_PREROLL_V1: read-only complete segment for indexed original.
  joined=re.fullmatch(r"/new/saved/complete/(motion_[0-9]{13}[.]mp4)",path)
  if joined:
   original=joined.group(1);record=data.get(original)
   if record:
    nm=original+".complete.mp4"
    try:
     req=urllib.request.Request("http://127.0.0.1:18808/clip/"+nm,method="HEAD")
     with urllib.request.urlopen(req,timeout=9) as response:
      if response.status!=200 or "video/mp4" not in response.headers.get("Content-Type",""):
       raise ValueError("not_video")
      size=int(response.headers.get("Content-Length","0"))
     if 25000<size<260000000:return play_sd(self,nm,{**record,"size":size})
    except (ValueError,TypeError,urllib.error.HTTPError,urllib.error.URLError,TimeoutError):pass
   self.js(404,{"ok":False,"error":"complete_video_not_yet_available"});return
  snap=re.fullmatch(r"/new/saved/snap/([A-Za-z0-9._-]+[.]mp4[.]thumb[.]jpg)",path)
  if snap:
   name=snap.group(1)
   source=BASE/"s9-phone-thumbs"/name
   if source.is_file() and name[:-10] in data:
    return self.local_file(source,"image/jpeg")
  # ARCHIVE_HISTORICAL_DRIVE_ALIAS_V1: restore read-only history.
  # The original underlying handler still serves historic Drive /saved media.
  if path=='/new/api/drive-saved' or re.fullmatch(r'/new/drive/saved/(?:clip|snap)/[A-Za-z0-9._-]{1,180}',path):
   before=self.path
   if path=='/new/api/drive-saved':self.path=before.replace('/new/api/drive-saved','/new/api/saved',1)
   else:self.path=before.replace('/new/drive/saved/','/new/saved/',1)
   try:return original(self)
   finally:self.path=before
  return original(self)
 H.go=go
 # Review writes use the same signed relay but never affect video/playback.
 import s9_human_thumbnail_review
 s9_human_thumbnail_review.install(H)
 # Historical Drive people are listed privately; visitor IDs require explicit human linking.
 import s9_drive_visitor_review
 s9_drive_visitor_review.install(H)
 # Camera2 control writes are bounded and require an explicit signed relay header.
 import s9_native_camera_controls
 s9_native_camera_controls.install(H)
 # C720P_SD_EXPLICIT_DELETE_V1: filter tombstones and mount read-only by default.
 import s9_archive_delete_v1
 globals()['rows']=s9_archive_delete_v1.install(H,rows,SECURITY_SD,NATIVE_SD,SD)
 import s9_person_folders_v31
 s9_person_folders_v31.install(H,lambda:rows())
def play_sd(handler,name,record):
 size=int(record.get("size") or 0)
 if size<10000 or size>4*1024*1024*1024:
  handler.js(404,{"ok":False,"error":"invalid_clip"});return
 header=handler.headers.get("Range","").strip()
 first=0;last=size-1;code=200
 if header:
  match=re.fullmatch(r"bytes=([0-9]*)-([0-9]*)",header)
  if not match:
   handler.send_response(416);handler.send_header("Content-Range",f"bytes */{size}");handler.end_headers();return
  a,b=match.groups()
  if a:first=int(a);last=min(size-1,int(b)) if b else last
  elif b:first=max(0,size-int(b))
  if first<0 or first>=size or last<first:
   handler.send_response(416);handler.send_header("Content-Range",f"bytes */{size}");handler.end_headers();return
  code=206
 count=last-first+1
 if handler.command=="HEAD":
  return media_headers(handler,code,size,first,last,count)
 # Native Camera2 MP4s can now be served from the phone's loopback Range API
 # without starting ADB dd per seek. Old installed builds still 404/fallback.
 if name.startswith("motion_") and phone_video_range(handler,name,size,first,last,count,code):
  return
 shift=first%BLOCK
 chunks=last//BLOCK-first//BLOCK+1
 root=SECURITY_SD if name.startswith("motion_") else NATIVE_SD if name.startswith("native4k_") else SD
 args=["adb","-s",PHONE,"exec-out","dd","if="+root+"/"+name,
       "bs="+str(BLOCK),"skip="+str(first//BLOCK),"count="+str(chunks)]
 try:proc=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 except Exception:
  handler.js(503,{"ok":False,"error":"phone_offline"});return
 try:
  ignored=proc.stdout.read(shift)
  if len(ignored)!=shift:raise OSError("seek")
  lead=proc.stdout.read(min(count,32768))
  if not lead:raise OSError("empty_video")
 except Exception:
  proc.kill();handler.js(503,{"ok":False,"error":"microSD_not_reachable"});return
 media_headers(handler,code,size,first,last,count)
 remaining=count
 try:
  handler.wfile.write(lead);remaining-=len(lead)
  while remaining>0:
   part=proc.stdout.read(min(65536,remaining))
   if not part:break
   handler.wfile.write(part);remaining-=len(part)
 except (BrokenPipeError,ConnectionResetError):pass
 finally:
  if proc.poll() is None:proc.terminate()
def phone_video_range(handler,name,size,start,end,count,code):
 """No MP4 decoding or seeks on C720P: transparently copy S9+ byte ranges.

 A 404 means the older Camera2 APK is still installed; keep the ADB
 compatibility path until an on-device rollout verifies the native endpoint.
 """
 request=urllib.request.Request("http://127.0.0.1:18808/clip/"+name,
     headers={"Range":f"bytes={start}-{end}","Accept":"video/mp4"})
 try:
  response=urllib.request.urlopen(request,timeout=11)
 except urllib.error.HTTPError as error:
  if error.code==404:return False
  handler.js(503,{"ok":False,"error":"native_phone_range_unavailable"});return True
 except Exception:
  handler.js(503,{"ok":False,"error":"native_phone_range_offline"});return True
 with response:
  try:
   expected=f"bytes {start}-{end}/{size}"
   if (response.status!=206 or
       response.headers.get("Content-Range")!=expected or
       int(response.headers.get("Content-Length","-1"))!=count or
       "video/mp4" not in response.headers.get("Content-Type","")):
    handler.js(503,{"ok":False,"error":"native_phone_range_header_mismatch"});return True
   first_chunk=response.read(min(count,65536))
   if not first_chunk:
    handler.js(503,{"ok":False,"error":"native_phone_range_empty"});return True
   media_headers(handler,code,size,start,end,count,source="phone-microSD-range")
   remaining=count
   handler.wfile.write(first_chunk);remaining-=len(first_chunk)
   while remaining>0:
    chunk=response.read(min(65536,remaining))
    if not chunk:break
    handler.wfile.write(chunk);remaining-=len(chunk)
  except (BrokenPipeError,ConnectionResetError,OSError):pass
 return True

def media_headers(handler,code,size,start,end,length,source="adb-legacy"):
 handler.send_response(code)
 handler.send_header("Content-Type","video/mp4")
 handler.send_header("X-S9-Media-Source",source)
 handler.send_header("Accept-Ranges","bytes")
 handler.send_header("Content-Length",str(length))
 handler.send_header("Cache-Control","private,no-store")
 handler.send_header("X-Content-Type-Options","nosniff")
 if code==206:handler.send_header("Content-Range",f"bytes {start}-{end}/{size}")
 handler.end_headers()
