#!/usr/bin/env python3
"""Offline-only synthetic descriptor and strict model isolation tests."""
from pathlib import Path
import importlib.util
import math
import unittest

P=Path(__file__).with_name('offline_handcrafted_roi_512d_v1.py')
spec=importlib.util.spec_from_file_location('handcrafted_roi',P)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class OfflineDescriptors(unittest.TestCase):
    def test_repeatable_512_dimensions_and_normalization(self):
        raw=bytes((i*23 + i//3)%256 for i in range(3072))
        a=mod.vector(raw)
        self.assertEqual(a,mod.vector(raw))
        self.assertEqual(len(a),512)
        self.assertTrue(math.isclose(math.sqrt(math.fsum(x*x for x in a)),1.,rel_tol=1e-10))
        self.assertTrue(all(math.isfinite(x) for x in a))
    def test_different_sources_not_identical(self):
        a=mod.vector(bytes((i*19+i//2)%256 for i in range(3072)))
        b=mod.vector(bytes((i*7+i//7)%256 for i in range(3072)))
        self.assertNotEqual(a,b)
    def test_invalid_raster_denied(self):
        with self.assertRaisesRegex(ValueError,'invalid_rgb_length'):
            mod.vector(b'\x00'*255)
        with self.assertRaisesRegex(ValueError,'constant_or_invalid_crop'):
            mod.vector(bytes([128]*3072))
    def test_untrained_model_explicitly_separate_from_onnx(self):
        self.assertNotEqual(mod.MODEL_ID,'visual_embedding_cosine_v1')
        self.assertNotIn('onnx',mod.MODEL_ID)
        src=P.read_text()
        self.assertIn("'compatible_with_visual_embedding_cosine_v1':False",src)
        self.assertIn("'production_feature_index_updated':False",src)
        self.assertNotIn('phone_run',src)
if __name__=='__main__': unittest.main()
