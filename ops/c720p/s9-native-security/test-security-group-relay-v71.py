#!/usr/bin/env python3
"""Isolated V71 relay policy test: no actual HTTP writes or security media."""
import importlib.util
from pathlib import Path
root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('v71',root/'deploy-security-group-relay-v71.py')
v71=importlib.util.module_from_spec(spec);spec.loader.exec_module(v71)
old="""  if path=='/new/api/s9-manual-recording-links':
   if not self.authorized():return self.empty(401)
   if not self.origin_ok() or self.headers.get('X-S9-Manual-Link-Intent')!='manual-original-review-links-v1':return self.empty(403)
   if not isinstance(obj,dict) or set(obj)!={'action','source','name','folder','revision','human_confirmed'}:return self.empty(400)
   if obj.get('human_confirmed') is not True or obj.get('action') not in ('assign','return_to_queue','skip','reject'):return self.empty(400)
  parts=path.strip('/').split('/')
""".encode()
new,already=v71.patch_relay(old)
assert not already
assert new!=old
assert v71.SCHEMA_NEW in new.decode()
assert v71.ACTION_NEW in new.decode()
assert new.decode().count('X-S9-Manual-Link-Intent')==1
assert new.decode().count('self.authorized()')==1
assert new.decode().count('self.origin_ok()')==1
assert 'return self.empty(401)' in new.decode()
assert 'return self.empty(403)' in new.decode()
assert v71.patch_relay(new)==(new,True)
scope={}
compile(new.decode(),'synthetic_authenticated_relay.py','exec')
assert b'X-S9-Manual-Link-Intent' in new
try:
    v71.patch_relay(old.replace(b'self.authorized()',b'not_authorized()'))
except RuntimeError:
    pass
else:
    raise AssertionError('Missing authorization must fail closed')
try:
    v71.patch_relay(old.replace(b"('assign','return_to_queue','skip','reject')",b"('assign',)"))
except RuntimeError:
    pass
else:
    raise AssertionError('Unknown concurrent action changes must fail closed')
print('SECURITY_GROUP_V71_RELAY_CONTRACT_PASS')
