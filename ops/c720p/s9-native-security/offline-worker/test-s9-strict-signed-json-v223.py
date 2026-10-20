#!/usr/bin/env python3
"""Only host synthetic parser tests. No phone, HTTP listener, keys, recordings."""
from pathlib import Path
import subprocess
import tempfile
import unittest
ROOT=Path(__file__).resolve().parent
class StrictJson(unittest.TestCase):
 def test_java_host_malformed_rejection(self):
  with tempfile.TemporaryDirectory(prefix="s9-strict-v223-") as directory:
   names=["S9MigratedSignedActionV198.java",
     "S9MigratedStrictJsonIntentV223.java",
     "S9MigratedStrictJsonIntentTestV223.java"]
   compiled=subprocess.run(["javac","-source","8","-target","8","-d",directory]+
        [str(ROOT/n) for n in names],capture_output=True,text=True,timeout=35)
   self.assertEqual(compiled.returncode,0,compiled.stderr)
   run=subprocess.run(["java","-cp",directory,
       "nl.kalenel.s9offline.S9MigratedStrictJsonIntentTestV223"],
       capture_output=True,text=True,timeout=20)
   self.assertEqual(run.returncode,0,run.stderr)
   self.assertEqual(run.stdout.strip(),"S9_STRICT_SIGNED_JSON_V223_HOST_OK")
 def test_decode_is_not_authenticated_action(self):
  source=(ROOT/"S9MigratedStrictJsonIntentV223.java").read_text()
  for marker in ("values.containsKey(key)","values.size()!=NAMES.size()",
     "body.length>MAX_BYTES",'"application/json".equals(contentType)',
     "NUMERIC.contains(key)?number():text(180)"):
   self.assertIn(marker,source)
  for banned in ("HttpServer","ServerSocket","FileInputStream",
      "CameraManager","MediaCodec","getExternalFilesDir(",
      "Files.delete(","Files.write(","KeyGenerator"):
   self.assertNotIn(banned,source)
if __name__=="__main__":unittest.main(verbosity=2)
