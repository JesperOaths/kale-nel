#!/usr/bin/env python3
"""Replay the exact V65+OSNet live lineage and exercise Drive-only people."""
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
v60=load('deploy-security-people-v60-coverage');v62=load('deploy-security-people-v62')
v63=load('deploy-automatic-person-ui-v63');v64=load('deploy-drive-review-v64')
v65=load('deploy-security-filing-v65');v66=load('deploy-security-drive-person-v66')
model=load('deploy-s9-reviewed-model-suggestions-v1')
old=at(v66.BEFORE).decode()
live,_=v63.patch_main_js(v62.patched(v60.patch_coverage(at('eaf8a58f1c733dbc9109348725669917eab1bb5b')),at(v62.BASE_SHA),at(v62.NEW_SHA)),at(v63.BEFORE),at(v63.AFTER))
live=v64.patch_js(live,at(v64.BEFORE).decode(),at(v65.BEFORE).decode())
live,_=model.patch(live)
live=v65.patch_js(live,at(v65.BEFORE).decode(),old)
assert v65.sha(live)==v66.LIVE_JS
fresh=v66.patch_js(live,old,at('962b15b04cf3f130e568ba4d014ce5c06533b80f').decode())
assert v66.b.sha(fresh)==v66.ALREADY_JS, 'Installed V66 hash no longer matches exact source replay'
with tempfile.TemporaryDirectory() as directory:
 target=Path(directory)/PREFIX;target.mkdir(parents=True)
 (target/'security-people-v45.js').write_bytes(fresh)
 for name in ('test-people-v45.js','security-people-v45.html'):(target/name).write_bytes(at('962b15b04cf3f130e568ba4d014ce5c06533b80f',name))
 subprocess.run(['node',PREFIX+'test-people-v45.js'],cwd=directory,check=True)
print('DRIVE_PERSON_V66_LIVE_PATCH_REGRESSION_PASS')
