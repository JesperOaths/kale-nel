#!/usr/bin/env python3
"""Replay exact historical V66 and verify non-destructive V68 delta in isolation."""
import importlib.util
import runpy
import subprocess
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent
PREFIX='ops/c720p/s9-native-security/'
def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    return mod
v68=load(ROOT/'deploy-security-group-v68.py','group_v68')
data=runpy.run_path(str(ROOT/'test-security-drive-person-v66.py'))
old=data['fresh']
assert v68.b.sha(old)==v68.LIVE_JS
source=(ROOT/'security-people-v45.js').read_text()
patched=v68.patch_js(old,source)
assert b'function assignedFolders(item){' in patched
assert b'function addApprovalPerson(value=' in patched
assert b'const recheck=0;' in patched
assert b'async function searchClothingMatches(' in patched
assert b'addReviewedOsnetMatches' in patched
assert b'approvedFolderContext' in patched
with tempfile.TemporaryDirectory() as d:
    output=Path(d)/'people.js';output.write_bytes(patched)
    subprocess.run(['node','--check',str(output)],check=True)
html=data['at'](data['V66_RELEASE'],'security-people-v45.html')
modified=v68.patch_html(html)
assert b'id="approvalAddPerson"' in modified
assert b'id="approvalMorePeople"' in modified
assert b'Confirm &amp; keep' in modified
assert b'approval-extra-row' in modified
# Test the relay's allow-list in isolation using the historical V65 replacement.
relay="""  if path=='/new/api/s9-manual-recording-links':
   allowed=('assign','return_to_queue','skip','reject')
   # keep X-S9-Manual-Link-Intent and Origin
  parts=path.strip('/').split('/')
"""
altered=v68.patch_relay(relay.encode()).decode()
assert "('assign','assign_many','return_to_queue','skip','reject')" in altered
print('SECURITY_GROUP_V68_IMMUTABLE_V66_DELTA_PASS',v68.b.sha(patched))
