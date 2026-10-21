#!/usr/bin/env python3
"""Human-review-only provisional folder appearance ranking.

Consumes the two 512-D appearance embeddings emitted by PersonFeatureExtractor.
Uses the conditional scorer from PR #808: aligned+compatible structural/visual
(0.70/0.30), otherwise visual/PAIRWISE HSV (0.75/0.25).
This is not identity recognition, identity probability or automatic assignment.

All reference labels must be explicit, media-bound human decisions. Historic
unbound approvals, unknown models and revoked/stale media cannot become training
references by inference. No original video, image or model is modified here.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
from typing import Any, Callable, Mapping, Sequence

DIM = 512
MATCH_THRESHOLD = 0.55
CLUSTER_THRESHOLD = 0.45
NEGATIVE_THRESHOLD = 0.55
NEGATIVE_PENALTY = 0.25
SCHEMA = "folder_suggestions_v1"


def unit(values: Any, *, dimension: int = DIM) -> tuple[float, ...] | None:
    if values is None:
        return None
    if not isinstance(values, (list, tuple)) or len(values) != dimension:
        raise ValueError("Expected a valid 512-dimensional embedding")
    try:
        numbers = tuple(float(v) for v in values)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Invalid embedding") from exc
    if not all(math.isfinite(v) for v in numbers):
        raise ValueError("Nonfinite embedding")
    length = math.sqrt(math.fsum(v * v for v in numbers))
    if not math.isfinite(length) or length < 1e-10:
        raise ValueError("Zero-length embedding")
    return tuple(v / length for v in numbers)


def histogram(values: Any) -> tuple[float, ...] | None:
    if values is None:
        return None
    if not isinstance(values, (list, tuple)) or len(values) != 32:
        raise ValueError("Expected 32-bin pairwise-comparable HSV histogram")
    try:
        nums = tuple(float(v) for v in values)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError("Invalid histogram") from exc
    if not all(math.isfinite(v) and v >= 0 for v in nums):
        raise ValueError("Invalid histogram bins")
    total = math.fsum(nums)
    if total < 1e-10:
        raise ValueError("Empty color histogram")
    return tuple(v / total for v in nums)


def cosine(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    return max(-1.0, min(1.0, math.fsum(x * y for x, y in zip(a, b))))


def color_affinity(a: tuple[float, ...] | None,
                   b: tuple[float, ...] | None) -> float | None:
    """PR #808 pairwise color comparison (Bhattacharyya affinity for HSV32)."""
    if a is None or b is None or len(a) != len(b):
        return None
    return max(0.0, min(1.0, math.fsum(math.sqrt(x * y) for x, y in zip(a, b))))


def normalized_centroid(vectors: Sequence[tuple[float, ...]]) -> tuple[float, ...] | None:
    if not vectors:
        return None
    n = len(vectors)
    means = tuple(math.fsum(vec[i] for vec in vectors) / n for i in range(DIM))
    # Opposite vectors can cancel. Refuse to invent a centroid in that case.
    length = math.sqrt(math.fsum(v * v for v in means))
    if length < 1e-10:
        return None
    return tuple(v / length for v in means)


