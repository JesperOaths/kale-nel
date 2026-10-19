#!/usr/bin/env python3
"""Synthetic pure tests: no on-host camera use, no Save or media mutation."""
import ast
import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SRC=HERE/"audit-c720p-legacy-save-retirement-v149.py"
spec=importlib.util.spec_from_file_location("legacy149",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def fixture():
 source="""def write_html(events):
    html = "<title>Camera Security</title>src='{e['clip']}'"
    return html
def save_index(events):
    write_html(events)
def save_clip(event):
    save_index([event])
"""
 source=source.replace("src='{e['clip']}'","src clip")
 source=source.replace("return html","return html\n# src='{e['clip']}'")
 source=source.replace('"<title>Camera Security</title>src clip"','"<title>Camera Security</title>src clip"')
 source=source.replace('def save_index(events):','def save_index(events):\n    # c720p-migrated-index-playback-v1.js')
 index="<title>Camera Security</title><script defer src='c720p-migrated-index-playback-v1.js'></script>"+(
 "X"*510)+"<video src='clips/test.mp4'></video><button onclick='saveClip(1)'></button><script>function saveClip(i){return i}</script>"
 player="C720P_MIGRATED_S9_LEGACY_PLAYER_V1"+"X"*600
 bridge="C720PSecureRelay /new/api/c720p-migrated-clips /new/saved/c720p-migrated/clip/"
 return source.encode(),index.encode(),player.encode(),bridge.encode()
class Safe(unittest.TestCase):
 def test_pure_structural_summary(self):
  source,index,player,bridge=fixture()
  with patch.object(m,"BRIDGE_SHA256",hashlib.sha256(bridge).hexdigest()):
   d=m.structural(source,index,player,bridge)
  self.assertTrue(d["write_html_declared"])
  self.assertTrue(d["save_index_declared"])
  self.assertTrue(d["legacy_save_function_declared_in_index"])
  self.assertFalse(d["originals_safe_to_delete"])
  self.assertGreater(d["index_regeneration_call_sites"],0)
 def test_source_drift_fail_closed(self):
  source,index,player,bridge=fixture()
  with patch.object(m,"BRIDGE_SHA256",hashlib.sha256(bridge).hexdigest()):
   with self.assertRaisesRegex(RuntimeError,"index_generator_or_live_bridge_missing"):
    m.structural(source.replace(b"c720p-migrated-index-playback-v1.js",b"none"),index,player,bridge)
   with self.assertRaisesRegex(RuntimeError,"legacy_save_or_player_missing"):
    m.structural(source,index.replace(b"saveClip(",b"lostClip("),player,bridge)
  with self.assertRaisesRegex(RuntimeError,"signed_bridge_content_drift"):
   m.structural(source,index,player,bridge)
 def test_read_only_no_actions_or_private_logs(self):
  text=SRC.read_text()
  for prohibited in ("adb push","shutil.rmtree","systemctl restart",
     "os.remove(","os.unlink(","events.json\").write", "saveClip(1);", "subprocess.Popen",
     "requests.post(","urlopen(req_save"):
   self.assertNotIn(prohibited,text)
  self.assertIn('"originals_safe_to_delete":False',text)
  self.assertIn('"no_save_actions_invoked"',text)
  self.assertIn('"no_index_or_event_writes"',text)
  self.assertIn('raise SystemExit(1)',text)
 def test_missing_watcher_fails(self):
  with patch.object(m.subprocess,"run",return_value=type("R",(),{"returncode":3,"stdout":"inactive"})()):
   with self.assertRaisesRegex(RuntimeError,"index_restoration_unit_inactive"):
    m.unit_state()

if __name__=="__main__":unittest.main(verbosity=2)
