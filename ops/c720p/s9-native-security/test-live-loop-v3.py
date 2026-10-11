#!/usr/bin/env python3
"""Regression checks: live H264 -> authenticated MJPEG, retry backoff and unchanged MP4 recorder."""
import importlib.util,shutil,subprocess,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def imported(module,path):
 spec=importlib.util.spec_from_file_location(module,ROOT/path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
v2=imported("live_stable_v2","repair-live-loop-v2.py")
v3=imported("live_stable_v3","harden-live-retry-v3.py")
class Checks(unittest.TestCase):
 def oldjs(self):
  return ('const imageSrc=Object.getOwnPropertyDescriptor(image,'+"'src'"+');\n'
   "function cleanupLive(state){nativeRemove.call(state.img,'src');state.img.style.display=state.previousDisplay||'';state.running=false;}\n"
   "async function liveSession(state){const r=await relay().fetch('/new/live.mp4'); source.addSourceBuffer(mime);/*"+
   ("legacy-buffer-code"*280)+"*/}\nfunction startLive(img,options={}){}")
 def oldhtml(self):
  return ('<html><head></head><body><img id="cameraLive">'
   '<script id="s9v7-root-script"></script><script id="s9v6-security-script"></script>'
   '<script src="/local/security-video-playback.js?v=C720P_SECURITY_SMOOTH_VIDEO_V1"></script></body></html>')
 def test_live_patch_contract(self):
  upgraded=v2.patch_js(self.oldjs())
  self.assertEqual(upgraded,v2.patch_js(upgraded))
  self.assertNotIn("fetch('/new/live.mp4'",upgraded)
  self.assertIn("client.url('/new/live.mjpg')",upgraded)
  self.assertIn("state.retryTimer||!state.wanted",upgraded)
  self.assertIn("imageSrc.set.call(img,signed)",upgraded)
  self.assertIn("function startLive(img,options={}){}",upgraded)
  html=v2.patch_page(self.oldhtml())
  self.assertEqual(html,v2.patch_page(html))
 def test_v3_mock_install(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'security-video-playback.js').write_text(v2.patch_js(self.oldjs()).replace('state.running||state.retryTimer||','state.running||',1))
   (root/'c720p-surveillance.html').write_text(v2.patch_page(self.oldhtml()))
   d=v3.upgrade(root,root/'backups',apply=False);self.assertTrue(d['dry_run'])
   done=v3.upgrade(root,root/'backups',apply=True);self.assertTrue(done['deployed'])
   self.assertTrue(v3.upgrade(root,root/'backups',apply=True)['already_installed'])
 def test_js_parse(self):
  if not shutil.which('node'):self.skipTest('Node unavailable')
  with tempfile.TemporaryDirectory() as d:
   file=Path(d)/'live.js';file.write_text(v2.NEW_LIVE)
   result=subprocess.run(['node','--check',str(file)],capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main(verbosity=2)
