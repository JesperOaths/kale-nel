#!/usr/bin/env python3
"""S9 V5 regression: motion re-arms phone-side detection but never starts 4K alone."""
from pathlib import Path
import re,unittest
ROOT=Path(__file__).resolve().parent
S=(ROOT/"src/nl/kalenel/s9security/CameraService.java").read_text()
M=(ROOT/"src/nl/kalenel/s9security/ClipClassifier.java").read_text()
class FollowupTests(unittest.TestCase):
 def test_bounded_motion_followup(self):
  self.assertIn("GARDEN_PERSON_CANDIDATE_MS=4500L",S)
  cb=S.split("boolean change=motion.analyze(frame);",1)[1].split('}catch(Throwable error)',1)[0]
  self.assertIn("gardenPersonCandidateUntil=lastFrameAt+GARDEN_PERSON_CANDIDATE_MS",cb)
  self.assertIn('!"watching".equals(mode)',S)
  self.assertIn('if(!pilotOnly&&"watching".equals(mode)&&gardenGateReady&&',cb)
  self.assertIn("lastFrameAt>=cameraControlSettleUntil&&lastFrameAt<gardenPersonCandidateUntil",cb)
  self.assertIn("evaluateGardenPersonAsync();",cb)
  self.assertNotIn("startRecording();",cb.split("if(change &&",1)[1])
 def test_gpu_gate_is_rate_limited_and_resists_reused_frames(self):
  body=S.split("private void evaluateGardenPersonAsync(){",1)[1].split("private boolean rateAllowed",1)[0]
  for required in ("now-gardenPersonGateLastAt<900","gardenPersonGateBusy","gardenGateExecutor.execute",
    "gardenGateClassifier.personEvidenceInGarden","gardenGateClassifier.lastPersonScoreAnywhere",
    "personTrackGate.offer(now,jpegAt,score,personBox,localCells)",
    "personTrackGate","gardenPersonCandidateUntil=0",
    "temperature()<415","folder.getUsableSpace()>15L*1024*1024*1024"):
   self.assertIn(required,body)
  self.assertLess(body.index("GardenPersonTrackGate.Decision.CONFIRMED"),body.index("startRecording()"))
 def test_roi_diagnostics_do_not_add_inference(self):
  body=M.split("public synchronized float personScoreInGarden",1)[1].split("private static String upperClothingColour",1)[0]
  self.assertEqual(body.count("for(Detection detection:detect(bitmap))"),1)
  self.assertIn("lastPersonAnywhere=any",body)
  self.assertIn("highest=detection.score;bestBox=b;",body)
  self.assertIn('d.put("garden_person_gate_last_anywhere_score",gardenPersonGateAnyScore)',S)
  self.assertIn('d.put("garden_person_followup_version","motion_armed_4500ms_unique_jpeg_v5")',S)
 def test_existing_safety(self):
  for forbidden in ("cloud_upload\",true","setVideoSize(1920","setVideoFrameRate(15)"):
   self.assertNotIn(forbidden,S)
  for required in ('recorder.setVideoSize(3840,2160)','recorder.setVideoFrameRate(30)',
                   'GardenPersonTrackGate.VERSION','if(score<GardenPersonTrackGate.MIN_SCORE)',
                   'garden_person_gate_required_positive_frames",2','garden_zone'):
   self.assertIn(required,S)
if __name__=="__main__":unittest.main(verbosity=2)
