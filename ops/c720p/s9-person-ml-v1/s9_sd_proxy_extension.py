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
ACTIVITY_REPORT=Path("/home/jespern/c720p-home-hub/state/security-s9-drive-activity-v1.json")

def read_private_recording_activity(source=ACTIVITY_REPORT):
 """Sanitize private verified recording aggregates for the existing 8794 relay."""
 import datetime
 import time
 source=Path(source)
 st=source.stat()
 if source.is_symlink() or not source.is_file() or st.st_mode&0o077 or not 30<st.st_size<700000:
  raise ValueError("untrusted_activity_file")
 d=json.loads(source.read_bytes())
 if (d.get("schema_version")!="security_s9_drive_activity_v1"
  or d.get("timezone")!="Europe/Amsterdam" or d.get("operating_day_start_local")!="06:00"
  or d.get("s3_excluded") is not True or d.get("media_decoded") is not False
  or d.get("video_bytes_transferred") is not False):
  raise ValueError("untrusted_activity_origin")
 stamp=datetime.datetime.fromisoformat(d["generated_at_utc"])
 if stamp.tzinfo is None or not -180<=time.time()-stamp.timestamp()<=1800:
  raise ValueError("stale_activity")
 origins=d["source_recordings"]
 sd=origins["s9_microSD"];drive=origins["historical_drive_verified_new"]
 total=d["total_recordings"];unknown=d["historical_drive_timestamp_unknown"]
 if any(type(v) is not int or not 0<=v<=200000 for v in (sd,drive,total,unknown)) or sd+drive!=total or unknown>drive:
  raise ValueError("invalid_activity_totals")
 hours=d["local_wall_clock_hours"];days=d["operating_days"]
 if not isinstance(hours,dict) or set(hours)!={f"{i:02d}" for i in range(24)} or not isinstance(days,dict) or len(days)>420:
  raise ValueError("invalid_activity_dimensions")
 def checked(value):
  if not isinstance(value,dict):raise ValueError("invalid_activity_bucket")
  a,b,c=(value.get(k) for k in ("s9_microSD","historical_drive","combined"))
  if any(type(v) is not int or not 0<=v<=200000 for v in (a,b,c)) or a+b!=c:
   raise ValueError("inconsistent_activity_bucket")
  return {"s9_microSD":a,"historical_drive":b,"combined":c}
 h={key:checked(hours[key]) for key in sorted(hours)}
 dates={}
 for key,row in sorted(days.items()):
  if not re.fullmatch(r"20[0-9]{2}-[0-9]{2}-[0-9]{2}",key):raise ValueError("invalid_day")
  datetime.date.fromisoformat(key)
  dates[key]=checked(row)
 for table in (h,dates):
  if sum(x["s9_microSD"] for x in table.values())!=sd or sum(x["historical_drive"] for x in table.values())+unknown!=drive:
   raise ValueError("source_counts_do_not_reconcile")
 return {"ok":True,"schema_version":"security_s9_drive_activity_v1",
  "generated_at_utc":d["generated_at_utc"],"timezone":"Europe/Amsterdam",
  "operating_day_start_local":"06:00","source_recordings":{"s9_microSD":sd,
   "historical_drive_verified_new":drive},"total_recordings":total,
  "historical_drive_timestamp_unknown":unknown,"local_wall_clock_hours":h,
  "operating_days":dates,"recordings_not_people":True,"s3_included":False,
  "dst_caveat":"Historical Drive repeated-hour offsets cannot be resolved",
  "media_decoded":False,"video_bytes_transferred":False}

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
FACE_SNAPSHOT_MIN_BYTES=512
FACE_SNAPSHOT_MAX_BYTES=2200000

