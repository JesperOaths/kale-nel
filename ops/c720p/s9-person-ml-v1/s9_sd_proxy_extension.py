"""S9 microSD replay extension for the existing C720P secure archive proxy."""
import json,re,urllib.parse,subprocess,hashlib
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
         "review_backend":backend,"person_event_category":event}

def install_local_sd(H):
 original=H.go
 def go(self):
  url=urllib.parse.urlsplit(self.path)
  path=url.path
  data=rows()
  previews=preview_rows()
  if path=="/new/api/live-person-watch":
   # Read-only aggregate detector status through the existing signed relay;
   # never serve raw frames, person embeddings or unauthorized write routes.
   from pathlib import Path
   import time
   state_file=Path("/home/jespern/c720p-home-hub/state/s9-live-person-watch.json")
   try:
    d=json.loads(state_file.read_text())
    if d.get("version")!="s9-live-ssd-watch-v1" or not isinstance(d.get("status"),dict):
     raise ValueError("invalid_live_person_status")
    age=max(0,int(time.time()*1000)-int(d.get("last_sample_at_ms",0)))
    if age>17000:
     d={"ok":False,"status":{"kind":"sensor_stale","identity":"not_evaluated"},
        "last_sample_age_ms":age,"read_only":True}
    else:
     # Limit published fields to the documented aggregate model contract.
     d={k:d.get(k) for k in ("ok","version","read_only","label_is_ground_truth",
      "last_sample_at_ms","samples","failures","camera_mode","camera_temperature_c",
      "motion_changed_ratio","motion_coherent_cells","status","recent_candidate_transitions")}
     d["last_sample_age_ms"]=age
    self.js(200,d)
   except (OSError,TypeError,ValueError,OverflowError):
    self.js(200,{"ok":False,"read_only":True,"status":{"kind":"sensor_not_started",
      "identity":"not_evaluated"}})
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
      "face_review_status":r.get("face_review_status","not_available_in_original_review"),
      "face_review_sampled_frames":r.get("face_review_sampled_frames"),
      "face_snapshots_saved":r.get("face_snapshots_saved",0),
      "face_candidates":r.get("face_candidates",[]),**detection_metrics(r)})
   self.js(200,{"ok":True,"camera":"new","archive_mode":"S9-microSD-only","drive_ready":False,
     "events":events,"fallback_previews":list(previews.values())})
   return
  still=re.fullmatch(r"/new/saved/still/(preview_motion_[0-9]{13}[.]jpg)",path)
  if still:
   name=still.group(1);item=previews.get(name)
   if item:return serve_preview(self,name,item)
   self.js(404,{"ok":False,"error":"preview_not_indexed"});return
  match=re.fullmatch(r"/new/saved/clip/([A-Za-z0-9._-]+[.]mp4)",path)
  if match:
   name=match.group(1);item=data.get(name)
   if item:return play_sd(self,name,item)
  snap=re.fullmatch(r"/new/saved/snap/([A-Za-z0-9._-]+[.]mp4[.]thumb[.]jpg)",path)
  if snap:
   name=snap.group(1)
   source=BASE/"s9-phone-thumbs"/name
   if source.is_file() and name[:-10] in data:
    return self.local_file(source,"image/jpeg")
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
def media_headers(handler,code,size,start,end,length):
 handler.send_response(code)
 handler.send_header("Content-Type","video/mp4")
 handler.send_header("Accept-Ranges","bytes")
 handler.send_header("Content-Length",str(length))
 handler.send_header("Cache-Control","private,no-store")
 handler.send_header("X-Content-Type-Options","nosniff")
 if code==206:handler.send_header("Content-Range",f"bytes {start}-{end}/{size}")
 handler.end_headers()
