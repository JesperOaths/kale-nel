#!/usr/bin/env python3
"""Read-only production admission gate for the human-review folder suggester.

Never touches original clips, review decisions, Camera2, Home Assistant or the
S9+ phone. It cannot by itself certify security; it prevents source-only work
from being described as a live, verified review workflow.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

BASE = Path("/home/jespern/c720p-home-hub")
WEB = Path("/opt/homeassistant/config/www/frontyard-security-new")
ROUTE = "http://127.0.0.1:8795/new/api/folder-suggestions"
MANUAL = BASE / "state/s9-manual-recording-links-v1.json"
FILES = {
    "engine_installed": BASE / "bin/folder_suggestion_engine.py",
    "adapter_installed": BASE / "bin/folder_suggestion_api.py",
    "cards_installed": WEB / "folder-suggestion-cards-v1.js",
    "media_digest_binder_installed": BASE / "bin/s9_manual_media_digest_binding_v1.py",
    "manual_writer": BASE / "bin/s9_manual_recording_links.py",
    "people_html": WEB / "security-people-v50.html",
    "people_js": WEB / "security-people-v320.js",
}

def collect() -> dict:
    """Emit booleans and counts ONLY: never include individual folder/clip IDs."""
    checks = {}
    for label, path in FILES.items():
        checks[label] = path.is_file() and not path.is_symlink()
    media_binding_count = 0
    historical_unbound = 0
    status = "unavailable"
    try:
        if MANUAL.is_symlink() or not MANUAL.is_file() or MANUAL.stat().st_size > 500_000:
            raise ValueError("invalid manual index")
        stored = json.loads(MANUAL.read_text(encoding="utf-8"))
        items = stored["items"]
        if not isinstance(items, dict):
            raise ValueError("invalid manual index items")
        for item in items.values():
            if (isinstance(item, dict) and
                isinstance(item.get("media_binding"), dict) and
                item["media_binding"].get("status") == "bound_at_decision" and
                item["media_binding"].get("verified_at_decision") is True):
                media_binding_count += 1
            else:
                historical_unbound += 1
        status = "inspected"
        checks["manual_registry_readable"] = True
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        checks["manual_registry_readable"] = False

    checks["bound_future_approvals_exist"] = media_binding_count > 0
    checks["live_people_page_references_ranker"] = False
    checks["live_original_open_attestor_wired"] = False
    checks["live_authenticated_rank_route"] = False
    checks["live_verified_feature_snapshot"] = False
    try:
        if checks["people_html"] and checks["people_js"]:
            html = FILES["people_html"].read_text(encoding="utf-8")
            js = FILES["people_js"].read_text(encoding="utf-8")
            checks["live_people_page_references_ranker"] = (
                "folder-suggestion-cards-v1.js" in html and
                "FolderSuggestionCards.connect" in js)
            checks["live_original_open_attestor_wired"] = (
                "S9SignedOriginalReview.openAndAttest" in js and
                "S9SignedOriginalReview" in html)
    except (OSError, UnicodeError):
        pass
    try:
        with urlopen(ROUTE, timeout=4) as response:
            if response.status == 200:
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise ValueError("unbounded response")
                doc = json.loads(raw)
                checks["live_authenticated_rank_route"] = (
                    doc.get("schema") == "folder_suggestions_v1" and
                    doc.get("human_review_required", True) is True and
                    doc.get("automatic_assignments") == 0 and
                    doc.get("identity_probabilities") is False and
                    isinstance(doc.get("matches"), list) and
                    isinstance(doc.get("provisional_clusters"), list))
                checks["live_verified_feature_snapshot"] = (
                    checks["live_authenticated_rank_route"] and
                    doc.get("verified_media_evidence") is True and
                    doc.get("raw_embeddings_exposed") is False and
                    isinstance(doc.get("feature_snapshot_revision"), str) and
                    bool(doc.get("feature_snapshot_revision")))
    except (HTTPError, URLError, ValueError, OSError, json.JSONDecodeError):
        pass
    required = [
        "engine_installed", "adapter_installed", "cards_installed",
        "media_digest_binder_installed", "manual_registry_readable",
        "bound_future_approvals_exist", "live_people_page_references_ranker",
        "live_original_open_attestor_wired", "live_authenticated_rank_route",
        "live_verified_feature_snapshot",
    ]
    return {
        "schema": "folder_suggestion_activation_gate_v1",
        "production_activated": all(checks[k] for k in required),
        "checks": checks,
        "manual_index_status": status,
        "forward_bound_decisions": media_binding_count,
        "historically_unbound_decisions": historical_unbound,
        "original_clips_read": 0,
        "original_clips_changed": 0,
        "camera_changed": False,
        "review_decisions_changed": False,
        "requires_authenticated_browser_acceptance": True,
        "note": "Passing file and route checks is necessary but not sufficient for authenticated playback acceptance.",
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="Exit 1 unless live prerequisites pass")
    args = parser.parse_args()
    doc = collect()
    print(json.dumps(doc, sort_keys=True, indent=2))
    if args.strict and not doc["production_activated"]:
        raise SystemExit(1)
