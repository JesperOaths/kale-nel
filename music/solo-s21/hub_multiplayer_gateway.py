#!/usr/bin/env python3
"""Bounded, narrow reverse gateway from public HTTPS to S21 multiplayer.

Run only on the C720P loopback. A separate outbound-only Cloudflare or
Tailscale tunnel terminates TLS. Never proxy arbitrary paths, headers,
private Termux files, ADB, Solo, or the camera.
"""
import ipaddress
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

UPSTREAM = os.environ.get("TUNERUSH_S21_MULTIPLAYER_UPSTREAM",
                          "http://192.168.178.196:8798").rstrip("/")
HOST, PORT = "127.0.0.1", int(os.environ.get("TUNERUSH_REMOTE_GATEWAY_PORT", "8806"))
MAX_REQUEST = 4096
MAX_AUDIO_REPLY = 1_950_000
MAX_STATIC_REPLY = 256_000
ROUTES = {"/": "text/html; charset=utf-8",
          "/index.html": "text/html; charset=utf-8",
          "/app.js": "application/javascript; charset=utf-8",
          "/style.css": "text/css; charset=utf-8",
          "/api/health": "application/json; charset=utf-8"}
CODE = re.compile(r"[A-HJ-NP-Z2-9]{6}\Z")
TOKEN = re.compile(r"[a-f0-9]{64}\Z")
TUNNEL_HOST = re.compile(r"[a-z0-9-]+\.trycloudflare\.com\Z")
ALLOWED_ACTIONS = frozenset((
    "create", "join", "state", "settings", "start", "play", "buzz", "answer",
    "forfeit", "steal", "skip", "next", "finish", "expire"))
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
SLOTS = threading.BoundedSemaphore(8)
LOCK = threading.Lock()
REQUESTS = defaultdict(deque)
CREATES = defaultdict(deque)


def remote_host_allowed(host):
    return bool(TUNNEL_HOST.fullmatch(host) or host == "jesper-hub.tail87c632.ts.net")


def valid_ip(value):
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return "unknown"


def rate_limit(ip, action):
    # A per-IP public limit plus a global create cap prevents easy room spam.
    now = time.monotonic()
    with LOCK:
        for key, queue, seconds, limit in (
            (ip, REQUESTS[ip], 60, 160),
            ((ip, "create"), CREATES[(ip, "create")], 300, 10),
            (("global", "create"), CREATES[("global", "create")], 60, 20),
        ):
            if action != "create" and queue is not REQUESTS[ip]:
                continue
            while queue and queue[0] < now - seconds:
                queue.popleft()
            if len(queue) >= limit:
                return False
        REQUESTS[ip].append(now)
        if action == "create":
            CREATES[(ip, "create")].append(now)
            CREATES[("global", "create")].append(now)
    return True


