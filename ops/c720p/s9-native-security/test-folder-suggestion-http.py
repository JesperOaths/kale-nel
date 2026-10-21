#!/usr/bin/env python3
"""Real local HTTP acceptance for the opt-in folder suggestion review route.

Runs entirely in process with synthetic feature vectors and a loopback-only
HTTP server. No S9+ access, no Home Assistant changes, no video and no user
review state. Exercises actual GET/POST wrapper and fail-closed safeguards.
"""
from __future__ import annotations

import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
import folder_suggestion_engine as engine
import folder_suggestion_api as api


def feature(name: str, sha="a" * 64, revision="original-r1") -> dict:
    ones = [0.0] * engine.DIM
    ones[0] = 1.0
    return {
        "source": "sd", "clip_id": name, "media_sha256": sha,
        "media_revision": revision, "visual_model_id": "osnet-test",
        "structural_model_id": "structural-test",
        "visual_embedding": ones,
        "structural_crop_embedding": ones,
        "structural_aligned_verified": True,
    }


class ApiHttpAcceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.journal = engine.ReviewJournal(Path(self.temp.name) / "journal.json")
        ref = feature("reference.mp4")
        self.candidate = feature("candidate.mp4")
        self.data = {
            "features_verified": True, "revision": "verified-snapshot-1",
            "clips": [ref, self.candidate],
            "folders": [{"id": "p1"}, {"id": "p2"}],
        }
        approved = engine.ClipFeatures.from_dict(ref)
        for i, folder in enumerate(("p1", "p2")):
            self.journal.record(
                clip=approved, folder_id=folder, action="approve",
                expected_revision=i, opened_sha256=approved.media_sha256,
                opened_revision=approved.media_revision,
                authoritative_persisted=True, human_confirmed=True,
            )
        self.commits = []
        self.opens = []
        self.change_original_during_attestation = False
        self.bad_commit_receipt = False

        def provider():
            return self.data

        def opened_attestor(ticket, source, name, sha, revision):
            self.opens.append((source, name))
            if self.change_original_during_attestation:
                self.data["clips"][1] = feature("candidate.mp4", revision="replaced-r2")
            return (ticket == "opened-original-ticket-12345" and
                    source == "sd" and name == "candidate.mp4" and
                    sha == "a" * 64 and revision == "original-r1")

        def authoritative_commit(**args):
            self.commits.append(args)
            if self.bad_commit_receipt:
                return {"persisted": True, "media_verified": False}
            return {
                "persisted": True, "media_verified": True,
                "source": args["source"], "clip_id": args["clip_id"],
                "folder_id": args["folder_id"],
                "status": "approved" if args["action"] == "approve" else "rejected",
            }

        class Handler(BaseHTTPRequestHandler):
            def go(self):
                self.js(404, {"ok": False, "error": "unknown_route"})

            def do_GET(self):
                return self.go()

            def do_POST(self):
                self.js(404, {"ok": False, "error": "unknown_route"})

            def js(self, code, data):
                body = json.dumps(data, sort_keys=True).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        api.install(
            Handler, provider, self.journal,
            opened_attestor=opened_attestor,
            authoritative_commit=authoritative_commit,
        )
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.addCleanup(self.server.server_close)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(lambda: (self.server.shutdown(), self.worker.join(timeout=2)))
        self.root = "http://127.0.0.1:" + str(self.server.server_port)

    def request(self, path, body=None, *, headers=None, method=None):
        uri = self.root + path
        options = {
            "url": uri,
            "headers": headers or {},
        }
        if body is not None:
            options["data"] = json.dumps(body).encode("utf-8")
            options["headers"].setdefault("Content-Type", "application/json")
        if method:
            options["method"] = method
        try:
            with urlopen(Request(**options), timeout=3) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def body(self, action="approve", folder="p1"):
        return {
            "action": action, "source": "sd", "clip_id": "candidate.mp4",
            "folder_id": folder, "media_sha256": "a" * 64,
            "media_revision": "original-r1",
            "journal_revision": self.journal.read()["revision"],
            "feature_snapshot_revision": self.data["revision"],
            "opened_ticket": "opened-original-ticket-12345",
            "human_confirmed": True,
        }

    def post(self, body, *, headers=None):
        typical = {"X-S9-Folder-Suggestion-Intent": api.INTENT}
        if headers:
            typical.update(headers)
        return self.request(api.POST_ROUTE, body, headers=typical)

    def test_get_returns_review_only_metadata_not_embeddings(self):
        status, doc = self.request(api.GET_ROUTE)
        self.assertEqual(status, 200)
        self.assertEqual(doc["schema"], engine.SCHEMA)
        self.assertEqual(doc["journal_revision"], 2)
        self.assertEqual(len(doc["matches"]), 2)
        self.assertFalse(doc["raw_embeddings_exposed"])
        self.assertNotIn("visual_embedding", json.dumps(doc))
        self.assertTrue(all(row["state"] == "pending_review" for row in doc["matches"]))

    def test_successful_approve_commits_once_then_rejects_replay(self):
        body = self.body()
        code, result = self.post(body)
        self.assertEqual(code, 200)
        self.assertTrue(result["persisted"])
        self.assertEqual(result["status"], "approved")
        self.assertEqual(len(self.commits), 1)
        self.assertEqual(self.journal.read()["revision"], 3)
        # Never let an old render/revision click silently write twice.
        code, result = self.post(body)
        self.assertEqual(code, 409)
        self.assertEqual(len(self.commits), 1)
        self.assertEqual(self.request(api.GET_ROUTE)[1]["matches"], [])

    def test_reject_is_scoped_to_selected_folder(self):
        status, result = self.post(self.body("reject"))
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "rejected")
        ranked = self.request(api.GET_ROUTE)[1]["matches"]
        self.assertFalse(any(row["folder_id"] == "p1" for row in ranked))
        self.assertTrue(any(row["folder_id"] == "p2" for row in ranked))

    def test_cross_origin_intent_and_unknown_paths_fail_closed(self):
        self.assertEqual(self.request("/new/api/something-else")[0], 404)
        self.assertEqual(self.request(api.POST_ROUTE, self.body())[0], 403)
        self.assertEqual(self.post(self.body(), headers={"Origin": "https://attacker.invalid"})[0], 403)
        self.assertEqual(self.post(self.body(), headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(len(self.commits), 0)

    def test_snapshot_change_refuses_before_review_write(self):
        body = self.body()
        self.data["revision"] = "verified-snapshot-2"
        status, result = self.post(body)
        self.assertEqual(status, 409)
        self.assertEqual(len(self.commits), 0)

    def test_replacement_during_attestation_refuses_before_commit(self):
        self.change_original_during_attestation = True
        status, result = self.post(self.body())
        self.assertEqual(status, 409)
        self.assertEqual(len(self.commits), 0)
        self.assertEqual(self.journal.read()["revision"], 2)

    def test_missing_opened_proof_and_untrusted_authoritative_receipt(self):
        body = self.body()
        body["opened_ticket"] = "invalid-ticket"
        self.assertEqual(self.post(body)[0], 409)
        self.assertEqual(len(self.commits), 0)
        self.bad_commit_receipt = True
        self.assertEqual(self.post(self.body())[0], 503)
        self.assertEqual(self.journal.read()["revision"], 2)

    def test_unverified_feature_provider_blocks_ranking(self):
        self.data["features_verified"] = False
        self.assertEqual(self.request(api.GET_ROUTE)[0], 503)
        self.assertEqual(self.post(self.body())[0], 503)
        self.assertEqual(len(self.commits), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
