#!/usr/bin/env python3
"""Private, no-phone C720P JPEG-only migration quality + retention tests."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SOURCE=HERE/"c720p_to_s9_verified_snapshot_stage_v167.py"
spec=importlib.util.spec_from_file_location("c720p_snapshot_v167",SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
VIDEO="old-garden-0001.mp4"
JPEG="old-garden-0001.jpg"
class Stage:
    SD=m.SD
    RESERVE=m.RESERVE_BYTES
    MAX_TEMP_C=37.0
    DEST=m.DEST.rsplit("/Snapshots",1)[0]
    def __init__(self):
        self.commands=[];self.copied=[];self.present=set()
    def camera_ready(self):return True
    def connected(self):return 80*1024**3
    def adb(self,*args,**kwargs):self.commands.append(args)
    def sha256_file(self,path):
        return hashlib.sha256(path.read_bytes()).hexdigest()
    def copy_one(self,path,st,digest):
        self.copied.append((path.name,st.st_size,digest))
        self.present.add(path.name)
        return "copied_and_verified"
    def phone_file_matches(self,path,digest,bytes_count):
        return path.endswith("/"+JPEG) and JPEG in self.present
class Tests(unittest.TestCase):
 def setup_temp(self,folder):
    root=Path(folder);web=root/"www";snap=web/"snaps";state=root/"state"
    web.mkdir();snap.mkdir();state.mkdir()
    path=snap/JPEG
    blob=b"\xff\xd8"+b"j"*(1500-4)+b"\xff\xd9"
    path.write_bytes(blob)
    age=time.time()-350
    os.utime(path,(age,age))
    events=web/"events.json"
    events.write_text(json.dumps([{"clip":"clips/"+VIDEO,"snapshot":"snaps/"+JPEG,
                                  "saved":False}]))
    mp4=state/"c720p-s9-imported-v2.json"
    mp4.write_text(json.dumps({"schema_version":"c720p_s9_verified_import_v2",
     "records":{VIDEO:{"sha256":"a"*64,"bytes":500000,
      "sd_path":m.SD+"/Android/data/nl.kalenel.s9security/files/C720PMigrated/"+VIDEO,
      "indexed":True}}}))
    patches=[patch.object(m,"WEB",web),patch.object(m,"SNAPS",snap),
      patch.object(m,"STATE",state),patch.object(m,"EVENTS",events),
      patch.object(m,"VIDEO_MANIFEST",mp4),
      patch.object(m,"OUTPUT",state/"c720p-s9-imported-snapshots-v1.json"),
      patch.object(m,"LOCK",state/".c720p-s9-import-v2.lock")]
    return (path,events,mp4),patches
 def scenario(self,action):
    with tempfile.TemporaryDirectory() as root:
     sources,ps=self.setup_temp(root)
     stage=Stage()
     with patch.object(m,"stage_module",return_value=stage):
      from contextlib import ExitStack
      with ExitStack() as ctx:
       for p in ps:ctx.enter_context(p)
       return action(sources,stage)
 def test_good_event_requires_video_already_imported(self):
  def check(sources,stage):
   rows=m.candidates()
   self.assertEqual(len(rows),1)
   self.assertEqual(list(rows)[0],JPEG)
   self.assertEqual(rows[JPEG][1],VIDEO)
  self.scenario(check)
 def test_dry_run_does_not_touch_phone_or_source(self):
  def check(sources,stage):
   original=sources[0].read_bytes()
   m.execute("preview")
   self.assertEqual(sources[0].read_bytes(),original)
   self.assertEqual(stage.commands,[])
   self.assertFalse(m.OUTPUT.exists())
  self.scenario(check)
 def test_verified_copy_keeps_original_and_creates_private_manifest(self):
  def check(sources,stage):
   original=sources[0].read_bytes()
   m.execute("copy")
   self.assertEqual(original,sources[0].read_bytes())
   self.assertEqual(len(stage.copied),1)
   self.assertIn(("shell","mkdir","-p",m.DEST),stage.commands)
   self.assertEqual(m.OUTPUT.stat().st_mode&0o777,0o600)
   data=json.loads(m.OUTPUT.read_text())
   self.assertEqual(data["schema_version"],m.SCHEMA)
   self.assertEqual(data["records"][JPEG]["linked_video"],VIDEO)
   self.assertEqual(data["records"][JPEG]["bytes"],len(original))
   self.assertEqual(data["records"][JPEG]["sha256"],hashlib.sha256(original).hexdigest())
   self.assertEqual(data["records"][JPEG]["sd_path"],m.DEST+"/"+JPEG)
  self.scenario(check)
 def test_wrong_or_unknown_source_video_does_not_stage_jpeg(self):
  def check(sources,stage):
   source,events,_=sources
   rows=json.loads(events.read_text())
   rows[0]["clip"]="clips/unknown-garden.mp4"
   events.write_text(json.dumps(rows))
   with self.assertRaisesRegex(RuntimeError,"snapshot_inventory"):
    m.candidates()
  self.scenario(check)
 def test_outside_path_or_symlink_excluded(self):
  def check(sources,stage):
   source,events,_=sources
   source.unlink()
   source.symlink_to(events)
   with self.assertRaisesRegex(RuntimeError,"snapshot_inventory"):
    m.candidates()
  self.scenario(check)
 def test_jpeg_must_have_begin_and_end_markers(self):
  def check(sources,stage):
   source,_,_=sources
   raw=source.read_bytes()
   source.write_bytes(b"BAD"+raw[3:])
   os.utime(source,(time.time()-350,time.time()-350))
   with self.assertRaisesRegex(RuntimeError,"snapshot_inventory"):
    m.candidates()
  self.scenario(check)
 def test_conflicting_prior_sha_never_overwritten(self):
  def check(sources,stage):
   m.save({"schema_version":m.SCHEMA,"records":{JPEG:{
    "sha256":"f"*64,"bytes":1500,"linked_video":VIDEO,
    "sd_path":m.DEST+"/"+JPEG}}})
   previous=m.OUTPUT.read_bytes()
   with self.assertRaisesRegex(RuntimeError,"snapshot_source_version_or_mapping_changed"):
    m.execute("copy")
   self.assertEqual(m.OUTPUT.read_bytes(),previous)
   self.assertEqual(stage.copied,[])
  self.scenario(check)
 def test_lost_phone_connection_not_misreported_as_verified(self):
  def check(sources,stage):
   stage.connected=lambda: (_ for _ in ()).throw(RuntimeError("phone_unavailable"))
   with self.assertRaisesRegex(RuntimeError,"phone_unavailable"):
    m.execute("copy")
   self.assertFalse(m.OUTPUT.exists())
  self.scenario(check)
 def test_no_deletions_or_recorder_restarts(self):
  code=SOURCE.read_text()
  for banned in ("rm -rf","adb(\"shell\",\"rm\"",
                 "path.unlink(","os.remove(","shutil.rmtree(",
                 "am force-stop","pm install","Camera2.apk","delete_original",
                 "manual_face_person_confirmation","review_decide"):
   self.assertNotIn(banned,code)
  for required in ("RESERVE_BYTES=15*1024**3","LOCK=STATE/",
      "originals_modified","camera_apk_modified","source_snapshots",
      "mod.copy_one(path,st,digest)","ready_for_local_snapshot_retirement"):
   self.assertIn(required,code)

if __name__=="__main__":unittest.main(verbosity=2)
