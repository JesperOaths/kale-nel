#!/usr/bin/env python3
"""Synthetic, non-biometric tests for the isolated dual-embedding module.

No camera, people, identity labels, external downloads, saved videos,
network services or model weights are needed.
"""
import importlib.util
import math
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

import numpy as np

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location(
    "s9_person_features", HERE/"s9_person_feature_extractor.py")
feature=importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name]=feature
spec.loader.exec_module(feature)


class StubBackend:
    def __init__(self, dim):
        self.vector_dim=dim
        self.pixels=[]

    def encode(self, crop):
        self.pixels.append(crop.copy())
        vector=np.zeros(self.vector_dim,np.float32)
        vector[0]=1
        vector[1]=int(crop[0,0,0])+1
        return vector


class FakeSession:
    def __init__(self, expected_dim, *, shape=(1,3,64,64),
                 dtype="tensor(float)", payload=None):
        self.expected_dim=expected_dim
        self.shape=shape
        self.dtype=dtype
        self.payload=payload
        self.batches=[]

    def get_inputs(self):
        return [SimpleNamespace(name="pixel_input",shape=self.shape,type=self.dtype)]

    def get_outputs(self):
        return [SimpleNamespace(name="embedding")]

    def run(self,outputs,inputs):
        assert outputs==["embedding"]
        batch=inputs["pixel_input"]
        assert batch.dtype==np.float32
        assert batch.shape==(1,3,64,64)
        self.batches.append(batch.copy())
        if self.payload is not None:
            return [self.payload]
        return [np.ones((1,self.expected_dim),np.float32)]


