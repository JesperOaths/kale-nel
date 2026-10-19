#!/usr/bin/env python3
"""Replay the actual deployed UI lineage, then run mixed-source review tests."""
import hashlib
import importlib.util
from pathlib import Path
import subprocess
import tempfile
ROOT=Path(__file__).resolve().parent
PREFIX='ops/c720p/s9-native-security/'
def load(name):
 spec=importlib.util.spec_from_file_location(name,ROOT/(name+'.py'))
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def at(ref,name='security-people-v45.js'):
 return subprocess.check_output(['git','show',ref+':'+PREFIX+name])
v60=load('deploy-security-people-v60-coverage')
v62=load('deploy-security-people-v62')
v63=load('deploy-automatic-person-ui-v63')
v64=load('deploy-drive-review-v64')
v59=at('eaf8a58f1c733dbc9109348725669917eab1bb5b')
v62_js=v62.patched(v60.patch_coverage(v59),at(v62.BASE_SHA),at(v62.NEW_SHA))
live,_=v63.patch_main_js(v62_js,at(v63.BEFORE),at(v63.AFTER))
assert hashlib.sha256(live).hexdigest()==v64.LIVE_JS
fresh=v64.patch_js(live,at(v64.BEFORE).decode(),at('7cd6659c3').decode())
for token in (b'reviewQueueRows',b'fetchAutomatic',b'approvedFolderContext',b'faceFetchError'):
 assert token in fresh,token
with tempfile.TemporaryDirectory() as folder:
 target=Path(folder)/PREFIX;target.mkdir(parents=True)
 (target/'security-people-v45.js').write_bytes(fresh)
 (target/'security-people-v45.html').write_bytes((ROOT/'security-people-v45.html').read_bytes())
 # Live V63 retains V59's unique-original approval counter; mainline's fixture
 # expects a sum of folder summary counts. Preserve the actual live behavior.
 harness=at('7cd6659c3','test-people-v45.js').decode().replace(
  "assert.equal(el('approvalCount').textContent,'3');",
  "assert.equal(el('approvalCount').textContent,'1');")
 (target/'test-people-v45.js').write_text(harness)
 subprocess.run(['node',PREFIX+'test-people-v45.js'],cwd=folder,check=True)
print('DRIVE_REVIEW_V64_ACTUAL_V63_PATCH_AND_WORKFLOW_PASS')
