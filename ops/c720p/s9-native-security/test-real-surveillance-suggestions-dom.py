#!/usr/bin/env python3
"""Static acceptance for the dashboard's ACTUAL /local surveillance entry."""
from pathlib import Path
import unittest

BASE=Path(__file__).resolve().parent

class RuntimeSuggestionsRoute(unittest.TestCase):
    def test_real_surveillance_entry_guard(self):
        src=(BASE/'install-active-surveillance-suggestions.py').read_text()
        self.assertIn("PAGE = 'c720p-surveillance.html'",src)
        self.assertIn("security-hub-v33.js?v=runtime-nav-20261025b",src)
        self.assertIn('EXPECTED_SHA256',src)
        self.assertIn("os.replace(temp, entry)",src)
        self.assertNotIn('lovelace.c720p_hub',src)
    def test_hub_iframe_route_is_new_and_correct(self):
        js=(BASE/'security-hub-v33.js').read_text()
        self.assertIn('security-people-v53.html?v=runtime-nav-20261025b&',js)
        self.assertIn('security-task9-v1.html?v=task9-live-20261025',js)
    def test_people_nav_loads_actual_dom_guard(self):
        html=(BASE/'security-people-v53.html').read_text()
        self.assertIn('<nav class="tabs" aria-label="People and faces workspace">',html)
        self.assertEqual(html.count('data-pane="suggestions"'),1)
        self.assertIn('id="suggestionsTabCount"',html)
        self.assertIn('id="liveFolderSuggestionCards"',html)
        self.assertIn('people-suggestions-dom-guard-v1.js?v=runtime-nav-20261025b',html)
        self.assertIn('folder-suggestions-top-tab-live-v3.js?v=active-suggestions-v3-20261026',html)
    def test_guard_inserts_tab_or_reuses_existing_and_wires_click(self):
        js=(BASE/'people-suggestions-dom-guard-v1.js').read_text()
        for term in ('document.createElement(\'button\')','button.dataset.pane = \'suggestions\'',
                     "nav.dataset.vectorSuggestionsBound", "nav.addEventListener('click'",
                     "'people-folder-suggestions-open'", 'event.stopImmediatePropagation()',
                     "window.FolderSuggestionCards?.connect", 'suggestionsTabCount'):
            self.assertIn(term,js)

if __name__=='__main__':
    unittest.main()
