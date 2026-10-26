#!/usr/bin/env python3
"""Offline-only combined descriptor checks, no private files required."""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest

P = Path(__file__).with_name('offline_roi_fulltrack_fusion_v1.py')
spec = importlib.util.spec_from_file_location('fusion',P)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class FusionTests(unittest.TestCase):
    def test_normalized_1024d_and_equal_head_body_energy(self):
        head=[0.0]*512;body=[0.0]*512
        head[20]=5;body[71]=3
        v=mod.fused(head,body)
        self.assertEqual(len(v),1024)
        self.assertAlmostEqual(math.sqrt(math.fsum(x*x for x in v)),1.,places=12)
        self.assertAlmostEqual(math.fsum(x*x for x in v[:512]),.5,places=12)
        self.assertAlmostEqual(math.fsum(x*x for x in v[512:]),.5,places=12)
        self.assertEqual(v,mod.fused(head,body))
    def test_zero_bad_dimension_rejected(self):
        with self.assertRaises(ValueError):mod.fused([1.0],[1.0]*512)
        with self.assertRaises(ValueError):mod.fused([0.0]*512,[0.0]*512)
        with self.assertRaises(ValueError):mod.fused([float('nan')]*512,[1.0]*512)
    def test_sha_bound_private_source(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'source.jpg'
            raw=b'\xff\xd8'+b'\x00'*500
            p.write_bytes(raw)
            self.assertEqual(mod.read_bound(p,hashlib.sha256(raw).hexdigest()),raw)
            with self.assertRaises(ValueError):
                mod.read_bound(p,'a'*64)
            alias=Path(folder)/'alias.jpg';alias.symlink_to(p)
            with self.assertRaises(ValueError):
                mod.read_bound(alias,hashlib.sha256(raw).hexdigest())
    def test_model_isolation_no_phone_or_proof_claims(self):
        self.assertNotEqual(mod.MODEL,'visual_embedding_cosine_v1')
        self.assertNotEqual(mod.MODEL,mod.CHILD)
        s=P.read_text()
        self.assertIn("'identity_verified':False",s)
        self.assertIn("'trained_onnx_compatible':False",s)
        self.assertIn("'same_keyframe_verified':False",s)
        self.assertNotIn('phone_run(',s)
        self.assertNotIn('adb -s',s)
        self.assertNotIn('opened_ticket',s)
        self.assertNotIn('preview_ticket',s)
        self.assertNotIn('original_attestor',s)

if __name__=='__main__': unittest.main()

