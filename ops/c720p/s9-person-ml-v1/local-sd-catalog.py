#!/usr/bin/env python3
"""S9 microSD security catalog. No Google Drive access or MP4 hub caching."""
import json,subprocess,os,re,datetime,math
from pathlib import Path
ADDR="192.168.178.250:5555"
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9edge/files/SecurityClips"
ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
# Metadata only. Preview image bytes stay exclusively on S9+ microSD.
PRIVATE_FALLBACK=Path("/home/jespern/c720p-home-hub/state/s9-fallback-evidence.json")
RE_PREVIEW=re.compile(r"^preview_motion_([0-9]{13})[.]jpg$")
NAMES=re.compile(r"^rec_20[0-9]{2}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}\.mp4$")
# Only clip-scoped, on-phone predictions are mirrored as metadata. Never copy images,
# appearance vectors, face features, names or cross-clip matching suggestions.
TRACK_VERSION="sampled_box_tracklets_v1"
COLOURS={"black","white","gray","red","orange","yellow","green","blue","purple_or_pink","brown","uncertain"}
def anonymous_clip_metadata(manifest):
 status={"anonymous_tracking_status":"not_available_in_original_review",
         "anonymous_track_count":None,"anonymous_tracks":[]}
 if manifest.get("anonymous_tracking_version")!=TRACK_VERSION:
  return status
 if manifest.get("anonymous_track_scope")!="this_recording_only":
  return {**status,"anonymous_tracking_status":"invalid_tracking_scope"}
 raw=manifest.get("anonymous_tracks")
 if not isinstance(raw,list) or len(raw)>64:
  return {**status,"anonymous_tracking_status":"invalid_tracking_manifest"}
 duration=manifest.get("duration_ms",0)
 try:
  duration=int(duration)
 except (ValueError,TypeError,OverflowError):
  duration=0
 if not 0<duration<=120000:
  return {**status,"anonymous_tracking_status":"invalid_tracking_duration"}
 tracks=[]
 seen=set()
 try:
  for entry in raw:
   if not isinstance(entry,dict):raise ValueError("invalid_track")
   index=entry.get("temporary_track_id")
   if isinstance(index,bool) or not isinstance(index,int) or not 1<=index<=64 or index in seen:
    raise ValueError("invalid_track_id")
   if entry.get("id")!=f"Person {index}" or entry.get("cross_recording_identity")!="not_attempted":
    raise ValueError("invalid_identity_scope")
   first,last=entry.get("first_sample_ms"),entry.get("last_sample_ms")
   samples=entry.get("sample_count")
   peak=entry.get("peak_detection_score")
   colour=entry.get("upper_clothing_colour")
   if any(isinstance(v,bool) for v in (first,last,samples,peak)):
    raise ValueError("invalid_track_fields")
   if not isinstance(first,int) or not isinstance(last,int) or not 0<=first<=last<=duration+100:
    raise ValueError("invalid_sample_timing")
   if not isinstance(samples,int) or not 1<=samples<=12:
    raise ValueError("invalid_sample_count")
   if not isinstance(peak,(int,float)) or not .5<=peak<=1:
    raise ValueError("invalid_peak_score")
   if colour not in COLOURS:colour="uncertain"
   tracks.append({"id":f"Person {index}","temporary_track_id":index,
    "first_sample_ms":first,"last_sample_ms":last,"sample_count":samples,
    "peak_detection_score":round(float(peak),3),"upper_clothing_colour":colour})
   seen.add(index)
  claimed=manifest.get("anonymous_track_count")
  if isinstance(claimed,bool) or not isinstance(claimed,int) or claimed!=len(tracks):
   raise ValueError("track_count_mismatch")
 except (ValueError,TypeError,OverflowError):
  return {**status,"anonymous_tracking_status":"invalid_tracking_manifest"}
 return {"anonymous_tracking_status":"sampled_tracks_available" if tracks else "none_detected_in_sampled_frames",
         "anonymous_track_count":len(tracks),"anonymous_tracks":tracks}

def safe_native_detection_stats(manifest):
 """Whitelisted, non-biometric detection provenance from S9 signed manifests."""
 value=manifest.get("person_confidence")
 try:
  score=float(value)
  if not math.isfinite(score) or not 0<=score<=1:score=None
 except (TypeError,ValueError,OverflowError):score=None
 try:
  frames=int(manifest.get("sampled_frame_count"))
  if not 0<=frames<=32:frames=None
 except (TypeError,ValueError,OverflowError):frames=None
 try:
  duration=int(manifest.get("duration_ms"))
  if not 0<duration<=120000:duration=None
 except (TypeError,ValueError,OverflowError):duration=None
 hits=manifest.get("person_frames_at_050")
 if isinstance(hits,bool) or not isinstance(hits,int) or frames is None or frames<1 or not 0<=hits<=frames:
  hits=None
 coverage=round(100*hits/frames,1) if hits is not None else None
 backend=manifest.get("backend")
 if backend not in ("gpu","cpu"):backend=None
 category=manifest.get("person_event_category")
 if category not in ("single_person_repeated_candidate","single_frame_person_candidate",
                      "multiple_people_candidate","possible_group_needs_frame_review",
                      "possible_person_below_standard_threshold","no_person_model_detection"):
  category=None
 return {"person_score":round(score,3) if score is not None else None,
         "sampled_frames":frames,"person_detected_frames_050":hits,
         "person_presence_percent":coverage,"duration_ms":duration,
         "review_backend":backend,"person_event_category":category}

