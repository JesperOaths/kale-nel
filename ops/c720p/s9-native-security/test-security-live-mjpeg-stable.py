#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
BASE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location("mjpeg_patch",BASE/"patch-security-live-mjpeg-stable.py")
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class TestLive(unittest.TestCase):
 def test_repeated_native_renews_only_when_first_frame_stalled(self):
  prior="""<!-- S9_NATIVE_RELAY_MAIN_STREAM_V2 -->
let s9LiveGeneration=0;
async function streams(on){
  const n=$('#cameraLive'),f=$('#cameraFast'),status=$('#cameraStatus');
  const generation=++s9LiveGeneration;
  if(!on)return;
  n.onload=()=>{
      status.textContent='live · native S9+';
  };
  n.onerror=()=>{};
  if(generation!==s9LiveGeneration)return;
    n.src=u+(u.includes('?')?'&':'?')+'v='+Date.now();
    if(status){status.textContent='live · native S9+';status.className='status ok'}
}
function enforceRoute(){}
setInterval(()=>{enforceRoute();if(active==='live'&&securityRouteActive())streams(true)},1000);
"""
  new=m.patch(prior)
  self.assertEqual(m.patch(new),new)
  self.assertIn("n.naturalWidth>0 || Date.now()-s9LiveConnectStarted<12000",new)
  self.assertIn("setInterval(enforceRoute,1000)",new)
  self.assertIn("waiting for native S9+ frames",new)
  self.assertIn("S9_NATIVE_RELAY_MAIN_STREAM_V3_RETAIN_MJPEG",new)
  self.assertNotIn("enforceRoute();if(active==='live'",new)
 def test_fails_closed_if_not_known_native_UI(self):
  with self.assertRaises(ValueError):m.patch("<script>async function streams(on){}</script>")
  with self.assertRaises(ValueError):m.patch("S9_NATIVE_RELAY_MAIN_STREAM_V2 async function streams(on){}")
 def test_deploy_only_live_UI_and_no_phone(self):
  text=(BASE/"deploy-security-live-mjpeg-stable.py").read_text()
  self.assertIn('s9-live-mjpeg',text)
  self.assertIn('phone_camera_unhealthy',text)
  self.assertIn('microSD_archive_unavailable',text)
  self.assertNotIn('adb ',text)
  self.assertNotIn('chmod -R',text)
if __name__=="__main__":unittest.main(verbosity=2)
