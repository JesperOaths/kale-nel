#!/usr/bin/env python3
"""Entirely synthetic SD/Drive original-byte attestations, no real media."""
import datetime as dt
import hashlib
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
FILE=ROOT/"s9_manual_original_byte_attestor_v252.py"
BIND=ROOT/"s9_manual_media_digest_binding_v1.py"
spec=importlib.util.spec_from_file_location("task21_original_v252",FILE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
bspec=importlib.util.spec_from_file_location("task21_binding_v1",BIND)
binding=importlib.util.module_from_spec(bspec);bspec.loader.exec_module(binding)
NAME="motion_1792500000000.mp4"
DRIVE="archived_001.mp4"
H="a"*64
def detail(uid="sd:"+NAME,revision="rev:"+"b"*64,size=13000):
 return {"source_identity":uid,"source_revision":revision,"size":size}

class Tests(unittest.TestCase):
 def lock(self,dir):
  p=Path(dir)/"worker.lock";p.write_text("")
  return p
 def test_sd_sha_and_native_source_stability(self):
  with tempfile.TemporaryDirectory() as root:
   lk=self.lock(root)
   att=m.IndependentOriginalAttestor()
   def fake_adb(cmd,timeout=25):
    self.assertIn("sha256sum",cmd)
    return H+"  "+m.SDROOT+"/"+NAME
   with patch.object(m,"LOCK",lk),patch.object(m,"source",return_value=(
        {"bytes":13000},None)),patch.object(m,"native_health"),patch.object(
        m,"sd_revision",return_value=detail()),patch.object(m,"adb",side_effect=fake_adb):
    proof=att.verify_bytes("sd",NAME)
   self.assertEqual(proof["sha256"],H)
   self.assertTrue(proof["verified_original_bytes"])
   self.assertEqual(proof["verifier"],"phone-original-byte-auditor")
   bound=binding.bind_new_decision("sd",NAME,Fixture(att,proof),now=dt.datetime.now(dt.timezone.utc))
   self.assertEqual(bound["status"],"bound_at_decision")
 def test_drive_full_byte_sha_stream_without_file_copy(self):
  cmd=[sys.executable,"-c",
    "import sys;sys.stdout.buffer.write(b'x'*13000)"]
  self.assertEqual(m.drive_bytes_sha(cmd,13000),
      hashlib.sha256(b"x"*13000).hexdigest())
  with self.assertRaises(m.Refused):
   m.drive_bytes_sha(cmd,12999)
 def test_drive_md5_revision_and_original_byte_binding(self):
  cfg={"rclone":"/usr/bin/rclone","rclone_config":"/tmp/secret",
   "remote":"safe","folders":{"new":{"id":"safe-folder"}}}
  remote={"ID":"abcdefghijklmnop","ModTime":"2026-10-21T02:00:00.000Z",
   "Size":13000,"Hashes":{"MD5":"e"*32}}
  with patch.object(m.subprocess,"run",return_value=type("R",(),{
      "returncode":0,"stdout":__import__("json").dumps(remote),"stderr":""})()):
   first=m.drive_revision(DRIVE,{"size":13000},cfg)
   self.assertEqual(first["source_identity"],"drive:abcdefghijklmnop")
   changed={**remote,"Hashes":{"MD5":"f"*32}}
   with patch.object(m.subprocess,"run",return_value=type("R",(),{
      "returncode":0,"stdout":__import__("json").dumps(changed),"stderr":""})()):
    second=m.drive_revision(DRIVE,{"size":13000},cfg)
   self.assertNotEqual(first["source_revision"],second["source_revision"])
  with tempfile.TemporaryDirectory() as root:
   lk=self.lock(root);att=m.IndependentOriginalAttestor()
   with patch.object(m,"LOCK",lk),patch.object(m,"source",return_value=(
        {"size":13000},cfg)),patch.object(m,"native_health"),patch.object(
        m,"drive_revision",return_value=first),patch.object(
        m,"drive_bytes_sha",return_value=H):
    proof=att.verify_bytes("drive",DRIVE)
    self.assertEqual(proof["sha256"],H)
    self.assertEqual(proof["verifier"],"drive-original-byte-auditor")
    fresh=binding.bind_new_decision("drive",DRIVE,Fixture(att,proof),
       now=dt.datetime.now(dt.timezone.utc))
    self.assertEqual(fresh["source_revision"],first["source_revision"])
 def test_source_revision_race_fails_closed_without_review_write(self):
  with tempfile.TemporaryDirectory() as root:
   lk=self.lock(root)
   details=[detail(),detail(revision="rev:"+"c"*64)]
   with patch.object(m,"LOCK",lk),patch.object(m,"source",return_value=(
       {"bytes":13000},None)),patch.object(m,"native_health"),patch.object(
       m,"sd_revision",side_effect=details),patch.object(m,"adb",return_value=
       H+"  "+m.SDROOT+"/"+NAME):
    with self.assertRaisesRegex(m.Refused,"original_changed_while_hashed"):
     m.IndependentOriginalAttestor().verify_bytes("sd",NAME)
 def test_future_bound_state_not_misrepresented(self):
  d={"media_binding":{"status":"bound_at_decision","source":"sd",
    "name":NAME,"source_identity":"sd:"+NAME,
    "source_revision":"rev:"+"b"*64}}
  self.assertEqual(binding.display_status({},None),"historically_unbound")
  self.assertEqual(binding.display_status(d,None),"source_unavailable")
  with patch.object(m.IndependentOriginalAttestor,"current_revision",
       return_value={"source_identity":"sd:"+NAME,"source_revision":"rev:"+"d"*64}):
   self.assertEqual(binding.display_status(d,m.IndependentOriginalAttestor()),
       "revision_mismatch")
 def test_no_public_attestation_or_automated_review_mutations(self):
  source=FILE.read_text()
  for term in ("HttpServer","do_POST","Files.delete(","os.replace(",
    "unlink(","copyfile","getUserMedia(","CameraManager","accept_user_review",
    "assign_person","store.write","update_reviews"):
   self.assertNotIn(term,source)
  self.assertIn('source_revision":"rev:',source)
  self.assertIn("original_changed_while_hashed",source)

class Fixture:
 def __init__(self,att,proof):self.att=att;self.proof=proof
 def verify_bytes(self,source,name):return self.proof
 def current_revision(self,source,name):
  return {"source_identity":self.proof["source_identity"],
          "source_revision":self.proof["source_revision"]}

if __name__=="__main__":unittest.main(verbosity=2)
