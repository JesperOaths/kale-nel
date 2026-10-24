#!/usr/bin/env python3
"""Isolated mock safety acceptance: NEVER contacts/controls a physical camera."""
import importlib.util,json
from pathlib import Path
import tempfile,unittest
from unittest import mock

HERE=Path(__file__).resolve().parent
SRC=HERE/"s9-one-supervised-normal-stop-start-v2.py"
def load():
 spec=importlib.util.spec_from_file_location("bounded_camera_supervision_inert",SRC)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 return mod
def state(frames=10,mode="watching",**changes):
 d={"mode":mode,"recorded":40,"frames":frames,"last_frame_age_ms":20,
  "temperature_c":31.0,"sd_free_bytes":50*1024**3,
  "continuous_4k_production_persisted":True,
  "continuous_4k_ready":False,"continuous_4k_buffered_ms":0}
 mod=load()
 d.update({flag:False for flag in mod.CHECK_FLAGS})
 d.update(changes)
 return d

class Safety(unittest.TestCase):
 def test_unsafe_live_recording(self):
  m=load()
  with self.assertRaisesRegex(m.Refuse,"not_idle_watching"):
   m.runchecks(state(10,mode="recording"),state(20))
 def test_frozen_frames_or_new_recording(self):
  m=load()
  with self.assertRaisesRegex(m.Refuse,"sensor_not_advancing"):
   m.runchecks(state(10),state(10))
  with self.assertRaisesRegex(m.Refuse,"new_recording_started"):
   m.runchecks(state(10),state(20,recorded=41))
 def test_temp_storage_and_pending_video(self):
  m=load()
  with self.assertRaisesRegex(m.Refuse,"temperature_guard"):
   m.runchecks(state(10),state(20,temperature_c=40.5))
  with self.assertRaisesRegex(m.Refuse,"sd_reserve_guard"):
   m.runchecks(state(10),state(20,sd_free_bytes=1))
  with self.assertRaisesRegex(m.Refuse,"recorder_busy_or_unknown"):
   m.runchecks(state(10),state(20,preview_jpeg_worker_busy=True))
 def test_activating_worker_refused(self):
  m=load()
  def fake(args,**kw):
   if args[2]=="list-jobs":return 0,"No jobs running.",""
   if args[2]=="is-active":return 3,"activating",""
   raise AssertionError(args)
  with mock.patch.object(m,"cmd",side_effect=fake):
   with self.assertRaisesRegex(m.Refuse,"competing_worker"):
    m.exclusion_check()
 def test_journal_is_at_most_once_and_private(self):
  m=load()
  with tempfile.TemporaryDirectory() as tmp:
   target=Path(tmp)/"once.json"
   m.Journal(target)
   self.assertEqual(target.stat().st_mode&0o777,0o600)
   with self.assertRaisesRegex(m.Refuse,"journal_already_exists"):
    m.Journal(target)
 def setup_transaction(self,m,all_states):
  def fake_ok(*args,**kw):
   return ("package:/data/app/example/base.apk" if args[:3]==("shell","pm","path")
           else m.APK if args[:2]==("shell","sha256sum")
           else "")
  return [
   mock.patch.object(m,"identity",return_value=True),
   mock.patch.object(m,"status",side_effect=all_states),
   mock.patch.object(m,"exclusion_check",return_value=True),
   mock.patch.object(m,"okadb",side_effect=fake_ok),
   mock.patch.object(m,"media",return_value={"mp4":1100,"recording":1,"tmp":0}),
   mock.patch.object(m,"ui_stop",return_value=(112,332)),
   mock.patch.object(m.time,"sleep",return_value=None),
  ]
 def test_one_stop_one_start_only_after_shutdown(self):
  m=load()
  with tempfile.TemporaryDirectory() as tmp:
   j=m.Journal(Path(tmp)/"once.json")
   a=self.setup_transaction(m,[state(10),state(20),state(30)])
   services=[True,True,False,False]
   order=[]
   def send(*args,**kw):
    order.append(args)
    return 0,"Activity started",""
   with a[0],a[1],a[2],a[3],a[4],a[5],a[6],mock.patch.object(m,"service",side_effect=lambda:services.pop(0)),mock.patch.object(m,"adb",side_effect=send):
    m.run(j)
   self.assertTrue(j.data["stop_confirmed"])
   self.assertTrue(j.data["start_confirmed"])
   self.assertFalse(j.data["camera_recovered"])
   self.assertEqual(sum("input" in x and "tap" in x for x in order),1)
   self.assertEqual(sum("am" in x and "start" in x for x in order),1)
 def test_failed_stop_delivery_never_starts(self):
  m=load()
  with tempfile.TemporaryDirectory() as tmp:
   j=m.Journal(Path(tmp)/"once.json")
   patches=self.setup_transaction(m,[state(10),state(20),state(30)])
   commands=[]
   def send(*args,**kw):
    commands.append(args);return 1,"","ADB failed"
   with patches[0],patches[1],patches[2],patches[3],patches[4],patches[5],patches[6],mock.patch.object(m,"service",return_value=True),mock.patch.object(m,"adb",side_effect=send):
    with self.assertRaisesRegex(m.Refuse,"stop_delivery_uncertain"):
     m.run(j)
   self.assertTrue(j.data["stop_attempted"])
   self.assertFalse(j.data["start_attempted"])
   self.assertEqual(len(commands),1)
 def test_lost_connection_after_stop_fails_without_second_stop(self):
  m=load()
  with tempfile.TemporaryDirectory() as tmp:
   j=m.Journal(Path(tmp)/"once.json")
   patches=self.setup_transaction(m,[state(10),state(20),state(30)])
   counter=[0];calls=[]
   def identity():
    counter[0]+=1
    if counter[0]==4:raise m.Refuse("wireless_link_lost")
    return True
   with mock.patch.object(m,"identity",side_effect=identity),patches[1],patches[2],patches[3],patches[4],patches[5],patches[6],mock.patch.object(m,"service",return_value=True),mock.patch.object(m,"bridge_recover_once",return_value=False),mock.patch.object(m,"adb",side_effect=lambda *a,**k:(calls.append(a) or (0,"",""))):
    with self.assertRaisesRegex(m.Refuse,"transport_lost_after_stop"):
     m.run(j)
   self.assertEqual(len(calls),1)
   self.assertTrue(j.data["stop_attempted"])
   self.assertFalse(j.data["start_attempted"])
 def test_bridge_connection_recovery_max_once(self):
  m=load()
  with tempfile.TemporaryDirectory() as tmp:
   j=m.Journal(Path(tmp)/"once.json")
   with mock.patch.object(m,"cmd",return_value=(0,"","")),mock.patch.object(m,"identity",return_value=True):
    self.assertTrue(m.bridge_recover_once(j))
    self.assertFalse(m.bridge_recover_once(j))
    self.assertTrue(j.data["bridge_recovery_attempted"])
 def test_ui_stop_label_and_coords_are_verified(self):
  m=load()
  xml='<hierarchy><node text="STOP NATIVE SERVICE" package="nl.kalenel.s9security" clickable="true" bounds="[20,1015][2772,1183]"/></hierarchy>'
  def get(*args,**kwargs):
   if args[:2]==("shell","cat"):return xml
   return ""
  with mock.patch.object(m,"okadb",side_effect=get),mock.patch.object(m,"adb",return_value=(0,"","")):
   self.assertEqual(m.ui_stop(),(1396,1099))
  with mock.patch.object(m,"okadb",side_effect=lambda *a,**kw: xml.replace("STOP NATIVE SERVICE","UNKNOWN") if a[:2]==("shell","cat") else ""),mock.patch.object(m,"adb",return_value=(0,"","")):
   with self.assertRaisesRegex(m.Refuse,"native_stop_control_missing"):
    m.ui_stop()
 def test_source_contains_no_forced_encoder_or_global_reset(self):
  source=SRC.read_text()
  for x in ("continuous_4k_trial=enable","adb kill-server","am force-stop",
            "pm install","adb tcpip","reset_recovery_attempts","--remove-all"):
   self.assertNotIn(x,source)

if __name__=="__main__":unittest.main(verbosity=2)
