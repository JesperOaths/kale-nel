#!/usr/bin/env python3
"""Opt-in authenticated Security Hub adapter for folder_suggestion_engine.

This module DOES NOT mount itself or fetch media. The existing authenticated
relay may install it only once a trusted feature/decision provider, verified
manual action writer and media-open attestor are available. It exposes only
derived ranking cards, not raw embeddings or underlying camera files.
"""
from __future__ import annotations

import json
import re
import threading
from urllib.parse import urlsplit

from folder_suggestion_engine import (
    ClipFeatures, ReviewJournal, rank_folders, bound_decision,
)

GET_ROUTE = "/new/api/folder-suggestions"
POST_ROUTE = "/new/api/folder-suggestions/review"
INTENT = "human-folder-suggestions-v1"
ORIGINS = frozenset({
    "https://kalenel.nl", "https://www.kalenel.nl",
    "http://127.0.0.1", "http://localhost",
    "http://127.0.0.1:8123", "http://localhost:8123",
    "http://127.0.0.1:8795", "http://localhost:8795",
})
SOURCE = re.compile(r"^[a-z][a-z0-9_-]{0,23}$")
CLIP = re.compile(r"^[A-Za-z0-9._-]{1,200}$")
FOLDER = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
SHA = re.compile(r"^[a-f0-9]{64}$")
GUARD = threading.RLock()


def snapshot(provider, journal: ReviewJournal) -> dict:
    """Provider must source immutable, independently verified media+features."""
    data = provider()
    if (not isinstance(data, dict) or data.get("features_verified") is not True
            or not isinstance(data.get("clips"), list)
            or not isinstance(data.get("folders"), list)
            or not isinstance(data.get("revision"), str)
            or not data["revision"]):
        raise ValueError("No verified original/feature snapshot")
    state = journal.read()
    # Only decisions written by the media-bound journal become references.
    result = rank_folders(data["clips"], data["folders"], state["decisions"])
    result["journal_revision"] = state["revision"]
    result["feature_snapshot_revision"] = data.get("revision")
    result["verified_media_evidence"] = True
    result["raw_embeddings_exposed"] = False
    return result


