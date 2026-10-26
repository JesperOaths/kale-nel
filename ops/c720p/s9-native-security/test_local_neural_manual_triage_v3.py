#!/usr/bin/env python3
"""Dynamic neural queue frontend metadata and read-only proofs (no browser required)."""
from pathlib import Path
import unittest

ROOT=Path(__file__).parent
class FrontendV3(unittest.TestCase):
    def setUp(self):
        self.js=(ROOT/'local-neural-manual-triage-v3.js').read_text()
        self.page=(ROOT/'security-people-v53.html').read_text()
    def test_current_script_is_cache_busted(self):
        self.assertIn('local-neural-manual-triage-v5.js?v=neural-assigned-crop-sync-v5-20261026',self.page)
        self.assertNotIn('local-neural-manual-triage-v2.js?v=',self.page)
    def test_queue_counts_dynamic_and_correlated(self):
        for clause in ('doc.count+doc.assigned_s9_count!==52','doc.indexed_crop_count!==52',
          'doc.assigned_s9_crops.length!==doc.assigned_s9_count',
          'doc.items.length!==doc.count','doc.reference_count<1'):
            self.assertIn(clause,self.js)
        self.assertNotIn('doc.count!==49',self.js)
        self.assertNotIn('doc.assigned_s9_crops.length!==3',self.js)
    def test_multi_person_and_draft_retirement(self):
        for clause in ('item.folder_ids','const live=new Set(doc.items.map(row=>row.clip_id))',
          'if(!live.has(key)||!folders.has(drafts[key]))','persistDrafts()'):
            self.assertIn(clause,self.js)
    def test_no_approval_forgery_or_person_recognition(self):
        for clause in ("method:'POST'","method: 'POST'",'opened_ticket','preview_ticket',
          'authoritative_commit'):
            self.assertNotIn(clause,self.js)
        self.assertIn('Uncertain visual comparison',self.js)
        self.assertIn('browser',self.js.lower())

if __name__=='__main__':unittest.main()

