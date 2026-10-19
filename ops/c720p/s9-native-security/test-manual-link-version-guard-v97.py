#!/usr/bin/env python3
"""Ensure legacy manual-link installer is a NO-OP on modern V70/V71 releases."""
import re
import unittest
from pathlib import Path

SOURCE=(Path(__file__).with_name("deploy-manual-recording-links-v1.py")).read_text()
class Tests(unittest.TestCase):
    def test_expected_signed_release_tags(self):
        match=re.search(r're\.search\(rb"([^"]+)"\s*,\s*\(WWW/',SOURCE)
        self.assertIsNotNone(match)
        pattern=re.compile(match.group(1).encode())
        good=("security-filing-v65-20261019",
              "security-drive-person-v66-20261019",
              "security-group-filing-v70-20261019",
              "security-review-face-choices-v71-20261019")
        for tag in good:
            self.assertIsNotNone(pattern.search(("?v="+tag).encode()),tag)
        for tag in ("security-people-v17-20261019","security-unknown-v99-20261019",
                    "security-review-face-choices-v71-20261020"):
            self.assertIsNone(pattern.search(tag.encode()),tag)
    def test_never_downgrade_a_different_current_backend(self):
        # Modern backend equality and authenticated route validation MUST
        # precede the branch returning to the legacy installer.
        self.assertLess(SOURCE.index('if sha(active_backend.read_bytes())!=expected["backend"]'),
                        SOURCE.index("modern_filing_ui_not_active"))
        self.assertLess(SOURCE.index("modern_filing_registry_unavailable"),
                        SOURCE.index('print("S9_MANUAL_CLIP_LINKS_DEPLOY_VERIFIED'))
        self.assertIn('modern_filing_requires_coordinated_deployer',SOURCE)
        self.assertIn('"proxy_preserved":True',SOURCE)

if __name__=="__main__":unittest.main(verbosity=2)
