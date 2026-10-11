#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
here=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("gate",here/"stage4-cutover-decision.py")
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
def gold():
 rows=[]
 for lighting in ("day","night"):
  for positive in (True,False):
   for i in range(20):
    # Existing detector misses half the people; candidate captures all.
    rows.append({"window_id":f"{lighting}-{positive}-{i}",
      "lighting":lighting,"person_present":"yes" if positive else "no",
      "baseline_alarm":"yes" if positive and i%2==0 else "no",
      "candidate_alarm":"yes" if positive else "no",
      "human_reviewed":"yes","capture_source":"continuous"})
 return rows
def health():
 return {"baseline_p90_ms":189,"candidate_p90_ms":196,
  "temperature_baseline_c":34.0,"temperature_candidate_c":34.8,
  "soak_days":0,"shadow_soak_no_camera_incidents":False,
  "4k_resolution_verified":True,"native_camera_healthy":True,
  "rollback_apk_verified":True,"playback_test_passed":True,
  "sd_storage_safe":True,"no_capture_loss":True}
class Gate(unittest.TestCase):
 def test_missing_labels_never_authorizes(self):
  result=mod.evaluate([],health())
  self.assertEqual(result["decision"],"HOLD_EXISTING_DETECTOR")
  self.assertFalse(result["old_detector_retirement_authorized"])
 def test_qualified_better_model_can_only_enter_guarded_rollout(self):
  result=mod.evaluate(gold(),health())
  self.assertTrue(result["eligible_for_guarded_shadow_cutover"])
  self.assertFalse(result["old_detector_retirement_authorized"])
  self.assertFalse(result["production_change_performed"])
  self.assertLess(result["paired_exact_two_sided_p"],.05)
 def test_soak_still_required_for_retirement(self):
  h=health();h["soak_days"]=7;h["shadow_soak_no_camera_incidents"]=True
  self.assertTrue(mod.evaluate(gold(),h)["old_detector_retirement_authorized"])
  h["no_capture_loss"]=False
  self.assertFalse(mod.evaluate(gold(),h)["old_detector_retirement_authorized"])
 def test_prior_cpu_result_blocks_cutover(self):
  h=health();h["candidate_p90_ms"]=233
  d=mod.evaluate(gold(),h)
  self.assertFalse(d["eligible_for_guarded_shadow_cutover"])
  self.assertIn("candidate_p90_latency_regression_above_10_percent",d["blockers"])
 def test_model_only_mp4_labels_rejected(self):
  rows=gold();rows[0]["capture_source"]="recorded_only"
  with self.assertRaisesRegex(ValueError,"selection_biased"):
   mod.evaluate(rows,health())
  rows=gold();rows[0]["human_reviewed"]="no"
  with self.assertRaisesRegex(ValueError,"independent"):
   mod.evaluate(rows,health())
 def test_false_positive_and_night_misses_block(self):
  rows=gold();rows[-1]["candidate_alarm"]="yes"
  d=mod.evaluate(rows,health())
  self.assertFalse(d["eligible_for_guarded_shadow_cutover"])
  self.assertIn("candidate_false_alarms_increase_night",d["blockers"])
  rows=gold()
  for r in rows:
   if r["lighting"]=="night" and r["person_present"]=="yes" and int(r["window_id"].rsplit("-",1)[1])<=10:
    r["candidate_alarm"]="no"
  self.assertFalse(mod.evaluate(rows,health())["eligible_for_guarded_shadow_cutover"])
 def test_matched_annotated_windows_required(self):
  rows=gold();rows[1]["window_id"]=rows[0]["window_id"]
  with self.assertRaisesRegex(ValueError,"duplicate"):
   mod.evaluate(rows,health())
if __name__=="__main__":unittest.main(verbosity=2)
