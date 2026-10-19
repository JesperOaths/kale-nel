#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch,call
from types import SimpleNamespace

spec=importlib.util.spec_from_file_location("clock",Path(__file__).with_name("c720p-clock-health-repair-v1.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Tests(unittest.TestCase):
    def test_parse_synchronized_amsterdam_status(self):
        with patch.object(m,"run",return_value="Timezone=Europe/Amsterdam\nNTP=yes\nNTPSynchronized=yes\nCanNTP=yes\n"):
            report=m.status()
        self.assertEqual(report["timezone"],"Europe/Amsterdam")
        self.assertTrue(report["clock_synchronized"])
    def test_never_auto_change_timezone(self):
        with patch.object(m,"run",return_value="Timezone=UTC\nNTP=no\nCanNTP=no\n"):
            with self.assertRaisesRegex(RuntimeError,"unexpected_timezone"):
                m.status()
    def test_existing_sync_requires_no_sudo(self):
        current={"timezone":"Europe/Amsterdam","ntp_enabled":True,
                 "clock_synchronized":True,"ntp_supported":True}
        with patch.object(m,"status",return_value=current),patch.object(m,"run") as run:
            self.assertEqual(m.repair()["status"],"already_synchronized")
            run.assert_not_called()
    def test_permission_denied_is_blocking_not_workaround(self):
        stale={"timezone":"Europe/Amsterdam","ntp_enabled":False,
               "clock_synchronized":False,"ntp_supported":False}
        with patch.object(m,"status",return_value=stale),\
             patch.object(m.shutil,"disk_usage",return_value=SimpleNamespace(free=700*1024*1024)),\
             patch.object(m,"run",side_effect=RuntimeError("sudo_password_required")) as run:
            with self.assertRaisesRegex(RuntimeError,"sudo_password_required"):m.repair()
            self.assertEqual(run.call_count,1)
            self.assertEqual(run.call_args.args[0],["sudo","-n","-v"])
    def test_reject_apt_transactions_with_removals(self):
        stale={"timezone":"Europe/Amsterdam","ntp_enabled":False,
               "clock_synchronized":False,"ntp_supported":False}
        with patch.object(m,"status",return_value=stale),\
             patch.object(m.shutil,"disk_usage",return_value=SimpleNamespace(free=700*1024*1024)),\
             patch.object(m,"run",side_effect=["","Remv homeassistant [1]\n"] ) as run:
            with self.assertRaisesRegex(RuntimeError,"would_remove_packages"):m.repair()
            self.assertEqual(run.call_count,2)
    def test_enabled_but_unsynchronized_is_not_success(self):
        stale={"timezone":"Europe/Amsterdam","ntp_enabled":False,
               "clock_synchronized":False,"ntp_supported":True}
        after=dict(stale,ntp_enabled=True)
        with patch.object(m,"status",side_effect=[stale]+[after]*13),\
             patch.object(m.shutil,"disk_usage",return_value=SimpleNamespace(free=700*1024*1024)),\
             patch.object(m,"run",side_effect=["","",""]),\
             patch.object(m.time,"sleep"):
            with self.assertRaisesRegex(RuntimeError,"not_confirmed"):m.repair()

if __name__=="__main__":
    unittest.main(verbosity=2)
