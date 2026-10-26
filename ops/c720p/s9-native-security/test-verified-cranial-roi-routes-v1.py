#!/usr/bin/env python3
"""Live source-linked 108 crop integration regression, no phone/service writes."""
import io
import unittest
from pathlib import Path
import s9_verified_cranial_roi_routes_v1 as mod

ROOT=Path(__file__).resolve().parent

class Fake:
    def __init__(self,path,authorized=True,method='GET'):
        self.path=path;self.auth=authorized;self.command=method
        self.headers_sent={};self.wfile=io.BytesIO();self.code=None;self.json_out=None
    def authorized(self):return self.auth
    def go(self,*a,**k):self.code=499
    def js(self,code,data):self.code=code;self.json_out=data
    def send_response(self,code):self.code=code
    def cors(self):pass
    def send_header(self,k,v):self.headers_sent[k]=v
    def end_headers(self):pass

mod.install(Fake)

class ReadOnlyROIs(unittest.TestCase):
    def test_provenance_and_hashes(self):
        rows,index=mod.verified_records()
        self.assertEqual(len(rows),108)
        self.assertEqual(len(index),108)
        self.assertEqual(len({r['clip'] for r in rows}),40)
        self.assertTrue(all(r['source']=='drive' and r['face_detected'] is False and r['identity_verified'] is False for r in rows))
    def test_auth_metadata(self):
        bad=Fake(mod.PREFIX,False)
        bad.go()
        self.assertEqual(bad.code,401)
        good=Fake(mod.PREFIX)
        good.go()
        self.assertEqual(good.code,200)
        self.assertEqual(good.json_out['count'],108)
        self.assertFalse(good.json_out['original_attestation'])
        self.assertFalse(good.json_out['identity_matching'])
    def test_jpeg_bytes_and_bad_path(self):
        rows,_=mod.verified_records()
        one=Fake(mod.PREFIX+'/image/'+rows[0]['image_id'])
        one.go()
        self.assertEqual(one.code,200)
        self.assertEqual(one.headers_sent['Cache-Control'],'private, no-store')
        self.assertEqual(one.headers_sent['Content-Type'],'image/jpeg')
        self.assertTrue(one.wfile.getvalue().startswith(b'\xff\xd8'))
        missing=Fake(mod.PREFIX+'/image/'+'0'*64)
        missing.go()
        self.assertEqual(missing.code,404)
    def test_no_api_proof_bypass_and_ui_consistency(self):
        route=(ROOT/'s9_verified_cranial_roi_routes_v1.py').read_text()
        self.assertNotIn('opened_ticket',route)
        self.assertNotIn('opened_attestor',route)
        self.assertNotIn('phone_run',route)
        people=(ROOT/'security-people-v328.js').read_text()
        self.assertIn('localDriveRoi(f)',people)
        self.assertIn("state.driveRois=collected",people)
        self.assertIn("rows?.length!==1",people)
        suggestions=(ROOT/'folder-suggestions-top-tab-v4.js').read_text()
        self.assertIn('renderHistoricalRois(cardsHost)',suggestions)
        self.assertIn('showProvisional: true',suggestions)
        self.assertIn("requiredMode: VECTOR_MODE",suggestions)
        page=(ROOT/'security-people-v53.html').read_text()
        self.assertIn('security-people-v328.js?v=historical-verified-crops-v5-20261026',page)
        self.assertIn('folder-suggestions-top-tab-v4.js?v=historical-verified-crops-v5-20261026',page)
if __name__=='__main__':
    unittest.main()

