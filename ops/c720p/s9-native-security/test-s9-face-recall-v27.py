#!/usr/bin/env python3
"""V27 static/source and strict proxy-data regressions (no device access)."""
from pathlib import Path
import importlib.util
root=Path(__file__).resolve().parent
src=root/"src/nl/kalenel/s9security"
face=(src/"S9FaceReview.java").read_text()
classification=(src/"ClipClassifier.java").read_text()
service=(src/"CameraService.java").read_text()
catalog=root.parent/"s9-person-ml-v1/local-sd-catalog.py"
ui=(root/"security-face-folders-v22.html").read_text()
build=(root/"build-s9-face-recall-v27.py").read_text()
install=(root/"deploy-s9-face-recall-v27.py").read_text()
assert 'DEEP_FACE_ROI_VERSION="s9_onphone_36_samples_person_or_tile_v4"' in classification
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
assert "temperature()>=FACE_BACKFILL_MAX_TEMP_TENTHS_C" in scope
assert "FACE_BACKFILL_MAX_TEMP_TENTHS_C=390" in service
assert "gardenPersonGateBusy" in scope
assert '"watching".equals(mode)' in scope
assert "now-lastMovementAt<45000L" in scope
assert 'folder.getUsableSpace()<20L*1024*1024*1024' in scope
assert "faceBackfillRetries" in scope
assert "high_resolution_isolated_person_head_roi_v2" in face
assert 'if(f.confidence()<.49f)' in face
assert 'if(f.eyesDistance()<7)' in face
assert 'rejectedLowConfidence++' in face and 'rejectedSmallFace++' in face
assert 'manualRescueCandidates++' in face
assert 'if(reliableForEmbedding)' in face
assert "void sampleSceneTile(Bitmap frame,long ms,boolean right)" in face
assert 'face_shadow_review_version' in face
assert 'shadowEmbeddingTrials==0' in face
assert 'shadow=null' in face
assert 'JSONObject match=assign(emb)' in face
assert 'face_shadow_embeddings_persisted' in face
assert "face_crop_requires_manual_review" in face
assert "reliableForEmbedding" in face
assert "if(reliableForEmbedding)" in face
assert 'face_review_identity_claim","similarity_suggestion_not_verified_identity"' in face
assert 'face_embedding_on_s9_only",true' in face
assert "s9-face-recall-v27" in build and "saved_current_camera_apk_not_identical_to_installed" in build
assert 'STAGE=Path("/dev/shm/s9-face-recall-v27")/REF[:12]' in build
assert 'TARGET=STAGE' in build
assert 'BASE=STAGE/"installed-before-v27.apk"' in build
assert 'hub_disk_below_210MiB_refuse_ram_stage_build' in build
assert 'ram_stage_below_110MiB_refuse_build' in build
assert 'RELEASE=STAGE/"release.json"' in install
assert 'baseline=STAGE/"installed-before-v27.apk"' in install
assert 'BACK="/storage/9C33-6BBD/c720p-offloaded-build-evidence-20261014/v27-exact-rollback"' in install
assert 'rollback_microSD_staged_checksum_mismatch' in install
assert 'rollback_microSD_final_checksum_mismatch' in install
assert 'rollback_checksum_changed' in install
assert 'insufficient_hub_disk_210MiB_reserve' in install
assert install.index('rollback_microSD_final_checksum_mismatch') < install.index('changed=True')
assert install.index('insufficient_free_disk_after_microSD_rollback') < install.index('changed=True')
assert 'adb("install","-r","-g",str(baseline)' in install
assert 'shutil.copy2(baseline' not in install
assert '"AppearanceSearchIndex","Boot"' in build
assert '"AppearanceSearchIndex" in JAVAS' in build
assert "models_native_and_manifest_preserved" in build and "APK_SIGNER_CHANGED" in build
assert '"s9_onphone_36_samples_person_or_tile_v4", "face_evidence_outcome"' in build
assert '"s9_onphone_36_samples_person_roi_v2", "face_evidence_outcome"' not in build

assert 'S9_FACE_RECALL_V27_ROLLBACK_VERIFIED' in install
assert 'originals.issubset(nowclips)' in install
assert 'S9_FACE_RECALL_V27_DEVICE_VERIFIED' in install
assert 'face_rejected_low_confidence' in catalog.read_text()
assert 'face_rejected_small_face' in catalog.read_text()
assert 'face_manual_review_rescue_candidates' in catalog.read_text()
assert "Face images · manual review" in ui
assert "facePipelineStatus" in ui and "comparisonCandidate(face)" in ui
assert "unverifiedCrops" in ui and "C720PSecureRelay" in ui
spec=importlib.util.spec_from_file_location("catalog",catalog)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
m={"face_review_version":"s9_face_review_v1",
   "face_review_status":"no_frontal_face_in_samples",
   "face_review_sampled_frames":42,
   "face_deep_review_version":"s9_onphone_36_samples_person_or_tile_v4",
   "face_deep_tiled_scene_samples":8,
   "face_deep_second_person_roi_samples":6,
   "face_rejected_low_confidence":2,
   "face_rejected_small_face":1,
   "face_manual_review_rescue_candidates":3,
   "face_candidates":[]}
res=module.safe_face_review_metadata(m)
assert res["face_deep_review_version"]==m["face_deep_review_version"]
assert res["face_deep_tiled_scene_samples"]==8
assert res["face_deep_second_person_roi_samples"]==6
assert res["face_rejected_low_confidence"]==2
assert res["face_rejected_small_face"]==1
assert res["face_manual_review_rescue_candidates"]==3
shadow={"face_review_version":"s9_face_review_v1",
        "face_review_status":"review_complete_unverified_matches",
        "face_shadow_review_version":"s9_shadow_model_probe_v1",
        "face_shadow_embedding_trials":1,
        "face_shadow_embedding_successful":1,
        "face_shadow_embedding_failed":0,
        "face_shadow_matches_created":0,
        "face_shadow_embeddings_persisted":False,
        "face_candidates":[{"match_status":"not_comparable_manual_review",
                            "time_ms":1000}]}
out=module.safe_face_review_metadata(shadow)
assert out["face_shadow_embedding_trials"]==1
assert out["face_shadow_embedding_successful"]==1
assert out["face_shadow_matches_created"]==0
assert out["face_shadow_embeddings_persisted"] is False
assert out["face_candidates"][0]["match_status"]=="not_comparable_manual_review"
assert "embedding" not in out["face_candidates"][0]
assert "face_embedding" not in res
assert module.safe_face_review_metadata({})["face_review_status"]=="not_available_in_original_review"
assert "CaptureResult.LENS_APERTURE" in service
assert "sensor_lens_aperture_result_available" in service
assert "LENS_INFO_AVAILABLE_APERTURES" in service
assert "passive_optical_aperture_capture_not_in_dex" in build
assert "s9_night_optical_telemetry_not_installed" in install
print("S9_PEOPLE_FACE_RECALL_V27_TESTS_PASS")
