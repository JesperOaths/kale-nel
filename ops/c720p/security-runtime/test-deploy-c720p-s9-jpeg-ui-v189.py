#!/usr/bin/env python3
"""No-device unit tests: all legacy features and six local JPEGs preserved."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

DIR=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location("c720p_jpeg_display_v189",
   DIR/"deploy-c720p-s9-jpeg-ui-v189.py")
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)
VIDEO=m.VIDEO
PHOTO=m.PHOTO
def clips():
 return ("""<!doctype html><html><head><script src="/local/c720p-secure-relay-client.js"></script></head>
 <body><script>// C720P_MIGRATED_S9_LEGACY_PLAYER_V1
 const C720PSecureRelay=true;function save(){return 'local'}
 </script><img src="snaps/sample.jpg"></body></html>""").encode()
def idx():
 return ("<html><head><title>Camera Security</title>"+VIDEO+"</head>"+
 "<body><button onclick='saveClip(1)'>Save</button><video src='clips/local.mp4'></video></body></html>"+
 "<!-- fixture size must satisfy the REAL watchdog's 500-byte minimum: "+ "x"*540+" -->").encode()
def generator():
 return ('def write_html(events):\n'
   '    html = """<title>Camera Security</title>'+VIDEO+
   '<button onclick="saveClip(1)">Save</button> clips/"""\n'
   '    return html\n').encode()
class Tests(unittest.TestCase):
 def guard_original(self):
  return (DIR/"c720p_legacy_s9_index_bridge_guard_v1.py").read_bytes()
 def contents(self):
  return {m.PLAYER:clips(),m.INDEX:idx(),m.GENERATOR:generator(),m.GUARD:self.guard_original()}
 def test_patch_is_additive_to_all_three_legacy_files(self):
  before=self.contents();after=m.patch(before)
  self.assertEqual(set(before),set(after))
  for target in (m.PLAYER,m.INDEX,m.GENERATOR):
   self.assertEqual(after[target].count(PHOTO.encode()),1)
   self.assertEqual(after[target].replace(PHOTO.encode(),b""),before[target])
  compile(after[m.GENERATOR].decode(),"generator.py","exec")
 def test_guard_restores_after_legacy_regeneration(self):
  original=self.guard_original()
  rewritten=m.patch_guard(original)
  self.assertIn(b"JPEG_MARKER",rewritten)
  self.assertIn(b"JPEG_SCRIPT",rewritten)
  ns={"__name__":"c720p_guard_test"}
  exec(compile(rewritten.decode(),"guard.py","exec"),ns)
  minimal=idx()
  missing_all=minimal.replace(VIDEO.encode(),b"")
  recovered=ns["new_html"](minimal)
  self.assertEqual(recovered.count(VIDEO.encode()),1)
  self.assertEqual(recovered.count(PHOTO.encode()),1)
  self.assertIsNone(ns["new_html"](recovered))
  regenerated=ns["new_html"](missing_all)
  self.assertEqual(regenerated.count(VIDEO.encode()),1)
  self.assertEqual(regenerated.count(PHOTO.encode()),1)
  with self.assertRaisesRegex(ValueError,"untrusted_existing_snapshot"):
   ns["new_html"](recovered+PHOTO.encode())
 def test_backup_and_rollback_on_midinstall_failure(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder)
   remap={m.PLAYER:root/"clips.html",m.INDEX:root/"index.html",
          m.GENERATOR:root/"recorder.py",m.GUARD:root/"guard.py"}
   originals=self.contents()
   for old,new in remap.items():new.write_bytes(originals[old])
   js=root/"c720p-migrated-snapshot-display-v182.js"
   js.write_bytes(b"C720P_MIGRATED_S9_SNAPSHOT_DISPLAY_V182")
   expected={remap[p]:m.sha(blob) for p,blob in originals.items()}
   ctx=[patch.object(m,"PLAYER",remap[m.PLAYER]),
        patch.object(m,"INDEX",remap[m.INDEX]),
        patch.object(m,"GENERATOR",remap[m.GENERATOR]),
        patch.object(m,"GUARD",remap[m.GUARD]),
        patch.object(m,"BRIDGE",js),
        patch.object(m,"BRIDGE_SHA",m.sha(js.read_bytes())),
        patch.object(m,"PREVIOUS",expected),
        patch.object(m,"LOCK",root/"lock"),
        patch.object(m,"BACKUP",root/"backup"),
        patch.object(m,"camera",return_value={"temperature_c":35.0}),
        patch.object(m,"verify_served",return_value=None)]
   from contextlib import ExitStack
   with ExitStack() as stack:
    for one in ctx:stack.enter_context(one)
    before={p:p.read_bytes() for p in remap.values()}
    m.main(False)
    self.assertEqual(before,{p:p.read_bytes() for p in remap.values()})
    write=m.atomic
    def fault(path,data):
     if path==m.GENERATOR:
      raise OSError("test_atomic_generator_failure")
     return write(path,data)
    with patch.object(m,"atomic",side_effect=fault):
     with self.assertRaisesRegex(OSError,"test_atomic_generator_failure"):
      m.main(True)
    self.assertEqual(before,{p:p.read_bytes() for p in remap.values()})
    m.main(True)
    self.assertTrue(all(PHOTO.encode() in p.read_bytes() for p in (
      m.PLAYER,m.INDEX,m.GENERATOR)))
    self.assertFalse(any(PHOTO.encode() in p.read_bytes() for p in (js,)))
    self.assertEqual(len(list((root/"backup").rglob("file-*"))),8)
 def test_no_media_or_manual_record_writes(self):
  source=(DIR/"deploy-c720p-s9-jpeg-ui-v189.py").read_text()
  for prohibited in ("adb install","pm install","am force-stop","ffmpeg",
     "shutil.rmtree","review_decide","function saveClip", "function deleteClip", "original.mp4",
     "/Security4K/motion_", "systemctl"):
   self.assertNotIn(prohibited,source)
  self.assertIn('"local_jpeg_fallback_preserved":True',source)
  self.assertIn("unknown_newer_live_legacy_source",source)
if __name__=="__main__":unittest.main(verbosity=2)
