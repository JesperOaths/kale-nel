#!/usr/bin/env python3
"""Offline SHA, HEAD, negative Range and browser privacy proof for six JPEGs."""
import ast
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT=Path(__file__).resolve().parent
PATH=ROOT/"smoke-c720p-all-migrated-jpegs-v181.py"
spec=importlib.util.spec_from_file_location("smoke_jpeg_v181",PATH)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def jpeg(i):
 return b"\xff\xd8\xff"+bytes([65+i])*1200+b"\xff\xd9"

class Response:
 status=200
 def __init__(self,body,head=False):
  self.body=b"" if head else body
  self.headers={"Content-Type":"image/jpeg",
                "Content-Length":str(len(body)),
                "Cache-Control":"private,no-store"}
 def __enter__(self):return self
 def __exit__(self,*args):return False
 def read(self,limit=-1):return self.body[:limit]

class Tests(unittest.TestCase):
 def rows(self):
  return {"image"+str(i)+".jpg":{
   "bytes":len(jpeg(i)),
   "sha256":hashlib.sha256(jpeg(i)).hexdigest()}
   for i in range(6)}
 def test_six_jpegs_verified_both_ports_and_head_range_refusal(self):
  checks=[]
  def response(port,name,method="GET",headers=None):
   self.assertIn(port,(8794,8795))
   i=int(name[5:-4])
   checks.append((port,method,headers))
   if headers and headers.get("Range"):
    raise HTTPError("http://127.0.0.1",400,"rejected",{},None)
   return Response(jpeg(i),head=(method=="HEAD"))
  with patch.object(m,"fetch",side_effect=response):
   s=m.host_check(self.rows())
  self.assertEqual(s["sha256_matched_on_both_private_ports"],6)
  self.assertEqual(s["head_and_range_negative_tests_each"],12)
  self.assertEqual(len(checks),36)
 def test_corrupt_or_missing_evidence_denied(self):
  def response(port,name,method="GET",headers=None):
   if method=="HEAD":return Response(jpeg(0),head=True)
   if headers:raise HTTPError("http://127.0.0.1",400,"rejected",{},None)
   return Response(jpeg(0))
  with patch.object(m,"fetch",side_effect=response):
   with self.assertRaisesRegex(RuntimeError,"snapshot_sha_or_http_contract_mismatch"):
    m.host_check(self.rows())
 def test_catalog_parity_with_stable_private_names(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/"events.json"
   data=[{"clip":"clips/motion"+str(i)+".mp4",
          "snapshot":"snaps/image"+str(i)+".jpg"} for i in range(6)]
   p.write_text(json.dumps(data))
   class Evidence:
    def read_proof(self):return self_rows
   self_rows=self.rows()
   with patch.object(m,"EVENTS",p),patch.object(m,"load",return_value=Evidence()),patch.object(m,"EXPECTED_BYTES",sum(v["bytes"] for v in self_rows.values())):
    self.assertEqual(m.evidence(),self_rows)
    data[0]["snapshot"]="snaps/../../secrets.jpg"
    p.write_text(json.dumps(data))
    with self.assertRaisesRegex(RuntimeError,"unsafe_legacy_event_media_path"):
     m.evidence()
 def test_browser_aggregate_only_exact_evidence_accepted(self):
  proof={"ok":True,"authenticated_snapshot_gets":6,"signed_urls":6,
      "browser_decoded_jpegs":6,"browser_snapshot_total_bytes":1_956_743,
      "private_filenames_not_returned":True,"signed_urls_not_returned":True,
      "no_media_changes":True,"no_review_changes":True}
  self.assertTrue(m.browser_validate(proof)["authenticated_all_six_jpegs"])
  for key,value in (("browser_decoded_jpegs",5),("signed_urls",5),
                    ("browser_snapshot_total_bytes",2),
                    ("signed_urls_not_returned",False)):
   with self.subTest(key=key),self.assertRaisesRegex(RuntimeError,"browser_jpeg_aggregate"):
    m.browser_validate({**proof,key:value})
  js=m.browser_script()
  self.assertIn("createImageBitmap(",js)
  self.assertIn("C720PSecureRelay",js)
  self.assertIn("signed_urls_not_returned:true",js)
  self.assertNotIn("return {name:",js)
 def test_source_has_no_save_delete_restart_or_capture_controls(self):
  tree=ast.parse(PATH.read_text())
  calls=[n.func.attr for n in ast.walk(tree) if isinstance(n,ast.Call)
    and isinstance(n.func,ast.Attribute)]
  for forbidden in ("unlink","rmtree","replace","write_text",
                    "write_bytes","remove","chmod","restart","Popen"):
   self.assertNotIn(forbidden,calls)
  source=PATH.read_text()
  for forbidden in ("adb push","adb shell rm","pm install","DELETE FROM",
                    "review_decide","getUserMedia"):
   self.assertNotIn(forbidden,source)
  self.assertIn("c720p_mp4s_and_jpegs_still_required",source)

if __name__=="__main__":unittest.main(verbosity=2)
