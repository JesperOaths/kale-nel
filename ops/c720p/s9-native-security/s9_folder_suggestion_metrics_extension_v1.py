"""Read-only baseline reporting on the existing authenticated folder suggestions API.

Preserves the original provider, ranking and HMAC opened-original requirement.
The supplementary A-Z validation never blocks/proposes/mutates decisions.
"""
from __future__ import annotations
import folder_suggestion_api as api
import s9_folder_suggestion_bridge_v1 as original
from folder_suggestion_baseline_v1 import gold_references, validate_gold

_ORIGINAL_SNAPSHOT = api.snapshot

class MetricsBridge(original.Bridge):
    def provider(self):
        data = super().provider()
        manual, _, _, _ = self.review_state()
        data["gold_decisions"] = gold_references(manual, data["clips"], data["folders"])
        return data

def _read_only_snapshot(provider, journal):
    data = provider()
    ranked = _ORIGINAL_SNAPSHOT(lambda: data, journal)
    try:
        metrics = validate_gold(
            data["clips"], data.get("gold_decisions", []),
            threshold=float(data.get("embedding_similarity_threshold", 0.68))
        )
    except (KeyError, ValueError, TypeError, OverflowError):
        metrics = {
            "ready": False, "ground_truth_clips": 0, "ground_truth_folders": 0,
            "held_out": 0, "correct": 0, "accuracy": None,
            "reason": "baseline_metrics_unavailable"
        }
    ranked["baseline"] = metrics
    # Do not filter matches or suppress provisional groups.
    return ranked

def install(handler, bridge=None):
    bridge = bridge or MetricsBridge()
    api.snapshot = _read_only_snapshot
    return original.install(handler, bridge=bridge)