@dataclass(frozen=True)
class ClipFeatures:
    source: str
    clip_id: str
    media_sha256: str
    media_revision: str
    visual_model_id: str
    visual: tuple[float, ...]
    structural_model_id: str
    structural: tuple[float, ...] | None
    structural_aligned_verified: bool
    hsv: tuple[float, ...] | None

    @property
    def key(self) -> str:
        return self.source + ":" + self.clip_id

    @classmethod
    def from_dict(cls, obj: Mapping[str, Any]) -> "ClipFeatures":
        # Do not collapse equal filenames across SD, Drive or other archives.
        source = str(obj.get("source") or "")
        clip_id = str(obj.get("clip_id") or obj.get("name") or "")
        media_sha = str(obj.get("media_sha256") or obj.get("original_sha256") or "")
        revision = str(obj.get("media_revision") or "")
        if not source or ":" in source or not clip_id or not media_sha or not revision:
            raise ValueError("Source-qualified, media-bound recording required")
        if len(media_sha) != 64 or any(c not in "0123456789abcdef" for c in media_sha):
            raise ValueError("Invalid original SHA-256")
        visual_id = str(obj.get("visual_model_id") or obj.get("visual_model_sha256") or "")
        structural_id = str(obj.get("structural_model_id") or obj.get("structural_model_sha256") or "")
        if not visual_id.strip():
            raise ValueError("Missing visual model provenance")
        visual = unit(obj.get("visual_embedding"))
        if visual is None:
            raise ValueError("Visual embedding is required")
        structural = unit(obj.get("structural_crop_embedding"))
        aligned = obj.get("structural_aligned_verified") is True
        if structural is not None and not structural_id:
            raise ValueError("Missing structural model provenance")
        hsv = histogram(obj.get("color_histogram") if "color_histogram" in obj
                        else obj.get("upper_hsv32"))
        return cls(source, clip_id, media_sha, revision, visual_id, visual,
                   structural_id, structural, aligned, hsv)


def pair_score(a: ClipFeatures, b: ClipFeatures) -> dict[str, Any] | None:
    """Mirror PhoneOfflineSimilarity.compare(Evidence, Evidence, pairColor)."""
    if a.key == b.key or a.visual_model_id != b.visual_model_id:
        return None
    visual_score = cosine(a.visual, b.visual)
    upper = None
    color = color_affinity(a.hsv, b.hsv)
    if (a.structural_aligned_verified and b.structural_aligned_verified
            and a.structural is not None and b.structural is not None
            and a.structural_model_id and a.structural_model_id == b.structural_model_id):
        upper = cosine(a.structural, b.structural)
        score = 0.70 * upper + 0.30 * visual_score
        method = "structural_70_visual_30"
    elif color is not None:
        score = 0.75 * visual_score + 0.25 * color
        method = "visual_75_color_25"
    else:
        return None  # never treat missing color as zero or skip its 25% share
    return {"score": score, "method": method, "upper_crop_score": upper,
            "visual_score": visual_score, "color_score": color}


def centroid_score(candidate: ClipFeatures,
                   refs: Sequence[ClipFeatures]) -> dict[str, Any] | None:
    compatible = [r for r in refs if r.key != candidate.key
                  and r.visual_model_id == candidate.visual_model_id]
    if not compatible:
        return None
    structural = [r for r in compatible if candidate.structural_aligned_verified
                  and candidate.structural is not None and r.structural_aligned_verified
                  and r.structural is not None and candidate.structural_model_id
                  and candidate.structural_model_id == r.structural_model_id]
    if structural:
        # Both centroids use the EXACT same compatible population.
        visual_mean = normalized_centroid([r.visual for r in structural])
        upper_mean = normalized_centroid([r.structural for r in structural])
        if visual_mean is not None and upper_mean is not None:
            upper = cosine(candidate.structural, upper_mean)
            visual = cosine(candidate.visual, visual_mean)
            return {"score": 0.70 * upper + 0.30 * visual,
                    "method": "structural_70_visual_30",
                    "upper_crop_score": upper, "visual_score": visual,
                    "color_score": None}
    # Color is inherently pairwise: do not manufacture a per-clip color score.
    usable = [(r, color_affinity(candidate.hsv, r.hsv)) for r in compatible]
    usable = [(r, c) for r, c in usable if c is not None]
    if not usable:
        return None
    visual_mean = normalized_centroid([r.visual for r, _ in usable])
    if visual_mean is None:
        return None
    visual = cosine(candidate.visual, visual_mean)
    # Reference color is an aggregate *histogram*, not a fabricated
    # per-clip pair score. Compute Bhattacharyya affinity to the aggregate.
    mean_hsv = tuple(math.fsum(r.hsv[i] for r, _ in usable) / len(usable)
                     for i in range(len(candidate.hsv)))
    color = color_affinity(candidate.hsv, mean_hsv)
    return {"score": 0.75 * visual + 0.25 * color,
            "method": "visual_75_color_25",
            "upper_crop_score": None, "visual_score": visual,
            "color_score": color}