class Handler(BaseHTTPRequestHandler):
    server_version = "TuneRushInternetBridge/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass  # Never log game capabilities or query-string room codes.

    def reply(self, status, body, content_type="application/json; charset=utf-8"):
        if isinstance(body, dict):
            body = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        if content_type.startswith("text/html"):
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self' 'unsafe-inline'; "
                "style-src 'self' 'unsafe-inline'; connect-src 'self'; "
                "media-src 'self' data:; img-src 'self' data:; "
                "frame-src 'self'; frame-ancestors 'self'; "
                "object-src 'none'; base-uri 'self'; form-action 'self'")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (ConnectionResetError, BrokenPipeError):
            pass

    def allowed_host(self):
        host = self.headers.get("Host", "").lower().split(":")[0]
        if remote_host_allowed(host):
            return True
        return self.client_address[0] == "127.0.0.1" and host in ("127.0.0.1", "localhost")

    def allowed_origin(self):
        # Same-origin JSON POST only; browser cannot embed/share privileged
        # gameplay APIs cross-site. Host credentials never leave the origin.
        host = self.headers.get("Host", "").lower()
        origin = self.headers.get("Origin", "")
        if not origin:
            return self.client_address[0] == "127.0.0.1" and host.split(":")[0] in (
                "127.0.0.1", "localhost")
        if remote_host_allowed(host.split(":")[0]):
            return origin == "https://" + host
        return origin == "http://" + host and host.split(":")[0] in ("localhost", "127.0.0.1")

    def do_OPTIONS(self):
        self.reply(403, {"error": "cross_origin_forbidden"})

    def do_HEAD(self):
        self.reply(405, {"error": "method_not_allowed"})

    def do_GET(self):
        parts = urlsplit(self.path)
        if not self.allowed_host() or parts.path not in ROUTES:
            return self.reply(404, {"error": "not_found"})
        if len(self.path) > 600:
            return self.reply(414, {"error": "request_uri_too_long"})
        if parts.path not in ("/", "/index.html") and parts.query:
            return self.reply(404, {"error": "not_found"})
        return self.forward(parts.path, None)

    def do_POST(self):
        parts = urlsplit(self.path)
        if not self.allowed_host() or parts.path != "/api/multiplayer" or parts.query:
            return self.reply(404, {"error": "not_found"})
        if not self.allowed_origin():
            return self.reply(403, {"error": "origin_forbidden"})
        try:
            if self.headers.get("Transfer-Encoding"):
                raise ValueError()
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_REQUEST:
                raise ValueError()
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict) or set(request) != {"action", "code", "hash", "data"}:
                raise ValueError()
            action = request["action"]
            if (action not in ALLOWED_ACTIONS or
                not isinstance(request["code"], str) or
                not CODE.fullmatch(request["code"]) or
                not isinstance(request["hash"], str) or
                not TOKEN.fullmatch(request["hash"]) or
                not isinstance(request["data"], dict)):
                raise ValueError()
        except (ValueError, OSError, TimeoutError, TypeError):
            return self.reply(400, {"error": "invalid_game_request"})
        ip = valid_ip(self.headers.get("Cf-Connecting-Ip", self.client_address[0]))
        if not rate_limit(ip, action):
            return self.reply(429, {"error": "rate_limited"})
        return self.forward("/api/multiplayer",
                            json.dumps(request, separators=(",", ":")).encode())

    def forward(self, path, body):
        if not SLOTS.acquire(blocking=False):
            return self.reply(503, {"error": "server_busy"})
        try:
            headers = {"Accept": "application/json" if path.startswith("/api/") else "*/*"}
            if body is not None:
                headers["Content-Type"] = "application/json"
            method = "POST" if body is not None else "GET"
            request = urllib.request.Request(UPSTREAM + path, data=body,
                                             headers=headers, method=method)
            try:
                response = OPENER.open(request, timeout=15)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                limit = MAX_AUDIO_REPLY if path == "/api/multiplayer" else MAX_STATIC_REPLY
                raw = response.read(limit + 1)
                if len(raw) > limit:
                    return self.reply(502, {"error": "upstream_reply_too_large"})
                if path.startswith("/api/"):
                    try:
                        obj = json.loads(raw)
                        if not isinstance(obj, dict):
                            raise ValueError()
                        if path == "/api/multiplayer":
                            state = obj.get("state")
                            if isinstance(state, dict) and state.get("role") != "host":
                                # Fail closed against accidental future S21 audio leaks.
                                if "clipAudio" in state or "clipAudio" in obj:
                                    raise ValueError("guest_audio_leak")
                    except (ValueError, UnicodeDecodeError):
                        return self.reply(502, {"error": "invalid_upstream_response"})
                    return self.reply(response.code, obj)
                return self.reply(response.code, raw, ROUTES[path])
        except (TimeoutError, OSError, ValueError):
            return self.reply(502, {"error": "s21_unavailable"})
        finally:
            SLOTS.release()


def main():
    u = urlsplit(UPSTREAM)
    if (u.scheme != "http" or u.hostname != "192.168.178.196" or
        u.port != 8798 or u.username or u.password or u.path or u.query or u.fragment):
        raise SystemExit("Refusing unexpected S21 upstream")
    if PORT not in (8806, 8807):
        raise SystemExit("Refusing unexpected local bind port")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
