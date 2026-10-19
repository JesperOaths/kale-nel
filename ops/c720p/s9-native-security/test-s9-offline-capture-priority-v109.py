#!/usr/bin/env python3
"""Source-only safety contract: optional ML must yield to Camera2 cooling."""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parent
SERVICE=ROOT/"src/nl/kalenel/s9security/CameraService.java"
SOURCE=SERVICE.read_text()

def body(start,stop):
    i=SOURCE.index(start)
    j=SOURCE.index(stop,i+len(start))
    return SOURCE[i:j]

class Safety(unittest.TestCase):
    def test_single_rearm_gate_protects_verified_4k_production(self):
        method=body(" private boolean offlineArchiveWorkAllowed(){",
                    " private void maybeMovementBackfill(){")
        for token in (
            "temperature()",
            "batteryTenths>=420",
            'getBoolean("continuous_4k_production_enabled",false)',
            "continuous4KTrial",
            "continuous4K!=null",
            "continuous4K.readyForEvent()",
            "batteryTenths<=OFFLINE_4K_HEADROOM_TENTHS_C",
        ):
            self.assertIn(token,method)
        self.assertIn("OFFLINE_4K_HEADROOM_TENTHS_C=395",SOURCE)
        self.assertIn('if(!getSharedPreferences("native",MODE_PRIVATE)',method)
        # The historical legacy path is not disabled for cameras that
        # never enabled continuous-4K production in the first place.
        self.assertIn("return true;",method)

    def test_all_optional_heavy_archival_workers_yield(self):
        windows={
          "movement":(" private void maybeMovementBackfill(){",
                      " /** At most one historic 4K appearance index"),
          "appearance":(" private void maybeAppearanceBackfill(){",
                       " // Never quarantine an existing person-negative"),
          "drive":(" private void maybeHistoricalImport(){",
                   " // Battery thermistor is tenths"),
        }
        for label,(start,end) in windows.items():
            with self.subTest(label=label):
                method=body(start,end)
                self.assertGreaterEqual(method.count("!offlineArchiveWorkAllowed()"),2)
                self.assertNotIn("temperature()>=420",method)
                # A separate active-recording check is retained.
                self.assertIn('"watching".equals(mode)',method)

    def test_face_backfill_already_defers_while_4k_missing(self):
        method=body(" private boolean faceBackfillThermallyAllowed(){",
                    " /** Scan finalized Security4K person recordings at idle")
        self.assertIn('getBoolean("continuous_4k_production_enabled",false)',method)
        self.assertIn("!continuous4KTrial||continuous4K==null",method)
        self.assertIn("!continuous4K.readyForEvent()",method)

    def test_realtime_detection_recording_rearm_and_originals_untouched(self):
        for invariant in (
           "private void startRecording(){",
           'if(temperature()>=420||folder.getUsableSpace()',
           "private void maybeRestoreCool4K(){",
           "continuous4KRecoveryAttempts>=3",
           "now<continuous4KRetryAfterMs||temperature()>=405",
           "gardenPersonCandidateUntil>now",
           "private void watchdog(){",
           "maybeRestoreCool4K();",
           "private static final boolean GARDEN_AUTO_QUARANTINE_ENABLED=false",
        ):
            self.assertIn(invariant,SOURCE)
        source=SERVICE.read_text()
        self.assertNotIn("pm install",source)
        self.assertNotIn("am force-stop",source)

if __name__=="__main__":
    unittest.main(verbosity=2)
