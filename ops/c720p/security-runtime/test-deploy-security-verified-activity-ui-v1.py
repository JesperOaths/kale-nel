#!/usr/bin/env python3
"""Offline, synthetic safety tests for the one-file Security UI installer."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

p=Path(__file__).with_name("deploy-security-verified-activity-ui-v1.py")
spec=importlib.util.spec_from_file_location("security_verified_deploy",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Tests(unittest.TestCase):
    def setUp(self):
        folder=tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        root=Path(folder.name)
        self.target=root/"security-review-v8.html"
        self.backups=root/"backups"
        self.before=b"<html>known live pre-change</html>"
        self.after=b"<html>approved post-change</html>"
        self.old=m.EXPECTED_OLD;self.new=m.EXPECTED_NEW
        m.EXPECTED_OLD=m.blob_sha(self.before)
        m.EXPECTED_NEW=m.blob_sha(self.after)
        self.old_validator=m.validate_document
        m.validate_document=lambda raw:None
        self.addCleanup(lambda: setattr(m,"EXPECTED_OLD",self.old))
        self.addCleanup(lambda: setattr(m,"EXPECTED_NEW",self.new))
        self.addCleanup(lambda: setattr(m,"validate_document",self.old_validator))
        self.target.write_bytes(self.before)
    def test_guarded_atomic_install_and_idempotency(self):
        result=m.guarded_replace(self.target,self.after,self.backups,readback=lambda:self.after)
        self.assertEqual(result["action"],"installed_verified")
        self.assertEqual(self.target.read_bytes(),self.after)
        self.assertEqual(Path(result["backup"]).read_bytes(),self.before)
        self.assertEqual(Path(result["backup"]).stat().st_mode&0o777,0o600)
        self.assertEqual(m.guarded_replace(self.target,self.after,self.backups)["action"],"already_installed")
    def test_http_failure_restores_original_byte_for_byte(self):
        with self.assertRaisesRegex(RuntimeError,"http_readback_mismatch"):
            m.guarded_replace(self.target,self.after,self.backups,readback=lambda:b"wrong")
        self.assertEqual(self.target.read_bytes(),self.before)
        self.assertEqual(len(list(self.backups.glob("*.html"))),1)
    def test_drift_and_tampering_fail_without_writing(self):
        self.target.write_bytes(b"some newer hotfix")
        with self.assertRaisesRegex(ValueError,"source_drift"):
            m.guarded_replace(self.target,self.after,self.backups)
        self.assertFalse(self.backups.exists())
        self.target.write_bytes(self.before)
        with self.assertRaisesRegex(ValueError,"digest_mismatch"):
            m.guarded_replace(self.target,b"wrong source",self.backups)
        self.assertEqual(self.target.read_bytes(),self.before)
    def test_symlink_target_is_rejected(self):
        self.target.unlink()
        actual=self.target.with_name("actual.html")
        actual.write_bytes(self.before)
        self.target.symlink_to(actual)
        with self.assertRaisesRegex(ValueError,"untrusted_live_page"):
            m.guarded_replace(self.target,self.after,self.backups)
        self.assertEqual(actual.read_bytes(),self.before)
    def test_current_asset_preserves_original_installer_and_security_contract(self):
        # This installer is intentionally pinned to the original activity rollout,
        # not to every later additive revision of the Security HTML.
        self.assertEqual(self.new,"3d53db930a8597a76a4a549bf418bad51f39a3c8")
        self.assertIn("5d9d553c339c3904ee733998ba4ea6871d9b66f6",m.SOURCE)
        page=Path(__file__).parents[1]/"s9-native-security"/"security-review-v8.html"
        raw=page.read_bytes()
        m.validate_document=self.old_validator
        m.validate_document(raw)
        self.assertIn(b"/new/api/security-recording-activity",raw)
        self.assertIn(b"/new/api/s9-manual-recording-links",raw)
        self.assertIn(b"gejast-auth-gate.js",raw)
        self.assertIn(b"/new/api/s9-auxiliary-recovery",raw)
        self.assertNotEqual(m.blob_sha(raw),self.old)

if __name__=="__main__":
    unittest.main(verbosity=2)
