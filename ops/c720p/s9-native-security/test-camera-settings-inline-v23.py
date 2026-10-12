#!/usr/bin/env python3
"""Offline regression tests: Camera Settings uses native inline S9 controls."""
from pathlib import Path
import importlib.util
import unittest

CODE=Path(__file__).resolve().parent/"deploy-camera-settings-inline-v23.py"
spec=importlib.util.spec_from_file_location("camera_settings_v23",CODE)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class CameraSettingsV23(unittest.TestCase):
    def setUp(self):
        self.html='''<html><head><style>
#s9v5-shell #panel-controls>.controls{display:none!important}
#s9v5-shell #panel-controls #s9v22-camera-frame{display:block!important;width:100%!important;height:100%!important;min-height:0!important;border:0!important;background:#0e1721}
</style></head><body>
<div id="panel-controls"><iframe id="s9v22-camera-frame"></iframe>
<div class="controls"><div id="cameraControls"></div><div id="cameraControlMsg"></div></div></div>
<script>async function loadControls() { await C720PSecureRelay.fetch('/new/camera-controls') }
function refreshControls(){loadControls('new','camera')}
function tab(t){if(t==='controls')refreshControls()}
async function send(){await C720PSecureRelay.fetch('/new/camera-control',{
headers:{'X-S9-Camera-Control-Intent':'explicit-user-selection-v1'}
})}
</script></body></html>'''
    def test_inline_controls_visible_if_iframe_fails(self):
        out=m.patch(self.html)
        self.assertIn(m.MARK,out)
        self.assertIn("#panel-controls>.controls{display:block!important",out)
        self.assertIn("#panel-controls #s9v22-camera-frame{display:none!important}",out)
        self.assertNotIn(m.OLD,out)
        self.assertIn("refreshControls(){loadControls(",out)
        self.assertIn("explicit-user-selection-v1",out)

    def test_idempotent(self):
        once=m.patch(self.html)
        self.assertEqual(once,m.patch(once))

    def test_refuses_missing_controls(self):
        with self.assertRaises(RuntimeError):m.patch(self.html.replace('id="cameraControls"','id="noControls"'))

    def test_refuses_drifted_revisions(self):
        with self.assertRaises(RuntimeError):m.patch(self.html.replace(m.OLD,'#s9v5-shell #panel-controls>.controls{display:block}'))

if __name__=="__main__":unittest.main()
