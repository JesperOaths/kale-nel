#!/usr/bin/env python3
"""V26 static/source and strict proxy-data regressions (no device access)."""
from pathlib import Path
import importlib.util
root=Path(__file__).resolve().parent
src=root/"src/nl/kalenel/s9security"
face=(src/"S9FaceReview.java").read_text()
classification=(src/"ClipClassifier.java").read_text()
service=(src/"CameraService.java").read_text()
catalog=root.parent/"s9-person-ml-v1/local-sd-catalog.py"
ui=(root/"security-face-folders-v22.html").read_text()
build=(root/"build-s9-face-recall-v26.py").read_text()
install=(root/"deploy-s9-face-recall-v26.py").read_text()
assert ('DEEP_FACE_ROI_VERSION="s9_onphone_36_samples_person_or_tile_v3"' in classification or
        'DEEP_FACE_ROI_VERSION="s9_onphone_36_samples_person_or_tile_v4"' in classification)
scope=classification.split('static boolean deepFaceNeedsUpgrade(',1)[1].split("public synchronized boolean deepFaceReview",1)[0]
assert 'person_count' not in scope
assert 'face_snapshots_saved' in scope
assert 'return !DEEP_FACE_ROI_VERSION.equals' in scope
deep=classification.split("public synchronized boolean deepFaceReview(",1)[1].split("backfillMovementEvidence",1)[0]
assert "face_deep_tiled_scene_samples" in deep
assert "face_deep_second_person_roi_samples" in deep
assert "faces.sampleSceneTile" in deep
assert "people.get(1)" in deep
assert "Long.parseLong(name.substring(7,20))>=1791687597000L" not in deep
assert 'fingerprint.equalsIgnoreCase(digest(mp4))' in deep
assert 'writeJson(new File(folder,name+".verified.json"),manifest)' in deep
scope=service.split("private void maybeFaceBackfill(){",1)[1].split("Offloaded archived-video retention review",1)[0]
assert 'if(meta.optInt("person_count",0)<=0)continue;' not in scope
assert "faceBackfillQueued" in scope
assert "temperature()>=370" in scope
assert "gardenPersonGateBusy" in scope
assert '"watching".equals(mode)' in scope
assert "now-lastMovementAt<45000L" in scope
assert 'folder.getUsableSpace()<20L*1024*1024*1024' in scope
assert "faceBackfillRetries" in scope
assert "high_resolution_isolated_person_head_roi_v2" in face
assert "void sampleSceneTile(Bitmap frame,long ms,boolean right)" in face
assert "face_crop_requires_manual_review" in face
assert "reliableForEmbedding" in face
assert "if(reliableForEmbedding)" in face
assert 'face_review_identity_claim","similarity_suggestion_not_verified_identity"' in face
assert 'face_embedding_on_s9_only",true' in face
assert "s9-face-recall-v26" in build and "saved_current_camera_apk_not_identical_to_installed" in build
assert '"AppearanceSearchIndex","Boot"' in build
assert '"AppearanceSearchIndex" in JAVAS' in build
assert "models_native_and_manifest_preserved" in build and "APK_SIGNER_CHANGED" in build
assert '"s9_onphone_36_samples_person_or_tile_v3", "face_evidence_outcome"' in build
assert '"s9_onphone_36_samples_person_roi_v2", "face_evidence_outcome"' not in build

assert 'S9_FACE_RECALL_V26_ROLLBACK_VERIFIED' in install
assert 'originals.issubset(nowclips)' in install
assert 'S9_FACE_RECALL_V26_DEVICE_VERIFIED' in install
assert "Face images · review needed" in ui
assert "unverifiedCrops" in ui and "C720PSecureRelay" in ui
spec=importlib.util.spec_from_file_location("catalog",catalog)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
m={"face_review_version":"s9_face_review_v1",
   "face_review_status":"no_frontal_face_in_samples",
   "face_review_sampled_frames":42,
   "face_deep_review_version":"s9_onphone_36_samples_person_or_tile_v3",
   "face_deep_tiled_scene_samples":8,
   "face_deep_second_person_roi_samples":6,
   "face_candidates":[]}
res=module.safe_face_review_metadata(m)
assert res["face_deep_review_version"]==m["face_deep_review_version"]
assert res["face_deep_tiled_scene_samples"]==8
assert res["face_deep_second_person_roi_samples"]==6
assert "face_embedding" not in res
assert module.safe_face_review_metadata({})["face_review_status"]=="not_available_in_original_review"
print("S9_PEOPLE_FACE_RECALL_V26_TESTS_PASS")
