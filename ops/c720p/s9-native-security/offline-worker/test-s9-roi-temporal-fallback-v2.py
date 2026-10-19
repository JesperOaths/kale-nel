#!/usr/bin/env python3
"""Contract: supplemental frames only when baseline frame sampler fails."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent
class Checks(unittest.TestCase):
 def test_same_model_thresholds_same_private_append_only_paths(self):
  old=(ROOT/"S9StandalonePersonRoi.java").read_text()
  revised=(ROOT/"S9StandalonePersonRoiTemporalV2.java").read_text()
  self.assertIn("double[][] groups={{.33,.66,.12},{.05,.22,.47,.79,.92}}",revised)
  self.assertIn("if(best!=null)break;",revised)
  self.assertIn("additional_frames_only_when_first_three_rejected",revised)
  for invariant in ("person_count", "S9_OFFLINE_SINGLE_PERSON_ROI_STAGED"):
   self.assertIn(invariant,revised) if invariant in old else None
  for threshold in ("scores[0][i]>=.45f","score<.56f",
                    "aspect<1.15f||aspect>5.0f",
                    "w<50||h<100", "MODEL_SHA", "LABEL_SHA",
                    "Files.createTempFile", "dest","Files.exists(dest)"):
   self.assertIn(threshold,old)
   self.assertIn(threshold,revised)
  self.assertIn('metadataJson.put("schema","s9_offline_single_person_roi_v1")',revised)
  self.assertNotIn("am force-stop",revised)
  self.assertNotIn("pm install",revised)

 def test_separate_dex_and_osnet_backfill(self):
  controller=(ROOT/"backfill-s9-original-roi-osnet-temporal-v2.py").read_text()
  setup=(ROOT/"install-s9-roi-temporal-fallback-v2.py").read_text()
  self.assertIn("s9-offline-person-roi-temporal-v2.jar",setup)
  self.assertIn("S9StandalonePersonRoiTemporalV2.java",setup)
  self.assertIn("S9StandalonePersonRoiTemporalV2 --extract",controller)
  self.assertIn("visual_embedding",controller)
  self.assertIn('abs(sum(x*x for x in vec)-1)>0.001',controller)
  self.assertIn("temperature:",controller)
  self.assertIn("camera_apk_modified",controller)
  self.assertNotIn("delete_original",controller)
if __name__=="__main__":unittest.main(verbosity=2)
