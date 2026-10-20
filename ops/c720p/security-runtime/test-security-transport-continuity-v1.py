"""Network-free auth, routing, input and strict telemetry contract regressions."""
import importlib.util
import http.client
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location("relay", ROOT / "s9_continuity_relay_v1.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
spec = importlib.util.spec_from_file_location("transform", ROOT / "patch-security-transport-continuity-v1.py")
p = importlib.util.module_from_spec(spec); spec.loader.exec_module(p)


class Handler:
    def __init__(self, path, authenticated=True, origin=True, body=b"", headers=None):
        self.path, self.authenticated, self.origin = path, authenticated, origin
        self.headers = headers or {}
        self.rfile, self.wfile = io.BytesIO(body), io.BytesIO()
        self.status = None; self.response_headers = {}; self.forward = None
    def authorized(self): return self.authenticated
    def origin_ok(self): return self.origin
    def empty(self, status): self.status = status
    def go(self, head=False): self.status = 404
    def do_POST(self): self.status = 404
    def archive(self, *args): self.forward = args
    def cors(self): pass
    def send_response(self, status): self.status = status
    def send_header(self, key, value): self.response_headers[key] = value
    def end_headers(self): pass


m.install(Handler)


class Tests(unittest.TestCase):
    def test_component_health_is_authenticated_read_only_local_metadata(self):
        payload = {"ok": True, "schema_version": "security_component_health_v1", "components": {}}
        with patch.object(m.component_health, "build", return_value=payload) as reader, \
                patch.object(m.urllib.request, "urlopen") as network:
            for head, auth, status in ((False, False, 401), (True, True, 405)):
                h = Handler(m.HEALTH, authenticated=auth)
                h.go(head); self.assertEqual(h.status, status)
            reader.assert_not_called()
            h = Handler(m.HEALTH + "?auth=consumed")
            h.go(); self.assertEqual(h.status, 200)
            self.assertEqual(json.loads(h.wfile.getvalue()), payload)
            self.assertEqual(h.response_headers["Cache-Control"], "private, no-store")
            reader.assert_called_once_with(); network.assert_not_called()
            post = Handler(m.HEALTH); post.do_POST(); self.assertEqual(post.status, 404)

    def test_component_health_rejects_queries_before_reading(self):
        for query in ("?file=secret", "?auth=a&auth=b", "?refresh=1", "?clip=motion_1792000000000.mp4"):
            with self.subTest(query=query), patch.object(m.component_health, "build") as reader:
                h = Handler(m.HEALTH + query); h.go()
                self.assertEqual(h.status, 400); reader.assert_not_called()

    def test_component_health_never_emits_oversize_or_nonfinite_payload(self):
        for payload in ({"value": "x" * 32768}, {"value": float('nan')}):
            with patch.object(m.component_health, "build", return_value=payload):
                h = Handler(m.HEALTH); h.go()
                self.assertEqual(h.status, 502); self.assertEqual(h.wfile.getvalue(), b"")

    def test_truncated_upstream_fails_before_sending_success(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, _): raise http.client.IncompleteRead(b"{", 20)
        h = Handler("/new/api/automatic-person")
        with patch.object(m.urllib.request, "urlopen", return_value=Response()):
            m.send_json(h, m.urllib.request.Request("http://127.0.0.1:8795/new/api/automatic-person"))
        self.assertEqual(h.status, 502)
        self.assertEqual(h.wfile.getvalue(), b"")

    def test_cancelled_client_never_sends_a_second_response(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, _): return b'{"ok":true}'
        class Closed:
            def write(self, _): raise BrokenPipeError()
        h = Handler("/new/api/automatic-person"); h.wfile = Closed()
        with patch.object(m.urllib.request, "urlopen", return_value=Response()), patch.object(h, "empty") as error:
            m.send_json(h, m.urllib.request.Request("http://127.0.0.1:8795/new/api/automatic-person"))
            error.assert_not_called()
        self.assertEqual(h.status, 200)
        self.assertTrue(h.close_connection)

    def test_auth_precedes_all_new_readers(self):
        for route in m.JSON_ROUTES:
            h = Handler(route + "?clip=motion_1792000000000.mp4", authenticated=False)
            with patch.object(m.urllib.request, "urlopen") as network:
                h.go(); self.assertEqual(h.status, 401); network.assert_not_called()

    def test_metadata_head_never_calls_backend(self):
        for route in m.JSON_ROUTES:
            h = Handler(route)
            with patch.object(m.urllib.request, "urlopen") as network:
                h.go(True); self.assertEqual(h.status, 405); network.assert_not_called()

    def test_v3_and_v1_keep_validated_reference_query(self):
        for route in ("/new/api/appearance-multivector", "/new/api/appearance-multivector-v3"):
            h = Handler(route + "?clip=motion_1792000000000.mp4&auth=discard")
            with patch.object(m, "send_json") as forward:
                h.go(); request = forward.call_args.args[1]
                self.assertEqual(request.full_url, "http://127.0.0.1:8795" + route + "?clip=motion_1792000000000.mp4")

    def test_invalid_duplicate_foreign_and_traversal_query_fail_without_backend(self):
        for raw in ("clip=../secret", "clip=motion_1792000000000.mp4&clip=motion_1792000000001.mp4", "url=http://example.org", "clip=motion_1792000000000.mp4&model=face"):
            h = Handler("/new/api/appearance-multivector-v3?" + raw)
            with patch.object(m, "send_json") as forward:
                h.go(); self.assertEqual(h.status, 400); forward.assert_not_called()

    def test_hsv_bounded_semantics_and_times(self):
        good = "clip=motion_1792000000000.mp4&category=upper_clothing&method=correlation&limit=5&from_ms=1&until_ms=2"
        self.assertEqual(m.query_for("/new/api/appearance-search", good), "?" + good)
        for suffix in ("&limit=51", "&category=face", "&from_ms=3&until_ms=2"):
            with self.assertRaises(ValueError):
                m.query_for("/new/api/appearance-search", "clip=motion_1792000000000.mp4&category=upper_clothing" + suffix)

    def test_recovery_exact_auxiliary_paths_only(self):
        path = "/new/saved/recovery/clip/motion_1792000000000.mp4.preroll.mp4"
        h = Handler(path + "?auth=discard"); h.go(True)
        self.assertEqual(h.forward, ("new", path[4:], True))
        for suffix in (".complete.partial.mp4", "/../../secret", ".jpg"):
            h = Handler("/new/saved/recovery/clip/motion_1792000000000.mp4" + suffix)
            h.go(); self.assertEqual(h.status, 404)

    def test_denial_requires_auth_origin_intent_and_exact_body(self):
        body = {"action": "deny", "id": "a" * 64, "revision": 0, "human_confirmed": True}
        raw = json.dumps(body).encode()
        headers = {"Content-Length": str(len(raw)), "Content-Type": "application/json", "X-S9-Automatic-Person-Intent": m.INTENT}
        for authenticated, origin, remove, expected in ((False, True, None, 401), (True, False, None, 403), (True, True, "X-S9-Automatic-Person-Intent", 403)):
            hs = dict(headers)
            if remove: hs.pop(remove)
            h = Handler(m.AUTO, authenticated, origin, raw, hs)
            with patch.object(m, "send_json") as forward:
                h.do_POST(); self.assertEqual(h.status, expected); forward.assert_not_called()
        h = Handler(m.AUTO, body=raw, headers=headers)
        with patch.object(m, "send_json") as forward:
            h.do_POST(); request = forward.call_args.args[1]
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(request.get_header("Origin"), "http://127.0.0.1")
            self.assertEqual(request.data, raw)
        for change in ({"action": "assign"}, {"human_confirmed": False}, {"revision": True}, {"extra": 1}):
            raw = json.dumps(body | change).encode(); hs = headers | {"Content-Length": str(len(raw))}
            h = Handler(m.AUTO, body=raw, headers=hs)
            with patch.object(m, "send_json") as forward:
                h.do_POST(); self.assertEqual(h.status, 400); forward.assert_not_called()

    def test_install_idempotent_and_existing_routes_preserved(self):
        previous = Handler.go; m.install(Handler); self.assertIs(Handler.go, previous)
        h = Handler("/new/api/saved"); h.go(); self.assertEqual(h.status, 404)

    def test_patch_relay_fails_closed_and_is_idempotent(self):
        source = "def authorized(self):pass\ndef origin_ok(self):pass\n" + p.HOOK + "\nx='X-S9-Verified-People-Intent,X-S9-Visual-Review-Intent'\n"
        changed = p.patch_relay(source)
        self.assertEqual(p.patch_relay(changed), changed)
        with self.assertRaises(ValueError): p.patch_relay(source.replace("def authorized(self)", "def not_authorized(self)"))

    def test_telemetry_exact_typed_values_no_invented_readiness(self):
        source = 'def from_phone(phone):\n    return {\n      "camera_mode":phone["mode"],"camera_temperature_c":phone.get("temperature_c"),\n    }\n'
        changed = p.patch_status(source); self.assertEqual(p.patch_status(changed), changed)
        scope = {"_sensor_value": lambda v, lo, hi: v if type(v) in (int, float) and lo <= v <= hi else None}
        exec(changed, scope)
        phone = {"mode": "watching", "native_4k_enabled": True, "continuous_4k_ready": False, "continuous_4k_buffered_ms": 0, "continuous_4k_dropped_output_frames": 4}
        self.assertIs(scope["from_phone"](phone)["continuous_4k_ready"], False)
        self.assertIs(scope["from_phone"](phone)["native_4k_enabled"], True)
        invalid = {"mode": "watching", "native_4k_enabled": 1, "continuous_4k_ready": "true", "continuous_4k_buffered_ms": -1}
        result = scope["from_phone"](invalid)
        self.assertIsNone(result["native_4k_enabled"]); self.assertIsNone(result["continuous_4k_ready"])
        self.assertIsNone(result["continuous_4k_buffered_ms"])


if __name__ == "__main__": unittest.main(verbosity=2)
