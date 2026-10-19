#!/usr/bin/env python3
"""Read-only, privacy-preserving first archive-pilot postmortem tests."""
from pathlib import Path
import importlib.util
from types import SimpleNamespace
import unittest

ROOT=Path(__file__).resolve().parent
SCRIPT=ROOT/"run-s9-v3-first-pilot-postmortem.py"
spec=importlib.util.spec_from_file_location("s9_pilot_probe",SCRIPT)
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

class Fake:
    def adb(self,*args,**kwargs):
        if args[1].startswith("test -s "):
            return SimpleNamespace(returncode=1,stderr="",stdout="")
        raise AssertionError("No other ADB command expected")

class Checks(unittest.TestCase):
    def test_absent_sidecar_is_not_a_phone_failure(self):
        self.assertFalse(p.present(Fake(),"/data/local/tmp/s9_worker/inbox/"+"a"*64+".jpg"))
    def test_source_contract_remains_readonly(self):
        txt=SCRIPT.read_text()
        for part in ("private_identifiers_disclosed","first_candidate_private_evidence",
                     "camera_pid_unchanged","active_v3_verified_crops",
                     "ledger_successes","crop_sha_matches","osnet_vector_valid"):
            self.assertIn(part,txt)
        for forbidden in ("--apply","-delete","rm -f","pm install",
                          ".write_text(", ".write_bytes(", "os.replace(",
                          "original_file.unlink", "subprocess.run("):
            self.assertNotIn(forbidden,txt)
        self.assertNotIn("print(subject)",txt)
        self.assertNotIn("print(key)",txt)
if __name__=="__main__":unittest.main(verbosity=2)
