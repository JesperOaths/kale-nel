#!/usr/bin/env python3
"""Synthetic source-safe read-only neural S9 triage regressions."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import hashlib, io, json, tempfile, unittest
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
            def __init__(self):
                self.wfile=io.BytesIO();self.status=None;self.headers=[]
            def go(self,*a,**kw):return 'other'
            def authorized(self):return False
            def send_response(self,status):self.status=status
            def cors(self):pass
            def send_header(self,k,v):self.headers.append((k,v))
            def end_headers(self):pass
        mod.install(H)
        inst=H()
        inst.path=mod.PREFIX
        inst.command='GET'
        with patch.object(mod,'source_metadata',side_effect=AssertionError('read before auth')):
            inst.go()
        self.assertEqual(inst.status,401)
        self.assertEqual(json.loads(inst.wfile.getvalue())['error'],'authentication_required')
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
    def test_live_verified_and_excluded_count_consistency(self):
        model,crops,manual=mod.source_metadata()
        result=mod.calculate_queue(model,crops,manual)
        self.assertEqual(result['indexed_crop_count'],52)
        self.assertEqual(result['verified_crop_count'],len(crops))
        self.assertEqual(result['excluded_count'],len(crops.excluded))
        self.assertEqual(result['count']+result['assigned_s9_count']+result['excluded_count'],52)
        self.assertEqual(len({v['image_id'] for v in result['items']}),result['count'])
        self.assertTrue(all(mod.crop_blob(row) for row in crops.values()))
        for row in result['items']:
            self.assertEqual(row['identity_status'],'unidentified_review_needed')
            self.assertIsNone(row['suggested_assignment'])
            self.assertEqual(len(row['ranked_candidates']),3)
            self.assertGreaterEqual(row['top_two_margin'],0)
            self.assertEqual(row['ranked_candidates'][0]['folder_id'],row['folder_id'])
    @unittest.skipUnless(mod.NATIVE.is_file(),'private native catalog not present in CI')
    def test_native_source_sha_change_still_fails_closed(self):
        native=json.loads(mod.NATIVE.read_text())
        verified=next(iter(mod.source_metadata()[1]))
        native['items'][verified]['sha256']='0'*64
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'catalog.json'
            file.write_text(json.dumps(native))
            with patch.object(mod,'NATIVE',file):
                with self.assertRaisesRegex(ValueError,'native_source_sha_changed'):
                    mod.source_metadata()
    @unittest.skipUnless(mod.NATIVE.is_file(),'private native catalog not present in CI')
    def test_removed_catalog_entry_is_not_served_as_verified(self):
        native=json.loads(mod.NATIVE.read_text())
        verified=next(iter(mod.source_metadata()[1]))
        del native['items'][verified]
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'catalog.json'
            file.write_text(json.dumps(native))
            with patch.object(mod,'NATIVE',file):
                model,crops,manual=mod.source_metadata()
                self.assertNotIn(verified,crops)
                self.assertIn(verified,crops.excluded)
                response=mod.calculate_queue(model,crops,manual)
                self.assertEqual(response['excluded_count'],len(crops.excluded))
                self.assertEqual(response['count']+response['assigned_s9_count']+response['excluded_count'],52)

if __name__=='__main__': unittest.main()