def review(payload, provider, journal: ReviewJournal,
           opened_attestor, authoritative_commit) -> tuple[int, dict]:
    """Single review transaction, bounded and fail-closed.

    An opened-ticket verifier MUST bind the original actually shown to this
    reviewer to its source, bytes digest, revision, and reviewed-session.
    A bare client-provided digest is never proof of a media review.
    """
    if not isinstance(payload, dict):
        return 400, {"ok": False, "error": "invalid_fields"}
    keys = {"action", "source", "clip_id", "folder_id", "media_sha256",
            "media_revision", "journal_revision", "opened_ticket",
            "human_confirmed", "feature_snapshot_revision"}
    if set(payload) != keys:
        return 400, {"ok": False, "error": "invalid_fields"}
    action = payload["action"]
    source, name, folder = (payload["source"], payload["clip_id"], payload["folder_id"])
    if (action not in ("approve", "reject")
            or not all(isinstance(v, str) for v in (source, name, folder))
            or not SOURCE.fullmatch(source) or not CLIP.fullmatch(name)
            or not FOLDER.fullmatch(folder)
            or payload["human_confirmed"] is not True
            or type(payload["journal_revision"]) is not int
            or not isinstance(payload["media_sha256"], str)
            or not SHA.fullmatch(payload["media_sha256"])
            or not isinstance(payload["media_revision"], str)
            or not payload["media_revision"]
            or not isinstance(payload["feature_snapshot_revision"], str)
            or not payload["feature_snapshot_revision"]
            or not isinstance(payload["opened_ticket"], str)
            or not 10 <= len(payload["opened_ticket"]) <= 8192):
        return 400, {"ok": False, "error": "human_review_and_provenance_required"}
    with GUARD:
        try:
            data = provider()
            if data.get("features_verified") is not True:
                raise ValueError("Unverified features")
            if payload["feature_snapshot_revision"] != data.get("revision"):
                return 409, {"ok": False, "error": "feature_snapshot_changed"}
            clips = [ClipFeatures.from_dict(raw) for raw in data["clips"]]
            matched = next((c for c in clips if c.source == source and c.clip_id == name), None)
            folders = [str(f.get("id")) for f in data["folders"]]
            if (matched is None or folder not in folders or
                    matched.media_sha256 != payload["media_sha256"] or
                    matched.media_revision != payload["media_revision"]):
                return 409, {"ok": False, "error": "source_or_original_changed"}
            if journal.read()["revision"] != payload["journal_revision"]:
                return 409, {"ok": False, "error": "review_revision_changed"}
            ranking = rank_folders(data["clips"], data["folders"], journal.read()["decisions"])
            if not any(row["source"] == source and row["clip_id"] == name
                       and row["folder_id"] == folder and row["state"] == "pending_review"
                       for row in ranking["matches"]):
                return 409, {"ok": False, "error": "candidate_no_longer_pending"}
            attested = opened_attestor(payload["opened_ticket"], source, name,
                                        matched.media_sha256, matched.media_revision)
            if attested is not True:
                return 409, {"ok": False, "error": "opened_original_not_attested"}
            # A signed playback ticket may take time to attest. Revalidate
            # the provider AFTER it finishes, before any authoritative write.
            fresh = provider()
            if (fresh.get("features_verified") is not True or
                    fresh.get("revision") != data["revision"] or
                    not any(raw.get("source") == source and raw.get("clip_id") == name
                            and raw.get("media_sha256") == matched.media_sha256
                            and raw.get("media_revision") == matched.media_revision
                            for raw in fresh.get("clips", []))):
                return 409, {"ok": False, "error": "original_changed_during_review"}
            # Actual authoritative review commit is supplied by the caller.
            # Reject MUST be folder-specific: never translate it to global
            # Skip/Reject in the existing manual-link store.
            proof = authoritative_commit(action=action, source=source, clip_id=name,
                                         folder_id=folder, media_sha256=matched.media_sha256,
                                         media_revision=matched.media_revision)
            if not isinstance(proof, dict) or proof.get("persisted") is not True:
                return 503, {"ok": False, "error": "authoritative_review_not_persisted"}
            if (proof.get("source") != source or proof.get("clip_id") != name or
                    proof.get("folder_id") != folder or proof.get("status") !=
                    ("approved" if action == "approve" else "rejected") or
                    proof.get("media_verified") is not True):
                return 503, {"ok": False, "error": "authoritative_review_proof_mismatch"}
            record = journal.record(clip=matched, folder_id=folder, action=action,
                                    expected_revision=payload["journal_revision"],
                                    opened_sha256=matched.media_sha256,
                                    opened_revision=matched.media_revision,
                                    authoritative_persisted=True, human_confirmed=True)
            return 200, {"ok": True, "persisted": record["persisted"],
                         "status": record["decision"]["status"],
                         "revision": record["revision"], "media_verified": True,
                         "folder_id": folder, "source": source, "clip_id": name,
                         "original_retained": True, "human_review_required": True}
        except (OSError, ValueError, TypeError, KeyError, RuntimeError):
            return 503, {"ok": False, "error": "verified_folder_review_unavailable"}


def install(H, provider, journal: ReviewJournal,
            opened_attestor=None, authoritative_commit=None):
    """Opt-in only. Caller must provide genuine, independently verified hooks.

    Do NOT install on a publicly exposed/non-authenticated handler. There is no
    default or dummy attestor. No route is installed if hooks are absent.
    """
    if not all(callable(v) for v in (provider, opened_attestor, authoritative_commit)):
        raise ValueError("Missing signed media-review or authoritative persistence hook")
    existing_get, existing_post = H.go, H.do_POST

    def get(self):
        route = urlsplit(self.path)
        if route.path != GET_ROUTE or route.query:
            return existing_get(self)
        try:
            self.js(200, snapshot(provider, journal))
        except (ValueError, OSError, TypeError, KeyError, RuntimeError):
            self.js(503, {"ok": False, "error": "verified_folder_suggestions_unavailable"})

    def post(self):
        route = urlsplit(self.path)
        if route.path != POST_ROUTE:
            return existing_post(self)
        if (route.query or self.headers.get("X-S9-Folder-Suggestion-Intent") != INTENT):
            return self.js(403, {"ok": False, "error": "intent_required"})
        if "application/json" not in self.headers.get("Content-Type", "").lower():
            return self.js(415, {"ok": False, "error": "json_only"})
        origin = self.headers.get("Origin", "").strip()
        if origin and origin not in ORIGINS:
            return self.js(403, {"ok": False, "error": "origin_blocked"})
        if self.headers.get("Sec-Fetch-Site", "") not in ("", "same-origin", "none"):
            return self.js(403, {"ok": False, "error": "cross_site_blocked"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 30 <= size <= 10000:
                raise ValueError("Invalid request size")
            payload = json.loads(self.rfile.read(size))
        except (ValueError, TypeError, OSError):
            return self.js(400, {"ok": False, "error": "invalid_json"})
        status, result = review(payload, provider, journal,
                                opened_attestor, authoritative_commit)
        return self.js(status, result)

    H.go = get
    H.do_POST = post
