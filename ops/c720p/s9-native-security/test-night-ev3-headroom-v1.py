#!/usr/bin/env python3
"""Offline regression tests: guard and always restore S9+ camera exposure."""
import importlib.util
from pathlib import Path
from unittest import TestCase,main,mock

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("night_headroom",ROOT/"probe-night-ev3-headroom-v1.py")
probe=importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class NightHeadroomTests(TestCase):
 def test_no_mutation_of_videos_or_camera_format(self):
  src=(ROOT/"probe-night-ev3-headroom-v1.py").read_text()
  for x in ("finally:","restored=restore(old)","continuous_4k_ready",
      "night_active","night_mode","plus3_not_proven_better",
      "no_images_or_recordings_saved"):
   self.assertIn(x,src)
  for bad in ("adb install","force-stop","unlink(", "rmtree(", "DELETE ",
      "POST /api/saved", "base64.b64encode", "open('w')"):
   self.assertNotIn(bad,src)

 def test_restore_previously_set_exposure(self):
  config={"ev":"1"}
  def ctl():return {"exposure_ev":{"value":config["ev"]}}
  def set_control(ev):config["ev"]=ev
  with mock.patch.object(probe,"controls",side_effect=ctl),mock.patch.object(
      probe,"set_ev",side_effect=set_control),mock.patch.object(
      probe.quality,"state",return_value={"mode":"watching"}):
   self.assertTrue(probe.restore("0"))
  self.assertEqual(config["ev"],"0")

 def test_restoration_attempt_if_apply_acknowledgement_lost(self):
  options={"exposure_ev":{"value":"0","available":["0","1"]},
       "night_effective_ev":2}
  good={"ok":True,"mode":"watching","native_4k_enabled":True,
        "continuous_4k_ready":True,"night_mode":"auto",
        "night_active":True,"temperature_c":35,"recorded":0}
  called=[]
  def apply(ev):
   called.append(ev)
   raise RuntimeError("ack_lost_after_apply")
  with mock.patch.object(probe,"controls",return_value=options),mock.patch.object(
    probe.quality,"state",return_value=good),mock.patch.object(
    probe,"measure",return_value={"gray":25,"dark":.94}),mock.patch.object(
    probe,"set_ev",side_effect=apply),mock.patch.object(
    probe,"restore",return_value=True) as restore:
   with self.assertRaises(RuntimeError):
    probe.main()
   self.assertEqual(called,["1"])
   restore.assert_called_once_with("0")

if __name__=="__main__":
 main()
