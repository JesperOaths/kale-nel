import hashlib
import importlib.util
from io import BytesIO
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent.parent
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
client=load('phone_catalog_test_client',Path(__file__).with_name('phone_archive_catalog_v1.py'))
NAME='motion_1792000000000.mp4'
def entry():
    return {'name':NAME,'bytes':200000,'version':'a'*64,'thumbnail':False,'thumbnail_version':'',
            'manifest':{'name':NAME,'bytes':200000,'width':3840,'height':2160,'sha256':'b'*64}}

class Handler:
    command='GET'
    def __init__(self):self.wfile=BytesIO();self.status=None;self.headers={}
    def send_response(self,code):self.status=code
    def send_header(self,key,value):self.headers[key]=value
    def end_headers(self):pass
    def js(self,code,data):self.status=code

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        with patch.dict(sys.modules,{'phone_archive_catalog_v1':client}):
            self.catalog=load('catalog_adapter_test',ROOT/'s9-person-ml-v1/local-sd-catalog.py')
            self.fast=load('fast_adapter_test',ROOT/'s9-native-security/fast-recent-s9-clip-index.py')
        self.proxy=load('proxy_adapter_test',ROOT/'s9-person-ml-v1/s9_sd_proxy_extension.py')
    def test_native_fast_path_preserves_existing_fields_without_adb(self):
        old={'name':NAME,'private_annotation':'preserved'};snapshot={'records':{NAME:entry()}}
        with patch.object(self.fast,'ROOT',self.root),patch.object(self.fast,'adb') as adb:
            updates=self.fast.native_updates({'phone_recordings':[old]},snapshot,self.catalog)
        adb.assert_not_called();self.assertEqual(updates[0]['private_annotation'],'preserved')
        self.assertEqual(updates[0]['phone_catalog_version'],'a'*64)
    def test_unchanged_native_fast_path_skips_images(self):
        snapshot={'records':{NAME:entry()}};old={'name':NAME,'phone_catalog_version':'a'*64}
        with patch.object(client,'cache_thumbnail') as images,patch.object(self.fast,'adb') as adb:
            self.assertEqual(self.fast.native_updates({'phone_recordings':[old]},snapshot,self.catalog),[])
        images.assert_not_called();adb.assert_not_called()
    def test_native_full_path_avoids_per_clip_adb_and_keeps_valid_rows(self):
        calls=[];snapshot={'records':{NAME:entry()}}
        def adb(*args):
            calls.append(args)
            if args[:3]==('shell','ls','-1'):return (NAME+'\n').encode() if 'Security4K' in args[-1] else b''
            raise OSError('legacy_source_absent')
        with patch.object(self.catalog,'ROOT',self.root),patch.object(self.catalog,'PRIVATE_FALLBACK',self.root/'fallback.json'), \
             patch.object(self.catalog,'adb',side_effect=adb),patch.object(self.catalog.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=b'device')), \
             patch.object(client,'load_catalog',return_value=snapshot):self.catalog.main()
        result=json.loads((self.root/'s9-phone-events.json').read_text())
        self.assertEqual(result['total_phone_files'],1);self.assertEqual(result['errors'],[])
        self.assertFalse(any(NAME in str(args) for args in calls))
    def jpeg(self):
        return b'\xff\xd8\xff\xe0'+(500).to_bytes(2,'big')+b'x'*498+b'\xff\xc0\x00\x11\x08\x00\x78\x00\x78\x03'+b'\x01\x11\x00\x02\x11\x00\x03\x11\x00'+b'\xff\xd9'
    def face(self,raw):
        name='motion_1792000000000__fixture__1200_0.jpg'
        return name,{'face_candidates':[{'snapshot_name':name,'snapshot_on_s9':True,
                'snapshot_size':len(raw),'snapshot_sha256':hashlib.sha256(raw).hexdigest()}]}
    def test_face_http_path_preserves_digest_dimensions_without_adb(self):
        raw=self.jpeg();name,record=self.face(raw);h=Handler()
        with patch.dict(sys.modules,{'phone_archive_catalog_v1':client}),patch.object(client,'read_asset',return_value=raw),patch.object(self.proxy.subprocess,'run') as adb:
            self.proxy.serve_face_snapshot(h,name,record)
        adb.assert_not_called();self.assertEqual(h.status,200);self.assertEqual(h.wfile.getvalue(),raw)
    def test_bad_face_bytes_fail_closed_even_when_native_endpoint_answers(self):
        raw=self.jpeg();name,record=self.face(raw);h=Handler()
        with patch.dict(sys.modules,{'phone_archive_catalog_v1':client}),patch.object(client,'read_asset',return_value=b'corrupt'),patch.object(self.proxy.subprocess,'run') as adb:
            self.proxy.serve_face_snapshot(h,name,record)
        adb.assert_not_called();self.assertEqual(h.status,503);self.assertEqual(h.wfile.getvalue(),b'')
    def test_old_app_keeps_existing_verified_face_fallback(self):
        raw=self.jpeg();name,record=self.face(raw);h=Handler()
        with patch.dict(sys.modules,{'phone_archive_catalog_v1':client}),patch.object(client,'read_asset',side_effect=client.Unavailable), \
             patch.object(self.proxy.subprocess,'run',return_value=SimpleNamespace(stdout=raw)) as adb:
            self.proxy.serve_face_snapshot(h,name,record)
        adb.assert_called_once();self.assertEqual(h.status,200)

if __name__=='__main__':unittest.main()