def safe_face_review_metadata(m):
 """Strictly allowlisted human-readable phone metadata. Never copy embeddings or JPEGs."""
 result={"face_review_status":"not_available_in_original_review",
         "face_review_sampled_frames":None,"face_snapshots_saved":0,"face_candidates":[]}
 if m.get("face_review_version")!="s9_face_review_v1":return result
 status=m.get("face_review_status")
 valid=("no_frontal_face_in_samples","face_embedding_unavailable_snapshots_only",
   "face_embedding_failed_snapshots_only","face_review_failed",
   "review_complete_unverified_matches","face_model_changed_requires_reenrollment",
   "face_index_read_error")
 result["face_review_status"]=status if status in valid else "invalid_face_review_status"
 n=m.get("face_review_sampled_frames")
 if type(n) is int and 0<=n<=12:result["face_review_sampled_frames"]=n
 rows=m.get("face_candidates")
 if not isinstance(rows,list) or len(rows)>8:return result
 out=[]
 for row in rows:
  if not isinstance(row,dict):continue
  status=row.get("match_status")
  if status not in ("not_comparable_model_unavailable","reference_similarity_unverified",
    "anonymous_similarity_unverified","new_anonymous_candidate","face_model_changed_requires_reenrollment",
    "face_index_read_error","face_database_unavailable","face_index_capacity_reached"):continue
  ms=row.get("time_ms")
  if type(ms) is not int or not 0<=ms<=3600000:continue
  key=row.get("person_id")
  if not isinstance(key,str) or not re.fullmatch(r"(?:unknown_[0-9]{5}|known_candidate_[A-Za-z0-9_.-]{1,56})",key):key=None
  label=row.get("candidate_name")
  if not isinstance(label,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 _.-]{0,55}",label):label=None
  score=row.get("cosine_similarity")
  if type(score) not in (float,int) or not math.isfinite(score) or not -1<=score<=1:score=None
  # A face JPEG can be requested on demand only if this verified manifest
  # gives its exact basename, expected size and digest.
  snap=row.get("snapshot")
  base=m.get("name","").removesuffix(".mp4")
  valid_snapshot=(isinstance(base,str) and re.fullmatch(r"motion_[0-9]{13}",base)
      and isinstance(snap,str) and re.fullmatch(
       r"motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg",snap)
      and snap.startswith(base+"__"))
  size=row.get("snapshot_size_bytes")
  digest=row.get("snapshot_sha256")
  if not (valid_snapshot and type(size) is int and 2000<=size<=2200000
          and isinstance(digest,str) and re.fullmatch(r"[a-f0-9]{64}",digest)):
   snap=None;size=None;digest=None
  out.append({"person_id":key,"candidate_name":label,"match_status":status,
    "time_ms":ms,"cosine_similarity":round(score,3) if score is not None else None,
    "snapshot_on_s9":snap is not None,
    "snapshot_name":snap,"snapshot_size":size,"snapshot_sha256":digest})
 result["face_candidates"]=out
 result["face_snapshots_saved"]=len(out)
 return result

def adb(*args):
 p=subprocess.run(["adb","-s",ADDR,*args],capture_output=True,timeout=32)
 if p.returncode:raise OSError("phone_adb_offline")
 return p.stdout
