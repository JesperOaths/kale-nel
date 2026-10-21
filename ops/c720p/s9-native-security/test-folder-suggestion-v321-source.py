#!/usr/bin/env python3
"""Versioned People V321/V51 source-safety regression; no production writes."""
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent


class VersionedFolderSuggestionUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v320 = (HERE / "security-people-v320.js").read_bytes()
        cls.v321 = (HERE / "security-people-v321.js").read_bytes()
        cls.v50 = (HERE / "security-people-v50.html").read_bytes()
        cls.v51 = (HERE / "security-people-v51.html").read_bytes()
        cls.legacy = (HERE / "security-people-v45.js").read_bytes()

    def test_production_source_baseline_preserved(self):
        self.assertNotIn(b"folderRankedCards", self.v320)
        self.assertIn(b"security-people-v320.js", self.v50)
        self.assertNotIn(b"security-people-v321.js", self.v50)
        self.assertNotIn(b"folder-suggestion-cards-v1.js", self.v50)

    def test_v321_changes_are_exactly_review_bridge(self):
        start = b"// Optional source-level bridge to media-bound model suggestions."
        stop = b"function renderFolder(){"
        self.assertEqual(self.v321.count(start), 1)
        a = self.v321.index(start)
        b = self.v321.index(stop, a)
        bridge = self.v321[a:b]
        self.assertIn(b"function renderFolderRankedButton(){", bridge)
        self.assertIn(b"FolderSuggestionCards.connect(", bridge)
        restored = self.v321.replace(bridge, b"", 1)
        invocation = b" renderFolderRankedButton();\n"
        self.assertEqual(restored.count(invocation), 1)
        restored = restored.replace(invocation, b"", 1)
        self.assertEqual(restored, self.v320)
        self.assertIn(b"window.S9SignedOriginalReview", self.v321)
        self.assertIn(b"openAndAttest", self.v321)
        self.assertIn(b"return {verified:false}", self.v321)

    def test_v51_only_adds_versioned_assets_and_optional_panel(self):
        old = (b'<script defer src="/local/frontyard-security-new/security-people-v320.js'
               b'?v=people-faces-sorting-v320c-20261021"></script>')
        new = (b'<script defer src="/local/frontyard-security-new/folder-suggestion-cards-v1.js'
               b'?v=folder-suggestions-v1"></script>\n'
               b'<script defer src="/local/frontyard-security-new/security-people-v321.js'
               b'?v=folder-review-v321-20261021"></script>')
        old_layout = b'<div class="folder-layout"><div><div id="folderGrid" class="grid"></div>'
        new_layout = (b'<div class="folder-layout"><div><section id="folderRankedCards" '
                      b'class="folder-model-suggestions" hidden '
                      b'aria-label="Media-bound provisional folder suggestions"></section>'
                      b'<div id="folderGrid" class="grid"></div>')
        self.assertEqual(self.v50.count(old), 1)
        self.assertEqual(self.v51.count(new), 1)
        reconstructed = self.v50.replace(old, new).replace(old_layout, new_layout)
        reconstructed = reconstructed.replace(b'Review workspace V45</title>',
                                              b'Review workspace V51</title>')
        self.assertEqual(reconstructed, self.v51)
        self.assertEqual(self.v51.count(b'folderRankedCards'), 1)

    def test_never_changes_any_review_without_verified_original(self):
        self.assertIn(b"row.source_qualified_clip_id", self.v321)
        self.assertIn(b"onOpen:async row=>", self.v321)
        self.assertIn(b"onClusterOpen:async", self.v321)
        self.assertIn(b"onClusterName:async", self.v321)
        self.assertNotIn(b"autoApprove(", self.v321)
        self.assertNotIn(b"autoAssign(", self.v321)
        self.assertIn(b"state.tab!=='suggestions'", self.v321)


if __name__ == "__main__":
    unittest.main(verbosity=2)
