#!/usr/bin/env python3
"""Deterministic appearance-only search tests using synthetic image crops."""
import importlib.util
import pathlib
import sqlite3
import unittest

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("hsv_search", ROOT / "s9_hsv_search_reference.py")
search = importlib.util.module_from_spec(spec)
spec.loader.exec_module(search)


def colour(bgr):
    result = np.zeros((40, 40, 3), np.uint8)
    result[:] = bgr
    return result


BLUE = colour((255, 0, 0))
RED = colour((0, 0, 255))
GREEN = colour((0, 255, 0))


class SearchTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        search.initialize(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_histogram_l1_and_bhattacharyya(self):
        blue, red = search.histogram(BLUE), search.histogram(RED)
        self.assertEqual(blue.shape, search.BINS)
        self.assertAlmostEqual(float(blue.sum()), 1.0)
        self.assertAlmostEqual(search.similarity(blue, blue), 1.0, places=5)
        self.assertLess(search.similarity(blue, red), 0.25)
        self.assertGreater(search.similarity(blue, blue, "correlation"), .99)
        self.assertLess(search.similarity(blue, red, "correlation"), .75)

    def test_segmentation_and_invalid_pixels(self):
        mask = np.zeros(BLUE.shape[:2], np.uint8)
        mask[:, :20] = 255
        self.assertAlmostEqual(float(search.histogram(BLUE, mask).sum()), 1)
        with self.assertRaises(ValueError):
            search.histogram(BLUE, np.zeros(BLUE.shape[:2], np.uint8))
        with self.assertRaises(ValueError):
            search.histogram(np.zeros((0, 0, 3), np.uint8))

    def test_rank_metadata_grouping_and_reindex(self):
        a = "motion_1770000000000.mp4"
        b = "motion_1770001000000.mp4"
        c = "motion_1770002000000.mp4"
        search.index_clip(self.conn, a, 9000, "one_person", [
            {"category": "upper_clothing", "zone": "front_garden",
             "offset_ms": 1000, "crop_bgr": BLUE},
            {"category": "upper_clothing", "zone": "front_garden",
             "offset_ms": 2000, "crop_bgr": RED},
        ])
        search.index_clip(self.conn, b, 9000, "one_person", [
            {"category": "upper_clothing", "zone": "front_garden",
             "offset_ms": 1500, "crop_bgr": RED}
        ])
        search.index_clip(self.conn, c, 9000, "vehicle", [
            {"category": "vehicle", "zone": "background_street",
             "offset_ms": 1700, "crop_bgr": BLUE}
        ])
        results = search.search(self.conn, BLUE, "upper_clothing", zone="front_garden")
        self.assertEqual([r["clip_name"] for r in results], [a, b])
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["offset_ms"], 1000)
        self.assertAlmostEqual(results[0]["similarity"], 1)
        self.assertTrue(results[0]["appearance_only"])
        self.assertFalse(results[0]["verified_same_person"])
        self.assertEqual(search.search(self.conn, BLUE, "vehicle",
                                       zone="front_garden"), [])
        self.assertEqual(search.search(self.conn, BLUE, "upper_clothing",
                                       from_ms=1770000500000)[0]["clip_name"], b)
        self.assertEqual(search.search(self.conn, BLUE, "vehicle")[0]["clip_name"], c)

        # Re-reviewing a clip replaces its observations rather than duplicating.
        search.index_clip(self.conn, a, 9000, "one_person", [
            {"category": "upper_clothing", "zone": "front_garden",
             "offset_ms": 4000, "crop_bgr": GREEN}
        ])
        count = self.conn.execute(
            "SELECT count(*) FROM observations WHERE clip_name=?", (a,)).fetchone()[0]
        self.assertEqual(count, 1)

    def test_protect_restrictions_and_no_identity(self):
        with self.assertRaises(ValueError):
            search.search(self.conn, BLUE, "face")
        with self.assertRaises(ValueError):
            search.search(self.conn, BLUE, "upper_clothing", zone="unknown_zone")
        with self.assertRaises(ValueError):
            search.index_clip(self.conn, "../clip.mp4", 1000, "x", [])
        with self.assertRaises(ValueError):
            search.search(self.conn, BLUE, "vehicle", from_ms=99, until_ms=1)
        android = (ROOT / "src/nl/kalenel/s9security/AppearanceSearchIndex.java").read_text()
        classifier = (ROOT / "src/nl/kalenel/s9security/ClipClassifier.java").read_text()
        fetch = (ROOT / "fetch-source.sh").read_text()
        self.assertIn("SQLiteDatabase", android)
        self.assertIn("AppearanceSearchIndex.sample(", classifier)
        self.assertIn('result.put("appearance_search_status","indexed_on_phone")', classifier)
        self.assertIn("AppearanceSearchIndex", fetch)
        self.assertIn("verified_same_person", android)
        self.assertNotIn("faceEmbedding", android)
        self.assertNotIn("personIdentityScore", android)


if __name__ == "__main__":
    unittest.main(verbosity=2)
