#!/usr/bin/env python3
"""Live source-linked 108 crop integration regression, no phone/service writes."""
import io
import hashlib
import json
import tempfile
from unittest.mock import patch
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
    def send_response(self,code):self.code=code
    def cors(self):pass
    def send_header(self,k,v):self.headers_sent[k]=v
    def end_headers(self):pass

mod.install(Fake)

class ReadOnlyROIs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.path=Path(cls.tmp.name)
        photos=cls.path/'images'
        photos.mkdir()
        roi=cls.path/'roi'
        roi.mkdir()
        entries={};rows=[]
        for i in range(108):
            clip=f'DRIVE_{i//3:03d}.mp4'
            src_name=f'{i:024x}.jpg'
            src=bytes((255,216))+bytes([i%251])*550
            derived=bytes((255,216))+bytes([(i+13)%251])*455
            src_sha=hashlib.sha256(src).hexdigest()
            derived_sha=hashlib.sha256(derived).hexdigest()
            (photos/src_name).write_bytes(src)
            (roi/(src_sha+'.cranial-roi.jpg')).write_bytes(derived)
            entry=entries.setdefault(clip,{
                'source':'drive','name':clip,
                'original_sha256':'a'*64,'revision':'synthetic-v1',
                'tracks':[]})
            entry['tracks'].append({'body_image':src_name,'images':{src_name:{
                'kind':'body-v35','sha256':src_sha
            }}})
            rows.append({'source':'drive','source_clip_key':clip,
                'source_original_sha256':'a'*64,'source_revision':'synthetic-v1',
                'source_body_crop_sha256':src_sha,'output_filename':src_sha+'.cranial-roi.jpg',
                'geometry':{'derived_sha256':derived_sha},
                'identity_verified':False,'face_detected':False,'vector_embedding':None})
        data=json.dumps({'entries':entries},sort_keys=True).encode()
        index=cls.path/'features.json'
        index.write_bytes(data)
        manifest=roi/'manifest.json'
        manifest.write_text(json.dumps({
            'schema':'offline-head-region-crops-v1',
            'complete':True,'count':108,'unique_outputs':108,'eligible':108,'errors':{},
            'records':rows,'source_index_sha256':hashlib.sha256(data).hexdigest()
        }))
        cls.patches=[patch.object(mod,'ROOT',roi),patch.object(mod,'MANIFEST',manifest),
            patch.object(mod,'ORIGINAL_FEATURE_INDEX',index),
            patch.object(mod,'ORIGINAL_BODY_IMAGES',photos)]
        for item in cls.patches:item.start()

    @classmethod
    def tearDownClass(cls):
        for item in reversed(cls.patches):item.stop()
        cls.tmp.cleanup()

    def test_provenance_and_hashes(self):
        rows,index=mod.verified_records()
        self.assertEqual(len(rows),108)
        self.assertEqual(len(index),108)
        self.assertEqual(len({r['clip'] for r in rows}),36)
        self.assertTrue(all(r['source']=='drive' and r['face_detected'] is False and r['identity_verified'] is False for r in rows))
    def test_auth_metadata(self):
        bad=Fake(mod.PREFIX,False)
        bad.go()
        self.assertEqual(bad.code,401)
        good=Fake(mod.PREFIX)
        good.go()
        self.assertEqual(good.code,200)
        doc=json.loads(good.wfile.getvalue())
        self.assertEqual(doc['count'],108)
        self.assertFalse(doc['original_attestation'])
        self.assertFalse(doc['identity_matching'])
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
        self.assertIn('security-people-v328.js?v=neural-review-handoff-v1-20261026',page)
        self.assertIn('folder-suggestions-top-tab-v4.js?v=historical-verified-crops-v5-20261026',page)
if __name__=='__main__':
    unittest.main()

