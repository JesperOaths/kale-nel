"""OpenCV reference/diagnostic client for the native S9+ HSV colour index.

Production indexing/query algorithms are in AppearanceSearchIndex.java on S9+.
This module reads the same microSD SQLite schema for reproducible calibration.
It never accesses faces, biometric embeddings, cameras, or network services.
"""

import math
import re
import sqlite3
from pathlib import Path

import cv2
import numpy as np

BINS = (18, 8, 8)
HIST_SIZE = math.prod(BINS)
CLIP_RE = re.compile(r"motion_[0-9]{13}\.mp4\Z")
CATEGORIES = frozenset(("upper_clothing", "lower_clothing", "vehicle"))
ZONES = frozenset(("front_garden", "background_street", "unspecified"))
SCHEMA = """
CREATE TABLE IF NOT EXISTS clips (
 clip_name TEXT PRIMARY KEY,
 start_ms INTEGER NOT NULL,
 end_ms INTEGER NOT NULL,
 scene TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS observations (
 clip_name TEXT NOT NULL,
 sample_no INTEGER NOT NULL,
 offset_ms INTEGER NOT NULL,
 category TEXT NOT NULL,
 zone TEXT NOT NULL,
 h_bin INTEGER NOT NULL,
 s_bin INTEGER NOT NULL,
 v_bin INTEGER NOT NULL,
 r_bin INTEGER NOT NULL,
 g_bin INTEGER NOT NULL,
 b_bin INTEGER NOT NULL,
 histogram BLOB NOT NULL,
 PRIMARY KEY (clip_name, sample_no)
);
CREATE INDEX IF NOT EXISTS appearance_lookup
 ON observations(category,zone,clip_name);
CREATE INDEX IF NOT EXISTS appearance_clip_time ON clips(start_ms,end_ms);
"""


def initialize(connection: sqlite3.Connection) -> None:
    connection.executescript(SCHEMA)


def histogram(crop_bgr: np.ndarray, mask: np.ndarray | None = None) -> np.ndarray:
    """L1-normalized 3-D HSV histogram (OpenCV hue range 0..180)."""
    image = np.asarray(crop_bgr)
    if image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("Expected nonempty uint8 BGR image with three channels")
    if image.shape[0] < 8 or image.shape[1] < 8:
        raise ValueError("Image crop too small")
    if mask is not None:
        mask = np.asarray(mask)
        if mask.dtype != np.uint8 or mask.shape != image.shape[:2] or not np.any(mask):
            raise ValueError("Invalid nonempty uint8 segmentation mask")
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    vector = cv2.calcHist([hsv], [0, 1, 2], mask, list(BINS),
                          [0, 180, 0, 256, 0, 256]).astype(np.float32)
    cv2.normalize(vector, vector, alpha=1.0, norm_type=cv2.NORM_L1)
    return vector


def similarity(a: np.ndarray, b: np.ndarray,
               method: str = "bhattacharyya") -> float:
    """0..1 appearance similarity; 1 means identical colour distribution."""
    if a.shape != BINS or b.shape != BINS:
        raise ValueError("Histogram shapes do not match the S9 index")
    if method == "bhattacharyya":
        distance = cv2.compareHist(a, b, cv2.HISTCMP_BHATTACHARYYA)
        return float(np.clip(1.0 - distance, 0.0, 1.0))
    if method == "correlation":
        correlation = cv2.compareHist(a, b, cv2.HISTCMP_CORREL)
        return float(np.clip((correlation + 1.0) / 2.0, 0.0, 1.0))
    raise ValueError("Unknown metric")


def _bins(crop_bgr: np.ndarray, hist: np.ndarray) -> tuple[int, ...]:
    h, s, v = np.unravel_index(int(hist.argmax()), BINS)
    b, g, r = (np.bincount(crop_bgr[:, :, axis].ravel() // 32,
                            minlength=8).argmax()
               for axis in (0, 1, 2))
    return int(h), int(s), int(v), int(r), int(g), int(b)


