#!/usr/bin/env python3
"""Synthetic verified-source manual folder-link tests, no media access."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SRC=Path(__file__).resolve().parent.parent/"s9-person-ml-v1/s9_manual_recording_links.py"
spec=importlib.util.spec_from_file_location("s9_manual_links",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
EXT_PATH=Path(__file__).resolve().parent.parent/"s9-person-ml-v1/s9_sd_proxy_extension.py"
ext_spec=importlib.util.spec_from_file_location("s9_proxy_drive_alias",EXT_PATH)
ext=importlib.util.module_from_spec(ext_spec);ext_spec.loader.exec_module(ext)
SD="motion_1792200000000.mp4"
DRIVE="drive_2026-05-12_08-30-00.mp4"
class ManualLinkCases(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.patches=[]
  for name,file in (("STORE","links.json"),("AUDIT","audit.jsonl"),
                    ("LOCK","links.lock"),("DRIVE","drive.json")):
   p=patch.object(m,name,Path(self.tmp.name)/file)
   p.start();self.addCleanup(p.stop)
  m.DRIVE.write_text(json.dumps({"items":[{"remote_name":DRIVE,
   "size":4500000,"state":"verified"}]}))
 def body(self,source="sd",name=SD,folder="G123",revision=0,action="assign"):
  return {"action":action,"source":source,"name":name,"folder":folder,
          "revision":revision,"human_confirmed":True}
 def mutate(self,**kw):return m.mutate(self.body(**kw),{SD:{"sd_verified":True}})
 def test_sd_and_drive_require_real_verified_sources(self):
  code,receipt=self.mutate()
  self.assertEqual(code,200)
  self.assertTrue(receipt['persisted'])
  self.assertEqual((receipt['source'],receipt['name'],receipt['folder']),('sd',SD,'G123'))
  code,receipt=self.mutate(source="drive",name=DRIVE,revision=1)
  self.assertEqual(code,200)
  self.assertTrue(receipt['persisted'])
  self.assertEqual((receipt['source'],receipt['name'],receipt['folder']),('drive',DRIVE,'G123'))
  self.assertEqual(m.report()["items"]["drive:"+DRIVE]["folder"],"G123")
  self.assertEqual(m.STORE.stat().st_mode&0o777,0o600)
  self.assertEqual(len(m.AUDIT.read_text().splitlines()),2)
 def test_return_to_queue_retains_audit_history(self):
  self.assertEqual(self.mutate()[0],200)
  code,response=self.mutate(folder=None,revision=1,action="return_to_queue")
  self.assertEqual(code,200)
  self.assertIsNone(m.report()["items"]["sd:"+SD]["folder"])
  self.assertEqual(len(m.AUDIT.read_text().splitlines()),2)
  self.assertEqual(self.mutate(revision=2)[0],200)
 def test_reject_forged_unverified_videos_and_invalid_folders(self):
  for kw in ({"name":"../../evil.mp4"},{"source":"sd","name":DRIVE},
             {"source":"drive","name":"not-a-drive-file.mp4"},
             {"source":"drive","name":"../../fake.mp4"},
             {"folder":"../G123"},{"folder":""},
             {"folder":"G123","revision":"0"}):
   self.assertNotEqual(self.mutate(**kw)[0],200)
  self.assertFalse(m.STORE.exists())
 def test_reject_false_human_confirmation_and_stale_revision(self):
  body=self.body();body["human_confirmed"]=False
  self.assertEqual(m.mutate(body,{SD:1})[0],400)
  self.assertEqual(self.mutate()[0],200)
  self.assertEqual(self.mutate(revision=0)[0],409)
 def test_multiple_people_are_one_atomic_audited_decision(self):
  body=self.body(source="drive",name=DRIVE)
  body["folders"]=["G123","G456","G789"]
  code,receipt=m.mutate(body,{SD:1})
  self.assertEqual(code,200)
  self.assertEqual(receipt["folders"],body["folders"])
  self.assertEqual(m.report()["items"]["drive:"+DRIVE]["folders"],body["folders"])
  self.assertEqual(m.report()["revision"],1)
  log=json.loads(m.AUDIT.read_text().splitlines()[0])
  self.assertEqual(log["to_folders"],body["folders"])
  self.assertEqual(len(m.AUDIT.read_text().splitlines()),1)
  # Changing people is one revision and cannot silently retain an old member.
  next_body=self.body(source="drive",name=DRIVE,revision=1,folder="G789")
  next_body["folders"]=["G789","G123"]
  self.assertEqual(m.mutate(next_body,{SD:1})[0],200)
  self.assertEqual(m.report()["items"]["drive:"+DRIVE]["folders"],["G789","G123"])
  self.assertEqual(m.report()["revision"],2)
  self.assertEqual(m.mutate(next_body,{SD:1})[0],409)
  clear=self.body(source="drive",name=DRIVE,folder=None,revision=2,action="return_to_queue")
  self.assertEqual(m.mutate(clear,{SD:1})[0],200)
  self.assertEqual(m.report()["items"]["drive:"+DRIVE]["folders"],[])
  self.assertIsNone(m.report()["items"]["drive:"+DRIVE]["folder"])
  self.assertEqual(len(m.AUDIT.read_text().splitlines()),3)
 def test_reject_malformed_multi_people_without_changes(self):
  baseline=self.body()
  for group in ([],["G123","G123"],["G456"],["G123","../invalid"],
                ["G123"]*13,["G123",None],"G123"):
   body=dict(baseline,folders=group)
   self.assertNotEqual(m.mutate(body,{SD:1})[0],200)
  self.assertFalse(m.STORE.exists())
  self.assertFalse(m.AUDIT.exists())
 def test_deleted_drive_files_cannot_be_added(self):
  m.DRIVE.write_text(json.dumps({"items":[{"remote_name":DRIVE,
   "size":4500000,"state":"deleted"}]}))
  self.assertEqual(self.mutate(source="drive",name=DRIVE)[0],404)
 def test_audit_symlink_fails_closed(self):
  (Path(self.tmp.name)/"trap").write_text("protected")
  m.AUDIT.symlink_to(Path(self.tmp.name)/"trap")
  self.assertEqual(self.mutate()[0],503)
  self.assertFalse(m.STORE.exists())
 def test_exact_drive_catalog_and_clip_paths_preserve_legacy_handler(self):
  expected={
   "/new/api/drive-saved":"/new/api/saved",
   "/new/drive/saved/clip/drive_2026-05-12.mp4":
     "/new/saved/clip/drive_2026-05-12.mp4",
   "/new/drive/saved/snap/drive_2026-05-12.jpg":
     "/new/saved/snap/drive_2026-05-12.jpg"}
  for request,legacy in expected.items():
   with self.subTest(request=request):
    self.assertEqual(ext.historical_drive_origin_path(request,""),legacy)
  for invalid in ("/new/api/drive-saved/extra",
      "/new/drive/saved/clip/../secret.mp4",
      "/new/drive/saved/clip/clip.jpg",
      "/new/drive/saved/snap/image.mp4",
      "/new/drive/saved/clip/unknown file.mp4",
      "/new/drive/saved/clip/"+("a"*220)+".mp4"):
   self.assertIsNone(ext.historical_drive_origin_path(invalid,""))
  self.assertIsNone(ext.historical_drive_origin_path("/new/api/drive-saved","q=1"))
 def test_historical_drive_routes_are_preserved_in_versioned_proxy_source(self):
  proxy=Path(__file__).resolve().parent.parent/"s9-person-ml-v1/s9_sd_proxy_extension.py"
  script=proxy.read_text()
  self.assertIn("SECURITY_DRIVE_V9_SOURCE_PRESERVED",script)
  self.assertIn('if path=="/new/api/drive-saved":',script)
  self.assertIn('self.path="/new/api/saved"',script)
  self.assertIn('if drive_clip or drive_snap:',script)
  self.assertIn('return original(self)',script)
  installer=Path(__file__).with_name("deploy-manual-recording-links-v1.py").read_text()
  self.assertIn('api("/new/api/drive-saved")',installer)
  self.assertIn("historical_drive_catalog_missing_after_proxy_restart",installer)
 def test_relay_health_uses_actual_historical_archive_size(self):
  path=Path(__file__).with_name("deploy-manual-recording-links-relay-v2.py")
  spec=importlib.util.spec_from_file_location("s9_manual_relay_install",path)
  mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
  drive={"ok":True,"events":[{} for _ in range(94)]}
  self.assertTrue(mod.matching_drive_catalogs(drive,drive),
    "94 legitimate remaining Drive originals must not be rejected")
  self.assertFalse(mod.matching_drive_catalogs({"ok":True,"events":[{} for _ in range(93)]},drive))
  self.assertFalse(mod.matching_drive_catalogs({"ok":True,"events":[]},
    {"ok":True,"events":[]}))
  self.assertFalse(mod.matching_drive_catalogs({"ok":False,"events":[{} for _ in range(94)]},drive))
 def test_backend_rollout_retains_real_drive_inventory(self):
  code=Path(__file__).with_name("deploy-manual-recording-links-v1.py").read_text()
  self.assertIn('drive_count_before=len(drive_before["events"])',code)
  self.assertIn('len(drive_catalog["events"])<drive_count_before',code)
  self.assertIn("verified_historical_drive_baseline_unavailable",code)
  self.assertNotIn('len(drive_catalog["events"])<100',code)
 def test_route_does_not_recognize_or_modify_people(self):
  src=SRC.read_text()
  for forbidden in ("cv2.imread","face_embedding","rclone delete",
                    "adb shell","shutil.rmtree","source_sha256 ="):
   self.assertNotIn(forbidden,src)
if __name__=="__main__":unittest.main(verbosity=2)
