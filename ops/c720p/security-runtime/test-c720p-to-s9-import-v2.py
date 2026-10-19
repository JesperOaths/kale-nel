#!/usr/bin/env python3
"""Offline tests: migrated footage remains private, intact and separately counted."""
import importlib.util,io,json,os,tempfile,time,unittest,hashlib
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch,call
HERE=Path(__file__).resolve().parent
def load(path,name):
 s=importlib.util.spec_from_file_location(name,path)
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
stage=load(HERE/"c720p_to_s9_verified_media_stage_v2.py","stage")
api=load(HERE.parent/"s9-person-ml-v1"/"s9_c720p_imported_media_api_v1.py","api")
def record():
 n="motion_1792000010000.mp4"
 return {"schema_version":api.SCHEMA,"records":{n:{"sd_path":api.SD_ROOT+"/"+n,"bytes":12000,"sha256":"a"*64,"indexed":True}}}
class H:
 def __init__(self,path,method="GET"):
  self.path=path;self.command=method;self.headers={};self.wfile=io.BytesIO();self.messages=[]
 def send_response(self,n):self.messages.append(n)
 def send_header(self,k,v):self.messages.append((k,v))
 def end_headers(self):pass
 def js(self,n,d):self.messages.append(n)
 def go(self):self.messages.append("original")
