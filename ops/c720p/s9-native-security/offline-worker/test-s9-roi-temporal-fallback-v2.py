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
  self.assertIn('abs(sum(x*x for x in vec)-1)<=0.001',controller)
  self.assertIn('temperatures.append(assert_camera_safe(camera))',controller)
  self.assertIn('sha=detector_provenance(clip,key,metadata)',controller)
  self.assertIn("temperature:",controller)
  self.assertIn("camera_apk_modified",controller)
  self.assertNotIn("delete_original",controller)

 def test_existing_vectors_fail_closed_on_bad_provenance(self):
  import importlib.util, math
  path=ROOT/"backfill-s9-original-roi-osnet-temporal-v2.py"
  spec=importlib.util.spec_from_file_location("s9_temporal_checked_controller",path)
  module=importlib.util.module_from_spec(spec)
  spec.loader.exec_module(module)
  key="a"*64
  doc={"schema":"s9_offline_appearance_embedding_v1",
       "source_qualified_key":key,"crop_sha256":"b"*64,
       "model_sha256":module.OSNET_SHA,"model_type":"visual",
       "appearance_only":True,"human_review_required":True,
       "verified_same_person":False,"visual_embedding":[1.0]+[0.0]*511}
  self.assertTrue(module.valid_visual(doc,key,"b"*64))
  for field,value in (("crop_sha256","c"*64),("model_type","structural"),
                      ("verified_same_person",True),("human_review_required",False)):
   corrupt=dict(doc);corrupt[field]=value
   self.assertFalse(module.valid_visual(corrupt,key,"b"*64),field)
  for broken in (float("nan"),float("inf"),True,2.0):
   corrupt=dict(doc);vector=list(doc["visual_embedding"]);vector[0]=broken
   corrupt["visual_embedding"]=vector
   self.assertFalse(module.valid_visual(corrupt,key,"b"*64))
  corrupt=dict(doc);corrupt["visual_embedding"]=[0.0]*512
  self.assertFalse(module.valid_visual(corrupt,key,"b"*64))


 def test_camera_pid_and_temperature_are_checked_per_clip(self):
  import importlib.util
  from types import SimpleNamespace
  from unittest.mock import patch
  path=ROOT/"backfill-s9-original-roi-osnet-temporal-v2.py"
  spec=importlib.util.spec_from_file_location("s9_temporal_pid_guard",path)
  module=importlib.util.module_from_spec(spec)
  spec.loader.exec_module(module)
  def responses(pid="1234",temp=419):
   def fake_adb(*args,**kwargs):
    if args[1].startswith("pidof"):return SimpleNamespace(stdout=pid)
    if args[1]=="dumpsys battery":
     return SimpleNamespace(stdout="battery status\\ntemperature: "+str(temp))
    raise AssertionError("Unexpected request: "+str(args))
   return fake_adb
  with patch.object(module,"adb",side_effect=responses()):
   self.assertEqual(module.assert_camera_safe("1234"),41.9)
  with patch.object(module,"adb",side_effect=responses(temp=421)):
   with self.assertRaisesRegex(RuntimeError,"above 42"):
    module.assert_camera_safe("1234")
  with patch.object(module,"adb",side_effect=responses(pid="5678")):
   with self.assertRaisesRegex(RuntimeError,"process changed"):
    module.assert_camera_safe("1234")


 def test_zero_detection_archive_recovery_only_and_group_safety(self):
  import importlib.util
  path=ROOT/"backfill-s9-original-roi-osnet-temporal-v2.py"
  spec=importlib.util.spec_from_file_location("s9_temporal_archive_selector",path)
  m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  events={
   "motion_1700000000000.mp4":{"person_count":0},
   "motion_1700000001000.mp4":{"person_count":1},
   "motion_1700000002000.mp4":{"person_count":2},
   "motion_1700000003000.mp4":{"person_count":0,
                                "frames_with_distinct_multiple_person_boxes":1},
   "motion_1700000004000.mp4":{},
   "motion_1700000005000.mp4":{"person_count":True},
   "motion_1700000006000.mp4":{"person_count":-1}}
  approved={"motion_1700000000000.mp4"}
  self.assertEqual([x[1] for x in m.candidates(events,approved,"person")],
                   ["motion_1700000001000.mp4"])
  self.assertEqual([x[1] for x in m.candidates(events,approved,"approved")],
                   ["motion_1700000000000.mp4"])
  self.assertEqual([x[1] for x in m.candidates(events,approved,"archive")],
                   ["motion_1700000000000.mp4","motion_1700000001000.mp4",
                    "motion_1700000004000.mp4"])
  self.assertEqual(m.candidates(events,approved,"all"),
                   m.candidates(events,approved,"archive"))
  self.assertFalse(m.eligible_archive_clip({"person_count":1,
      "frames_with_distinct_multiple_person_boxes":2},"all",False))

if __name__=="__main__":unittest.main(verbosity=2)
