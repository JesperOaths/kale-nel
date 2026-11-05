#!/usr/bin/env python3
"""Contract checks: seven-second 4K prefix and auditable 10s tail.
Source change only; live APK must be upgraded separately after a cool capture window.
"""
from pathlib import Path
import re
import unittest
HERE=Path(__file__).resolve().parents[1]
JAVA=HERE/"src/nl/kalenel/s9security"
RING=(JAVA/"Encoded4KRing.java").read_text()
CAPTURE=(JAVA/"CameraService.java").read_text()
class Contracts(unittest.TestCase):
 def test_mature_buffer_targets_seven_full_seconds(self):
  for expr in ("HISTORY_US=9000000L","TARGET_US=7000000L",
               "MAX_FRAMES=300","MAX_BYTES=48*1024*1024"):
   self.assertIn(expr,RING)
  self.assertIn("long cutoff=latest-TARGET_US;",RING)
  self.assertIn("a.get(i).ptsUs<=cutoff",RING)
  self.assertIn("if(a.get(i).key)",RING)
 def test_early_ring_preserves_evidence(self):
  self.assertIn("MIN_VALID_US=4400000L",RING)
  self.assertIn("if(chosen<0)",RING)
  self.assertIn("return duration>=MIN_VALID_US?new Frozen(selected):null;",RING)
 def test_10sec_quiet_end_logic_remains(self):
  self.assertIn("QUIET_MS=10000",CAPTURE)
  self.assertIn('lastFrameAt-lastMovementAt>QUIET_MS)stopRecording("quiet_end")',CAPTURE)
  # A car-only frame may vote motion but must never refresh the tail
  # or arm a max-duration continuation without person corroboration.
  raw=CAPTURE[CAPTURE.index('if(change && lastFrameAt>=cameraControlSettleUntil)'):
              CAPTURE.index('if("recording".equals(mode)&&lastFrameAt-lastStart>2500)')]
  self.assertNotIn('lastMovementAt=lastFrameAt;',raw)
  self.assertNotIn('eventChain.evidence(',raw)
  self.assertIn('boolean recordingCheck=recording&&temperature()<420&&',raw)
  confirmed=CAPTURE[CAPTURE.index('private void evaluateGardenPersonAsync('):
                    CAPTURE.index('private boolean rateAllowed(')]
  self.assertIn('if("recording".equals(mode)){',confirmed)
  self.assertIn('personTrackGate.offer(now,jpegAt,score,personBox,localCells)',confirmed)
  self.assertIn('lastMovementAt=SystemClock.elapsedRealtime();',confirmed)
  self.assertIn('eventChain.evidence(lastMovementAt);',confirmed)
  self.assertIn('gardenPersonTailVerifiedRefreshes++;',confirmed)
 def test_saved_evidence_surfaces_actual_age(self):
  self.assertIn('evidence.put("last_accepted_motion_age_at_stop_ms",',CAPTURE)
  self.assertIn('j.put("capture_segment_last_accepted_motion_age_at_stop_ms",',CAPTURE)
  self.assertEqual(CAPTURE.count("segment.lastEvidenceAgeMs==Long.MAX_VALUE?JSONObject.NULL:segment.lastEvidenceAgeMs"),2)
  self.assertIn('evidence.put("configured_quiet_hold_ms",QUIET_MS);',CAPTURE)
  self.assertIn('j.put("capture_segment_configured_quiet_hold_ms",QUIET_MS);',CAPTURE)
 def test_no_removal_of_failure_and_rollback_controls(self):
  for expr in ("restoreLegacy4K(","trial_health_guard","continuous_4k_dropped_output_frames",
               "watchdog_cap","diagnosticPrerollActive"):
   self.assertIn(expr,CAPTURE)
if __name__=="__main__":unittest.main(verbosity=2)
