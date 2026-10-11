#!/usr/bin/env python3
"""Contract tests for event recording and thumbnail provenance; no device IO."""
from pathlib import Path
import importlib.util
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
PKG=HERE/"src/nl/kalenel/s9security"
def source(name):return (PKG/name).read_text()
class Contract(unittest.TestCase):
 def test_camera_records_original_4k_and_segments_by_reason(self):
  s=source("CameraService.java")
  self.assertIn('recorder.setVideoSize(3840,2160)',s)
  self.assertIn('recorder.setVideoFrameRate(30)',s)
  self.assertIn('recorder.setVideoEncodingBitRate(36000000)',s)
  self.assertIn('stopRecording("max_segment")',s)
  self.assertIn('stopRecording("quiet_end")',s)
  self.assertIn('eventChain.continuationReady(',s)
  self.assertIn('eventChain.started(lastStart,System.currentTimeMillis())',s)
  self.assertIn('eventChain.stopped(',s)
  self.assertIn('eventChain.evidence(lastFrameAt)',s)
  self.assertIn('recording_capture_evidence_write_failed',s)
  self.assertIn('capture_segments_have_unrecorded_transition_gaps',s)
  self.assertIn('capture_segment_gap_from_previous_ms',s)
  self.assertIn('final CaptureContinuity.Segment eventSegment',s)
  self.assertIn('new File(folder,f.getName()+".verified.json")',s)
  self.assertIn('writeCaptureEvidenceAsync(saved,eventSegment)',s)
  self.assertNotIn('System.exit(',s)
 def test_thumbnail_event_center_and_nonempty_evidence(self):
  s=source("ClipClassifier.java")
  for anchor in (
    'EventFrameRanker.rank(', 'sampleSharpnessGarden(bitmap)',
    'MediaMetadataRetriever.OPTION_CLOSEST', 'thumbnail_rank_version',
    'thumbnail_sharpness', 'thumbnail_candidate_frames',
    'thumbnail_nearest_frame_attempts', 'thumbnail_selection_human_verified',
    'thumbnail_source_time_ms', 'person_sample_timeline',
    'best.compress(Bitmap.CompressFormat.JPEG,92,o)',
    '.put("sha256",digest(mp4))'):
   self.assertIn(anchor,s)
  self.assertIn('writeJson(new File(folder,name+".verified.json"),result)',s)
  self.assertIn('if(best!=null)best.recycle()',s)
  self.assertIn('finally{if(near!=null)near.recycle();}',s)
 def test_source_bundle_and_signing_stays_pinned(self):
  fetch=(HERE/"fetch-source.sh").read_text()
  self.assertEqual(fetch.count('CaptureContinuity EventFrameRanker'),2)
  for f in ("compile-only.sh","package-only.sh"):
   s=(HERE/f).read_text()
   for cls in ("CaptureContinuity","EventFrameRanker"):
    self.assertIn(cls+".class",s)
  stage=(HERE/"stage-verified-deployment.py").read_text()
  self.assertIn('"CaptureContinuity.java"',stage)
  self.assertIn('"EventFrameRanker.java"',stage)
  self.assertIn('signed_apk_and_compiled_source_versions_differ',stage)
 def test_private_catalog_whitelists_values(self):
  f=HERE.parent/"s9-person-ml-v1/local-sd-catalog.py"
  spec=importlib.util.spec_from_file_location("s9local",f)
  m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  name="motion_1791692000000.mp4"
  d={"capture_event_version":"s9_logical_event_segments_v1",
     "capture_event_id":"garden_1791691900000",
     "capture_segment_index":2,
     "capture_previous_segment":"motion_1791691900000.mp4",
     "capture_segment_transition":"max_duration_continuation",
     "capture_segment_gap_from_previous_ms":1490,
     "thumbnail_rank_version":"s9_event_frame_rank_v1",
     "thumbnail_sharpness":49.382}
  safe=m.safe_capture_event_metadata(d,name)
  self.assertEqual(safe["capture_segment_gap_ms"],1490)
  self.assertEqual(safe["thumbnail_sharpness"],49.38)
  self.assertTrue(safe["capture_has_physical_transition_gaps"])
  self.assertNotIn("anonymous_tracks",safe)
  broken={**d,"capture_previous_segment":"../../somewhere"}
  self.assertEqual(m.safe_capture_event_metadata(broken,name)["capture_evidence_status"],"invalid_event_link")
  broken={**d,"capture_event_id":"user-person-identity"}
  self.assertEqual(m.safe_capture_event_metadata(broken,name)["capture_evidence_status"],"invalid_event_metadata")
  broken={**d,"thumbnail_sharpness":float("nan")}
  self.assertIsNone(m.safe_capture_event_metadata(broken,name)["thumbnail_sharpness"])
if __name__=="__main__":unittest.main(verbosity=2)
