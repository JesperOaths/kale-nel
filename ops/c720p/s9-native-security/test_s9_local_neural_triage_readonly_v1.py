#!/usr/bin/env python3
"""Synthetic source-safe read-only neural S9 triage regressions."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import hashlib, tempfile, unittest
from unittest.mock import patch

P=Path(__file__).with_name('s9_local_neural_triage_readonly_v1.py')
spec=importlib.util.spec_from_file_location('s9_local_neural_triage_readonly_v1',P)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class TriageTests(unittest.TestCase):
    def test_unit_dim_and_zero_refuse(self):
        values=[0.]*1024
        values[50]=7.
        self.assertEqual(mod.unit(values)[50],1.)
        for bad in ([1.]*512,[0.]*1024,[float('nan')]*1024):
            with self.assertRaises(ValueError): mod.unit(bad)
    def test_crop_sha_fails_on_tamper_and_symlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'thumbs';derived=Path(tmp)/'crops'
            source.mkdir();derived.mkdir()
            clip='motion_1791651184206.mp4'
            raw=b'\xff\xd8'+b'k'*550
            roi=b'\xff\xd8'+b'r'*550
            (source/(clip+'.thumb.jpg')).write_bytes(raw)
            (derived/('a'*64+'.jpg')).write_bytes(roi)
            row={'clip_id':clip,'image':'a'*64+'.jpg','roi_id':'a'*64,
                'derived_sha256':hashlib.sha256(roi).hexdigest(),
                'cached_thumbnail_sha256':hashlib.sha256(raw).hexdigest()}
            with patch.object(mod,'THUMBS',source),patch.object(mod,'CROPS',derived):
                self.assertEqual(mod.crop_blob(row),roi)
                (derived/row['image']).write_bytes(roi+b'changed')
                with self.assertRaises(ValueError):mod.crop_blob(row)
                (derived/row['image']).unlink()
                (derived/row['image']).symlink_to(source/(clip+'.thumb.jpg'))
                with self.assertRaises(ValueError):mod.crop_blob(row)
    def test_unauthenticated_request_denied_without_disk_read(self):
        class H:
            def go(self,*a,**kw):return 'other'
            def authorized(self):return False
            def js(self,status,data):return status,data
        mod.install(H)
        inst=H()
        inst.path=mod.PREFIX
        inst.command='GET'
        with patch.object(mod,'source_metadata',side_effect=AssertionError('read before auth')):
            code,result=inst.go()
        self.assertEqual(code,401)
        self.assertEqual(result['error'],'authentication_required')
        inst.path='/unrelated/path'
        self.assertEqual(inst.go(),'other')
    def test_readonly_no_decision_and_no_original_proof_path(self):
        source=P.read_text()
        self.assertNotIn('opened_ticket',source)
        self.assertNotIn('preview_ticket',source)
        self.assertNotIn('original_opened',source)
        self.assertNotIn('phone_run(',source)
        self.assertNotIn('adb ',source)
        self.assertIn("'review_writes_enabled':False",source)
        self.assertIn("'automatic_assignments':0",source)
        self.assertIn('self.authorized()',source)

class DeviceData(unittest.TestCase):
    @unittest.skipUnless(mod.MODEL.is_file() and mod.S9.is_file(),'private corpus not present in CI')
    def test_49_pending_and_3_assigned_verified_live_source(self):
        model,crops,manual=mod.source_metadata()
        result=mod.calculate_queue(model,crops,manual)
        self.assertEqual(result['count'],49)
        self.assertEqual(len(result['assigned_s9_crops']),3)
        self.assertEqual(len(crops),52)
        self.assertEqual(len({v['image_id'] for v in result['items']}),49)
        self.assertTrue(all(mod.crop_blob(row) for row in crops.values()))

if __name__=='__main__': unittest.main()