class Tests(unittest.TestCase):
 def test_all_finalized_including_unindexed(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp);clips=d/"clips";clips.mkdir();old=time.time()-500
   for name in ("motion_1792000010000.mp4","unindexed.mp4"):
    p=clips/name;p.write_bytes(b"x"*12000);os.utime(p,(old,old))
   (clips/"recent.mp4").write_bytes(b"x"*12000)
   outside=d/"outside.mp4";outside.write_bytes(b"x"*12000)
   (clips/"linked.mp4").symlink_to(outside)
   with patch.object(stage,"CLIPS",clips):
    self.assertEqual({p.name for p,_ in stage.candidates()},{"motion_1792000010000.mp4","unindexed.mp4"})
 def test_verified_interrupted_partial_promoted_without_retransfer(self):
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/"motion_1792000010000.mp4"
   path.write_bytes(b"a"*12000)
   old=time.time()-600
   os.utime(path,(old,old))
   stat=path.stat()
   digest=hashlib.sha256(path.read_bytes()).hexdigest()
   # destination absent, partial exists, destination still absent
   simulated=[SimpleNamespace(returncode=1,stderr=b""),SimpleNamespace(returncode=0,stderr=b""),
              SimpleNamespace(returncode=1,stderr=b"")]
   with patch.object(stage.subprocess,"run",side_effect=simulated) as run,       patch.object(stage,"phone_file_matches",side_effect=[False,True,True]) as matches,       patch.object(stage,"camera_ready",return_value=True),       patch.object(stage,"adb") as adb:
    self.assertEqual(stage.copy_one(path,stat,digest),"verified_partial_promoted")
   self.assertEqual(run.call_count,3)
   self.assertEqual(matches.call_count,3)
   self.assertEqual(adb.call_count,1)
   self.assertEqual(adb.call_args.args[0:2],("shell","mv"))
   self.assertTrue(adb.call_args.args[2].endswith(".partial"))
 def test_corrupt_existing_partial_kept_for_investigation(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/"motion_1792000010000.mp4"
   p.write_bytes(b"b"*12000)
   st=p.stat()
   digest=hashlib.sha256(p.read_bytes()).hexdigest()
   with patch.object(stage.subprocess,"run",side_effect=[
            SimpleNamespace(returncode=1,stderr=b""),SimpleNamespace(returncode=0,stderr=b"")]),       patch.object(stage,"phone_file_matches",side_effect=[False,False]),       patch.object(stage,"camera_ready",return_value=True),       patch.object(stage,"adb") as adb:
    with self.assertRaisesRegex(RuntimeError,"preexisting_partial_not_matching_preserved"):
     stage.copy_one(p,st,digest)
    adb.assert_not_called()
 def test_resumed_partial_rechecks_source_and_temperature_before_rename(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/"motion_1792000010000.mp4";p.write_bytes(b"c"*12000)
   st=p.stat();digest=hashlib.sha256(p.read_bytes()).hexdigest()
   for reason,ready,digest_after in (
       ("source_digest_changed_during_copy",[True], "0"*64),
       ("camera_became_unhealthy_before_promotion",[True,False],digest)):
    with self.subTest(reason=reason),         patch.object(stage.subprocess,"run",side_effect=[
            SimpleNamespace(returncode=1,stderr=b""),SimpleNamespace(returncode=0,stderr=b"")]),         patch.object(stage,"phone_file_matches",side_effect=[False,True]),         patch.object(stage,"camera_ready",side_effect=ready),         patch.object(stage,"sha256_file",return_value=digest_after),         patch.object(stage,"adb") as adb:
     with self.assertRaisesRegex(RuntimeError,reason):
      stage.copy_one(p,st,digest)
     adb.assert_not_called()
 def test_existing_final_never_overwritten(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/"motion_1792000010000.mp4";p.write_bytes(b"d"*12000)
   with patch.object(stage,"phone_file_matches",return_value=True),       patch.object(stage,"adb") as adb,       patch.object(stage.subprocess,"run") as cmd:
    self.assertEqual(stage.copy_one(p,p.stat(),hashlib.sha256(p.read_bytes()).hexdigest()),"already_verified")
    adb.assert_not_called()
    cmd.assert_not_called()
 def test_adb_transport_failure_is_never_missing_file(self):
  for status,stderr in ((255,b"device offline"),(1,b"permission denied"),(0,b"transport warning"),(127,b"shell unavailable")):
   with self.subTest(status=status,stderr=stderr), patch.object(
       stage.subprocess,"run",return_value=SimpleNamespace(returncode=status,stderr=stderr)):
    with self.assertRaisesRegex(RuntimeError,"phone_path_existence_indeterminate"):
     stage.phone_path_exists(stage.DEST+"/clip.mp4")
  for status,expected in ((0,True),(1,False)):
   with patch.object(stage.subprocess,"run",return_value=SimpleNamespace(returncode=status,stderr=b"")):
    self.assertIs(stage.phone_path_exists(stage.DEST+"/clip.mp4"),expected)

 def test_indeterminate_destination_or_partial_never_pushes_or_renames(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/"motion_1792000010000.mp4";p.write_bytes(b"e"*12000)
   st=p.stat();digest=hashlib.sha256(p.read_bytes()).hexdigest()
   for probes in ((RuntimeError("phone_path_existence_indeterminate"),),
                  (False,RuntimeError("phone_path_existence_indeterminate")),
                  (False,True,RuntimeError("phone_path_existence_indeterminate"))):
    with self.subTest(probes=len(probes)), patch.object(
         stage,"phone_path_exists",side_effect=probes) as exists, patch.object(
         stage,"phone_file_matches",side_effect=[False,True,True]) as matches, patch.object(
         stage,"camera_ready",return_value=True), patch.object(
         stage,"adb") as adb:
     with self.assertRaisesRegex(RuntimeError,"phone_path_existence_indeterminate"):
      stage.copy_one(p,st,digest)
     self.assertEqual(exists.call_count,len(probes))
     adb.assert_not_called()

 def test_untrusted_phone_checksum_never_satisfies_verification(self):
  for output in ("","malformed",("a"*64)+" /unexpected/file.mp4"):
   with self.subTest(output=output[:14]), patch.object(
        stage,"phone_path_exists",return_value=True), patch.object(
        stage,"adb",side_effect=["12000",output]):
    with self.assertRaisesRegex(RuntimeError,"phone_checksum_response_indeterminate"):
     stage.phone_file_matches(stage.DEST+"/clip.mp4","a"*64,12000)

 def test_missing_file_probe_requires_clean_exit_one(self):
  with patch.object(stage.subprocess,"run",return_value=SimpleNamespace(returncode=255,stderr=b"device offline")), patch.object(stage,"adb") as adb:
   with self.assertRaisesRegex(RuntimeError,"phone_path_existence_indeterminate"):
    stage.phone_file_matches(stage.DEST+"/clip.mp4","a"*64,12000)
   adb.assert_not_called()

 def test_tampered_report_denied(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/"proof.json";p.write_text(json.dumps(record()));p.chmod(0o600)
   self.assertEqual(len(api.read_manifest(p)),1)
   d=record();name=next(iter(d["records"]));d["records"][name]["sd_path"]="/tmp/fake.mp4"
   p.write_text(json.dumps(d))
   with self.assertRaises(ValueError):api.read_manifest(p)
 def test_only_allowlisted_playback(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/"proof.json";p.write_text(json.dumps(record()));p.chmod(0o600)
   with patch.object(api,"REPORT",p),patch.object(api,"stat_same_size",return_value=True):
    played=[]
    api.install(H,lambda *args,**kwargs:played.append((args,kwargs)))
    h=H("/new/saved/c720p-migrated/clip/motion_1792000010000.mp4",method="HEAD");h.go()
    self.assertEqual(played[0][1],{"root_override":api.SD_ROOT})
    h=H("/new/saved/c720p-migrated/clip/other.mp4");h.go();self.assertIn(404,h.messages)
    h=H("/new/saved/clip/motion_1792000010000.mp4");h.go();self.assertEqual(h.messages,["original"])
 def test_separate_inventory_and_no_store(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/"proof.json";p.write_text(json.dumps(record()));p.chmod(0o600)
   with patch.object(api,"REPORT",p):
    api.install(H,lambda *args,**kwargs:None)
    h=H("/new/api/c720p-migrated-clips");h.go()
    d=json.loads(h.wfile.getvalue())
    self.assertEqual(d["total_imported"],1)
    self.assertTrue(d["not_s9_original_recordings"])
    self.assertIn(("Cache-Control","private,no-store"),h.messages)
 def test_existing_proxy_unchanged(self):
  text=(HERE.parent/"s9-person-ml-v1"/"s9_sd_proxy_extension.py").read_text()
  self.assertIn("s9_multivector_appearance_api.install(H)",text)
  self.assertIn("s9_c720p_imported_media_api_v1.install(H,play_sd)",text)
  self.assertIn("if root_override is None and name.startswith",text)
  html=(HERE.parent/"s9-native-security"/"security-review-v8.html").read_text()
  for key in ("id=\"c720pMigrated\"","/new/api/c720p-migrated-clips","/new/saved/c720p-migrated/clip/","not_s9_original_recordings!==true"):
   self.assertIn(key,html)
if __name__=="__main__":unittest.main(verbosity=2)
