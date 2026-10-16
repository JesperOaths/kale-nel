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
print("S9_TRACKS_V25_AGGREGATE_AUDIT "+json.dumps(report,sort_keys=True),flush=True)
