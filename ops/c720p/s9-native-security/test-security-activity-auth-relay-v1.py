#!/usr/bin/env python3
"""Prove private recording count relay preserves authentication and archives."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("relay",Path(__file__).with_name("deploy-security-activity-auth-relay-v1.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

PREFIX="""import re
class H:
 def authorized(self):return True
 def empty(self,n):return n
 def archive(self,*a):return a
 def handler(self,head=False):
  if not self.authorized():return self.empty(401)
  path='/new/api/saved'
"""
SUFFIX="""  m=re.fullmatch(r'/(new)/api/saved',path)
  if m:return self.archive(m.group(1),'/api/saved',head)
"""

class Tests(unittest.TestCase):
 def test_injection_keeps_existing_archive_route_and_is_idempotent(self):
  source=PREFIX+SUFFIX
  changed,yes=m.patched(source)
  self.assertTrue(yes)
  self.assertEqual(changed.count(m.MARK),1)
  self.assertIn(SUFFIX,changed)
  self.assertIn("if not self.authorized():return self.empty(401)",changed)
  self.assertIn("if head:return self.empty(405)",changed)
  self.assertIn("return self.archive(m.group(1),'/api/security-recording-activity',False)",changed)
  twice,again=m.patched(changed)
  self.assertFalse(again)
  self.assertEqual(twice,changed)
 def test_missing_auth_and_changed_anchor_fail_closed(self):
  with self.assertRaisesRegex(RuntimeError,"no_existing_authorization_guard"):
   m.patched((PREFIX+SUFFIX).replace("if not self.authorized():return self.empty(401)","pass"))
  with self.assertRaisesRegex(RuntimeError,"signed_archive_route_anchor_changed"):
   m.patched((PREFIX+SUFFIX).replace("/api/saved',head)","/api/saved',False)"))
 def test_does_not_add_mutation_or_unverified_media_routes(self):
  code,_=m.patched(PREFIX+SUFFIX)
  self.assertNotIn("do_POST",code)
  self.assertNotIn("do_DELETE",code)
  self.assertNotIn("security-health-diagnostics-v1.json",code)
  self.assertNotIn("original_sha256",code)
 def test_health_requires_exact_internal_and_relay_match(self):
  activity={"ok":True,"s3_included":False,"media_decoded":False,
   "video_bytes_transferred":False,"total_recordings":271,
   "source_recordings":{"s9_microSD":177,"historical_drive_verified_new":94},
   "operating_days":{"2026-10-19":{}}}
  saved={"events":[{"clip_no":"motion_1792000000000.mp4"}]}
  def source(port,path,limit=3500000):
   if "security-recording-activity" in path:return activity
   return saved
  with patch.object(m,"fetch",side_effect=source),\
       patch.object(m,"service",return_value="active"),\
       patch.object(m,"camera",return_value=True):
   result=m.health()
  self.assertEqual(result["total_recordings"],271)
  self.assertEqual(result["original_clips"],1)
  def tampered(port,path,limit=3500000):
   if "security-recording-activity" in path:
    return activity if port==8795 else {**activity,"total_recordings":270}
   return saved
  with patch.object(m,"fetch",side_effect=tampered),\
       patch.object(m,"service",return_value="active"),\
       patch.object(m,"camera",return_value=True):
   with self.assertRaisesRegex(RuntimeError,"source_parity"):
    m.health()
if __name__=="__main__":unittest.main(verbosity=2)
