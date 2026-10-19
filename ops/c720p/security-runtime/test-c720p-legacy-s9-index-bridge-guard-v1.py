#!/usr/bin/env python3
"""Source and systemd regressions for legacy index S9+ bridge restoration."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SOURCE=HERE/"c720p_legacy_s9_index_bridge_guard_v1.py"
spec=importlib.util.spec_from_file_location("bridge",SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def legacy():
    return (m.ANCHOR+"<script>function saveClip(n){return n}</script>"
            +"<video src='clips/example.mp4' controls></video>"
            +"<div>"+"Camera event description "*35+"</div>").encode()

class Safety(unittest.TestCase):
 def setUp(self):
    self.temp=tempfile.TemporaryDirectory()
    self.addCleanup(self.temp.cleanup)
    self.folder=Path(self.temp.name)
    self.html=self.folder/"index.html"
    self.js=self.folder/"c720p-migrated-index-playback-v1.js"
    self.html.write_bytes(legacy())
    self.html.chmod(0o664)
    self.js.write_bytes(b"secure already-audited playback bridge")
    self.patches=[
      patch.object(m,"INDEX",self.html),
      patch.object(m,"BRIDGE",self.js),
      patch.object(m,"STATE",self.folder),
      patch.object(m,"LOCK",self.folder/".guard.lock"),
      patch.object(m,"EXPECTED_BRIDGE_SHA256",m.digest(self.js.read_bytes())),
      patch.object(m.time,"sleep",lambda _:None)
    ]
    for p in self.patches:
     p.start()
     self.addCleanup(p.stop)
 def test_recreate_index_after_save_without_touching_save_or_video(self):
    self.assertEqual(m.apply(),"attached")
    contents=self.html.read_text()
    self.assertIn("function saveClip(n)",contents)
    self.assertIn("src='clips/example.mp4'",contents)
    self.assertEqual(contents.count(m.SCRIPT),1)
    self.assertEqual(m.apply(),"present")
    self.html.write_bytes(legacy())
    self.assertEqual(m.apply(),"attached")
    self.assertEqual(self.html.read_text().count(m.SCRIPT),1)
    self.assertEqual(self.html.stat().st_mode&0o777,0o664)
 def test_wrong_or_tampered_signed_bridge_defers(self):
    with patch.object(m,"EXPECTED_BRIDGE_SHA256","0"*64):
     self.assertEqual(m.apply(),"deferred")
     self.assertNotIn(m.MARKER,self.html.read_text())
 def test_unrelated_or_corrupt_html_fails_closed(self):
    self.html.write_bytes((m.ANCHOR+"junk"*150).encode())
    with self.assertRaises(ValueError):m.apply()
    self.html.write_bytes(legacy()+m.MARKER.encode())
    with self.assertRaises(ValueError):m.apply()
 def test_reject_symlink_to_suspect_index(self):
    linked=self.folder/"symlink-index.html"
    linked.symlink_to(self.html)
    with patch.object(m,"INDEX",linked):
     with self.assertRaises(ValueError):m.apply()
 def test_no_media_delete_camera_restart_or_privilege(self):
    src=SOURCE.read_text()
    for bad in ("sudo ", "os.system(", "shutil.rmtree(", "ffmpeg",
          "CameraManager", "adb pull", "adb push","systemctl restart",
          "events.json").__iter__():
     self.assertNotIn(bad,src)
    self.assertIn("os.replace(tmp,INDEX)",src)
    self.assertIn("INDEX.read_bytes()!=data",src)
 def test_path_timer_and_service_are_capture_sparing(self):
    prefix="c720p-legacy-s9-index-bridge-guard-v1"
    path=(HERE/(prefix+".path")).read_text()
    timer=(HERE/(prefix+".timer")).read_text()
    service=(HERE/(prefix+".service")).read_text()
    self.assertIn("PathChanged=/opt/homeassistant/config/www/frontyard-security-new/index.html",path)
    self.assertIn("OnUnitInactiveSec=10min",timer)
    self.assertIn("Persistent=false",timer)
    self.assertIn("NoNewPrivileges=yes",service)
    self.assertIn("IOSchedulingClass=idle",service)
    self.assertNotIn("sudo",service)

if __name__=="__main__":unittest.main(verbosity=2)
