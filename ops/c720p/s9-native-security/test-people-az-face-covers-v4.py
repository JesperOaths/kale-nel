"""Existing human-reviewed face crops, not garment approximations, drive People A-Z cover cards."""
from pathlib import Path
import unittest
class FaceCoverSource(unittest.TestCase):
    def test_profile_cards_face_first(self):
        s=(Path(__file__).parent/'security-people-v327.js').read_text()
        a=s.index('function profileRow(f){')
        b=s.index('function groupRows(host){',a)
        region=s[a:b]
        self.assertIn('chosenPortrait(f)',region)
        self.assertIn('automaticPortrait(f)',region)
        self.assertIn('representativeReviewedImage(f)',region)
        self.assertNotIn('AppearanceEvidenceV2?.folderPreview(f.id)',region)
        self.assertIn("mediaForFace(auto)",region)
    def test_existing_crop_sources_are_authenticated(self):
        s=(Path(__file__).parent/'security-people-v327.js').read_text()
        self.assertIn("'/new/saved/face/'",s)
        self.assertIn("face.snapshot_on_s9!==false",s)
        self.assertIn('folderApprovedSDClips',s)
if __name__=='__main__':unittest.main()
