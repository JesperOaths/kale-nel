#!/usr/bin/env python3
"""Read-only manual neural triage v2 static frontend invariants."""
import unittest
from pathlib import Path

DIR=Path(__file__).parent

class TriageV2(unittest.TestCase):
    def setUp(self):
        self.s=(DIR/'local-neural-manual-triage-v2.js').read_text()
    def test_newest_page_asset(self):
        page=(DIR/'security-people-v53.html').read_text()
        self.assertEqual(page.count('local-neural-manual-triage-v5.js?v=neural-assigned-crop-sync-v5-20261026'),1)
        self.assertNotIn('local-neural-manual-triage-v1.js?v=',page)
    def test_real_queue_not_truncated(self):
        for fragment in ("doc.count!==49","doc.items.length!==49","row.score<q",
                         "renderFiltered()","beforebegin","stats.textContent"):
            self.assertIn(fragment,self.s)
        self.assertIn("original.insertAdjacentElement('beforebegin', section)",self.s)
    def test_drafts_are_local_only_and_labeled(self):
        for fragment in ('window.localStorage.getItem','window.localStorage.setItem',
                         'browser only','NOT filed','decision_saved,review_basis',
                         'false,none','Copy draft CSV','Clear local drafts'):
            self.assertIn(fragment,self.s)
        self.assertNotIn("method:'POST'",self.s)
        self.assertNotIn("method: 'POST'",self.s)
        self.assertNotIn('opened_ticket',self.s)
        self.assertNotIn('preview_ticket',self.s)
        self.assertNotIn('authoritative_commit',self.s)
    def test_initial_people_crops_are_independent(self):
        self.assertIn('Promise.resolve().then(async()=>',self.s)
        self.assertIn('appendAssignedReferences(doc)',self.s)
        self.assertIn('MutationObserver',self.s)
    def test_search_and_filter_all_clip_preserving(self):
        for fragment in ('My local draft changes','Search pending S9 recordings',
                         'Search recording or folder','filter.value',
                         'search.addEventListener','clip_id.toLowerCase()'):
            self.assertIn(fragment,self.s)

if __name__=='__main__':unittest.main()

