#!/usr/bin/env python3
"""Ensure S9 production package fails closed when the optional model is absent."""
from pathlib import Path
import unittest

SH=(Path(__file__).resolve().parent/"package-only.sh").read_text()

class Tests(unittest.TestCase):
    def test_face_model_required_for_production(self):
        self.assertIn('S9_FACE_MODEL_REQUIRED_FOR_PRODUCTION',SH)
        self.assertIn('S9_ALLOW_FACE_SNAPSHOTS_ONLY:-0',SH)
        self.assertIn('S9_FACE_EMBEDDING_MODEL',SH)
        self.assertIn('S9_FACE_MODEL_SHA256_REQUIRED',SH)
        self.assertIn('FACE_MODEL_SHA256_MISMATCH',SH)
        self.assertIn('face_embedding.tflite',SH)
        self.assertIn('sha256sum -c -',SH)
        self.assertIn('exit 4',SH)
    def test_core_models_required(self):
        self.assertIn('for name in detect.tflite labelmap.txt',SH)
        self.assertIn('MISSING_MODEL_ASSET=',SH)

if __name__=="__main__":
    unittest.main(verbosity=2)
