#!/usr/bin/env python3
"""Narrow HTTPS transport to the S21. Game state and audio processing stay on phone.

Run behind a TLS reverse proxy on the owner's hub. No file, library, shell,
provider or administrator endpoints are forwarded. Only bounded game JSON.
"""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

UPSTREAM = os.environ.get("TUNERUSH_S21_UPSTREAM", "http://192.168.178.196:8797").rstrip("/")
MAX_RESPONSE = 2 * 1024 * 1024
ORIGINS = frozenset(("https://kalenel.nl", "https://www.kalenel.nl"))
TOKEN = re.compile(r"Bearer [0-9a-f]{64}\Z")
ROUTES = {("GET", "/api/health"), ("GET", "/api/state"),
          ("POST", "/api/session"), ("POST", "/api/action")}
SLOTS = threading.BoundedSemaphore(4)
STARTS = deque()
START_LOCK = threading.Lock()
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Handler(BaseHTTPRequestHandler):
    server_version = "TuneRushTransport/1.0"

    def log_message(self, *args):
        pass  # Never log session capabilities, guesses, clues or private paths.

    def reply(self, status, body):
        raw = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Vary", "Origin")
        origin = self.headers.get("Origin", "")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_OPTIONS(self):
        path = urlsplit(self.path).path
        method = self.headers.get("Access-Control-Request-Method", "")
        if self.headers.get("Origin") not in ORIGINS:
            return self.reply(403, {"error": "Origin is not allowed."})
        if (method, path) not in ROUTES:
            return self.reply(404, {"error": "Not found."})
        self.reply(200, {"ok": True})

    def do_GET(self):
        self.forward()

    def do_POST(self):
        self.forward()

    def forward(self):
        self.connection.settimeout(10)
        parts = urlsplit(self.path)
        path = parts.path
        if parts.query or (self.command, path) not in ROUTES:
            return self.reply(404, {"error": "Not found."})
        origin = self.headers.get("Origin", "")
        if origin and origin not in ORIGINS:
            return self.reply(403, {"error": "Origin is not allowed."})
        authorization = self.headers.get("Authorization", "")
        if path in ("/api/state", "/api/action") and not TOKEN.fullmatch(authorization):
            return self.reply(401, {"error": "Game session expired."})
        body = None
        if self.command == "POST":
            try:
                if self.headers.get("Transfer-Encoding"):
                    raise ValueError()
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096:
                    raise ValueError()
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError()
            except (ValueError, OSError, TimeoutError):
                return self.reply(400, {"error": "Invalid game request."})
            if path == "/api/session":
                # This route only starts games using the permanent S21 catalog.
                data["source"] = "persistent-library"
                with START_LOCK:
                    now = time.monotonic()
                    while STARTS and STARTS[0] < now - 60:
                        STARTS.popleft()
                    if len(STARTS) >= 12:
                        return self.reply(429, {"error": "Please wait before starting another game."})
                    STARTS.append(now)
            body = json.dumps(data, separators=(",", ":")).encode()
        if not SLOTS.acquire(blocking=False):
            return self.reply(503, {"error": "S21 is busy. Retry shortly."})
        try:
            headers = {"Accept": "application/json", "Content-Type": "application/json"}
            if authorization:
                headers["Authorization"] = authorization
            # Origin/Host and arbitrary browser headers never reach the LAN engine.
            request = urllib.request.Request(UPSTREAM + path, data=body,
                                             headers=headers, method=self.command)
            try:
                response = OPENER.open(request, timeout=12)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                raw = response.read(MAX_RESPONSE + 1)
                if len(raw) > MAX_RESPONSE:
                    raise ValueError()
                result = json.loads(raw)
                if not isinstance(result, dict):
                    raise ValueError()
                self.reply(response.code, result)
        except (OSError, ValueError, TimeoutError):
            self.reply(502, {"error": "The S21 game engine is not responding."})
        finally:
            SLOTS.release()


def main():
    parsed = urlsplit(UPSTREAM)
    if parsed.scheme != "http" or parsed.hostname not in ("192.168.178.196", "127.0.0.1") or parsed.port != 8797 or parsed.path:
        raise SystemExit("Unexpected S21 upstream address.")
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("TUNERUSH_BRIDGE_PORT", "8804"))), Handler).serve_forever()


if __name__ == "__main__":
    main()
