#!/usr/bin/env python3
"""Safety checks for on-hub conditional v9 installation (no phone access)."""
from pathlib import Path
import ast
import unittest
SOURCE=Path(__file__).with_name("arm-person-v9-cool-idle.py").read_text()
TREE=ast.parse(SOURCE)
RUNNER=next(node.value.value for node in TREE.body if isinstance(node,ast.Assign)
  and any(isinstance(target,ast.Name) and target.id=="RUNNER" for target in node.targets))
class TestCoolIdle(unittest.TestCase):
 def test_both_installer_and_runner_compile(self):
  ast.parse(SOURCE)
  ast.parse(RUNNER)
 def test_single_pinned_source_and_no_motion_or_disk_damage(self):
  for required in ("S9_SECURITY_REF","S9_V9_DEPLOY_SHA256","sha256(body).hexdigest()!=expected",
    'old.get("sha")==sha',"now+24*3600","OnActiveSec=120",
    "OnUnitInactiveSec=1800","systemctl","--user","enable","--now",
    "phone_apk_changed"):
   self.assertIn(required,SOURCE,required)
  for unwanted in ("adb install","adb shell am force-stop",
                   "shutil.rmtree","rm -rf","kill -9","service_role"):
   self.assertNotIn(unwanted,SOURCE,unwanted)
 def test_runner_fails_closed_and_preserves_continuous_4k(self):
  for key in ('continuous_4k_production_persisted','continuous_4k_ready',
    'continuous_4k_buffered_ms','garden_person_gate_backend','gpu',
    'float(s.get("temperature_c",100))<36.7',
    's.get("mode")=="watching"', 'S9_PEDESTRIAN_V9_LIVE_HEALTH_PASS',
    'S9_PEDESTRIAN_V9_DEFERRED_', 'DEPLOY_FAILED_RETRY_DISABLED',
    'EXPIRED_NOT_INSTALLED','subprocess.TimeoutExpired','fcntl.flock',
    'disable","--now"'):
   self.assertIn(key,RUNNER,key)
  self.assertLess(RUNNER.index('safe=(s.get("ok")'),RUNNER.index('proc=subprocess.run('))
  self.assertIn('S9_SECURITY_REF":config["sha"]',RUNNER)
  self.assertIn('deploy_sha256',RUNNER)
  for bad in ('--force','uninstall','rm -rf','/sdcard/','shutil.rmtree'):
   self.assertNotIn(bad,RUNNER,bad)
if __name__=="__main__":unittest.main(verbosity=2)
