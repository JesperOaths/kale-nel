#!/usr/bin/env python3
"""Pure patch regression, with no server, camera, or archive effects."""
import importlib.util
from pathlib import Path
import subprocess
root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('p68',root/'deploy-security-group-v70.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
pin='962b15b04cf3f130e568ba4d014ce5c06533b80f'
def at(path,rev=pin):
 return subprocess.check_output(['git','show',rev+':'+path]).decode()
old=at('ops/c720p/s9-native-security/security-people-v45.js')
new=(root/'security-people-v45.js').read_text()
assert p.patch_js(old,old,new)==new.encode()
assert b'function assignedFolders' in p.patch_js(old,old,new)
try:
 p.patch_js(old.replace('function assignedFolder(item){','function overriddenByNewLiveCode(item){'),
  old,new)
except RuntimeError:pass
else:raise AssertionError('concurrent JS modifications must fail closed')
oldhtml=at('ops/c720p/s9-native-security/security-people-v45.html').encode()
html=p.patch_html(oldhtml).decode()
assert html.count('id="approvalAddPerson"')==1
assert html.count('id="approvalMorePeople"')==1
assert 'additional-person-row' in html
assert p.patch_html(html.encode())==html.encode()
print('SECURITY_GROUP_V70_DIFF_AND_FORM_PATCH_PASS')
