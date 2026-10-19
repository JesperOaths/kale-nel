#!/usr/bin/env python3
"""Pure local regression for 10s tail verifier; never calls a phone or deploys APK."""
import importlib.util
from pathlib import Path
from unittest.mock import patch

path=Path(__file__).with_name("deploy-guarded-s9-5s10s-v9.py")
spec=importlib.util.spec_from_file_location("tail_installer_v9",path)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

healthy={"ok":True,"mode":"watching"}
with patch.object(m,"forward") as fwd,patch.object(m,"status",return_value=healthy),\
     patch.object(m,"healthy",return_value=True) as current,\
     patch.object(m,"safe_baseline",return_value=False) as legacy:
 assert m.wait_health(True,seconds=0.5)==healthy
 current.assert_called_with(healthy,True)
 legacy.assert_not_called()
 fwd.assert_called_once()

with patch.object(m,"forward"),patch.object(m,"status",return_value=healthy),\
     patch.object(m,"healthy",return_value=False) as current,\
     patch.object(m,"safe_baseline",return_value=True) as legacy:
 assert m.wait_health(False,seconds=0.5,baseline=True)==healthy
 legacy.assert_called_with(healthy)
 current.assert_not_called()

assert "installed_camera_apk_changed_refuse_install" in path.read_text()
assert 'if sha(old)!=V6_SHA:' in path.read_text()
assert 'if before.get("temperature_c",100)>=40.5:' in path.read_text()
print("S9_10S_TAIL_INSTALL_HEALTH_CHECK_PURE_TEST_PASS")
