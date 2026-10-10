#!/usr/bin/env python3
"""Native Camera2 control proxy regression and UI safety, no device needed."""
import importlib.util
import io,json,pathlib,unittest
from unittest import mock
ROOT=pathlib.Path(__file__).resolve().parent
RELAY=ROOT.parent/"s9-person-ml-v1/s9_native_camera_controls.py"
PATCH=ROOT/"patch-native-camera-controls-ui.py"
def imp(path,name):
 s=importlib.util.spec_from_file_location(name,path)
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class Tests(unittest.TestCase):
 def setUp(self):
  self.a=imp(RELAY,"camera2relaytest")
  class Handler:
   def __init__(self,path,body=b"",headers=None):
    self.path=path;self.rfile=io.BytesIO(body);self.headers=headers or {};self.status=None;self.data=None
   def go(self):self.status=418
   def do_POST(self):self.status=418
   def js(self,status,value):self.status=status;self.data=value
  self.H=Handler
  self.a.install(Handler)
 def test_advertised_options_only_from_phone(self):
  results={"ok":True,"mode":"watching","controls":{
   "zoom":{"available":["1.0","2.0","300.0"],"value":"2.0"},
   "torch":{"available":["off","on"],"value":"off"},
   "recording_rotation":{"available":["auto","0","90","180","270","45"],"value":"auto"},
   "intrusive_legacy_camera_control":{"available":["anything"],"value":"anything"}}}
  with mock.patch.object(self.a,"local",return_value=(200,results)):
   h=self.H("/new/camera-controls");h.go()
  self.assertEqual(h.status,200)
  self.assertEqual(sorted(h.data["controls"]),["recording_rotation","torch","zoom"])
  self.assertEqual(h.data["controls"]["recording_rotation"]["available"],["auto","0","90","180","270"])
  self.assertEqual(h.data["controls"]["zoom"]["available"],["1.0","2.0"])
 def test_explicit_intent_body_options_and_origin(self):
  body=json.dumps({"key":"zoom","value":"2.0"}).encode()
  h={"Content-Type":"application/json","Content-Length":str(len(body))}
  x=self.H("/new/camera-control",body,h);x.do_POST();self.assertEqual(x.status,403)
  h["X-S9-Camera-Control-Intent"]="explicit-user-selection-v1"
  h["Origin"]="https://malicious.example"
  x=self.H("/new/camera-control",body,h);x.do_POST();self.assertEqual(x.status,403)
  h["Origin"]="https://kalenel.nl"
  with mock.patch.object(self.a,"local",return_value=(200,{"ok":True,"value":"2.0"})):
   x=self.H("/new/camera-control",body,h);x.do_POST()
  self.assertEqual(x.status,200);self.assertEqual(x.data["value"],"2.0")
  body=json.dumps({"key":"torch","value":"reboot"}).encode()
  h["Content-Length"]=str(len(body))
  x=self.H("/new/camera-control",body,h);x.do_POST();self.assertEqual(x.status,400)
  # A playback/display hint is allowed only at exact quarter turns.
  rotation=json.dumps({"key":"recording_rotation","value":"270"}).encode()
  h["Content-Length"]=str(len(rotation))
  with mock.patch.object(self.a,"local",return_value=(200,{"ok":True,"value":"270"})):
   x=self.H("/new/camera-control",rotation,h);x.do_POST()
  self.assertEqual(x.status,200)
  automatic=json.dumps({"key":"recording_rotation","value":"auto"}).encode()
  h["Content-Length"]=str(len(automatic))
  with mock.patch.object(self.a,"local",return_value=(200,{"ok":True,"value":"auto"})):
   x=self.H("/new/camera-control",automatic,h);x.do_POST()
  self.assertEqual(x.status,200)
  bad=json.dumps({"key":"recording_rotation","value":"45"}).encode()
  h["Content-Length"]=str(len(bad))
  x=self.H("/new/camera-control",bad,h);x.do_POST();self.assertEqual(x.status,400)
  x=self.H("/new/api/saved");x.go();self.assertEqual(x.status,418)
  x=self.H("/new/saved/clip/clip.mp4");x.do_POST();self.assertEqual(x.status,418)
 def test_ui_idempotency_and_only_intent_change(self):
  ui=imp(PATCH,"camera2panel")
  old="<html>async function loadControls(cam,prefix){}<div id='cameraControls'></div>function refreshControls(){loadControls('new','camera')} headers:{'content-type':'application/json'},body:JSON.stringify({key,value:sel.value})</html>"
  patched=ui.patch(old)
  self.assertEqual(ui.patch(patched),patched)
  self.assertIn("X-S9-Camera-Control-Intent",patched)
  self.assertIn("S9_NATIVE_CAMERA2_SECURITY_CONTROLS_V1",patched)
  self.assertNotIn("cam-force-stop",patched)
 def test_native_source_guard_contract(self):
  source=(ROOT/"src/nl/kalenel/s9security/CameraService.java").read_text()
  cls=(ROOT/"src/nl/kalenel/s9security/CameraControls.java").read_text()
  self.assertIn('"POST /control "',source)
  self.assertIn('cameraHandler.post(job)',source)
  self.assertIn('!"watching".equals(mode)',source)
  self.assertIn('session.setRepeatingRequest',source)
  self.assertIn('recorder.setOrientationHint(recordingRotation())',source)
  self.assertIn('recording_rotation_degrees',source)
  self.assertIn('future_recordings_only',source)
  self.assertIn('CameraOrientation.recordingHint',source)
  self.assertIn('SENSOR_ORIENTATION',source)
  self.assertIn('.put("auto")',source)
  self.assertIn('CaptureRequest.SCALER_CROP_REGION',cls)
  self.assertIn('CONTROL_AE_EXPOSURE_COMPENSATION',cls)
  self.assertIn('FLASH_MODE_TORCH',cls)
  self.assertIn('CONTROL_AF_TRIGGER_START',source)
  classifier=(ROOT/'src/nl/kalenel/s9security/ClipClassifier.java').read_text()
  outfit=(ROOT/'src/nl/kalenel/s9security/OutfitEvidence.java').read_text()
  self.assertIn('outfit.add(bitmap,distinctPersonBoxes.get(0)',classifier)
  self.assertIn('outfit.publish(result,folder,name,persons==1',classifier)
  self.assertIn('new JSONArray()',outfit)
  self.assertIn('human_review_required',outfit)
  self.assertIn('verified_same_person',outfit)
  self.assertIn('similar_outfit_not_identity',outfit)
  self.assertIn('if(checked++>=250)break',outfit)
  self.assertIn('motion.resetForCameraControl()',source)
  self.assertIn('cameraControlSettleUntil=SystemClock.elapsedRealtime()+2500L',source)
  self.assertIn('change && lastFrameAt>=cameraControlSettleUntil',source)
  grid=(ROOT/"src/nl/kalenel/s9security/MotionGrid.java").read_text()
  self.assertIn('public void resetForCameraControl()',grid)
  self.assertIn('votes.clear()',grid)
  self.assertIn('motion=false;strong=false',grid)
  self.assertNotIn('MediaRecorder',cls)
if __name__=="__main__":unittest.main(verbosity=2)
