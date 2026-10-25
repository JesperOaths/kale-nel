#!/usr/bin/env python3
"""No-phone, no-originals checks for the authenticated 512-D Suggestions route."""
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import unittest

from folder_suggestion_engine import VECTOR_ONLY, ClipFeatures, ReviewJournal
from folder_suggestion_api import snapshot
from s9_folder_suggestion_bridge_v1 import Bridge

def feature(name, axis=0):
    vec = [0.0] * 512
    vec[axis] = 1.0
    return {
        'source': 'sd', 'clip_id': name, 'media_sha256': 'a' * 64,
        'media_revision': 'catalog:1', 'visual_model_id': 'verified-model',
        'visual_embedding': vec, 'structural_aligned_verified': False,
        'color_histogram': [1.0] + [0.0] * 31,
    }

class FakeBridge(Bridge):
    def __init__(self):
        self.local = threading.local()
        self.samples = [feature('reference.mp4'), feature('candidate.mp4')]
    def review_state(self):
        return {'revision': 5}, [{'id': 'P1', 'label': 'One'}], [], 'verified-manual'
    def features(self):
        return list(self.samples)

class VectorOnlyRouteTest(unittest.TestCase):
    def test_provider_explicitly_pins_512d_vector_engine(self):
        data = FakeBridge().provider()
        self.assertEqual(data['scoring_mode'], VECTOR_ONLY)
        self.assertEqual(data['embedding_similarity_threshold'], 0.68)
        self.assertEqual(len(data['clips'][0]['visual_embedding']), 512)

    def test_actual_snapshot_is_vector_only_and_uses_approved_reference(self):
        bridge = FakeBridge()
        with TemporaryDirectory() as folder:
            journal = ReviewJournal(Path(folder) / 'test-journal.json')
            ref = ClipFeatures.from_dict(bridge.samples[0])
            journal.record(clip=ref, folder_id='P1', action='approve',
                           expected_revision=0,
                           opened_sha256=ref.media_sha256,
                           opened_revision=ref.media_revision,
                           authoritative_persisted=True,
                           human_confirmed=True)
            result = snapshot(bridge.provider, journal)
            self.assertEqual(result['scoring_mode'], VECTOR_ONLY)
            self.assertEqual(result['approved_reference_counts'], {'P1': 1})
            self.assertEqual(len(result['matches']), 1)
            row = result['matches'][0]
            self.assertEqual(row['method'], VECTOR_ONLY)
            self.assertAlmostEqual(row['score'], 1.0)
            self.assertAlmostEqual(row['visual_score'], 1.0)
            self.assertIsNone(row['color_score'])
            self.assertIsNone(row['upper_crop_score'])
            self.assertEqual(result['automatic_assignments'], 0)
            self.assertFalse(result['raw_embeddings_exposed'])
            self.assertNotIn('visual_embedding', row)

    def test_legacy_people_entries_redirect_to_top_level_vector_page(self):
        base = Path(__file__).resolve().parent
        for entry in ('security-people-v33.html', 'security-people-v50.html'):
            raw = (base / entry).read_text()
            self.assertIn('security-people-v52.html?v=vector-only-suggestions-20261025', raw)
            self.assertNotIn('security-people-v50.html?v=security-visible-route', raw)

if __name__ == '__main__':
    unittest.main()
