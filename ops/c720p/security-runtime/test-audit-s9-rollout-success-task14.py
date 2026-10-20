#!/usr/bin/env python3
"""Strict synthetic rollout source and physical attestation preflight."""
import ast
import importlib.util
from pathlib import Path
from unittest.mock import patch
import unittest

SRC=Path(__file__).with_name("audit-s9-rollout-success-task14.py")
sp=importlib.util.spec_from_file_location("rollout_task14",SRC)
m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_no_privileged_apk_or_camera_control_in_probe(self):
  text=SRC.read_text()
  tree=ast.parse(text)
  calls=[x.func.attr for x in ast.walk(tree) if isinstance(x,ast.Call)
    and isinstance(x.func,ast.Attribute)]
  for method in ("write_text","write_bytes","unlink","replace","remove",
                 "chmod","mkdir","rmtree","Popen"):
   self.assertNotIn(method,calls)
  for bad in ('"install"','"force-stop"','"reboot"','"pm clear"','"start"'):
   self.assertNotIn(bad,text)
  self.assertIn('"no_camera_reinstall_or_restart":True',text)
 def test_simulated_terminal_producer_mismatch_reported_without_action(self):
  d={"schema_version":m.OLD_SCHEMA,"candidate_sha256":m.NEW_SHA,
    "state":"done","installed":True,"already_installed":True}
  with patch.object(m,"native",return_value={
     "ok":True,"mode":"watching","native_4k_enabled":True,
     "continuous_4k_ready":True,"continuous_4k_dropped_output_frames":0,
     "temperature_c":32.0}),patch.object(m,"phone_apk_sha",return_value=m.NEW_SHA),\
      patch.object(m,"read",side_effect=[b"sample_producer",__import__("json").dumps(d).encode()]):
   out=m.inspect("f"*64)
   self.assertTrue(out["phone_apk_matches_exact_candidate"])
   self.assertTrue(out["rollout_installed_field_true"])
   self.assertFalse(out["installed_source_matches_current_main"])
 def test_terminal_missing_installed_is_not_falsely_accepted(self):
  import json
  d={"schema_version":m.OLD_SCHEMA,"candidate_sha256":m.NEW_SHA,
    "state":"done","already_installed":True}
  with patch.object(m,"native",return_value={
     "ok":True,"mode":"watching","native_4k_enabled":True,
     "continuous_4k_ready":True,"continuous_4k_dropped_output_frames":0,
     "temperature_c":32.0}),patch.object(m,"phone_apk_sha",return_value=m.NEW_SHA),\
      patch.object(m,"read",side_effect=[b"producer",json.dumps(d).encode()]):
   out=m.inspect("a"*64)
   self.assertFalse(out["rollout_installed_field_true"])
if __name__=="__main__":unittest.main(verbosity=2)
