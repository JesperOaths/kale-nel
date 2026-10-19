"""Bounded existing-owner Security features through the authenticated LAN relay.

Fixed localhost destinations only. This does not run inference, create proposals,
assign people, change camera settings, or add an unauthenticated media origin.
"""
import http.client
import json
import re
import urllib.error
import urllib.parse
import urllib.request

VERSION = "security_transport_continuity_v1"
CLIP = re.compile(r"motion_[0-9]{13}[.]mp4\Z")
RECOVERY = re.compile(r"/new/saved/recovery/clip/motion_[0-9]{13}[.]mp4[.](?:preroll|complete)[.]mp4\Z")
JSON_ROUTES = frozenset((
    "/new/api/appearance-multivector", "/new/api/appearance-multivector-v3",
    "/new/api/appearance-search", "/new/api/automatic-person",
    "/new/api/evidence-quality", "/new/api/s9-auxiliary-recovery",
))
AUTO = "/new/api/automatic-person"
INTENT = "human-automatic-person-denial-v1"
LIMIT = 2_000_000


def query_for(path, raw):
    """Validate every forwarded parameter; auth is consumed only by the relay."""
    if len(raw) > 1500:
        raise ValueError("query_too_long")
    q = urllib.parse.parse_qs(raw, keep_blank_values=True, strict_parsing=True,
                             max_num_fields=10)
    if any(len(v) != 1 for v in q.values()):
        raise ValueError("duplicate_query")
    q.pop("auth", None)
    q = {k: v[0] for k, v in q.items()}
    if path in ("/new/api/appearance-multivector", "/new/api/appearance-multivector-v3"):
        if set(q) != {"clip"} or not CLIP.fullmatch(q["clip"]):
            raise ValueError("one_valid_clip_required")
    elif path == "/new/api/appearance-search":
        if set(q) - {"clip", "category", "zone", "method", "from_ms", "until_ms", "limit"}:
            raise ValueError("unknown_parameter")
        if not CLIP.fullmatch(q.get("clip", "")):
            raise ValueError("invalid_clip")
        if q.get("category") not in ("upper_clothing", "lower_clothing", "vehicle"):
            raise ValueError("invalid_category")
        if q.get("zone", "unspecified") not in ("front_garden", "background_street", "unspecified"):
            raise ValueError("invalid_zone")
        if q.get("method", "bhattacharyya") not in ("bhattacharyya", "correlation"):
            raise ValueError("invalid_method")
        limit = q.get("limit", "20")
        if not re.fullmatch(r"[0-9]{1,2}", limit) or not 1 <= int(limit) <= 50:
            raise ValueError("invalid_limit")
        for k in ("from_ms", "until_ms"):
            if k in q and not re.fullmatch(r"[0-9]{1,15}", q[k]):
                raise ValueError("invalid_time")
        if "from_ms" in q and "until_ms" in q and int(q["from_ms"]) > int(q["until_ms"]):
            raise ValueError("inverted_time")
    elif q:
        raise ValueError("unexpected_query")
    return ("?" + urllib.parse.urlencode(q)) if q else ""


def send_json(handler, request):
    try:
        try:
            response = urllib.request.urlopen(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(LIMIT + 1)
            if len(raw) > LIMIT or not isinstance(json.loads(raw), dict):
                raise ValueError("invalid_upstream_json")
            status = response.status
    except (OSError, ValueError, TypeError, TimeoutError, http.client.HTTPException):
        return handler.empty(502)
    try:
        handler.send_response(status)
        handler.cors()
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Cache-Control", "private, no-store")
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.send_header("Content-Length", str(len(raw)))
        handler.end_headers()
        handler.wfile.write(raw)
    except OSError:
        # The status may already be sent. A client closing its tab must never
        # receive a second HTTP response or turn into an upstream failure.
        handler.close_connection = True


def install(H):
    if getattr(H, "_security_continuity_version", None) == VERSION:
        return
    if getattr(H, "_security_continuity_version", None) is not None:
        raise RuntimeError("different_continuity_relay_already_installed")
    previous_get, previous_post = H.go, H.do_POST

    def go(self, head=False):
        url = urllib.parse.urlsplit(self.path)
        path = url.path
        if path not in JSON_ROUTES and not RECOVERY.fullmatch(path):
            return previous_get(self, head)
        if not self.authorized():
            return self.empty(401)
        if RECOVERY.fullmatch(path):
            try:
                query_for(path, url.query)
            except ValueError:
                return self.empty(400)
            return self.archive("new", path[len("/new"):], head)
        if head:
            return self.empty(405)  # never execute a metadata reader for HEAD
        try:
            suffix = query_for(path, url.query)
        except ValueError:
            return self.empty(400)
        return send_json(self, urllib.request.Request("http://127.0.0.1:8795" + path + suffix))

    def post(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path != AUTO:
            return previous_post(self)
        if not self.authorized():
            return self.empty(401)
        if (not self.origin_ok() or self.headers.get("X-S9-Automatic-Person-Intent") != INTENT
                or self.headers.get("Sec-Fetch-Site", "") not in ("", "same-origin", "same-site", "none")):
            return self.empty(403)
        try:
            if query_for(AUTO, url.query):
                raise ValueError("unexpected_query")
            n = int(self.headers.get("Content-Length", "0"))
            if not 45 <= n <= 700 or "application/json" not in self.headers.get("Content-Type", "").lower():
                return self.empty(415)
            raw = self.rfile.read(n)
            body = json.loads(raw)
            if (not isinstance(body, dict) or set(body) != {"action", "id", "revision", "human_confirmed"}
                    or body.get("action") != "deny" or body.get("human_confirmed") is not True
                    or type(body.get("revision")) is not int
                    or not isinstance(body.get("id"), str)
                    or not re.fullmatch(r"[0-9a-f]{64}", body["id"])):
                return self.empty(400)
        except (ValueError, TypeError):
            return self.empty(400)
        # Caller origin was validated above; backend receives the existing trusted
        # localhost relay origin, matching the manual-review proxy contract.
        request = urllib.request.Request("http://127.0.0.1:8795" + AUTO, data=raw,
            headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1",
                     "X-S9-Automatic-Person-Intent": INTENT}, method="POST")
        return send_json(self, request)

    H.go, H.do_POST = go, post
    H._security_continuity_version = VERSION
