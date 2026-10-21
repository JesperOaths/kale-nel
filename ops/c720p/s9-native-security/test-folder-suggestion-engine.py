#!/usr/bin/env python3
"""Synthetic, media-free acceptance for folder_suggestion_engine."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

here = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("folder_suggestion_engine", here / "folder_suggestion_engine.py")
eng = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = eng
spec.loader.exec_module(eng)

def axis(k, sign=1):
    vals = [0.0] * 512
    vals[k] = float(sign)
    return vals

def feature(name, *, source="sd", visual=None, upper=None, aligned=True,
            model="osnet-v1", upper_model="struct-v1", hsv=None, media_sha=None):
    return {"source": source, "clip_id": name, "media_sha256": media_sha or "a"*64,
            "media_revision": "video-r1", "visual_model_id": model,
            "structural_model_id": upper_model,
            "visual_embedding": visual if visual is not None else axis(0),
            "structural_crop_embedding": upper,
            "structural_aligned_verified": aligned,
            "color_histogram": hsv}

def decision(clip, folder="P1", status="approved"):
    return {"source": clip["source"], "clip_id": clip["clip_id"],
            "media_sha256": clip["media_sha256"], "media_revision": clip["media_revision"],
            "folder_id": folder, "status": status, "human_confirmed": True}

def folders(*names):
    return [{"id": f, "label": f} for f in names]

class FolderSuggestionsTest(unittest.TestCase):
    def test_primary_weight_formula_and_metrics(self):
        a = feature("one", upper=axis(0), visual=axis(0))
        b = feature("two", upper=axis(0), visual=axis(1))
        got = eng.pair_score(eng.ClipFeatures.from_dict(a), eng.ClipFeatures.from_dict(b))
        self.assertEqual(got["method"], "structural_70_visual_30")
        self.assertAlmostEqual(got["score"], 0.70)
        self.assertAlmostEqual(got["upper_crop_score"], 1)
        self.assertAlmostEqual(got["visual_score"], 0)

    def test_fallback_pairwise_color_and_missing(self):
        a = feature("one", aligned=False, upper=axis(0), hsv=[1]+[0]*31)
        b = feature("two", aligned=False, upper=axis(0), hsv=[.36,.64]+[0]*30)
        p = eng.pair_score(eng.ClipFeatures.from_dict(a), eng.ClipFeatures.from_dict(b))
        self.assertEqual(p["method"], "visual_75_color_25")
        self.assertAlmostEqual(p["color_score"], 0.6)
        self.assertAlmostEqual(p["score"], 0.9)
        b["color_histogram"] = None
        self.assertIsNone(eng.pair_score(eng.ClipFeatures.from_dict(a), eng.ClipFeatures.from_dict(b)))

    def test_reject_mixed_legacy_48_bin_color_schema(self):
        a = feature("legacy",aligned=False,hsv=[1]+[0]*47)
        with self.assertRaisesRegex(ValueError, "32-bin"):
            eng.ClipFeatures.from_dict(a)

    def test_cannot_score_incompatible_visual_models_or_struct_without_alignment(self):
        a = feature("one", upper=axis(0), hsv=[1]+[0]*31)
        b = feature("two", upper=axis(0), hsv=[1]+[0]*31, model="different")
        self.assertIsNone(eng.pair_score(eng.ClipFeatures.from_dict(a), eng.ClipFeatures.from_dict(b)))
        b["visual_model_id"] = a["visual_model_id"]
        b["structural_model_id"] = "different-struct"
        self.assertEqual(eng.pair_score(eng.ClipFeatures.from_dict(a),
                          eng.ClipFeatures.from_dict(b))["method"], "visual_75_color_25")

    def test_review_only_approved_references_and_unbound_exclusion(self):
        ref = feature("ref", upper=axis(0))
        unreviewed = feature("candidate", upper=axis(0))
        legacy = decision(ref)
        legacy.pop("media_revision")
        got = eng.rank_folders([ref,unreviewed], folders("P1"), [legacy])
        self.assertEqual(got["matches"], [])
        self.assertEqual(got["excluded_unbound_or_legacy_decisions"], 1)
        got = eng.rank_folders([ref,unreviewed], folders("P1"), [decision(ref)])
        self.assertEqual(got["approved_reference_counts"]["P1"], 1)
        self.assertEqual(got["matches"][0]["state"], "pending_review")
        self.assertAlmostEqual(got["matches"][0]["score"], 1.0)
        self.assertEqual(got["matches"][0]["suggestion_confidence"],
                         round(eng.suggestion_confidence(1),2))
        self.assertEqual(got["automatic_assignments"], 0)

    def test_stale_revision_cannot_seed_a_centroid(self):
        a = feature("ref", upper=axis(0))
        b = feature("cand", upper=axis(0))
        expired = decision(a)
        expired["media_sha256"] = "b"*64
        got = eng.rank_folders([a,b],folders("P1"),[expired])
        self.assertFalse(got["matches"])
        self.assertEqual(got["excluded_unbound_or_legacy_decisions"], 1)

    def test_source_qualified_same_filename_cannot_cross(self):
        a = feature("same.mp4",source="sd",upper=axis(0))
        b = feature("same.mp4",source="drive",upper=axis(1),media_sha="b"*64)
        got = eng.rank_folders([a,b],folders("P1"),[decision(a)])
        self.assertEqual(got["matches"], [], "below-threshold cannot enter named-folder queue")
        self.assertEqual(got["provisional_clusters"][0]["source_qualified_clips"],
                         ["drive:same.mp4"])

    def test_negative_penalty_only_for_target_folder(self):
        approved = feature("ref", upper=axis(0))
        rejected = feature("reject", upper=axis(0))
        cand = feature("cand", upper=axis(0))
        got = eng.rank_folders([approved,rejected,cand],folders("P1","P2"),
                               [decision(approved,"P1"),decision(approved,"P2"),
                                decision(rejected,"P1","rejected")])
        scored = {(r["folder_id"],r["clip_id"]):r for r in got["matches"]}
        self.assertNotIn(("P1","reject"),scored)
        self.assertAlmostEqual(scored[("P1","cand")]["score"],.75)
        self.assertAlmostEqual(scored[("P2","cand")]["score"],1.)
        self.assertAlmostEqual(scored[("P1","cand")]["negative_penalty"],.25)

    def test_centroids_are_l2_normalized_and_not_sum_weighted(self):
        a = feature("one",upper=axis(0),visual=axis(0))
        b = feature("two",upper=axis(1),visual=axis(1))
        c = feature("candidate",upper=axis(0),visual=axis(0))
        out = eng.rank_folders([a,b,c],folders("P1"),[decision(a),decision(b)])
        hit = out["matches"][0]
        self.assertAlmostEqual(hit["exemplar_score"],1.0)
        self.assertAlmostEqual(hit["centroid_score"],2**-.5,places=6)
        self.assertAlmostEqual(hit["score"],.6+.4*2**-.5,places=6)

    def test_reviewed_rejection_is_not_an_unreviewed_cluster(self):
        ref = feature("ref",upper=axis(0))
        denied = feature("denied",upper=axis(1),visual=axis(1))
        got = eng.rank_folders([ref,denied],folders("P1"),
                               [decision(ref),decision(denied,"P1","rejected")])
        self.assertFalse(any("sd:denied" in c["source_qualified_clips"]
                             for c in got["provisional_clusters"]))
        self.assertFalse(any(r["clip_id"]=="denied" for r in got["matches"]))

    def test_calibration_is_index_not_probability(self):
        self.assertAlmostEqual(eng.suggestion_confidence(.42),50.)
        self.assertGreater(eng.suggestion_confidence(.60),50)
        self.assertLess(eng.suggestion_confidence(.20),50)

    def test_complete_linkage_rejects_bridge_clusters(self):
        # The 0<->1 similarity is .6; 1<->2 is .6; 0<->2 is -.28.
        one = axis(0)
        two = [.6,.8]+[0]*510
        three = [-.28,.96]+[0]*510
        clips = [feature("one", visual=one,aligned=False,hsv=[1]+[0]*31),
                 feature("two", visual=two,aligned=False,hsv=[1]+[0]*31),
                 feature("three",visual=three,aligned=False,hsv=[1]+[0]*31)]
        raw = [eng.ClipFeatures.from_dict(c) for c in clips]
        clusters = eng.agglomerate(raw,threshold=.65)
        self.assertEqual(sorted(c["member_count"] for c in clusters),[1,2])
        self.assertTrue(all(c["state"]=="pending_review" for c in clusters))

    def test_missing_provenance_fails_closed(self):
        a = feature("one",upper=axis(0))
        for key in ("source","clip_id","visual_model_id","media_sha256","media_revision"):
            b = dict(a)
            b[key] = ""
            with self.assertRaises(ValueError, msg=key):
                eng.ClipFeatures.from_dict(b)
        a["visual_embedding"][0]=float("nan")
        with self.assertRaises(ValueError):
            eng.ClipFeatures.from_dict(a)

    def test_journal_requires_review_proof_and_preserves_revisions(self):
        clip = eng.ClipFeatures.from_dict(feature("one",upper=axis(0)))
        with tempfile.TemporaryDirectory() as temp:
            journal = eng.ReviewJournal(Path(temp)/"reviews.json")
            with self.assertRaises(ValueError):
                journal.record(clip=clip,folder_id="P1",action="approve",
                    expected_revision=0,opened_sha256="b"*64,
                    opened_revision=clip.media_revision,
                    authoritative_persisted=True,human_confirmed=True)
            outcome = journal.record(clip=clip,folder_id="P1",action="reject",
                expected_revision=0,opened_sha256=clip.media_sha256,
                opened_revision=clip.media_revision,
                authoritative_persisted=True,human_confirmed=True)
            self.assertEqual(outcome["revision"],1)
            self.assertEqual(outcome["decision"]["status"],"rejected")
            with self.assertRaises(ValueError):
                journal.record(clip=clip,folder_id="P1",action="approve",
                    expected_revision=0,opened_sha256=clip.media_sha256,
                    opened_revision=clip.media_revision,
                    authoritative_persisted=True,human_confirmed=True)
            self.assertEqual(len(journal.read()["decisions"]),1)

    def test_legacy_review_not_resurfaced(self):
        approved = feature("historic.mp4", upper=axis(0))
        rejected = feature("rejected.mp4", upper=axis(0))
        live_ref = feature("live-ref.mp4", upper=axis(0))
        fresh = feature("fresh.mp4", upper=axis(0))
        old_approved = decision(approved)
        old_rejected = decision(rejected, status="rejected")
        old_approved.pop("media_revision")
        old_rejected.pop("media_revision")
        got = eng.rank_folders([approved,rejected,live_ref,fresh],
                               folders("P1", "P2"),
                               [old_approved,old_rejected,decision(live_ref),decision(live_ref,"P2")])
        self.assertEqual(got["approved_reference_counts"]["P1"], 1)
        self.assertEqual(got["excluded_unbound_or_legacy_decisions"], 2)
        self.assertFalse(any(m["clip_id"] == "historic.mp4" for m in got["matches"]))
        self.assertFalse(any(m["clip_id"] == "rejected.mp4" and m["folder_id"] == "P1"
                             for m in got["matches"]))
        self.assertTrue(any(m["clip_id"] == "rejected.mp4" and m["folder_id"] == "P2"
                            for m in got["matches"]))
        self.assertTrue(any(m["clip_id"] == "fresh.mp4" for m in got["matches"]))
        grouped = [key for group in got["provisional_clusters"]
                   for key in group["source_qualified_clips"]]
        self.assertNotIn("sd:historic.mp4", grouped)
        self.assertNotIn("sd:rejected.mp4", grouped)

if __name__ == "__main__":
    unittest.main(verbosity=2)
