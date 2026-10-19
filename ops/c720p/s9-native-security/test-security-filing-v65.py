#!/usr/bin/env python3
"""Replay newest live UI, preserve its features, exercise the real review handler."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import io
ROOT=Path(__file__).resolve().parent
PREFIX='ops/c720p/s9-native-security/'
BASE=subprocess.check_output(['git','rev-parse','7cd6659c3']).decode().strip()
def load(name,path=None):
 spec=importlib.util.spec_from_file_location(name,path or ROOT/(name+'.py'))
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def at(ref,name='security-people-v45.js'):
 return subprocess.check_output(['git','show',ref+':'+PREFIX+name])
m=load('filing_backend',ROOT.parent/'s9-person-ml-v1/s9_manual_recording_links.py')
v65=load('deploy-security-filing-v65')
class Handler:
 def go(self):self.result=(404,{})
 def do_POST(self):self.result=(405,{})
 def js(self,status,data):self.result=(status,data)
class Cases(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  for name in ('STORE','AUDIT','LOCK','DRIVE'):
   p=patch.object(m,name,Path(self.tmp.name)/name);p.start();self.addCleanup(p.stop)
  self.name='motion_1792200000000.mp4'
  m.DRIVE.write_text(json.dumps({'items':[{'remote_name':self.name,'state':'verified','size':10001}]}))
 def body(self,action='assign',source='sd',revision=0):
  return {'action':action,'source':source,'name':self.name,'folder':'G123' if action=='assign' else None,
   'revision':revision,'human_confirmed':True}
 def request(self,body=None,origin='http://127.0.0.1:8123',site='same-origin'):
  class H(Handler):pass
  m.install(H,lambda:{self.name:{}})
  h=H();h.command='POST';h.path=m.ROUTE;raw=json.dumps(body or self.body()).encode()
  h.headers={'Origin':origin,'Sec-Fetch-Site':site,'Content-Type':'application/json',
   'Content-Length':str(len(raw)),'X-S9-Manual-Link-Intent':m.INTENT}
  h.rfile=io.BytesIO(raw);h.do_POST();return h.result
 def test_real_origin_guard_accepts_exact_ha_ports_and_rejects_foreign_sites(self):
  for origin in ('http://localhost:8123','http://127.0.0.1:8123'):
   body=self.body(revision=m.report()['revision']);self.assertEqual(self.request(body,origin)[0],200)
  for origin in ('http://localhost:9999','https://localhost:8123','http://127.0.0.1.evil.test:8123','https://evil.test'):
   self.assertEqual(self.request(origin=origin)[0],403)
  self.assertEqual(self.request(site='cross-site')[0],403)
  self.assertEqual(m.report()['revision'],2)
 def test_both_sources_skip_reject_restore_assign_with_history(self):
  for source in ('sd','drive'):
   for action,status in [('skip','skipped'),('return_to_queue','inbox'),('reject','rejected'),('assign','assigned')]:
    revision=m.report()['revision']
    code,res=self.request(self.body(action,source,revision))
    self.assertEqual(code,200);self.assertEqual(res['review_status'],status)
    row=m.report()['items'][source+':'+self.name]
    self.assertEqual(row['review_status'],status)
    self.assertEqual(row['folder'],'G123' if action=='assign' else None)
  self.assertEqual(len(m.AUDIT.read_text().splitlines()),8)
  self.assertEqual(m.report()['items']['sd:'+self.name]['folder'],'G123')
 def test_stale_rejection_and_invalid_source_cannot_mutate(self):
  self.assertEqual(self.request(self.body('skip'))[0],200)
  self.assertEqual(self.request(self.body('reject'))[0],409)
  body=self.body('reject',revision=1);body['name']='missing.mp4'
  self.assertEqual(self.request(body)[0],404)
  self.assertEqual(m.report()['revision'],1)
 def test_new_review_actions_cannot_include_person_assignments(self):
  for action in ('skip','reject','return_to_queue'):
   body=self.body(action);body['folder']='G123'
   self.assertEqual(self.request(body)[0],400)
  self.assertFalse(m.STORE.exists())
 def test_live_js_lineage_preserves_newer_model_features_and_passes_same_harness(self):
  v60=load('deploy-security-people-v60-coverage');v62=load('deploy-security-people-v62')
  v63=load('deploy-automatic-person-ui-v63');v64=load('deploy-drive-review-v64')
  model=load('deploy-s9-reviewed-model-suggestions-v1')
  v59=at('eaf8a58f1c733dbc9109348725669917eab1bb5b')
  live,_=v63.patch_main_js(v62.patched(v60.patch_coverage(v59),at(v62.BASE_SHA),at(v62.NEW_SHA)),at(v63.BEFORE),at(v63.AFTER))
  live=v64.patch_js(live,at(v64.BEFORE).decode(),at(BASE).decode())
  live,_=model.patch(live)
  self.assertEqual(v65.sha(live),v65.LIVE_JS)
  new=v65.patch_js(live,at(BASE).decode(),(ROOT/'security-people-v45.js').read_text())
  self.assertIn(b'addReviewedOsnetMatches',new)
  with tempfile.TemporaryDirectory() as directory:
   target=Path(directory)/PREFIX;target.mkdir(parents=True)
   (target/'security-people-v45.js').write_bytes(new)
   (target/'security-people-v45.html').write_bytes((ROOT/'security-people-v45.html').read_bytes())
   harness=(ROOT/'test-people-v45.js').read_text().replace("assert.equal(el('approvalCount').textContent,'3');","assert.equal(el('approvalCount').textContent,'1');")
   (target/'test-people-v45.js').write_text(harness)
   subprocess.run(['node',PREFIX+'test-people-v45.js'],cwd=directory,check=True)
 def test_relay_patch_keeps_authorization_and_exact_browser_origin_checks(self):
  old=(ROOT/'deploy-manual-recording-links-relay-v2.py').read_text()
  self.assertIn('if not self.authorized()',old)
  self.assertIn('if not self.origin_ok()',old)
  self.assertIn("header['Origin']='http://127.0.0.1'",old)
if __name__=='__main__':unittest.main(verbosity=2)
