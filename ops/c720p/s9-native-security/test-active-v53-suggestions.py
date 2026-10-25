#!/usr/bin/env python3
"""Static acceptance of the active People & faces UI, not the dormant v52 page."""
from pathlib import Path
import re
import unittest

BASE=Path(__file__).resolve().parent
class ActiveSuggestionsUI(unittest.TestCase):
 def test_real_v53_top_subnavigation_has_one_suggestions_peer(self):
  html=(BASE/'security-people-v53.html').read_text()
  nav=re.search(r'<nav class="tabs" aria-label="People and faces workspace">(.*?)</nav>',html,re.S)
  self.assertIsNotNone(nav)
  names=re.findall(r'data-pane="([a-z]+)"',nav.group(1))
  self.assertEqual(names[:5],['people','review','automatic','suggestions','clothing'])
  self.assertEqual(names.count('suggestions'),1)
  self.assertIn('id="suggestionsTabCount"',nav.group(1))
  self.assertIn('aria-controls="suggestions"',nav.group(1))
  self.assertIn('<section id="suggestions" hidden',html)
  self.assertIn('id="liveFolderSuggestionCards"',html)
  self.assertIn('id="refreshSuggestions"',html)
 def test_current_page_loads_vector_review_and_preserves_appearance_evidence(self):
  html=(BASE/'security-people-v53.html').read_text()
  for asset in ['folder-suggestion-cards-live-v3.js','folder-suggestions-top-tab-live-v3.js','security-people-v326.js','appearance-evidence-panel-v3.js']:
   self.assertIn(asset,html)
  self.assertNotIn('security-people-v323.js?v=',html)
  self.assertIn('width:100%;max-width:100%',html)
  self.assertIn('GEJAST_PAGE_VERSION="v817"',html)
  self.assertIn('v817 - Made by Bruis',html)
  adapter=(BASE/'folder-suggestions-top-tab-live-v3.js').read_text()
  self.assertIn("requiredMode: VECTOR_MODE",adapter)
  self.assertIn("visual_embedding_cosine_v1",adapter)
  self.assertIn("window.addEventListener('people-folder-suggestions-open', load)",adapter)
  appearance=(BASE/'appearance-evidence-panel-v3.js').read_text()
  self.assertIn("node('button','Appearance comparisons')",appearance)
  self.assertNotIn("node('button','Folder Suggestions')",appearance)
 def test_v326_click_exclusively_opens_suggestions(self):
  controller=(BASE/'security-people-v326.js').read_text()
  self.assertIn("['overview','review','people','clothing','automatic','suggestions','folderView']",controller)
  self.assertIn("if(pane==='suggestions'){",controller)
  self.assertIn("window.dispatchEvent(new Event('people-folder-suggestions-open'))",controller)
  self.assertIn("const p=b.dataset.pane;if(p==='review')openReview('all');else openHome(p);",controller)
  self.assertIn('window.AppearanceEvidenceV2',controller)
  self.assertIn("if(state.pane==='suggestions'){",controller)
 def test_active_security_hub_routes_v53_with_fresh_url(self):
  hub=(BASE/'security-hub-v32.js').read_text()
  self.assertIn("security-people-v53.html?v=suggestions-active-v53-20261025&",hub)
  self.assertIn("security-task9-v1.html?v=task9-live-20261025",hub)
  installer=(BASE/'install-active-people-hub-loader.py').read_text()
  self.assertIn('security-hub-v32.js?v=suggestions-active-v53-20261025',installer)
  self.assertIn('EXPECTED_ORIGINAL_SHA256',installer)

if __name__=='__main__':
 unittest.main()

