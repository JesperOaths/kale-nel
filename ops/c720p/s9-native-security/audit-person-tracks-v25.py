#!/usr/bin/env python3
"""Read-only aggregate audit of Tracks V25 evidence, no video/frame/IDs."""
import json,collections,urllib.request
from pathlib import Path
url="http://127.0.0.1:8795/new/api/saved"
with urllib.request.urlopen(url,timeout=18) as result:
 d=json.load(result)
if d.get("archive_mode")!="S9-microSD-only":raise RuntimeError("unexpected_archive")
clips=[x for x in d.get("events",[]) if str(x.get("clip_no","")).startswith("motion_")]
categories=collections.Counter()
reasons=collections.Counter()
for r in clips:
 c=str(r.get("scene_category") or "unknown")
 categories[c]+=1
 for x in r.get("person_track_review_reasons",[]):
  if isinstance(x,dict):reasons[str(x.get("reason"))]+=1
 for x in r.get("person_track_excluded_reasons",[]):
  if isinstance(x,dict):reasons[str(x.get("reason"))]+=1
def count(pred):return sum(1 for x in clips if pred(x))
report={"total_clips":len(clips),
        "classified_people_old":count(lambda x:int(x.get("person_count") or 0)>0),
        "old_track_rows":count(lambda x:len(x.get("anonymous_tracks") or [])>0),
        "new_person_track_rows":count(lambda x:int(x.get("person_track_count") or 0)>0),
        "new_person_track_total":sum(int(x.get("person_track_count") or 0) for x in clips),
        "review_rows":count(lambda x:int(x.get("person_track_review_count") or 0)>0),
        "excluded_rows":count(lambda x:int(x.get("rejected_object_track_count") or 0)>0),
        "no_v25_evidence":count(lambda x:x.get("person_track_evidence_version")!="corroborated_person_tracklets_v25"),
        "reasons":dict(reasons),
        "category_counts":dict(categories),
        "original_videos_deleted":False,
        "privacy":"metadata_aggregate_only"}
# Inspect only local catalog METADATA (never any MP4, image or person identity).
index=Path("/opt/homeassistant/config/www/frontyard-security-new/s9-phone-events.json")
if index.is_file():
 rows=json.loads(index.read_text()).get("phone_recordings",[])
 samples=collections.Counter();peaks=collections.Counter();spans=collections.Counter()
 excluded=collections.Counter();reviewed=collections.Counter()
 repeat=collections.Counter()
 for r in rows:
  for t in r.get("anonymous_tracks",[]):
   if not isinstance(t,dict):continue
   n=t.get("sample_count")
   if type(n) is int:
    samples[str(n) if n<5 else "5+"]+=1
   peak=t.get("peak_detection_score")
   if type(peak) in (int,float):
    peaks["<.70" if peak<.70 else ".70-.79" if peak<.80 else ".80-.89" if peak<.90 else ">=.90"]+=1
   a=t.get("first_sample_ms");b=t.get("last_sample_ms")
   if type(a) is int and type(b) is int:
    span=b-a
    spans["<.6s" if span<600 else ".6-1.5s" if span<1500 else ">=1.5s"]+=1
  for t in r.get("person_track_excluded_reasons",[]):
   if isinstance(t,dict):excluded[str(t.get("reason"))]+=1
  for t in r.get("person_track_review_reasons",[]):
   if isinstance(t,dict):reviewed[str(t.get("reason"))]+=1
  n=r.get("person_detected_frames_050")
  if type(n) is int:
   repeat["0" if n==0 else "1" if n==1 else "2" if n==2 else "3+"]+=1
 report["raw_track_sample_bins"]=dict(samples)
 report["raw_track_peak_bins"]=dict(peaks)
 report["raw_track_span_bins"]=dict(spans)
 report["catalog_rejection_reasons"]=dict(excluded)
 report["catalog_review_reasons"]=dict(reviewed)
 report["person_positive_frame_bins"]=dict(repeat)
print("S9_TRACKS_V25_AGGREGATE_AUDIT "+json.dumps(report,sort_keys=True),flush=True)
