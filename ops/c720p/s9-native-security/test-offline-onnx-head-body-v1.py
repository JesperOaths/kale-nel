#!/usr/bin/env python3
"""Offline ONNX crop-pair vector contract tests (private model optional in CI)."""
from __future__ import annotations
import ast,importlib.util,math,hashlib
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
PROGRAM=HERE/'offline_onnx_head_body_v1.py'
TEXT=PROGRAM.read_text()
H=Path('/home/jespern/c720p-home-hub')
MODEL=H/'state/folder-reference-v2/visual_backbone_512d.onnx'
SHA='ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d'

class StaticContract(unittest.TestCase):
    def test_source_syntax_and_model_lock(self):
        tree=ast.parse(TEXT)
        names={n.name for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
        self.assertTrue({'main','feature','preprocess','rgb','fused'}<=names)
        self.assertIn(SHA,TEXT)
        self.assertIn('ORT_ENABLE_ALL',TEXT)
        self.assertIn("providers=['CPUExecutionProvider']",TEXT)
        self.assertIn("'review_attestation_changed':False",TEXT)
        self.assertIn("'live_scoring_enabled':False",TEXT)
    def test_source_never_connects_phone_or_spoofs_review(self):
        self.assertNotIn('phone_run(',TEXT)
        self.assertNotIn("subprocess.run(['adb'",TEXT)
        self.assertNotIn('opened_ticket',TEXT)
        self.assertNotIn('preview_ticket',TEXT)
        self.assertNotIn('folder_suggestion_api',TEXT)
        self.assertNotIn('original_opened',TEXT)

@unittest.skipUnless(importlib.util.find_spec('onnxruntime') is not None and
                     importlib.util.find_spec('numpy') is not None and
                     MODEL.is_file(), 'private CPU model and runtime not installed')
class RuntimeContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import numpy as np
        import onnxruntime as ort
        import sys
        cls.np=np
        cls.sys=sys
        sys.path.insert(0,str(H/'artifacts/offline-cranial-backfill-tool-v1-20261026'))
        spec=importlib.util.spec_from_file_location('offline_neural',PROGRAM)
        mod=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        cls.mod=mod
        opt=ort.SessionOptions();opt.intra_op_num_threads=1;opt.inter_op_num_threads=1
        cls.sess=ort.InferenceSession(str(MODEL),sess_options=opt,providers=['CPUExecutionProvider'])
    def test_pretrained_weight_bytes_and_shape(self):
        self.assertEqual(hashlib.sha256(MODEL.read_bytes()).hexdigest(),SHA)
        self.assertEqual(self.sess.get_inputs()[0].shape,[1,3,256,128])
        self.assertEqual(self.sess.get_outputs()[0].shape,[1,512])
    def test_preprocessing_and_repeatable_512d_forward(self):
        np=self.np
        image=np.zeros((256,128,3),dtype=np.uint8)
        image[:,:,0]=np.arange(128,dtype=np.uint8)[None,:]
        image[:,:,1]=np.arange(256,dtype=np.uint8)[:,None]
        pre=self.mod.preprocess(image)
        self.assertEqual(pre.shape,(1,3,256,128))
        self.assertAlmostEqual(float(pre[0,2,5,5]),(0-.406)/.225,places=5)
        input_name=self.sess.get_inputs()[0].name
        a=self.mod.feature(self.sess,input_name,image)
        b=self.mod.feature(self.sess,input_name,image)
        self.assertEqual(len(a),512)
        self.assertTrue(np.isfinite(a).all())
        self.assertTrue(np.array_equal(a,b))
        self.assertAlmostEqual(float(np.linalg.norm(a)),1.0,places=7)
        c=self.mod.fused(a,b)
        self.assertEqual(len(c),1024)
        self.assertAlmostEqual(math.sqrt(sum(v*v for v in c)),1.0,places=10)
        self.assertAlmostEqual(sum(v*v for v in c[:512]),.5,places=6)

if __name__=='__main__':unittest.main()

