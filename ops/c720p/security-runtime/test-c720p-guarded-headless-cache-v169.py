#!/usr/bin/env python3
"""No-host tests of admission, profile skip and strict cache-only outputs."""
import ast,contextlib,importlib.util,json
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
SRC=HERE/"c720p-guarded-headless-cache-v169.py"
spec=importlib.util.spec_from_file_location("headless_v169",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def report(apply=False,status=None,items=None):
 return {"video_deleted":False,"backup_deleted":False,
 "headless_profile_deleted":False,"detector_build_deleted":False,
 "apply_requested":apply,
 "status":status or ("finished" if apply else "dry_run_only"),
 "items":items if items is not None else (
 [{"cache":"GPUCache","status":"removed" if apply else "eligible_not_deleted",
   "size_mb":9.5}]),"reclaimed_mb":9.2 if apply else 0}
class Tests(unittest.TestCase):
 def test_reject_unbounded_and_unsafe_cache_outputs(self):
  self.assertEqual(m.validate(report(),False),(1,9.5))
  self.assertEqual(m.validate(report(True),True),(1,9.5))
  for mutate in ({"video_deleted":True},{"backup_deleted":True},
    {"headless_profile_deleted":True},{"detector_build_deleted":True},
    {"apply_requested":True},
    {"items":[{"status":"eligible_not_deleted","size_mb":300}]}):
   d=report();d.update(mutate)
   with self.subTest(mutate=mutate),self.assertRaises(RuntimeError):
    m.validate(d,False)
 def test_no_apply_while_browser_profile_in_use(self):
  deferred=report(status="skipped_profile_in_use",items=[])
  ready={"continuous_4k_dropped_output_frames":0,"temperature_c":32.0}
  out=StringIO()
  with patch.object(m,"camera",return_value=ready),patch.object(
     m.shutil,"disk_usage",return_value=SimpleNamespace(free=800*1024**2)),patch.object(
     m.os,"getloadavg",return_value=(.3,.4,.5)),patch.object(
     m,"load_helper",return_value=object()),patch.object(
     m,"run_helper",return_value=deferred) as runner,contextlib.redirect_stdout(out):
   m.execute()
  self.assertEqual(runner.call_count,1)
  self.assertIn('"cache_reclaim_performed": false',out.getvalue())
 def test_actual_eligible_items_get_bounded_apply(self):
  ready={"continuous_4k_dropped_output_frames":0,"temperature_c":32.0}
  result=StringIO()
  with patch.object(m,"camera",return_value=ready),patch.object(
    m.shutil,"disk_usage",return_value=SimpleNamespace(free=800*1024**2)),patch.object(
    m.os,"getloadavg",return_value=(.5,.2,.1)),patch.object(
    m,"load_helper",return_value=object()),patch.object(
    m,"run_helper",side_effect=[report(),report(True)]) as run,contextlib.redirect_stdout(result):
   m.execute()
  self.assertEqual(run.call_count,2)
  self.assertEqual([x.args[1] for x in run.call_args_list],[False,True])
  self.assertIn('"removed_cache_items": 1',result.getvalue())
  self.assertIn('"originals_retained": true',result.getvalue())
 def test_source_never_touches_recording_or_auth_services(self):
  tree=ast.parse(SRC.read_text())
  calls=[n.func.attr for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)]
  for name in ("rmtree","unlink","remove","replace","Popen","restart","chmod","write_text","write_bytes"):
   self.assertNotIn(name,calls)
  source=SRC.read_text()
  for phrase in ("pm install","adb push","apt-get autoremove","docker system prune"):
   self.assertNotIn(phrase,source)
if __name__=="__main__":unittest.main(verbosity=2)
