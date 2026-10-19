#!/usr/bin/env python3
"""Replay portrait-only patch and reject unknown concurrent People JS changes."""
import importlib.util
import subprocess
from pathlib import Path
BASE=Path(__file__).resolve().parent
def load(name):
 p=BASE/(name+'.py')
 spec=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
v=load('deploy-security-portrait-v71')
old=subprocess.check_output(['git','show',v.BEFORE+':ops/c720p/s9-native-security/security-people-v45.js']).decode()
new=(BASE/'security-people-v45.js').read_text()
patched=v.patch_js(old,old,new).decode()
# V71 deliberately changes only four bounded regions; unrelated source changes
# must never be silently smuggled into the live V70 release.
for start,end in (
 ('function folderApprovedSDClips(id){','function assignedRecordingKeys(folder){'),
 ('function chosenPortrait(f){','function approvedPreviewClip(preview){'),
 ("  badge(media,item.source==='drive'","  if(item.decision==='approved'){"),
 (' const faceMatches=state.faceList.filter(', " paginate($('folderPage')"),
):
 assert v.b.block(patched,start,end)==v.b.block(new,start,end),(start,end)
assert patched.count('Use as portrait')>=1

assert 'assignedFolders(row).includes(id)' in new
assert 'Unverified crop' in new and 'Use as portrait' in new
assert 'approved_clips' in new and 'function fetchAutomatic' in new
assert 'change review decisions' in new or 'change review' in new
try:
 v.patch_js(old.replace('function folderApprovedSDClips(id){','function modifiedLiveFolderApprovedSDClips(id){'),old,new)
except RuntimeError:pass
else:raise AssertionError('concurrent_changes_must_fail_closed')
print('FACE_GALLERY_V71_GUARDED_PATCH_PASS')
