#!/usr/bin/env python3
"""Offline tests: migrated footage remains private, intact and separately counted."""
import importlib.util,io,json,os,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
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
if __name__=="__main__":unittest.main(verbosity=2)
