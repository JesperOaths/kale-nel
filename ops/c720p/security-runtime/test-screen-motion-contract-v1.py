#!/usr/bin/env python3
"""Motion-to-backlight regressions with synthetic state and a fake X11 display."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch

spec=importlib.util.spec_from_file_location('screen_idle',Path(__file__).with_name('c720p-screen-idle.py'))
screen=importlib.util.module_from_spec(spec)
spec.loader.exec_module(screen)

def sample(**updates):
 record={'ok':True,'version':'frontcam-motion-v19','updated_at':1000.,
         'last_trigger_at':999.,'confirmed_motion':False,
         'lamp_trigger_allowed':False,'ambient_light_sufficient':True}
 record.update(updates)
 return record

class MotionContractTests(unittest.TestCase):
 def test_current_v19_and_retained_releases_refresh_camera_wake(self):
  for version in ('frontcam-motion-v16','frontcam-motion-v18','frontcam-motion-v19'):
   with self.subTest(version=version):
    self.assertEqual(screen.motion_sample(sample(version=version),1000),(True,999.))

 def test_bright_room_motion_wakes_even_without_a_new_lamp_webhook(self):
  record=sample(confirmed_motion=True,last_trigger_at=800.)
  self.assertEqual(screen.motion_sample(record,1000),(True,1000.))

 def test_unconfirmed_candidate_does_not_extend_wake(self):
  self.assertEqual(screen.motion_sample(sample(candidate=True,last_motion_at=1000.,
   last_trigger_at=None),1000),(True,0.))

 def test_stale_failed_or_unknown_detector_cannot_wake_screen(self):
  for updates in ({'updated_at':992.9},{'ok':False},{'version':'frontcam-motion-v20'},
                  {'version':'other-camera'},{'updated_at':float('nan')},
                  {'updated_at':float('inf')},{'updated_at':'invalid'}):
   with self.subTest(updates=updates):
    self.assertEqual(screen.motion_sample(sample(**updates),1000),(False,0.))

 def test_future_event_does_not_extend_wake(self):
  self.assertEqual(screen.motion_sample(sample(last_trigger_at=1002.),1000),(True,0.))

 def test_malformed_state_is_unavailable_instead_of_stopping_dimmer(self):
  for record in (None,[],42,'not-state',sample(updated_at={}),sample(version=[])):
   with self.subTest(record=record):
    self.assertEqual(screen.motion_sample(record,1000),(False,0.))

 def test_run_dims_wakes_for_v19_and_expires_after_150_seconds(self):
  with tempfile.TemporaryDirectory(dir=os.environ.get('C720P_TEST_TMPDIR')) as folder:
   root=Path(folder);brightness=root/'brightness';maximum=root/'max_brightness'
   motion=root/'motion.json';status=root/'screen.json'
   brightness.write_text('1000');maximum.write_text('2000')
   records=[sample(updated_at=992.,last_trigger_at=992.),
            sample(updated_at=1001.,confirmed_motion=True,last_trigger_at=800.),
            sample(updated_at=1152.,last_trigger_at=1001.)]
   motion.write_text(json.dumps(records[0]))
   observed=[];handlers={}
   xlib=SimpleNamespace(XOpenDisplay=Mock(return_value=1),
    XDefaultRootWindow=Mock(return_value=1),XCloseDisplay=Mock())
   def query(display,window,info):
    info._obj.idle=200000
    return 1
   xss=SimpleNamespace(XScreenSaverQueryInfo=Mock(side_effect=query))
   def sleep(_):
    observed.append(int(brightness.read_text()))
    if len(observed)==len(records):handlers[screen.signal.SIGTERM]()
    else:motion.write_text(json.dumps(records[len(observed)]))
   def path(value):
    return maximum if str(value)=='/sys/class/backlight/intel_backlight/max_brightness' else Path(value)
   with patch.object(screen,'P',brightness),patch.object(screen,'M',motion),\
        patch.object(screen,'S',status),patch.object(screen,'Path',side_effect=path),\
        patch.object(screen.ctypes.util,'find_library',side_effect=lambda name:name),\
        patch.object(screen.ctypes,'CDLL',side_effect=[xlib,xss]),\
        patch.object(screen.signal,'signal',side_effect=lambda sig,fn:handlers.__setitem__(sig,fn)),\
        patch.object(screen.time,'monotonic',side_effect=[100.,106.,107.,258.]),\
        patch.object(screen.time,'time',side_effect=[1000.,1001.,1152.]),\
        patch.object(screen.time,'sleep',side_effect=sleep),contextlib.redirect_stdout(io.StringIO()):
    screen.run()
   self.assertEqual(observed,[300,1000,300])
   self.assertEqual(brightness.read_text(),'1000')
   self.assertTrue(json.loads(status.read_text())['camera_fresh'])
   xlib.XCloseDisplay.assert_called_once_with(1)

if __name__=='__main__':unittest.main()
