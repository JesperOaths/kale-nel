#!/usr/bin/env python3
"""Prevent shipping a new S9+ APK without its installed face-review model."""
from pathlib import Path
import subprocess
import unittest
ROOT=Path(__file__).resolve().parent

class Tests(unittest.TestCase):
 def test_release_requires_verified_model_or_explicit_developer_optout(self):
  src=(ROOT/'package-only.sh').read_text()
  self.assertIn('S9_FACE_MODEL_REQUIRED_FOR_PRODUCTION',src)
  self.assertIn('S9_ALLOW_FACE_SNAPSHOTS_ONLY',src)
  self.assertIn('!= "1"',src)
  self.assertIn('S9_FACE_MODEL_SHA256_REQUIRED',src)
  self.assertIn('sha256sum -c -',src)
  self.assertIn('cp "$FACE_MODEL" "$ROOT/assets/face_embedding.tflite"',src)
  self.assertIn('S9_FACE_REVIEW_SNAPSHOTS_ONLY_EXPLICIT_DEV_BUILD',src)
  self.assertNotIn('S9_FACE_REVIEW_SNAPSHOTS_ONLY: no verified embedding model provided',src)
  result=subprocess.run(['bash','-n',str(ROOT/'package-only.sh')],
     capture_output=True,text=True,timeout=8)
  self.assertEqual(result.returncode,0,result.stderr)

if __name__=='__main__':unittest.main(verbosity=2)
