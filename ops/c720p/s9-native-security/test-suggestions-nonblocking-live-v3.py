#!/usr/bin/env python3
"""Live provider extension: non-blocking calibration, original proof unchanged."""
import tempfile
import unittest
from pathlib import Path

from folder_suggestion_engine import ReviewJournal
import folder_suggestion_api
import s9_folder_suggestion_metrics_extension_v1 as metrics

def clip(i, axis):
    vector = [0.0]*512
    vector[axis] = 1.0
    return {'source':'sd','clip_id':f'motion_{1790000000000+i}.mp4',
            'media_sha256':'a'*64,'media_revision':'catalog:1',
            'visual_model_id':'synthetic-512','visual_embedding':vector,
            'structural_aligned_verified':False,
            'color_histogram':[1.0]+[0.0]*31}

class BaselineNonBlocking(unittest.TestCase):
    def test_baseline_missing_does_not_suppress_provisional_or_candidate_eligibility(self):
        rows=[clip(0,0),clip(1,0),clip(2,1),clip(3,1)]
        provider=lambda:{'clips':rows,'folders':[{'id':'A','label':'Person A'},{'id':'B','label':'Person B'}],
                         'gold_decisions':[],'historic_reviewed_keys':[],
                         'features_verified':True,'historic_review_index_verified':True,
                         'revision':'synthetic','scoring_mode':'visual_embedding_cosine_v1',
                         'embedding_similarity_threshold':0.68}
        with tempfile.TemporaryDirectory() as tmp:
            x=metrics._read_only_snapshot(provider,ReviewJournal(Path(tmp)/'reviews.json'))
        self.assertEqual(x['baseline']['ground_truth_clips'],0)
        self.assertFalse(x['baseline']['ready'])
        self.assertGreaterEqual(len(x['provisional_clusters']),1)
        self.assertEqual(x['scoring_mode'],'visual_embedding_cosine_v1')
    def test_review_ticket_verification_unmodified(self):
        self.assertIn('opened_ticket',folder_suggestion_api.review.__code__.co_consts.__str__())
        self.assertIs(metrics._ORIGINAL_SNAPSHOT,folder_suggestion_api.snapshot)
    def test_frontend_rendering_nonblocking_and_provisional_enabled(self):
        base=Path(__file__).parent
        top=(base/'folder-suggestions-top-tab-live-v3.js').read_text()
        cards=(base/'folder-suggestion-cards-live-v3.js').read_text()
        page=(base/'security-people-v53.html').read_text()
        self.assertIn('showProvisional: true',top)
        self.assertNotIn('baseline?.ready === true',top)
        self.assertIn('Informational validation only',cards)
        self.assertNotIn('if (!snapshot.baseline || snapshot.baseline.ready !== true)',cards)
        self.assertIn('opened_ticket: ticket',cards)
        self.assertIn('folder-suggestions-top-tab-v4.js',page)
        self.assertIn('folder-suggestion-cards-live-v3.js',page)
if __name__ == '__main__': unittest.main()