def index_clip(connection: sqlite3.Connection, clip_name: str, duration_ms: int,
               scene: str, observations: list[dict]) -> None:
    """Diagnostic indexer compatible with the on-phone SQLite schema."""
    if not CLIP_RE.fullmatch(clip_name) or duration_ms < 0 or len(observations) > 128:
        raise ValueError("Invalid finalized clip")
    start_ms = int(clip_name[7:20])
    prepared = []
    for sample in observations:
        category = sample["category"]
        zone = sample["zone"]
        offset_ms = int(sample["offset_ms"])
        if category not in CATEGORIES or zone not in ZONES or not 0 <= offset_ms <= duration_ms:
            raise ValueError("Invalid observation")
        crop = np.asarray(sample["crop_bgr"])
        hist = histogram(crop)
        prepared.append((offset_ms, category, zone, *_bins(crop, hist),
                         hist.astype("<f4").tobytes()))

    with connection:
        connection.execute(
            "INSERT OR REPLACE INTO clips (clip_name,start_ms,end_ms,scene) "
            "VALUES (?,?,?,?)", (clip_name, start_ms, start_ms + duration_ms, scene)
        )
        connection.execute("DELETE FROM observations WHERE clip_name=?", (clip_name,))
        connection.executemany(
            "INSERT INTO observations "
            "(clip_name,sample_no,offset_ms,category,zone,"
            "h_bin,s_bin,v_bin,r_bin,g_bin,b_bin,histogram) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            [(clip_name, i, *item) for i, item in enumerate(prepared)]
        )


def search(connection: sqlite3.Connection, reference_bgr: np.ndarray,
           category: str, *, zone: str | None = None,
           from_ms: int | None = None, until_ms: int | None = None,
           method: str = "bhattacharyya", limit: int = 20) -> list[dict]:
    """Rank clips by best colour-distance observation, never by identity."""
    if category not in CATEGORIES or (zone is not None and zone not in ZONES):
        raise ValueError("Unsupported attribute filter")
    if method not in ("bhattacharyya", "correlation") or not 1 <= limit <= 50:
        raise ValueError("Invalid metric or result limit")
    if from_ms is not None and until_ms is not None and from_ms > until_ms:
        raise ValueError("Inverted time interval")

    reference = histogram(reference_bgr)
    conditions = ["o.category=?"]
    params: list = [category]
    if zone is not None:
        conditions.append("o.zone=?")
        params.append(zone)
    if from_ms is not None:
        conditions.append("c.end_ms>=?")
        params.append(int(from_ms))
    if until_ms is not None:
        conditions.append("c.start_ms<=?")
        params.append(int(until_ms))
    sql = (
        "SELECT c.clip_name,c.start_ms,c.end_ms,c.scene,"
        "o.offset_ms,o.zone,o.histogram "
        "FROM observations o JOIN clips c ON c.clip_name=o.clip_name WHERE "
        + " AND ".join(conditions)
        + " ORDER BY c.start_ms DESC LIMIT 4000"
    )
    best = {}
    for name, start, end, scene, offset, observed_zone, blob in connection.execute(sql, params):
        if len(blob) != HIST_SIZE * 4:
            continue
        candidate = np.frombuffer(blob, dtype="<f4").reshape(BINS)
        if not np.all(np.isfinite(candidate)) or np.min(candidate) < 0:
            continue
        if abs(float(candidate.sum()) - 1) > .01:
            continue
        score = similarity(reference, candidate, method)
        if name in best and best[name]["similarity"] >= score:
            continue
        best[name] = {
            "clip_name": name, "start_ms": start, "end_ms": end,
            "scene": scene, "offset_ms": offset, "zone": observed_zone,
            "similarity": round(score, 4), "metric": method,
            "appearance_only": True, "verified_same_person": False,
            "index_version": "s9_hsv_histogram_index_v1"
        }
    return sorted(best.values(),
                  key=lambda result: (-result["similarity"], result["clip_name"]))[:limit]
