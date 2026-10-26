#!/usr/bin/env python3
"""Pure offline tests: never open a real recording or phone."""
import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

MOD_PATH=pathlib.Path(__file__).with_name('offline_verified_head_region_v1.py')
spec=importlib.util.spec_from_file_location('offline_crop_test_target',MOD_PATH)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def fake_jpeg(width=200,height=400):
    # JPEG SOF marker with the exact dimensions; enough padding to satisfy
    # the file envelope parser, no image decode performed in these tests.
    return (b'\xff\xd8\xff\xc0\x00\x11\x08'
            +height.to_bytes(2,'big')+width.to_bytes(2,'big')
            +b'\x03\x01\x11\x00\x02\x11\x00\x03\x11\x00'
            +b'\x00'*420)

class OfflineCropTests(unittest.TestCase):
    def test_header_dimensions_only(self):
        with tempfile.TemporaryDirectory() as folder:
            image=pathlib.Path(folder)/'src.jpg'
            image.write_bytes(fake_jpeg())
            self.assertEqual(module.dimensions(image),(200,400))
            image.write_bytes(b'\xff\xd8'+b'\x00'*450)
            with self.assertRaisesRegex(ValueError,'jpeg_marker_invalid'):
                module.dimensions(image)
    def test_top_quarter_centered_geometry(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder)
            src=root/'src.jpg';src.write_bytes(fake_jpeg())
            dst=root/'roi.jpg'
            def fake_run(args,**kwargs):
                self.assertEqual(args[args.index('-vf')+1],'crop=150:100:24:0')
                pathlib.Path(args[-1]).write_bytes(fake_jpeg(width=150,height=100))
            with patch.object(module.subprocess,'run',side_effect=fake_run):
                self.assertEqual(module.crop(src,dst)['height'],100)
            self.assertTrue(dst.is_file())
            self.assertEqual(module.dimensions(dst,min_h=16),(150,100))
    def test_symlink_source_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder)
            target=root/'src.jpg';target.write_bytes(fake_jpeg())
            alias=root/'link.jpg';alias.symlink_to(target)
            with self.assertRaisesRegex(ValueError,'source_not_regular'):
                module.check_output(alias)
    def test_file_contract_never_impersonates_face_or_embedding(self):
        source=MOD_PATH.read_text()
        self.assertIn("'identity_verified':False",source)
        self.assertIn("'vector_embedding':None",source)
        self.assertIn('source_body_crop_sha256',source)
        self.assertIn('source_original_sha256',source)
        self.assertIn('historical_original_hash_only',source)
        self.assertNotIn("subprocess.run(['adb'",source)
        self.assertNotIn('rclone',source)

if __name__=='__main__':
    unittest.main()