def suggestion_confidence(score: float) -> float:
    """Display index, NOT a calibrated probability of the same identity."""
    return 100.0 / (1.0 + math.exp(-10.0 * (score - 0.42)))


def bound_decision(row: Mapping[str, Any], clip: ClipFeatures) -> bool:
    return (row.get("source") == clip.source
            and row.get("clip_id") == clip.clip_id
            and row.get("media_sha256") == clip.media_sha256
            and row.get("media_revision") == clip.media_revision
            and row.get("human_confirmed") is True
            and row.get("revoked") is not True
            and row.get("status") in ("approved", "rejected"))


def latest_decisions(rows: Sequence[Mapping[str, Any]]
                     ) -> dict[tuple[str, str], Mapping[str, Any]]:
    # Ordered persisted decisions only; last per (folder, qualified clip) wins.
    out = {}
    for row in rows:
        if row.get("folder_id") and row.get("source") and row.get("clip_id"):
            out[(str(row["folder_id"]), str(row["source"]) + ":" + str(row["clip_id"]))] = row
    return out


def agglomerate(unmatched: Sequence[ClipFeatures], threshold: float = CLUSTER_THRESHOLD
                ) -> list[dict[str, Any]]:
    """Complete-linkage agglomerative clusters, quadratic feature comparison.

    A cluster may merge only if *every* cross-member score passes threshold.
    The minimum pair score is incrementally cached, avoiding repeated vector
    comparisons and cubic-or-worse rescans of entire clusters.
    """
    import heapq
    if not -1 <= threshold <= 1:
        raise ValueError("Invalid clustering threshold")
    entries = sorted(unmatched, key=lambda r: r.key)
    if len(entries) > 400:
        raise ValueError("Too many unreviewed clips for bounded clustering")
    clusters = {i: [entry] for i, entry in enumerate(entries)}
    distances = {}
    candidates = []
    for i, a in enumerate(entries):
        for j in range(i + 1, len(entries)):
            pair = pair_score(a, entries[j])
            if pair is None:
                continue
            score = pair["score"]
            distances[(i, j)] = score
            if score >= threshold:
                heapq.heappush(candidates, (-score, i, j))
    next_id = len(entries)
    while candidates:
        negative, i, j = heapq.heappop(candidates)
        if i not in clusters or j not in clusters:
            continue  # stale priority queue entry after an earlier merge
        merged = sorted(clusters.pop(i) + clusters.pop(j), key=lambda r: r.key)
        k = next_id
        next_id += 1
        for other in list(clusters):
            first = distances.get(tuple(sorted((i, other))))
            second = distances.get(tuple(sorted((j, other))))
            if first is None or second is None:
                continue
            score = min(first, second)
            distances[tuple(sorted((k, other))] = score
            if score >= threshold:
                lo, hi = sorted((k, other))
                heapq.heappush(candidates, (-score, lo, hi))
        clusters[k] = merged
    groups = []
    for cluster in clusters.values():
        keys = [c.key for c in cluster]
        digest = hashlib.sha256("\n".join(keys).encode("utf-8")).hexdigest()[:16]
        groups.append({"id": "awaiting-review-" + digest,
                       "label": "Awaiting Review", "state": "pending_review",
                       "source_qualified_clips": keys,
                       "member_count": len(keys), "human_review_required": True,
                       "automatically_assigned": False})
    return sorted(groups, key=lambda row: (-row["member_count"], row["id"]))

def rank_folders(clips: Sequence[Mapping[str, Any]],
                 folders: Sequence[Mapping[str, Any]],
                 decisions: Sequence[Mapping[str, Any]],
                 *, match_threshold: float = MATCH_THRESHOLD,
                 cluster_threshold: float = CLUSTER_THRESHOLD) -> dict[str, Any]:
    if not -1 <= match_threshold <= 1:
        raise ValueError("Invalid folder match threshold")
    if len(clips) > 2000 or len(folders) > 250:
        raise ValueError("Bounded ranking budget exceeded")
    indexed = {}
    for obj in clips:
        feature = ClipFeatures.from_dict(obj)
        if feature.key in indexed:
            raise ValueError("Duplicate source-qualified recording")
        indexed[feature.key] = feature
    folder_ids = [str(f.get("id") or "") for f in folders]
    if any(not f for f in folder_ids) or len(set(folder_ids)) != len(folder_ids):
        raise ValueError("Invalid or duplicate folder identifiers")
    review = latest_decisions(decisions)
    refs: dict[str, list[ClipFeatures]] = {folder: [] for folder in folder_ids}
    rejected: dict[str, list[ClipFeatures]] = {folder: [] for folder in folder_ids}
    globally_approved = set()
    reviewed_keys = set()
    legacy_or_unbound = 0
    for (folder, key), row in review.items():
        clip = indexed.get(key)
        if folder not in refs or clip is None:
            continue
        if not bound_decision(row, clip):
            legacy_or_unbound += 1
            continue
        reviewed_keys.add(key)
        if row["status"] == "approved":
            refs[folder].append(clip)
            globally_approved.add(key)
        else:
            rejected[folder].append(clip)
    matches = []
    unmatched = []
    for clip in sorted(indexed.values(), key=lambda r: r.key):
        if clip.key in globally_approved:
            continue
        top = -math.inf
        for folder in folder_ids:
            current_decision = review.get((folder, clip.key))
            # Exact rejected clips go into that folder's exclusion list.
            if (current_decision and bound_decision(current_decision, clip)
                    and current_decision["status"] == "rejected"):
                continue
            possible = [(r, pair_score(clip, r)) for r in refs[folder]]
            possible = [(r, p) for r, p in possible if p is not None]
            centroid = centroid_score(clip, refs[folder])
            if centroid is None or not possible:
                continue
            closest, exemplar = max(possible, key=lambda it: (it[1]["score"], it[0].key))
            raw = 0.40 * centroid["score"] + 0.60 * exemplar["score"]
            negatives = [pair_score(clip, r) for r in rejected[folder]]
            neg_max = max((n["score"] for n in negatives if n is not None),
                          default=-math.inf)
            penalty = NEGATIVE_PENALTY if neg_max > NEGATIVE_THRESHOLD else 0.0
            score = raw - penalty
            top = max(top, score)
            if score < match_threshold:
                continue  # below-threshold recordings belong only to Awaiting Review
            matches.append({
                "folder_id": folder, "source": clip.source, "clip_id": clip.clip_id,
                "source_qualified_clip_id": clip.key, "media_sha256": clip.media_sha256,
                "media_revision": clip.media_revision,
                "state": "pending_review", "human_review_required": True,
                "verified_same_person": False, "automatically_assigned": False,
                "score": round(score, 8), "unpenalized_score": round(raw, 8),
                "centroid_score": round(centroid["score"], 8),
                "exemplar_score": round(exemplar["score"], 8),
                "closest_approved_clip": closest.key,
                "negative_penalty": penalty,
                "rejected_exemplar_score": (round(neg_max, 8)
                                            if math.isfinite(neg_max) else None),
                "method": exemplar["method"],
                "upper_crop_score": exemplar["upper_crop_score"],
                "visual_score": exemplar["visual_score"],
                "color_score": exemplar["color_score"],
                "suggestion_confidence": round(suggestion_confidence(score), 2),
                "meets_threshold": score >= match_threshold,
                "confidence_is_identity_probability": False})
        # Only unassigned records that are BELOW threshold in every folder
        # form new tentative groups. Existing positive human reviews never do.
        if top < match_threshold and clip.key not in reviewed_keys:
            unmatched.append(clip)
    matches.sort(key=lambda m: (-m["score"], m["folder_id"],
                                m["source_qualified_clip_id"]))
    return {"schema": SCHEMA, "status": "human_review_only", "match_threshold": match_threshold,
            "cluster_threshold": cluster_threshold, "matches": matches,
            "provisional_clusters": agglomerate(unmatched, cluster_threshold),
            "approved_reference_counts": {key: len(refs[key]) for key in folder_ids},
            "excluded_unbound_or_legacy_decisions": legacy_or_unbound,
            "automatic_assignments": 0, "identity_probabilities": False}


class ReviewJournal:
    """Versioned folder-specific feedback, independent of global skip/reject.

    The caller MUST first verify the original recording actually opened for
    review and persist its authoritative folder assignment on approval.
    The journal never pretends to have performed either action itself.
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"schema": "folder_suggestion_reviews_v1", "revision": 0, "decisions": []}
        if self.path.is_symlink():
            raise ValueError("Unsafe review journal path")
        doc = json.loads(self.path.read_text(encoding="utf-8"))
        if (doc.get("schema") != "folder_suggestion_reviews_v1"
                or not isinstance(doc.get("revision"), int)
                or not isinstance(doc.get("decisions"), list)):
            raise ValueError("Invalid review journal")
        return doc

    def record(self, *, clip: ClipFeatures, folder_id: str, action: str,
               expected_revision: int, opened_sha256: str, opened_revision: str,
               authoritative_persisted: bool, human_confirmed: bool) -> dict[str, Any]:
        # Readers see atomic snapshots; writers acquire an interprocess lock.
        # The caller's successful authoritative review transaction is required.
        import fcntl
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        lock_path = self.path.with_name(self.path.name + ".lock")
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(lock_fd, "a+") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                return self._record_locked(
                    clip=clip, folder_id=folder_id, action=action,
                    expected_revision=expected_revision,
                    opened_sha256=opened_sha256, opened_revision=opened_revision,
                    authoritative_persisted=authoritative_persisted,
                    human_confirmed=human_confirmed)
        finally:
            # fdopen() closes the descriptor. Keep lockfile for reuse.
            pass

    def _record_locked(self, *, clip: ClipFeatures, folder_id: str, action: str,
                       expected_revision: int, opened_sha256: str,
                       opened_revision: str, authoritative_persisted: bool,
                       human_confirmed: bool) -> dict[str, Any]:
        if (action not in ("approve", "reject") or not folder_id
                or not human_confirmed or not authoritative_persisted
                or opened_sha256 != clip.media_sha256
                or opened_revision != clip.media_revision):
            raise ValueError("Human opened-media proof and persisted action required")
        # Caller serializes writes (e.g. server's own mutex) around read+record.
        doc = self.read()
        if expected_revision != doc["revision"]:
            raise ValueError("Review revision changed; refresh")
        row = {"folder_id": folder_id, "source": clip.source, "clip_id": clip.clip_id,
               "media_sha256": clip.media_sha256,
               "media_revision": clip.media_revision, "human_confirmed": True,
               "status": "approved" if action == "approve" else "rejected"}
        doc["revision"] += 1
        doc["decisions"].append(row)
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(prefix=".folder-review-", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(doc, f, sort_keys=True, separators=(",", ":"))
                f.flush()
                os.fsync(f.fileno())
            os.chmod(temp, 0o600)
            os.replace(temp, self.path)
            parent_fd = os.open(self.path.parent, os.O_RDONLY)
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
        return {"persisted": True, "revision": doc["revision"], "decision": row}