def jpeg_snapshot_dimensions(data):
 """Read bounded JPEG frame dimensions; never infer detail from file size.

 S9+ saves square native-pixel crops, at least 70 pixels per side. This
 structural check supplements the exact native-manifest size and SHA-256.
 It is not a claim that the image shows a person or establishes identity.
 """
 if (not isinstance(data,bytes) or not FACE_SNAPSHOT_MIN_BYTES<=len(data)<=FACE_SNAPSHOT_MAX_BYTES
     or not data.startswith(b"\xff\xd8\xff") or not data.endswith(b"\xff\xd9")):
  return None
 pos=2
 for _ in range(256):
  if pos>=len(data) or data[pos]!=255:return None
  while pos<len(data) and data[pos]==255:pos+=1
  if pos>=len(data):return None
  marker=data[pos];pos+=1
  if marker in (0,0xd8,0xd9,0xda):return None
  if marker==1 or 0xd0<=marker<=0xd7:continue
  if pos+2>len(data):return None
  length=int.from_bytes(data[pos:pos+2],"big")
  if length<2 or pos+length>len(data):return None
  if marker in (0xc0,0xc1,0xc2):
   if length<8 or data[pos+2]!=8:return None
   height=int.from_bytes(data[pos+3:pos+5],"big")
   width=int.from_bytes(data[pos+5:pos+7],"big")
   components=data[pos+7]
   if components not in (1,3) or length!=8+3*components:return None
   return (width,height) if 70<=width==height<=4096 else None
  pos+=length
 return None

def serve_face_snapshot(handler,name,record):
 """Relay indexed S9 microSD JPEG only on signed request, with SHA-256 verification.
 Not a face inference service; never writes image data to the C720P filesystem.
 """
 evidence=next((entry for entry in record.get("face_candidates",[]) if
                entry.get("snapshot_name")==name and entry.get("snapshot_on_s9")
                and type(entry.get("snapshot_size")) is int
                and FACE_SNAPSHOT_MIN_BYTES<=entry["snapshot_size"]<=FACE_SNAPSHOT_MAX_BYTES
                and re.fullmatch(r"[a-f0-9]{64}",str(entry.get("snapshot_sha256","")))),None)
 if evidence is None:
  handler.js(404,{"ok":False,"error":"face_snapshot_not_indexed"});return
 try:
  try:
   import phone_archive_catalog_v1 as phone_catalog
   try:data=phone_catalog.read_asset(name)
   except phone_catalog.Unavailable:data=None
  except ImportError:data=None
  if data is None:
   p=subprocess.run(["adb","-s",PHONE,"exec-out","cat",SECURITY_SD+"/FaceSnapshots/"+name],
     stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=16,check=True)
   data=p.stdout
  if (len(data)!=evidence["snapshot_size"] or
      hashlib.sha256(data).hexdigest()!=evidence["snapshot_sha256"] or
      jpeg_snapshot_dimensions(data) is None):
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

def historical_drive_origin_path(path,query):
 """Return the original Drive handler path, never a filesystem path."""
 if query:return None
 if path=="/new/api/drive-saved":return "/new/api/saved"
 match=re.fullmatch(r"/new/drive/saved/(clip|snap)/([A-Za-z0-9._-]{1,180})",path)
 if not match:return None
 kind,name=match.groups()
 if ".." in name or not name.endswith(".mp4" if kind=="clip" else ".jpg"):
  return None
 return "/new/saved/"+kind+"/"+name

