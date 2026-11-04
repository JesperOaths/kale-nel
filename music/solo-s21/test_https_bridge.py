#!/usr/bin/env python3
"""Verify that the public transport cannot expose the private S21 library."""
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import https_bridge as bridge

SEEN = []


class Phone(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        SEEN.append((self.command, self.path, self.headers, None))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"ready":true}')

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append((self.command, self.path, self.headers, data))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"state":{"source":"persistent-library","clipAudio":"data:audio/mpeg;base64,/+MY"}}')


class BridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.phone = ThreadingHTTPServer(("127.0.0.1", 0), Phone)
        bridge.UPSTREAM = "http://127.0.0.1:" + str(cls.phone.server_port)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), bridge.Handler)
        cls.url = "http://127.0.0.1:" + str(cls.server.server_port)
        for server in (cls.phone, cls.server):
            threading.Thread(target=server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        for server in (cls.server, cls.phone):
            server.shutdown()
            server.server_close()

    def request(self, path, method="GET", data=None, headers=None):
        raw = None if data is None else json.dumps(data).encode()
        request = urllib.request.Request(self.url + path, data=raw, method=method, headers=headers or {})
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.code, response.headers, json.load(response)

    def test_private_and_administrator_routes_are_absent(self):
        for path in ("/", "/app.js", "/api/music-library/health", "/api/audio/secret", "/api/health?target=http://evil.example"):
            before = len(SEEN)
            self.assertEqual(self.request(path)[0], 404)
            self.assertEqual(len(SEEN), before)

    def test_cors_restricts_browser_origins(self):
        self.assertEqual(self.request("/api/health", headers={"Origin":"https://evil.example"})[0], 403)
        code, headers, _ = self.request("/api/health", headers={"Origin":"https://kalenel.nl"})
        self.assertEqual(code, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://kalenel.nl")
        code, _, _ = self.request("/api/action", "OPTIONS", headers={"Origin":"https://kalenel.nl", "Access-Control-Request-Method":"POST"})
        self.assertEqual(code, 200)

    def test_session_uses_cached_recordings_and_removes_origin(self):
        code, _, body = self.request("/api/session", "POST", {"source":"youtube", "limit":10}, {"Origin":"https://kalenel.nl"})
        self.assertEqual(code, 200)
        self.assertTrue(body["state"]["clipAudio"].startswith("data:audio/mpeg;base64,"))
        self.assertEqual(SEEN[-1][3]["source"], "persistent-library")
        self.assertIsNone(SEEN[-1][2].get("Origin"))

    def test_private_game_actions_require_capability(self):
        for method, path, data in (("GET", "/api/state", None), ("POST", "/api/action", {"op":"clip"})):
            self.assertEqual(self.request(path, method, data)[0], 401)
        token = "Bearer " + "a" * 64
        self.assertEqual(self.request("/api/action", "POST", {"op":"clip"}, {"Authorization":token})[0], 200)
        self.assertEqual(SEEN[-1][2].get("Authorization"), token)

    def test_rejects_oversized_body_before_forwarding(self):
        before = len(SEEN)
        self.assertEqual(self.request("/api/session", "POST", {"x":"a" * 5000})[0], 400)
        self.assertEqual(len(SEEN), before)


if __name__ == "__main__":
    unittest.main()