def main():
 state=subprocess.run(["adb","-s",ADDR,"get-state"],capture_output=True,timeout=6)
 if state.returncode or state.stdout.strip()!=b"device":
  subprocess.run(["adb","connect",ADDR],capture_output=True,timeout=12)
 names=adb("shell","ls","-1",SD).decode().splitlines()
 rows=[];problems=[]
 for name in sorted(names,reverse=True):
  if not NAMES.fullmatch(name):continue
  try:
   b=adb("exec-out","cat",SD+"/"+name+".verified.json")
   if len(b)>14000:raise ValueError("manifest too large")
   m=json.loads(b)
   size=int(m.get("bytes",0))
   if m.get("name")!=name or size<10000 or not re.fullmatch("[a-f0-9]{64}",str(m.get("sha256",""))):raise ValueError("manifest")
   actual=int(adb("shell","stat","-c","%s",SD+"/"+name).strip())
   if actual!=size:raise ValueError("partial file")
   thumb=None
   try:
    img=adb("exec-out","cat",SD+"/"+name+".thumb.jpg")
    if img[:3]==bytes([255,216,255]) and 4000<len(img)<2200000:
     dest=ROOT/"s9-phone-thumbs"/(name+".thumb.jpg")
     dest.parent.mkdir(parents=True,exist_ok=True)
     if not dest.is_file() or dest.read_bytes()!=img:
      part=dest.with_suffix(".jpg.tmp")
      part.write_bytes(img);os.replace(part,dest)
     thumb="s9-phone-thumbs/"+dest.name
   except Exception:pass
   group=m.get("content_group")
   if group not in ("one_person","multiple_people"):group="unreviewed"
   dt=datetime.datetime.strptime(name[4:-4],"%Y-%m-%d_%H-%M")
   rows.append({"name":name,"timestamp":dt.strftime("%Y-%m-%d %H:%M"),"size":size,
     "drive_verified":False,"sd_verified":True,"sd_only":True,
     "scene_category":group,"person_count":m.get("ai_person_count_at_trigger",0),
     "thumbnail":thumb})
  except Exception as e:problems.append(name+":"+type(e).__name__)
 # Include only native 4K recordings whose S9-generated SHA-256 evidence matches.
 native="/storage/9C33-6BBD/Android/data/nl.kalenel.s9nativefourk/files/Native4K"
 try:
  m=json.loads(adb("exec-out","cat",native+"/native4k-test-result.json"))
  name=str(m.get("file") or "")
  if m.get("status")!="VERIFIED_4K" or not re.fullmatch(r"native4k_[0-9]{13}[.]mp4",name):
   raise ValueError("native_4k_verification_missing")
  if int(m.get("width",0))!=3840 or int(m.get("height",0))!=2160 or int(m.get("duration_ms",0))<3000:
   raise ValueError("native_4k_metrics_invalid")
  size=int(m.get("bytes",0));sha=str(m.get("sha256") or "").lower()
  if not 100000<size<350000000 or not re.fullmatch(r"[0-9a-f]{64}",sha):
   raise ValueError("native_4k_hash_invalid")
  actual=int(adb("shell","stat","-c","%s",native+"/"+name).strip())
  if actual!=size:raise ValueError("native_4k_size_mismatch")
  digest=adb("shell","sha256sum",native+"/"+name).decode().split()[0].lower()
  if sha!=digest:raise ValueError("native_4k_sha256_mismatch")
  thumb=None
  try:
   img=adb("exec-out","cat",native+"/"+name+".thumb.jpg")
   if img[:3]==bytes([255,216,255]) and 4000<len(img)<2200000:
    dest=ROOT/"s9-phone-thumbs"/(name+".thumb.jpg")
    dest.parent.mkdir(parents=True,exist_ok=True)
    if not dest.is_file() or dest.read_bytes()!=img:
     part=dest.with_suffix(".jpg.tmp")
     part.write_bytes(img);os.replace(part,dest)
    thumb="s9-phone-thumbs/"+dest.name
  except Exception:pass
  stamp=datetime.datetime.fromtimestamp(int(name.split("_")[1].split(".")[0])/1000.0)
  rows.append({"name":name,"timestamp":stamp.strftime("%Y-%m-%d %H:%M"),"size":size,
    "drive_verified":False,"sd_verified":True,"sd_only":True,
    "scene_category":"unreviewed","person_count":0,"thumbnail":thumb,
    "resolution":"3840x2160","codec":"H.264","storage":"S9+ native 4K microSD"})
 except Exception as e:
  if type(e).__name__!="OSError":problems.append("native_4k:"+type(e).__name__)
 # Standalone Camera2 motion-triggered 4K recordings, independently classified on S9.
 native_security="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
 try:
  recorded=adb("shell","ls","-1",native_security).decode().splitlines()
  native_listing_ok=True
 except Exception:
  recorded=[]
  native_listing_ok=False
 for name in recorded:
  if not re.fullmatch(r"motion_[0-9]{13}[.]mp4",name):continue
  try:
   m=json.loads(adb("exec-out","cat",native_security+"/"+name+".verified.json"))
   size=int(m.get("bytes",0));digest=str(m.get("sha256","")).lower()
   if m.get("name")!=name or not re.fullmatch(r"[a-f0-9]{64}",digest) or not 100000<size<800000000:
    raise ValueError("security_manifest_invalid")
   if int(m.get("width",0))!=3840 or int(m.get("height",0))!=2160:
    raise ValueError("not_verified_2160p")
   actual=int(adb("shell","stat","-c","%s",native_security+"/"+name).strip())
   if size!=actual:raise ValueError("incomplete_sd_mp4")
   group=str(m.get("scene_category","motion_other"))
   if group not in ("one_person","multiple_people","motion_other"):
    group="unreviewed"
   thumb=None
   try:
    raw=adb("exec-out","cat",native_security+"/"+name+".thumb.jpg")
    if 4000<len(raw)<2200000 and raw[:3]==bytes([255,216,255]):
     dest=ROOT/"s9-phone-thumbs"/(name+".thumb.jpg")
     dest.parent.mkdir(parents=True,exist_ok=True)
     if not dest.is_file() or dest.read_bytes()!=raw:
      t=dest.with_suffix(".jpg.partial");t.write_bytes(raw);os.replace(t,dest)
     thumb="s9-phone-thumbs/"+dest.name
   except Exception:pass
   when=datetime.datetime.fromtimestamp(int(name.split("_")[1].split(".")[0])/1000.0)
   rows.append({"name":name,"timestamp":when.strftime("%Y-%m-%d %H:%M"),
     "size":size,"drive_verified":False,"sd_verified":True,"sd_only":True,
     "scene_category":group,"person_count":int(m.get("person_count",0)),
     **safe_native_detection_stats(m),
     "thumbnail":thumb,"resolution":"3840x2160","codec":"H.264",
     "content_categories":m.get("categories",[]),
     **anonymous_clip_metadata(m),
     **safe_face_review_metadata(m),
     "storage":"S9 native 4K Security microSD"})
  except Exception as error:problems.append(name+":"+type(error).__name__)

 # Still-image evidence from a motion event when a full 4K clip was blocked.
 # Never call these frames "video" or infer that a person is present.
 # Do not mirror JPEG bytes to the hub: the secure media proxy reads microSD.
 if native_listing_ok:
  previews=[]
  for name in sorted(recorded,reverse=True):
   match=RE_PREVIEW.fullmatch(name)
   if not match:continue
   if len(previews)>=250:break
   try:
    stamp=int(match.group(1))
    sidecar=adb("exec-out","cat",native_security+"/"+name+".json")
    if not 30<len(sidecar)<4096:raise ValueError("preview_sidecar_size")
    m=json.loads(sidecar)
    if m.get("name")!=name or m.get("kind")!="preview_only_motion_evidence":
     raise ValueError("preview_manifest_kind")
    if m.get("archive")!="S9_microSD_only" or m.get("person_identity")!="not_evaluated":
     raise ValueError("preview_not_sd_only")
    if int(m.get("width",0))!=640 or int(m.get("height",0))!=480:
     raise ValueError("preview_dimensions")
    if abs(int(m.get("captured_at_ms",0))-stamp)>1500:
     raise ValueError("preview_timestamp")
    size=int(adb("shell","stat","-c","%s",native_security+"/"+name).strip())
    if not 3000<size<2500000:raise ValueError("preview_size")
    # Digest is calculated on the phone, avoiding a second permanent copy.
    checksum=adb("shell","sha256sum",native_security+"/"+name).decode().split()[0].lower()
    if not re.fullmatch(r"[0-9a-f]{64}",checksum):raise ValueError("preview_sha256")
    reason=str(m.get("reason") or "motion_event")
    if reason not in ("recording_budget_rejected","cooldown_motion",
                       "thermal_or_space_guard","recording_safety_guard"):
     reason="motion_event"
    when=datetime.datetime.fromtimestamp(stamp/1000)
    previews.append({"name":name,"kind":"preview_only_motion_evidence",
       "timestamp":when.strftime("%Y-%m-%d %H:%M:%S"),
       "captured_at_ms":stamp,"reason":reason,"size":size,"sha256":checksum,
       "sd_verified":True,"sd_only":True,"width":640,"height":480,
       "person_status":"not_evaluated","scene_category":"preview_only"})
   except Exception as e:
    problems.append("preview:"+name+":"+type(e).__name__)
  PRIVATE_FALLBACK.parent.mkdir(parents=True,exist_ok=True)
  preview_index={"archive_mode":"S9-microSD-only","kind":"fallback_previews",
                 "count":len(previews),"previews":previews}
  tmp=PRIVATE_FALLBACK.with_suffix(".json.tmp")
  tmp.write_text(json.dumps(preview_index,separators=(",",":"))+"\n")
  os.chmod(tmp,0o600)
  os.replace(tmp,PRIVATE_FALLBACK)
 out={"storage_policy":"local_microSD","phone_recordings":sorted(rows,key=lambda r:r["timestamp"]),
      "total_phone_files":len(rows),"archived_total":len(rows),"errors":problems}
 dest=ROOT/"s9-phone-events.json"
 part=dest.with_suffix(".json.tmp");part.write_text(json.dumps(out,indent=2)+"\n");os.replace(part,dest)
 print("LOCAL_SD_INDEXED",len(rows),"errors",problems[:4])
if __name__=="__main__":main()