def install_local_sd(H):
 original=H.go
 def go(self):
  url=urllib.parse.urlsplit(self.path)
  path=url.path
  # ARCHIVE_HISTORICAL_DRIVE_ALIAS_V1: preserve the pre-S9 archive handler.
  # S9+ overlays /new/api/saved; remap only explicitly bounded historical
  # routes back to the original Drive server, without touching Drive files.
  original_path=historical_drive_origin_path(path,url.query)
  if original_path is not None:
   before=self.path
   self.path=original_path
   try:return original(self)
   finally:self.path=before
  if path=="/new/api/security-recording-activity":
   # Existing outer 8794 relay applies the Security authentication boundary.
   if self.command!="GET" or url.query:
    self.js(400,{"ok":False,"error":"activity_get_no_query_only"});return
   try:
    blob=json.dumps(read_private_recording_activity(),separators=(",",":"),sort_keys=True).encode()
    self.send_response(200)
    self.send_header("Content-Type","application/json; charset=utf-8")
    self.send_header("Cache-Control","private, no-store")
    self.send_header("X-Content-Type-Options","nosniff")
    self.send_header("Content-Length",str(len(blob)))
    self.end_headers()
    self.wfile.write(blob)
   except (OSError,ValueError,TypeError,KeyError,OverflowError):
    self.js(503,{"ok":False,"error":"verified_activity_unavailable"})
   return
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
  if path=="/new/api/appearance-search":
   # Authenticated outer 8794 relay only; phone stays bound to 127.0.0.1.
   # Do not accept arbitrary paths, uploads, face data, or identity queries.
   if self.command!="GET":
    self.js(400,{"ok":False,"error":"appearance_search_get_only"});return
   allowed={"clip","category","zone","method","from_ms","until_ms","limit"}
   try:
    parameters=urllib.parse.parse_qs(url.query,keep_blank_values=True,strict_parsing=True)
    if not parameters or set(parameters)-allowed or any(len(v)!=1 for v in parameters.values()):
     raise ValueError("invalid_search_parameters")
    def field(name,default=None):
     return parameters.get(name,[default])[0]
    clip=field("clip")
    category=field("category")
    zone=field("zone")
    method=field("method","bhattacharyya")
    limit=field("limit","20")
    if not isinstance(clip,str) or not re.fullmatch(r"motion_[0-9]{13}[.]mp4",clip) or clip not in data:
     raise ValueError("reference_not_in_authenticated_archive")
    if category not in ("upper_clothing","lower_clothing","vehicle"):
     raise ValueError("invalid_category")
    if zone is not None and zone not in ("front_garden","background_street","unspecified"):
     raise ValueError("invalid_zone")
    if method not in ("bhattacharyya","correlation") or not re.fullmatch(r"[0-9]{1,2}",limit) or not 1<=int(limit)<=50:
     raise ValueError("invalid_metric_or_limit")
    safe={"clip":clip,"category":category,"method":method,"limit":limit}
    if zone:safe["zone"]=zone
    for key in ("from_ms","until_ms"):
     value=field(key)
     if value is not None:
      if not re.fullmatch(r"[0-9]{1,15}",value):raise ValueError("invalid_time_filter")
      safe[key]=value
    if "from_ms" in safe and "until_ms" in safe and int(safe["from_ms"])>int(safe["until_ms"]):
     raise ValueError("inverted_time_range")
   except (ValueError,TypeError):
    self.js(400,{"ok":False,"error":"invalid_appearance_search_request"});return
   source="http://127.0.0.1:18808/appearance/search?"+urllib.parse.urlencode(safe)
   try:
    with urllib.request.urlopen(source,timeout=15) as phone:
     if phone.status!=200 or int(phone.headers.get("Content-Length","200000"))>200000:
      raise ValueError("invalid_phone_search_response")
     payload=json.loads(phone.read(200001))
    if payload.get("ok") is not True or payload.get("appearance_only") is not True or not isinstance(payload.get("results"),list):
     raise ValueError("bad_appearance_payload")
    results=[]
    for hit in payload["results"][:50]:
     if not isinstance(hit,dict):continue
     name=hit.get("clip_name")
     score=hit.get("similarity")
     if name not in data or not isinstance(score,(int,float)) or isinstance(score,bool) or not 0<=score<=1:
      continue
     if hit.get("verified_same_person") is not False:continue
     results.append({"clip_name":name,"similarity":round(float(score),4),
       "offset_ms":int(hit.get("offset_ms",0)),"zone":hit.get("zone","unspecified"),
       "scene":str(hit.get("scene","unreviewed"))[:55],
       "appearance_only":True,"verified_same_person":False})
    self.js(200,{"ok":True,"index_version":"s9_hsv_histogram_index_v1",
      "appearance_only":True,"verified_same_person":False,
      "reference_clip":clip,"category":category,"results":results})
   except (urllib.error.URLError,TimeoutError,OSError,ValueError,TypeError,json.JSONDecodeError):
    self.js(503,{"ok":False,"error":"s9_appearance_index_unavailable"});return
   return
  # SECURITY_DRIVE_V9_SOURCE_PRESERVED: historical Drive routes belong to
  # the earlier trusted 8795 handler. Retain this forwarding in committed
  # source so installing new S9 metadata handlers cannot silently erase it.
  # Neither archive is modified; the outer 8794 relay still authenticates.
  if path=="/new/api/drive-saved":
   before=self.path
   try:
    self.path="/new/api/saved"+("?" + url.query if url.query else "")
    return original(self)
   finally:self.path=before
  drive_clip=re.fullmatch(r"/new/drive/saved/clip/([A-Za-z0-9._-]{1,180}[.]mp4)",path)
  drive_snap=re.fullmatch(r"/new/drive/saved/snap/([A-Za-z0-9._-]{1,180}[.]jpg)",path)
  if drive_clip or drive_snap:
   name=(drive_clip or drive_snap).group(1)
   if ".." in name:
    self.js(400,{"ok":False,"error":"invalid_historical_name"});return
   before=self.path
   try:
    self.path="/new/saved/"+("clip/" if drive_clip else "snap/")+name
    return original(self)
   finally:self.path=before
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
    # Only the V25 independently corroborated clip-local candidates may be
    # shown as people in Tracks & Movements. Raw detector fragments stay as
    # metadata for forensic review, never as verified person identities.
    evidence_version=r.get("person_track_evidence_version")
    person_tracks=r.get("person_tracks",[]) if evidence_version=="corroborated_person_tracklets_v25" else []
    if not isinstance(person_tracks,list) or len(person_tracks)>64:person_tracks=[]
    person_tracks=[t for t in person_tracks if isinstance(t,dict) and
      isinstance(t.get("id"),str) and
      re.fullmatch(r"Person (?:[1-9]|[1-5][0-9]|6[0-4])",t["id"]) and
      t.get("evidence_label")=="corroborated_person_candidate"]
    if evidence_version!="corroborated_person_tracklets_v25":person_tracks=[]
    def bounded_count(name):
     x=r.get(name,0)
     return x if type(x) is int and 0<=x<=64 else 0
    events.append({"camera":"new","clip_no":name,"timestamp":r.get("timestamp"),"reason":"S9+ microSD local recording",
      "method":"s9-microSD","remote_name":name,"snapshot_name":(name+".thumb.jpg" if r.get("thumbnail") else None),
      "size":r.get("size"),"person_status":r.get("scene_category","unreviewed"),
      "scene_category":r.get("scene_category","unreviewed"),"content_categories":r.get("content_categories",[]),
      "person_count":r.get("person_count",0),
      "anonymous_tracking_status":track_status,
      "anonymous_track_count":len(tracks) if track_status=="sampled_tracks_available" else
        (0 if track_status=="none_detected_in_sampled_frames" else None),
      "anonymous_tracks":tracks,
      "person_track_evidence_version":evidence_version if evidence_version=="corroborated_person_tracklets_v25" else None,
      "person_tracks":person_tracks,
      "person_track_count":len(person_tracks),
      "person_track_review_count":bounded_count("person_track_review_count"),
      "rejected_object_track_count":bounded_count("rejected_object_track_count"),
      "person_track_review_reasons":r.get("person_track_review_reasons",[])[:64] if isinstance(r.get("person_track_review_reasons"),list) else [],
      "duration_ms":r.get("duration_ms"),
      "person_detected_frames_050":r.get("person_detected_frames_050"),

      "anonymous_id_scope":"clip_only_never_across_recordings",
      "movement_evidence_scope":"camera_image_only_not_gait_identity",
      "face_review_status":r.get("face_review_status","not_available_in_original_review"),
      "face_review_sampled_frames":r.get("face_review_sampled_frames"),
      "face_deep_review_version":r.get("face_deep_review_version"),
      "face_crop_geometry_version":r.get("face_crop_geometry_version"),
      # The local catalog already checks all status enums and bounds numeric
      # diagnostics. Expose these human-readable results, never embeddings.
      "face_evidence_outcome":r.get("face_evidence_outcome","not_reviewed"),
      "face_model_state":r.get("face_model_state","not_tested_no_usable_face"),
      "face_shadow_review_version":r.get("face_shadow_review_version"),
      "face_shadow_model_trials":r.get("face_shadow_model_trials",0),
      "face_shadow_model_succeeded":r.get("face_shadow_model_succeeded",0),
      "face_shadow_model_failed":r.get("face_shadow_model_failed",0),
      "face_shadow_vectors_persisted":False,
      "face_shadow_matches_created":0,
      "face_detector_raw_hits":r.get("face_detector_raw_hits"),
      "face_rejected_confidence_or_size":r.get("face_rejected_confidence_or_size"),
      "face_rejected_low_confidence":r.get("face_rejected_low_confidence"),
      "face_rejected_small_face":r.get("face_rejected_small_face"),
      "face_manual_review_rescue_candidates":r.get("face_manual_review_rescue_candidates"),
      "face_rejected_looking_away_or_roll":r.get("face_rejected_looking_away_or_roll"),
      "face_rejected_crop_geometry":r.get("face_rejected_crop_geometry"),
      "face_rejected_insufficient_native_eye_detail":r.get("face_rejected_insufficient_native_eye_detail"),
      "face_crop_padded_manual_count":r.get("face_crop_padded_manual_count"),
      "face_rejected_dark_or_blurry":r.get("face_rejected_dark_or_blurry"),
      "face_deep_detector_anchor_frames":r.get("face_deep_detector_anchor_frames"),
      "face_deep_person_roi_anchors":r.get("face_deep_person_roi_anchors"),
      "face_deep_multiple_person_anchors":r.get("face_deep_multiple_person_anchors"),
      "face_deep_tiled_scene_samples":r.get("face_deep_tiled_scene_samples"),
      "face_deep_second_person_roi_samples":r.get("face_deep_second_person_roi_samples"),
      "face_snapshots_saved":r.get("face_snapshots_saved",0),
      "face_candidate_records":r.get("face_candidate_records",len(r.get("face_candidates",[]))),
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
 # Audited manually reviewed event cases (not biometric identities).
 import s9_manual_evidence_cases
 s9_manual_evidence_cases.install(H)
 # Human-only folder links for original clips without person index, Drive
 # sources, and reversible returns to the archive. Overlay, not biometrics.
 import s9_manual_recording_links
 # Manual migration is disabled by default. Never run two canonical writers.
 # Activate only after the separately authenticated original-open, range,
 # player-loaded and ticket-forwarding HTTP paths pass real acceptance.
 import os as _chat3_os
 if _chat3_os.environ.get('C720P_SIGNED_ORIGINAL_REVIEW_V1')=='verified':
  import s9_review_activation_v1 as _chat3_activation
  import s9_trusted_original_media_bridge_v1 as _chat3_media
  _chat3_activation.activate(H,rows,
   original_delegate=_chat3_media.serve_pinned_original,
   source_resolver=_chat3_media.resolve_original,
   relay_review_routes_verified=True)
 else:
  s9_manual_recording_links.install(H,rows)
 # Automatic Person proposals and denials remain private and opt-in to
 # human approval. No machine result writes an approved person assignment.
 import s9_automatic_person_review
 s9_automatic_person_review.install(H,rows)
 # Preserve the independent S9 multivector appearance API already deployed.
 import s9_multivector_appearance_api
 s9_multivector_appearance_api.install(H)
 # Historical auxiliary footage is separate from verified original recordings.
 import s9_auxiliary_recovery_api_v1
 s9_auxiliary_recovery_api_v1.install(H,play_sd)
 # Former C720P event recordings offloaded onto S9+; isolated from
 # verified original 4K and manual person classification.
 import s9_c720p_imported_media_api_v1
 s9_c720p_imported_media_api_v1.install(H,play_sd)
 # Camera2 control writes are bounded and require an explicit signed relay header.
 import s9_native_camera_controls
 s9_native_camera_controls.install(H)
 try:
  import s9_evidence_quality_v1
 except ModuleNotFoundError as error:
  if error.name!='s9_evidence_quality_v1':raise
 else:s9_evidence_quality_v1.install(H,rows)
 # Chat 3: V361 remains current-source-only. Never fall back to class-only
 # evidence qualification or silently convert revocation to a valid sample.
 # Private 8795 is a threaded server; relay authentication is still owned by
 # the separate signed 8794 transport.
 import s9_anonymous_quality_http_adapter_v1 as v361_route
 import s9_v361_http_reader_v1 as v369_transport
 import s9_anonymous_evidence_consumer_v361 as v361_consumer
 v361_route.install(H,rows,v361_consumer,v369_transport.fetch_live_http)
def play_sd(handler,name,record,*,root_override=None):
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
 if root_override is None and name.startswith("motion_") and phone_video_range(handler,name,size,first,last,count,code):
  return
 shift=first%BLOCK
 chunks=last//BLOCK-first//BLOCK+1
 root=(root_override if root_override is not None else
       SECURITY_SD if name.startswith("motion_") else NATIVE_SD if name.startswith("native4k_") else SD)
 if root_override is not None and root_override!=("/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/C720PMigrated"):
  handler.js(404,{"ok":False,"error":"unauthorized_media_root"});return
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


