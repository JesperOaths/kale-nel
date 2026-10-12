#!/usr/bin/env python3
"""Regression: the native camera control panel must be mounted into the visible Security stage."""
import importlib.util
from pathlib import Path
import unittest

MODULE=Path(__file__).with_name("deploy-camera-settings-stage-v24.py")
spec=importlib.util.spec_from_file_location("stage_v24",MODULE)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

MOCK='''<!doctype html><body>
<section id="panel-controls"><div id="cameraControls"></div><div id="cameraControlMsg"></div></section>
<div id="s9v5-stage"></div>
<script>const nav={};function showPanel(name){};nav.getAttribute('aria-current');C720PSecureRelay.fetch;</script>
<!-- SECURITY_CAMERA_SETTINGS_INLINE_V23 -->
<!-- security-settings-panel-safety-v22 -->
</body>'''

class NativeCameraStageMount(unittest.TestCase):
 def test_visible_stage_reparents_actual_controls(self):
  text=m.patch(MOCK)
  self.assertIn("stage.appendChild(panel)",text)
  self.assertIn("panel.parentElement!==stage",text)
  self.assertIn("panel.classList.add('s9v5-active')",text)
  self.assertIn("panel.style.setProperty('display','block','important')",text)
  self.assertIn("button[data-view=\"camera\"]",text)
  self.assertIn("panel.hidden=false",text)
  self.assertEqual(text.count(m.MARK),1)

 def test_idempotent_and_no_changes_to_existing_camera_controls(self):
  once=m.patch(MOCK)
  self.assertEqual(once,m.patch(once))
  self.assertEqual(once.count('id="cameraControls"'),1)
  self.assertEqual(once.count("C720PSecureRelay.fetch"),1)

 def test_refuses_missing_original_controls(self):
  with self.assertRaises(RuntimeError):m.patch(MOCK.replace('id="cameraControls"','id="absentControls"'))

 def test_refuses_incomplete_stage(self):
  with self.assertRaises(RuntimeError):m.patch(MOCK.replace('id="s9v5-stage"','id="other"'))

if __name__=="__main__":unittest.main(verbosity=2)
