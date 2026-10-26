#!/usr/bin/env python3
"""Read-only Drive crop route works on native H without .js()."""
from __future__ import annotations
import importlib.util,io,json,unittest
from pathlib import Path
from unittest.mock import patch

P=Path(__file__).with_name('s9_verified_cranial_roi_routes_v1.py')
spec=importlib.util.spec_from_file_location('tested_historical_rois',P)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class Handler:
    def __init__(self):
        self.path=mod.PREFIX
        self.command='GET'
        self.status=None
        self.headers=[]
        self.wfile=io.BytesIO()
    def authorized(self):return False
    def go(self,*a,**kw):return 'existing_routes'
    def send_response(self,code):self.status=code
    def cors(self):pass
    def send_header(self,k,v):self.headers.append((k,v))
    def end_headers(self):pass

class ReadOnlyRoute(unittest.TestCase):
    def test_auth_gate_prevents_source_read(self):
        class H(Handler):pass
        mod.install(H);s=H()
        with patch.object(mod,'verified_records',side_effect=AssertionError('read_before_auth')):
            s.go()
        self.assertEqual(s.status,401)
        self.assertEqual(json.loads(s.wfile.getvalue())['error'],'authentication_required')
        s.path='/unrelated/path'
        self.assertEqual(s.go(),'existing_routes')
    def test_no_json_helper_needed_and_native_response(self):
        class H(Handler):
            def authorized(self):return True
        mod.install(H);s=H()
        with patch.object(mod,'verified_records',return_value=([{
            'source':'drive','clip':'example.mp4','image_id':'a'*64}],{})):
            s.go()
        self.assertEqual(s.status,200)
        data=json.loads(s.wfile.getvalue())
        self.assertEqual(data['schema'],'verified-cranial-rois-v1')
        self.assertEqual(data['count'],1)
        self.assertEqual(dict(s.headers)['Cache-Control'],'private, no-store')
    def test_original_video_review_not_changed(self):
        src=P.read_text()
        self.assertNotIn('opened_ticket',src)
        self.assertNotIn('phone_run(',src)
        self.assertNotIn('do_POST',src)
        self.assertNotIn('self.js(',src)
    @unittest.skipUnless(mod.MANIFEST.is_file(),'private Drive index not present in CI')
    def test_real_108_digest_verified(self):
        rows,lookup=mod.verified_records()
        self.assertEqual(len(rows),108)
        self.assertEqual(len(lookup),108)
if __name__=='__main__':unittest.main()