class PersonFeatureTests(unittest.TestCase):
    def setUp(self):
        self.frame=np.zeros((120,100,3),np.uint8)
        # Full bbox height 80. Pixel rows 20..39 are red, remainder blue.
        self.frame[20:40,10:50]=(0,0,255)
        self.frame[40:100,10:50]=(255,0,0)

    def test_exact_separate_original_crops_and_fields(self):
        visual=StubBackend(512)
        structure=StubBackend(128)
        tool=feature.PersonFeatureExtractor(
            visual,structure,visual_model_id="osnet-checkpoint-sha256",
            structural_model_id="upper-model-sha256")
        record=tool.extract(self.frame,[10,20,50,100])
        self.assertEqual(visual.pixels[0].shape,(80,40,3))
        self.assertEqual(structure.pixels[0].shape,(20,40,3))
        self.assertTrue(np.all(structure.pixels[0][:,:,2]==255))
        self.assertTrue(np.all(structure.pixels[0][:,:,0]==0))
        self.assertTrue(np.all(visual.pixels[0][20:,:,0]==255))
        self.assertEqual(record["bbox_xyxy"],[10,20,50,100])
        self.assertEqual(len(record["visual_embedding"]),512)
        self.assertEqual(len(record["structural_crop_embedding"]),128)
        self.assertEqual(record["feature_schema"],feature.SCHEMA_VERSION)
        self.assertTrue(record["appearance_only"])
        self.assertFalse(record["verified_same_person"])
        self.assertAlmostEqual(float(np.linalg.norm(record["visual_embedding"])),1,places=6)
        self.assertAlmostEqual(float(np.linalg.norm(record["structural_crop_embedding"])),1,places=6)
        self.assertTrue(np.array_equal(self.frame[20,10],np.array([0,0,255],np.uint8)),
                        "Feature extraction must not overwrite frame pixels")

    def test_fractional_bounds_and_clamping(self):
        crop,xyxy=feature.crop_person(self.frame,(-5.1,19.2,50.01,125.8))
        self.assertEqual(xyxy,(0,19,51,120))
        self.assertEqual(crop.shape,(101,51,3))
        self.assertEqual(feature.upper_quarter(crop).shape,(26,51,3))

    def test_bad_boxes_fail_closed(self):
        bad_boxes=[
            (), (1,2,3), (0,0,0,50), (20,20,1,50),
            (5,5,8,7), (101,0,110,70), (0,110,30,120),
            (-40,0,-10,60), (0,0,float("nan"),80),
            (0,0,float("inf"),80), ("x",0,80,100)
        ]
        for rect in bad_boxes:
            with self.subTest(rect=rect),self.assertRaises(ValueError):
                feature.crop_person(self.frame,rect)
        for frame in [self.frame.astype(np.float32),
                      np.zeros((0,30,3),np.uint8),
                      np.zeros((100,100,4),np.uint8)]:
            with self.assertRaises(ValueError):
                feature.crop_person(frame,(0,0,40,40))

    def test_onnx_preprocessing_is_bgr_to_rgb_float32_nchw(self):
        ses=FakeSession(128)
        backend=feature.ONNXEmbeddingBackend(
            ses,vector_dim=128,input_spec=feature.InputSpec(64,64))
        # A pure BGR red crop must become high R plane, low B plane.
        patch=np.full((20,40,3),(0,0,255),dtype=np.uint8)
        result=backend.encode(patch)
        self.assertEqual(result.shape,(128,))
        self.assertEqual(result.dtype,np.float32)
        batch=ses.batches[0]
        expected_red=(1.-.485)/.229
        expected_blue=(0.-.406)/.225
        self.assertAlmostEqual(float(batch[0,0,0,0]),expected_red,places=5)
        self.assertAlmostEqual(float(batch[0,2,0,0]),expected_blue,places=5)
        self.assertAlmostEqual(float(np.linalg.norm(result)),1,places=5)

    def test_onnx_model_contract_rejections(self):
        with self.assertRaisesRegex(ValueError,"float32"):
            feature.ONNXEmbeddingBackend(
                FakeSession(128,dtype="tensor(float16)"),
                vector_dim=128,input_spec=feature.InputSpec(64,64))
        with self.assertRaisesRegex(ValueError,"shape"):
            feature.ONNXEmbeddingBackend(
                FakeSession(128,shape=(1,3,256,128)),
                vector_dim=128,input_spec=feature.InputSpec(64,64))
        with self.assertRaisesRegex(ValueError,"output"):
            feature.ONNXEmbeddingBackend(
                FakeSession(128),vector_dim=128,
                input_spec=feature.InputSpec(64,64),
                output_name="unknown")
        for output in (
            np.zeros((1,128),np.float32),
            np.full((1,128),np.nan,np.float32),
            np.ones((1,127),np.float32),
            np.ones((2,128),np.float32)
        ):
            with self.subTest(shape=output.shape,finite=np.isfinite(output).all()):
                fake=FakeSession(128,payload=output)
                model=feature.ONNXEmbeddingBackend(
                    fake,vector_dim=128,
                    input_spec=feature.InputSpec(64,64))
                with self.assertRaises(ValueError):
                    model.encode(self.frame[20:40,10:50])

    def test_bad_backend_and_missing_weights_fail_closed(self):
        with self.assertRaisesRegex(ValueError,"512"):
            feature.PersonFeatureExtractor(
                StubBackend(2048),StubBackend(128),
                visual_model_id="trained",structural_model_id="trained")
        with self.assertRaisesRegex(ValueError,"identifiers"):
            feature.PersonFeatureExtractor(
                StubBackend(512),StubBackend(128),
                visual_model_id="  ",structural_model_id="trained")
        with self.assertRaisesRegex(ValueError,"local model"):
            feature._existing_model(Path("/no/such/person/model.onnx"),".onnx")
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/"unsafe.onnx"
            f.write_bytes(b"not a real model")
            link=Path(d)/"model.onnx"
            link.symlink_to(f)
            with self.assertRaisesRegex(ValueError,"local model"):
                feature._existing_model(link,".onnx")

    def test_torch_cpu_inference_without_real_images(self):
        try:
            import torch
        except ImportError:
            self.skipTest("PyTorch is optional")
        class TinyFeature(torch.nn.Module):
            def forward(self,x):
                return x.mean(dim=(2,3)).mean(dim=1,keepdim=True).repeat(1,512)
        model=feature.TorchEmbeddingBackend(
            TinyFeature(),input_spec=feature.InputSpec(64,64))
        result=model.encode(self.frame[20:40,10:50])
        self.assertEqual(result.shape,(512,))
        self.assertTrue(np.isfinite(result).all())
        self.assertAlmostEqual(float(np.linalg.norm(result)),1,places=5)


if __name__=="__main__":
    unittest.main(verbosity=2)
