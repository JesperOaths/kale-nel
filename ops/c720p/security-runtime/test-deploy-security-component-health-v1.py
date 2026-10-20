#!/usr/bin/env python3
"""Scratch-only two-target deploy tests; no service, camera or network access."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('health_deploy',HERE/'deploy-security-component-health-v1.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
HELPER=b'''import json
def camera():return {'mode':'watching','temperature_c':32}
def archive():return {'synthetic_original_a','synthetic_original_b'}
def reviews():return {'synthetic_review':'unchanged'}
def request(url,method='GET',headers=None):
 if '192.168.' in url:return 401,b'',{}
 if method=='HEAD':return 405,b'',{}
 if method=='POST':return 404,b'',{}
 d={'ok':True,'schema_version':'security_component_health_v1','read_only':True,
    'media_read':False,'manual_reviews_modified':False,'workers_started':False,
    'rendered_playback_verified':False,'components':{k:{'status':'unavailable'} for k in ('infrastructure','evidence','saved_timing')}}
 return 200,json.dumps(d).encode(),{'Cache-Control':'private, no-store'}
if __name__=='__main__':raise RuntimeError('helper_main_must_never_run')
'''

class DeployTests(unittest.TestCase):
 def setUp(self):
  self.stack=contextlib.ExitStack();self.addCleanup(self.stack.close)
  self.base=Path(self.stack.enter_context(tempfile.TemporaryDirectory(dir=os.environ.get('C720P_TEST_TMPDIR'))))
  self.stage=self.base/'stage';self.stage.mkdir();self.bin=self.base/'bin';self.bin.mkdir()
  self.targets={n:self.bin/n for n in (m.READER,m.RELAY)}
  self.backups=self.base/'private-backups'
  self.stack.enter_context(mock.patch.object(m,'TARGETS',self.targets))
  self.stack.enter_context(mock.patch.object(m,'BACKUPS',self.backups))
  self.services=self.stack.enter_context(mock.patch.object(m,'service'))
  self.stack.enter_context(mock.patch.object(m,'sync_directory'))
  if os.name=='nt':
   self.stack.enter_context(mock.patch.object(m.os,'fchmod',lambda fd,mode:None,create=True))
   self.stack.enter_context(mock.patch.object(m.os,'getuid',lambda:0,create=True))
   self.stack.enter_context(mock.patch.object(m.os,'getgid',lambda:0,create=True))
   self.stack.enter_context(mock.patch.object(m.stat,'S_IMODE',lambda v:0o700 if stat.S_ISDIR(v) else 0o600))
  self.old=b'ORIGINAL_RELAY=True\n';self.targets[m.RELAY].write_bytes(self.old)
  (self.stage/m.READER).write_bytes(b'COMPONENT_READER=True\n')
  (self.stage/m.RELAY).write_bytes(b'COMPONENT_RELAY=True\n')
  (self.stage/m.HELPER).write_bytes(HELPER)
  self.manifest={'release':m.RELEASE,'verification_helper':{'staged':m.HELPER,'sha256':m.sha(HELPER)},'files':[
    {'target':str(self.targets[n]),'staged':n,'before_sha256':None if n==m.READER else m.sha(self.old),
     'after_sha256':m.sha((self.stage/n).read_bytes())} for n in (m.READER,m.RELAY)]}
  self.save_manifest()
 def save_manifest(self):
  raw=m.encoded(self.manifest);(self.stage/'manifest.json').write_bytes(raw);self.digest=m.sha(raw)
 def test_preflight_is_read_only_with_exact_two_target_plan(self):
  result=m.deploy(self.stage,self.digest)
  self.assertEqual(result['state'],'read_only_preflight')
  self.assertEqual(set(result['targets']),{m.READER,m.RELAY})
  self.assertFalse(self.targets[m.READER].exists());self.assertFalse(self.backups.exists())
  self.assertEqual(self.targets[m.RELAY].read_bytes(),self.old)
  self.assertEqual(self.services.call_args_list,[mock.call('is-active')])
 def test_apply_only_restarts_lan_relay_and_preserves_review_original_contract(self):
  result=m.deploy(self.stage,self.digest,True)
  self.assertEqual(result['state'],'backend_deployed_verified')
  self.assertEqual(result['services_restarted'],[m.SERVICE])
  self.assertTrue(result['manual_reviews_unchanged']);self.assertEqual(result['originals_preserved'],2)
  self.assertFalse(result['rendered_browser_verified'])
  self.assertEqual(result['route']['unsigned_lan_status'],401)
  self.assertEqual(result['route']['head_status'],405)
  self.assertEqual(result['route']['post_status'],404)
  self.assertEqual(self.services.call_args_list,[mock.call('is-active'),mock.call('restart')])
  receipt=Path(result['receipt']);self.assertEqual(stat.S_IMODE(receipt.stat().st_mode),0o600)
  self.assertEqual((receipt.parent/m.RELAY).read_bytes(),self.old)
  self.assertFalse((receipt.parent/m.READER).exists())
 def test_source_or_approved_helper_drift_fails_before_write(self):
  self.targets[m.RELAY].write_bytes(b'new_owner=True\n')
  with self.assertRaisesRegex(RuntimeError,'concurrent_source_change'):m.deploy(self.stage,self.digest,True)
  self.assertFalse(self.backups.exists())
  self.targets[m.RELAY].write_bytes(self.old)
  (self.stage/m.HELPER).write_bytes(HELPER+b'UNREVIEWED=True\n')
  with self.assertRaisesRegex(RuntimeError,'verification_helper_changed'):m.prepare(self.stage,self.digest)
  self.assertFalse(self.targets[m.READER].exists())
 def test_target_allowlist_refuses_unrelated_file(self):
  self.manifest['files'][0]['target']=str(self.base/'unrelated.py');self.save_manifest()
  with self.assertRaisesRegex(RuntimeError,'unsafe_or_duplicate_target'):m.deploy(self.stage,self.digest,True)
  self.assertFalse(self.backups.exists())
 def test_postreplace_fsync_failure_tracks_attempt_and_removes_only_new_reader(self):
  fired=[]
  def fail_once(parent):
   if parent==self.bin and self.targets[m.READER].exists() and not fired:
    fired.append(True);raise OSError('synthetic postreplace fsync failure')
  with mock.patch.object(m,'sync_directory',side_effect=fail_once):
   with self.assertRaisesRegex(OSError,'postreplace'):m.deploy(self.stage,self.digest,True)
  self.assertTrue(fired);self.assertFalse(self.targets[m.READER].exists())
  self.assertEqual(self.targets[m.RELAY].read_bytes(),self.old)
  receipt=json.loads(next(self.backups.glob('*/receipt.json')).read_bytes())
  self.assertEqual(receipt['restored'],[m.READER]);self.assertFalse(receipt['concurrent_conflicts_preserved'])
 def test_unknown_concurrent_extension_preserves_dependency_pair(self):
  def conflict(verifier):
   self.targets[m.RELAY].write_bytes(b'NEW_OWNER_EXTENSION=True\n')
   raise RuntimeError('synthetic concurrent edit')
  with mock.patch.object(m,'verify_route',side_effect=conflict):
   with self.assertRaisesRegex(RuntimeError,'concurrent edit'):m.deploy(self.stage,self.digest,True)
  self.assertEqual(self.targets[m.RELAY].read_bytes(),b'NEW_OWNER_EXTENSION=True\n')
  self.assertEqual(self.targets[m.READER].read_bytes(),(self.stage/m.READER).read_bytes())
  receipt=json.loads(next(self.backups.glob('*/receipt.json')).read_bytes())
  self.assertEqual(receipt['concurrent_conflicts_preserved'],[m.RELAY]);self.assertEqual(receipt['restored'],[])
  self.assertEqual(self.services.call_args_list,[mock.call('is-active'),mock.call('restart')])

if __name__=='__main__':unittest.main()
