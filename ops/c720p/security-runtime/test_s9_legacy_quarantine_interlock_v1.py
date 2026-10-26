#!/usr/bin/env python3
"""Static fail-closed tests for legacy sampled-negative quarantine source."""
from pathlib import Path
import unittest

JAVA=Path(__file__).parents[1]/"s9-native-security/src/nl/kalenel/s9security/GardenArchiveTriage.java"

class LegacyTriageSafety(unittest.TestCase):
    def test_legacy_20_frame_negative_does_not_enable_move(self):
        code=JAVA.read_text()
        self.assertIn('hasTrustedFullVideoEmptyAttestation(movie,verified,evidence)',code)
        self.assertIn('return false;',code.split('private boolean hasTrustedFullVideoEmptyAttestation(',1)[1].split('}',1)[0])
        target=code.index('File target=new File(quarantine,name)')
        interlock=code.index('if(!hasTrustedFullVideoEmptyAttestation(movie,verified,evidence))continue')
        move=code.index('if(!movie.renameTo(target))')
        self.assertLess(interlock,target)
        self.assertLess(target,move)

    def test_no_model_only_denylist_bypass(self):
        code=JAVA.read_text()
        self.assertIn('candidate_model_only',code)
        self.assertIn('no_garden_person_evidence',code)
        self.assertIn('quarantined_model_negative_not_deleted',code)
        self.assertIn('return false;',code.split('private boolean hasTrustedFullVideoEmptyAttestation(',1)[1].split('}',1)[0])

if __name__=="__main__":
    unittest.main(verbosity=2)
