import json
from pathlib import Path
import tempfile
import unittest
import uuid

from hub_relay import Relay, Transport, validate_request


class FakeTransport:
    def __init__(self):
        self.config = {"worker_secret": "a" * 64}
        self.engine_calls = 0
        self.complete_calls = 0
        self.fail_completion = False
        self.phone_ready = True
        self.claims = 0
        self.jobs = []

    def ready(self):
        return self.phone_ready

    def engine(self, request):
        self.engine_calls += 1
        return {"ok": True, "body": {"state": {"phase": "playing"}}}

    def rpc(self, name, data):
        if name.endswith("claim_v1"):
            self.claims += 1
            jobs, self.jobs = self.jobs, []
            return {"jobs": jobs}
        self.complete_calls += 1
        if self.fail_completion:
            raise TimeoutError("publication connection failed")
        return {"ok": True}


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.transport = FakeTransport()
        self.path = Path(self.temp.name) / "journal.sqlite3"
        self.relay = Relay(self.transport, self.path)
        self.job = {"id": str(uuid.uuid4()), "request": {
            "command": "action", "token": "b" * 64,
            "data": {"op": "clue", "round": 1}}}

    def tearDown(self):
        self.relay.journal.close()
        self.temp.cleanup()

    def test_publication_retry_does_not_repeat_phone_action(self):
        self.transport.jobs = [self.job]
        self.transport.fail_completion = True
        with self.assertRaises(TimeoutError):
            self.relay.tick()
        self.transport.fail_completion = False
        self.relay.tick()
        self.assertEqual(self.transport.engine_calls, 1)
        self.assertEqual(self.transport.complete_calls, 2)

    def test_restart_does_not_repeat_ambiguous_action(self):
        self.relay.execute_once(self.job)
        second = Relay(self.transport, self.path)
        try:
            _, result = second.execute_once(self.job)
            self.assertFalse(result["ok"])
            self.assertEqual(self.transport.engine_calls, 1)
        finally:
            second.journal.close()

    def test_invalid_request_never_reaches_phone(self):
        for command in ("shell", "multiplayer", "http://elsewhere"):
            self.job["request"]["command"] = command
            _, result = self.relay.execute_once(self.job)
            self.assertFalse(result["ok"])
        self.assertEqual(self.transport.engine_calls, 0)

    def test_bad_credential_or_action_is_rejected(self):
        for token, op in (("not-a-token", "clue"), ("b" * 64, "delete")):
            with self.assertRaises(ValueError):
                validate_request({"command": "action", "token": token, "data": {"op": op}})

    def test_phone_offline_does_not_claim_or_advertise_ready(self):
        self.transport.phone_ready = False
        self.relay.tick()
        self.assertEqual(self.transport.claims, 0)

    def test_oversized_data_is_rejected(self):
        with self.assertRaises(ValueError):
            validate_request({"command": "session", "data": {"x": "x" * 5000}})

    def test_journal_contains_no_audio_or_credentials(self):
        self.relay.execute_once(self.job)
        raw = self.path.read_bytes()
        self.assertNotIn(b"b" * 64, raw)
        self.assertNotIn(b"clipAudio", raw)
        self.assertNotIn(b"playing", raw)

    def test_transport_retains_phone_owned_api_contract(self):
        transport = Transport({"upstream": "http://192.168.178.196:8797"})
        calls = []
        transport.json_request = lambda *args, **kwargs: calls.append((args, kwargs)) or {"state": {}}
        transport.engine(self.job["request"])
        self.assertEqual(calls[0][0][0], "http://192.168.178.196:8797/api/action")
        self.assertEqual(calls[0][0][1], {"op": "clue", "round": 1})
        self.assertEqual(calls[0][0][2]["Authorization"], "Bearer " + "b" * 64)


if __name__ == "__main__":
    unittest.main()
