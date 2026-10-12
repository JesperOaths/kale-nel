#!/usr/bin/env python3
"""Safety contract for S9+ historical 4K movement metadata backfill."""
from pathlib import Path
import importlib.util
import unittest

ROOT=Path(__file__).resolve().parent
CLASSIFIER=(ROOT/"src/nl/kalenel/s9security/ClipClassifier.java").read_text()
CAMERA=(ROOT/"src/nl/kalenel/s9security/CameraService.java").read_text()
CATALOG=ROOT.parent/"s9-person-ml-v1/local-sd-catalog.py"

class BackfillSafety(unittest.TestCase):
    def test_original_4k_identity_and_sidecar_only(self):
        method=CLASSIFIER.split("boolean backfillMovementEvidence(",1)[1].split(
            "public synchronized JSONObject process(",1)[0]
        for required in (
            'name.matches("motion_[0-9]{13}[.]mp4")',
            'manifest.optInt("width",0)!=3840',
            'manifest.optInt("height",0)!=2160',
            'originalDigest.equalsIgnoreCase(digest(video))',
            'MediaMetadataRetriever.OPTION_CLOSEST_SYNC',
            'new AnonymousClipTracks()',
            'anonymousTracksJson(tracks)',
            '"movement_backfill_source","original_4k_microSD"',
            '"movement_backfill_identity","not_attempted"',
            'writeJson(new File(folder,name+".verified.json"),manifest)',
        ):
            self.assertIn(required,method)
        for forbidden in ('.delete(', 'faceReview.publish(', 'outfit.publish(',
                          'new FileOutputStream(video)', 'video.renameTo('):
            self.assertNotIn(forbidden,method)
        self.assertIn('if(decoded<3)',method)
        self.assertIn('manifest.optLong("bytes",-1)!=video.length()',method)

    def test_idle_reviewer_not_capture(self):
        method=CAMERA.split("private void maybeMovementBackfill()",1)[1].split(
            "private void maybeGardenArchiveTriage()",1)[0]
        for token in ('movementBackfillQueued', 'temperature()>=335',
                      'SystemClock.elapsedRealtime()-lastMovementAt<60000L',
                      'folder.getUsableSpace()<20L*1024*1024*1024',
                      'new File(target,name)', 'movementBackfillRetries',
                      'classifier.backfillMovementEvidence',
                      'return; // one candidate per guarded phone-local pass'):
            self.assertIn(token,method)
        self.assertNotIn('startRecording(',method)
        self.assertNotIn('stopRecording(',method)
        self.assertLess(CAMERA.index('  maybeMovementBackfill();'),
                        CAMERA.index('  maybeHistoricalImport();'))
        self.assertIn('d.put("movement_4k_backfill_completed"',CAMERA)
        self.assertIn('d.put("movement_4k_backfill_errors"',CAMERA)

    def test_strict_catalog_receives_measured_direction_not_gait(self):
        spec=importlib.util.spec_from_file_location("sd_catalog",CATALOG)
        catalog=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(catalog)
        manifest={
            "anonymous_tracking_version":"sampled_box_tracklets_v1",
            "anonymous_track_scope":"this_recording_only",
            "duration_ms":10000,
            "anonymous_track_count":1,
            "anonymous_tracks":[{
                "id":"Person 1","temporary_track_id":1,
                "first_sample_ms":100,"last_sample_ms":8100,
                "sample_count":6,"peak_detection_score":.84,
                "upper_clothing_colour":"blue",
                "image_movement_direction":"image_left",
                "body_posture_status":"not_measured_no_pose_keypoints",
                "gait_cadence_status":"not_measurable_from_sampled_frames",
                "cross_recording_identity":"not_attempted"
            }]
        }
        result=catalog.anonymous_clip_metadata(manifest)
        self.assertEqual(result["anonymous_tracking_status"],"sampled_tracks_available")
        self.assertEqual(result["anonymous_tracks"][0]["image_movement_direction"],"image_left")
        self.assertEqual(result["anonymous_tracks"][0]["gait_cadence_status"],
                         "not_measurable_from_sampled_frames")
        manifest["anonymous_tracks"][0]["cross_recording_identity"]="confirmed"
        self.assertEqual(catalog.anonymous_clip_metadata(manifest)["anonymous_tracking_status"],
                         "invalid_tracking_manifest")

if __name__=="__main__":
    unittest.main()
