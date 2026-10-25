"""Fail-closed leave-one-out calibration from explicitly owner-filed People A-Z.

No appearance clustering, guessed identity labels, raw embeddings or phone reads.
Only cryptographically media-bound hand-approved folder assignments count.
"""
from collections import Counter, defaultdict
from folder_suggestion_engine import (ClipFeatures, pair_score, centroid_score,
                                      VECTOR_ONLY)

MIN_FOLDERS = 2
MIN_PER_FOLDER = 2
MIN_ACCURACY = 1.0
MIN_MARGIN = 0.05

def gold_references(manual, clips, folders):
    """Convert only verified People A-Z manual assignments into bound decisions."""
    indexed = {r["source"] + ":" + r["clip_id"]: r for r in clips}
    allowed = {f["id"] for f in folders if isinstance(f, dict) and isinstance(f.get("id"), str)}
    decisions = []
    for key, entry in sorted(manual.get("items", {}).items()):
        if not isinstance(entry, dict) or entry.get("review_status") != "assigned":
            continue
        binding = entry.get("media_binding")
        if not isinstance(binding, dict) or binding.get("verified_at_decision") is not True or binding.get("status") != "bound_at_decision":
            continue
        clip = indexed.get(key)
        if not clip or binding.get("sha256") != clip.get("media_sha256") or binding.get("media_revision") != clip.get("media_revision"):
            continue
        if key != clip["source"] + ":" + clip["clip_id"] or binding.get("source") != clip["source"] or binding.get("name") != clip["clip_id"]:
            continue
        selected = entry.get("folders") or ([entry["folder"]] if entry.get("folder") else [])
        # Ambiguous multi-folder identities must never seed a gold label.
        if not isinstance(selected, list) or len(set(selected)) != 1 or selected[0] not in allowed:
            continue
        decisions.append({
            "source": clip["source"], "clip_id": clip["clip_id"],
            "folder_id": selected[0], "media_sha256": clip["media_sha256"],
            "media_revision": clip["media_revision"],
            "status": "approved", "human_confirmed": True
        })
    return decisions

def validate_gold(clips, gold, *, threshold=0.68):
    """Leave-one-out verification against the OTHER verified references.

    A profile is not fit using its own held-out vector. Every reference needs
    to beat all other folder centroids and its threshold by a safe margin.
    If validation is incomplete or ambiguous, new proposals remain disabled.
    """
    mapping = {r["source"] + ":" + r["clip_id"]: ClipFeatures.from_dict(r) for r in clips}
    groups = defaultdict(list)
    for row in gold:
        clip = mapping.get(row["source"] + ":" + row["clip_id"])
        if clip and row.get("media_sha256") == clip.media_sha256 and row.get("media_revision") == clip.media_revision:
            groups[row["folder_id"]].append(clip)
    counts = {k: len(v) for k, v in groups.items()}
    report = {"ready": False, "mode": VECTOR_ONLY,
              "ground_truth_clips": sum(counts.values()), "ground_truth_folders": len(counts),
              "held_out": 0, "correct": 0, "accuracy": None,
              "threshold": threshold, "required_accuracy": MIN_ACCURACY,
              "reason": "insufficient_verified_people_az_references"}
    if len(groups) < MIN_FOLDERS or any(len(rows) < MIN_PER_FOLDER for rows in groups.values()):
        return report
    correct = 0
    total = 0
    for true_folder, references in sorted(groups.items()):
        for candidate in references:
            scores = {}
            for folder, rows in sorted(groups.items()):
                training = [r for r in rows if r.key != candidate.key]
                if not training: continue
                centroid = centroid_score(candidate, training, scoring_mode=VECTOR_ONLY)
                nearest = max((pair_score(candidate, r, scoring_mode=VECTOR_ONLY)["score"] for r in training), default=-1.0)
                if centroid is None: continue
                scores[folder] = 0.40 * centroid["score"] + 0.60 * nearest
            total += 1
            if not scores: continue
            nearest_folder = max(scores, key=lambda name: (scores[name], name))
            other = max((score for folder, score in scores.items() if folder != true_folder), default=-1.0)
            if (nearest_folder == true_folder and scores[true_folder] >= threshold and
                    scores[true_folder] - other >= MIN_MARGIN):
                correct += 1
    report.update(held_out=total, correct=correct, accuracy=correct/total if total else None)
    if total == sum(counts.values()) and correct == total and total >= 4:
        report.update(ready=True, reason="validated_people_az_leave_one_out")
    else:
        report["reason"] = "gold_standard_holdout_not_yet_accurate"
    return report

