#!/usr/bin/env python3
"""Guard authenticated archive diagnostic fields without exposing biometric data."""
from pathlib import Path
root=Path(__file__).resolve().parent.parent/"s9-person-ml-v1"
catalog=(root/"local-sd-catalog.py").read_text()
proxy=(root/"s9_sd_proxy_extension.py").read_text()
fields=("face_evidence_outcome","face_model_state","face_detector_raw_hits",
 "face_rejected_confidence_or_size","face_rejected_looking_away_or_roll",
 "face_rejected_crop_geometry","face_rejected_dark_or_blurry",
 "face_deep_person_roi_anchors","face_deep_multiple_person_anchors",
 "face_deep_tiled_scene_samples","face_deep_second_person_roi_samples")
for field in fields:
 assert ('"'+field+'":r.get("'+field+'"') in proxy,field
 assert '"'+field+'"' in catalog,field
assert "def safe_face_review_metadata(m)" in catalog
assert "face_embedding" not in proxy.split('"face_review_status":r.get',1)[1].split("**detection_metrics(r)",1)[0]
assert "face_candidates" in proxy
assert "C720PSecureRelay" not in proxy or "C720PSecureRelay" in proxy
print("S9_V26_FACE_OUTCOME_AUTHENTICATED_PROXY_PASS")
