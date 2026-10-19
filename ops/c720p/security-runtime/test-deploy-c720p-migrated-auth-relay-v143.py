#!/usr/bin/env python3
"""Pure tests for authenticated path-only migration and fail-closed deploy."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
FILE=ROOT/"deploy-c720p-migrated-auth-relay-v143.py"
spec=importlib.util.spec_from_file_location("mig_auth_v143",FILE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def old():
 return '''class H:
 def authorized(self):return True
 def archive(self,*args):return args
 def empty(self,status):return status
 def do_GET(self): self.go(False)
 def go(self,head=False):
  path=urllib.parse.urlsplit(self.path).path
  if not self.authorized(): return self.empty(401)
  # SECURITY_NATIVE_CAMERA2_RELAY_V18: authenticated GET, read-only metadata
  return self.empty(404)
'''
class Tests(unittest.TestCase):
 def test_inserts_both_routes_behind_existing_auth_only(self):
  source=old().encode()
  result=m.patch_source(source,m.sha(source)).decode()
  self.assertEqual(result.count(m.MARK),1)
  self.assertLess(result.index("if not self.authorized()"),result.index(m.MARK))
  self.assertIn("path=='/new/api/c720p-migrated-clips'",result)
  self.assertIn("r'/(new)/saved/c720p-migrated/clip/",result)
  self.assertIn("return self.archive(",result)
  self.assertIn("'..' in m.group(2)",result)
  self.assertIn("if head:return self.empty(405)",result)
  self.assertEqual(result.count("def go(self,head=False)"),1)
 def test_bad_or_later_revision_refused(self):
  with self.assertRaisesRegex(RuntimeError,"unknown_or_newer_live_relay"):
   m.patch_source(old().encode(),"0"*64)
  prior=old().replace("if not self.authorized()", "if self.authorized()").encode()
  with self.assertRaisesRegex(RuntimeError,"authorization_anchor_missing"):
   m.patch_source(prior,m.sha(prior))
 def test_duplicate_insertion_refused(self):
  first=m.patch_source(old().encode(),m.sha(old().encode()))
  with self.assertRaises(RuntimeError):m.patch_source(first,m.sha(first))
 def test_import_manifest_contract(self):
  from email.message import Message
  class Mock:
   def get_content_type(self):return "application/json"
  good={"ok":True,"schema_version":m.SCHEMA,"not_s9_original_recordings":True,
    "not_person_assignments":True,"total_imported":1,
    "files":[{"name":"clip123.mp4","bytes":120000,"indexed":True}]}
  with patch.object(m,"fetch",return_value=(200,json.dumps(good).encode(),Mock())):
   self.assertEqual(m.manifest(8795),(1,"clip123.mp4"))
  for changed in ({"not_s9_original_recordings":False},{"total_imported":2},
      {"files":[{"name":"../evil.mp4","bytes":120000,"indexed":True}]}):
   doc=dict(good);doc.update(changed)
   with patch.object(m,"fetch",return_value=(200,json.dumps(doc).encode(),Mock())):
    with self.assertRaises(RuntimeError):m.manifest(8795)
 def test_range_verification_refuses_full_download(self):
  from email.message import Message
  h=Message();h["Content-Type"]="video/mp4";h["Content-Range"]="bytes 0-1023/120000"
  for code in (200,206):
   with patch.object(m,"fetch",return_value=(code,b"c"*1024,h)):
    if code==200:
     with self.assertRaises(RuntimeError):m.checked_range(8795,"clip123.mp4")
    else:
     self.assertEqual(len(m.checked_range(8795,"clip123.mp4")),64)
 def test_no_phone_or_person_workflow_modified(self):
  s=FILE.read_text()
  for banned in ("pm install","adb push","am force-stop","ffmpeg",
    "delete_original","review_decide","shutil.rmtree","/storage/9C33-6BBD/"):
   self.assertNotIn(banned,s)
  for required in ("PREVIOUS_SHA=","BACK/","source_backup_verified",
                   "originals_modified","manual_reviews_modified",
                   "Range","unit(\"restart\")"):
   self.assertIn(required,s)
if __name__=="__main__":unittest.main(verbosity=2)
