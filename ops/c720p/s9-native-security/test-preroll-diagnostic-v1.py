#!/usr/bin/env python3
"""Production-capture diagnostic contract: a probe must never impersonate motion."""
import re,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
S=(ROOT/"src/nl/kalenel/s9security/CameraService.java").read_text()
P=(ROOT/"src/nl/kalenel/s9security/GardenPreRoll.java").read_text()
class Diagnostic(unittest.TestCase):
 def test_explicit_one_shot(self):
  for x in ('"preroll_diagnostic".equals(key)','"record_once".equals(value)',
            'diagnosticPrerollUsed=true','diagnosticPrerollActive=true',
            'preRoll.cachedDurationMs()<4400','temperature()>=375',
            'folder.getUsableSpace()<15L*1024*1024*1024'):
   self.assertIn(x,S)
 def test_not_in_person_archive(self):
  a=S.index('if(diagnosticPrerollActive){\n    // No classification')
  b=S.index('completed++;lastClip=candidate.getName();',a)
  code=S[a:b]
  self.assertIn('eventChain.reset();',code)
  self.assertIn('preRoll.saveAsync(candidate,diagnosticFrozen)',code)
  self.assertIn('return;',code)
  self.assertNotIn('review(',code)
  self.assertNotIn('writeCaptureEvidenceAsync(',code)
  self.assertIn('diagnostic_preroll_',S)
 def test_bounded_recording_and_restore_preview(self):
  self.assertIn('stopRecording(diagnosticPrerollActive?"diagnostic_short":"pilot_short")',S)
  self.assertIn('},9000);',S)
  self.assertIn('cameraHandler.postDelayed(new Runnable(){public void run(){configurePreview();}},700)',S)
 def test_companion_muxed_and_separate_from_public_streaming(self):
  self.assertIn('(?:motion|diagnostic_preroll)_[0-9]{13}[.]mp4',P)
  self.assertIn('MediaMuxer',P)
  self.assertIn('new File(parent,name+".preroll.mp4")',P)
  r=(ROOT/"src/nl/kalenel/s9security/PhoneMediaRange.java").read_text()
  self.assertIn('motion_[0-9]{13}',r)
  self.assertNotIn('diagnostic_preroll',r)
if __name__=="__main__":unittest.main(verbosity=2)
