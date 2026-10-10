#!/usr/bin/env python3
"""Offline regression for native Security integration. No hub or phone writes."""
import importlib.util
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
P=HERE/"patch-s9-integrated-security-ui.py"
spec=importlib.util.spec_from_file_location("s9_hub_integrated",P)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
A=HERE/"patch-anonymous-tracks-ui.py"

class Tests(unittest.TestCase):
 def base(self):
  # Recreate exactly the main HTML contracts without embedding real video data.
  old=mod._load_anon(A).replace(
    " const relay=()=>{\n  // Nested Security iframe: share ONLY the same-origin signed parent relay.\n  if(window.C720PSecureRelay?.fetch)return window.C720PSecureRelay;\n  try{\n   if(window.parent!==window && window.parent.location.origin===location.origin &&\n      window.parent.C720PSecureRelay?.fetch)return window.parent.C720PSecureRelay;\n  }catch(_){}\n  return null;\n };",
    " const relay=()=>window.C720PSecureRelay;")
  old=old.replace("const validName=name=>/^motion_[0-9]{13}[.]mp4$/",
                  r"const validName=name=>/^motion_[0-9]{13}\\.mp4$/")
  return '<html><head><script src="/local/c720p-secure-relay-client.js"></script></head><body><div id="list"></div>'+old+'</body></html>'
 def test_upgrades_gallery_and_adds_analytics_idempotently(self):
  before=self.base()
  after=mod.patch(before)
  self.assertEqual(mod.patch(after),after)
  self.assertIn(mod.MARKER,after)
  self.assertIn(mod.SCRIPT,after)
  self.assertIn('parent.C720PSecureRelay?.fetch',after)
  self.assertIn('const validName=name=>/^motion_[0-9]{13}[.]mp4$/',after)
  self.assertNotIn(r"^motion_[0-9]{13}\\.mp4$",after)
  self.assertIn("/new/api/saved",after)
  self.assertIn("/new/api/drive-person-review",after)
  self.assertIn("/new/api/live-person-watch",after)
  self.assertIn("/new/live.mjpg",after)
  self.assertIn('Clothes can look similar',after)
  self.assertIn('img.removeAttribute',after)
  self.assertIn('C720PSecureRelay',after)
  self.assertIn('uncalibrated',after)
 def test_rejects_unknown_html_and_incomplete_widget(self):
  with self.assertRaises(ValueError):mod.patch('<html><body></body></html>')
  with self.assertRaises(ValueError):mod.patch(self.base().replace('/local/c720p-secure-relay-client.js','/local/unknown.js'))
  proper=mod.patch(self.base())
  with self.assertRaises(ValueError):mod.patch(proper.replace(mod.SCRIPT,'id="broken-script"'))
 def test_js_syntax_if_node_available(self):
  executable=shutil.which("node")
  if not executable:self.skipTest("node not present")
  html=mod.patch(self.base())
  scripts=re.findall(r'<script id="(s9-[a-z0-9-]+)">([\s\S]*?)</script>',html)
  self.assertGreaterEqual(len(scripts),2)
  with tempfile.TemporaryDirectory() as dirname:
   for idx,(_,body) in enumerate(scripts):
    p=Path(dirname)/(str(idx)+".js")
    p.write_text(body)
    result=subprocess.run([executable,"--check",str(p)],capture_output=True,text=True,timeout=15)
    self.assertEqual(result.returncode,0,result.stderr)

if __name__=="__main__":unittest.main(verbosity=2)
