import hashlib
import fcntl
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
        with patch.object(self.catalog,'ROOT',self.root),patch.object(self.catalog,'PRIVATE_FALLBACK',self.root/'fallback.json'),patch.object(self.catalog,'CATALOG_LOCK',self.root/'shared.lock'), \
             patch.object(self.catalog,'adb',side_effect=adb),patch.object(self.catalog.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=b'device')), \
             patch.object(client,'load_catalog',return_value=snapshot):self.catalog.main()
        result=json.loads((self.root/'s9-phone-events.json').read_text())
        self.assertEqual(result['total_phone_files'],1);self.assertEqual(result['errors'],[])
        self.assertFalse(any(NAME in str(args) for args in calls))
    def test_full_phone_outage_does_not_replace_populated_index(self):
        index=self.root/'s9-phone-events.json'
        original={'storage_policy':'local_microSD','phone_recordings':[{'name':NAME,'sd_verified':True}]}
        index.write_text(json.dumps(original));before=index.read_bytes()
        def adb(*args):
            if args[:3]==('shell','ls','-1') and args[-1]==self.catalog.SD:return b''
            raise OSError('phone_disconnected_mid_scan')
        with patch.object(self.catalog,'ROOT',self.root),patch.object(self.catalog,'PRIVATE_FALLBACK',self.root/'fallback.json'), \
             patch.object(self.catalog,'adb',side_effect=adb),patch.object(self.catalog.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=b'device')), \
             patch.object(client,'load_catalog',side_effect=client.Unavailable):
            with self.assertRaises(RuntimeError):self.catalog.build_catalog()
        self.assertEqual(index.read_bytes(),before)
        self.assertFalse((self.root/'fallback.json').exists())
    def test_full_sidecar_failure_does_not_hide_previously_indexed_original(self):
        index=self.root/'s9-phone-events.json'
        index.write_text(json.dumps({'storage_policy':'local_microSD','phone_recordings':[{'name':NAME,'sd_verified':True}]}))
        before=index.read_bytes()
        def adb(*args):
            if args[:3]==('shell','ls','-1'):
                return (NAME+'\n').encode() if 'Security4K' in args[-1] else b''
            raise OSError('sidecar_read_failed')
        with patch.object(self.catalog,'ROOT',self.root),patch.object(self.catalog,'PRIVATE_FALLBACK',self.root/'fallback.json'), \
             patch.object(self.catalog,'adb',side_effect=adb),patch.object(self.catalog.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=b'device')), \
             patch.object(client,'load_catalog',side_effect=client.Unavailable):
            with self.assertRaises(RuntimeError):self.catalog.build_catalog()
        self.assertEqual(index.read_bytes(),before)
        self.assertFalse((self.root/'fallback.json').exists())
    def test_full_successful_listing_can_reconcile_removed_original(self):
        index=self.root/'s9-phone-events.json'
        index.write_text(json.dumps({'storage_policy':'local_microSD','phone_recordings':[{'name':NAME,'sd_verified':True}]}))
        def adb(*args):
            if args[:3]==('shell','ls','-1'):return b''
            raise OSError('legacy_absent')
        with patch.object(self.catalog,'ROOT',self.root),patch.object(self.catalog,'PRIVATE_FALLBACK',self.root/'fallback.json'), \
             patch.object(self.catalog,'adb',side_effect=adb),patch.object(self.catalog.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=b'device')), \
             patch.object(client,'load_catalog',side_effect=client.Unavailable):self.catalog.build_catalog()
        self.assertEqual(json.loads(index.read_text())['phone_recordings'],[])
    def test_fast_defers_while_full_catalog_owns_shared_lock(self):
        lock=self.root/'shared.lock'
        with lock.open('a+') as owner:
            fcntl.flock(owner,fcntl.LOCK_EX)
            with patch.object(self.fast,'CATALOG_LOCK',lock),patch.object(client,'load_catalog') as phone:
                self.fast.main()
            phone.assert_not_called()
    def test_concurrent_newer_index_is_never_replaced_by_older_native_metadata(self):
        index=self.root/'index.json'
        original={'storage_policy':'local_microSD','phone_recordings':[{'name':NAME,'person_score':.7}]}
        newest={'storage_policy':'local_microSD','phone_recordings':[{'name':NAME,'person_score':.99}]}
        index.write_text(json.dumps(original))
        def snapshot():index.write_text(json.dumps(newest));return {'records':{NAME:entry()}}
        with patch.object(self.fast,'INDEX',index),patch.object(self.fast,'LOCK',self.root/'fast.lock'), \
             patch.object(self.fast,'CATALOG_LOCK',self.root/'shared.lock'),patch.object(self.fast,'module',return_value=self.catalog), \
             patch.object(client,'load_catalog',side_effect=snapshot):self.fast.main()
        self.assertEqual(json.loads(index.read_text()),newest)
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
    def test_fast_rechecks_corrupt_thumbnail_without_adb_when_version_unchanged(self):
        record=entry();record.update(thumbnail=True,thumbnail_version="5000:1792000000000")
        dest=self.root/'s9-phone-thumbs'/(NAME+'.thumb.jpg')
        dest.parent.mkdir(parents=True)
        dest.write_bytes(b'\xff\xd8\xff'+b'x'*4997)
        old={'name':NAME,'phone_catalog_version':record['version'],
             'phone_thumbnail_version':record['thumbnail_version']}
        valid=b'\xff\xd8\xff'+b'y'*4995+b'\xff\xd9'
        with patch.object(self.fast,'ROOT',self.root),patch.object(self.fast,'adb') as adb, \
             patch.object(client,'read_asset',return_value=valid) as read:
            updated=self.fast.native_updates({'phone_recordings':[old]},
                                             {'records':{NAME:record}},self.catalog)
        adb.assert_not_called();read.assert_called_once()
        self.assertEqual(len(updated),1)
        self.assertEqual(dest.read_bytes(),valid)

    def test_old_app_keeps_existing_verified_face_fallback(self):
        raw=self.jpeg();name,record=self.face(raw);h=Handler()
        with patch.dict(sys.modules,{'phone_archive_catalog_v1':client}),patch.object(client,'read_asset',side_effect=client.Unavailable), \
             patch.object(self.proxy.subprocess,'run',return_value=SimpleNamespace(stdout=raw)) as adb:
            self.proxy.serve_face_snapshot(h,name,record)
        adb.assert_called_once();self.assertEqual(h.status,200)

if __name__=='__main__':unittest.main()
