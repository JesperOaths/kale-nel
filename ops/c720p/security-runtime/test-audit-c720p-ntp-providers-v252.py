#!/usr/bin/env python3
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

script=Path(__file__).with_name("audit-c720p-ntp-providers-v252.py")
spec=importlib.util.spec_from_file_location("ntpaudit252",script)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Tests(unittest.TestCase):
 def test_status_and_timezone_boundary(self):
  actual="NTP=no\nNTPSynchronized=no\nCanNTP=no\nTimezone=Europe/Amsterdam\n"
  with patch.object(m,"run",return_value=(0,actual)):
   self.assertEqual(m.clock(),{"timezone_amsterdam":True,"ntp_enabled":False,
    "ntp_synchronized":False,"ntp_supported":False})
  with patch.object(m,"run",return_value=(0,actual.replace("Amsterdam","London"))):
   with self.assertRaisesRegex(RuntimeError,"unexpected_timezone"):m.clock()
  with patch.object(m,"run",return_value=(0,"NTP=no\n")):
   with self.assertRaisesRegex(RuntimeError,"incomplete"):m.clock()

 def test_provider_package_detection(self):
  with patch.object(m,"run",return_value=(0,"install ok installed")):
   self.assertEqual(m.package("systemd-timesyncd"),"installed")
  with patch.object(m,"run",return_value=(1,"")):
   self.assertEqual(m.package("chrony"),"not_installed")

 def test_config_not_disclosed(self):
  import tempfile
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/"ntp.conf"
   p.write_text("server secret.customer.internal iburst\npool pool.ntp.org\n")
   report=m.config(str(p))
   self.assertEqual(report["directive_count"],2)
   self.assertNotIn("secret.customer",str(report))
   marker=Path(folder)/"link.conf"
   marker.symlink_to(p)
   self.assertEqual(m.config(str(marker))["trust"],"symlink")

 def test_no_privilege_or_mutation_shells_in_source(self):
  source=script.read_text()
  for denied in ("set-ntp","apt-get install","sudo -S","subprocess.Popen(",
    "unlink(","shutil.rmtree(","os.remove(","systemctl restart","pm install",
    "clock_settime(", "datetime.now().replace("):
   self.assertNotIn(denied,source)

if __name__=="__main__":unittest.main(verbosity=2)
