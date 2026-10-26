#!/usr/bin/env python3
"""Neural card -> exact original S9 review player, no review proof shortcuts."""
from pathlib import Path
import unittest

HERE=Path(__file__).parent

class ReviewHandoff(unittest.TestCase):
    def setUp(self):
        self.person=(HERE/'security-people-v328.js').read_text()
        self.triage=(HERE/'local-neural-manual-triage-v4.js').read_text()
        self.page=(HERE/'security-people-v53.html').read_text()
    def test_cache_busted_page_integration(self):
        self.assertIn('security-people-v328.js?v=neural-review-handoff-v1-20261026',self.page)
        self.assertIn('local-neural-manual-triage-v5.js?v=neural-assigned-crop-sync-v5-20261026',self.page)
        self.assertNotIn('local-neural-manual-triage-v3.js?v=',self.page)
    def test_explicit_user_action_with_correct_original_clip(self):
        self.assertEqual(self.triage.count("node('button','▶ Review this recording')"),1)
        self.assertIn("reviewThis.addEventListener('click',()=>{",self.triage)
        self.assertIn("new CustomEvent('people-neural-review-target'",self.triage)
        self.assertIn("detail:{source:'sd',clip_id:row.clip_id}",self.triage)
        self.assertIn("window.addEventListener('people-neural-review-target'",self.person)
        self.assertIn("typeof clip!=='string'||!clipName.test(clip)",self.person)
        self.assertIn("if(state.busy)return;",self.person)
        self.assertIn("openReview('all');",self.person)
        self.assertIn("playVideo('/new/saved/clip/'+encodeURIComponent(clip)",self.person)
    def test_no_preview_ticket_or_autofiling(self):
        start=self.person.index("// One-click neural comparison handoff:")
        end=self.person.index("\n});",start)+4
        hook=self.person[start:end]
        for source in (hook,self.triage):
            for disallowed in ("opened_ticket","preview_ticket",
                               "original_opened","method:'POST'","method: 'POST'"):
                self.assertNotIn(disallowed,source)
        self.assertNotIn('manualLink(',hook)
        self.assertNotIn('openApproval(',hook)
        self.assertIn("const clip=detail?.clip_id",hook)
        self.assertIn("state.reviewSource='sd'",hook)
    def test_existing_review_writes_still_use_original_workflow(self):
        self.assertIn("const ok=await manualLink",self.person)
        self.assertIn("const filename=decodeURIComponent(path.split('/').pop()",self.person)
        self.assertIn("if(!modal.open)modal.showModal()",self.person)
        self.assertIn("function openReview(mode)",self.person)
        self.assertIn("function playVideo(path,title,seconds,originItem=null)",self.person)

if __name__=='__main__':unittest.main()

