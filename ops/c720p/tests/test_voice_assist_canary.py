#!/usr/bin/env python3
"""Offline tests: no C720P, Home Assistant, network, or device writes needed."""
import copy
import importlib.util
import json
import pathlib
import socket
import struct
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "voice-assist-canary-20261010.py"
spec = importlib.util.spec_from_file_location("voice_canary", SCRIPT)
canary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(canary)

SAMPLE = {
    "pipelines": [{
        "id": "test-123",
        "name": "Local", "language": "en", "conversation_language": "en",
        "conversation_engine": "unavailable_agent",
        "stt_engine": "stt.whisper", "stt_language": "en",
        "tts_engine": "tts.piper", "tts_language": "en", "tts_voice": "en",
        "wake_word_entity": "wake_word.hey_google", "wake_word_id": "hey_google",
        "prefer_local_intents": False,
    }],
    "preferred_pipeline": "test-123",
}

class FakeWS:
    def __init__(self, data):
        self.data = copy.deepcopy(data)
        self.calls = []
    def cmd(self, command_type, **kw):
        self.calls.append((command_type, copy.deepcopy(kw)))
        if command_type == "assist_pipeline/pipeline/update":
            self.data["pipelines"][0].update({
                k: v for k, v in kw.items() if k != "pipeline_id"
            })
            return {}
        if command_type == "assist_pipeline/pipeline/list":
            return self.data
        raise AssertionError(command_type)

class Tests(unittest.TestCase):
    def test_pipeline_selection(self):
        self.assertEqual(canary.choose_preferred(SAMPLE)["id"], "test-123")
        self.assertIsNone(canary.choose_preferred({"pipelines": [], "preferred_pipeline": "x"}))
        self.assertIsNone(canary.choose_preferred([]))

    def test_agent_ids(self):
        self.assertEqual(canary.agent_ids({"agents": [{"id":"homeassistant"}, {"agent_id":"assistant2"}]}),
                         {"homeassistant", "assistant2"})
        self.assertEqual(canary.agent_ids(None), set())

    def test_repair_strict_preconditions(self):
        no_agents = FakeWS(SAMPLE)
        self.assertEqual(canary.repair(no_agents, canary.choose_preferred(SAMPLE), set()),
                         "not_needed_or_not_proven")
        self.assertEqual(no_agents.calls, [])
        current = copy.deepcopy(SAMPLE)
        current["pipelines"][0]["conversation_engine"] = "homeassistant"
        already_ok = FakeWS(current)
        self.assertEqual(canary.repair(already_ok, current["pipelines"][0], {"homeassistant"}),
                         "not_needed_or_not_proven")
        self.assertEqual(already_ok.calls, [])

    def test_repair_preserves_every_other_setting(self):
        ws = FakeWS(SAMPLE)
        before = copy.deepcopy(SAMPLE["pipelines"][0])
        self.assertEqual(canary.repair(ws, before, {"homeassistant"}), "repaired_and_verified")
        after = ws.data["pipelines"][0]
        for key in before:
            if key != "conversation_engine":
                self.assertEqual(after[key], before[key])
        self.assertEqual(after["conversation_engine"], "homeassistant")
        self.assertEqual(ws.calls[0][1]["pipeline_id"], before["id"])
        self.assertEqual(set(ws.calls[0][1]), set(canary.REPAIR_FIELDS) | {"pipeline_id"})

    def test_no_mutation_if_fields_missing(self):
        p = copy.deepcopy(SAMPLE["pipelines"][0])
        p.pop("tts_engine")
        ws = FakeWS(SAMPLE)
        self.assertEqual(canary.repair(ws, p, {"homeassistant"}),
                         "unsupported_pipeline_fields_no_change")
        self.assertEqual(ws.calls, [])

    def test_client_masking(self):
        one, two = socket.socketpair()
        try:
            ws = canary.WS.__new__(canary.WS)
            ws.sock = one
            for payload in (b"hello", b"x" * 130):
                ws.send_frame(payload)
                h1, h2 = two.recv(2)
                self.assertEqual(h1, 0x81)
                length = h2 & 0x7f
                if length == 126:
                    length = struct.unpack("!H", self.read_exact(two, 2))[0]
                mask = self.read_exact(two, 4)
                masked = self.read_exact(two, length)
                self.assertEqual(bytes(b ^ mask[i % 4] for i,b in enumerate(masked)),payload)
                self.assertTrue(h2 & 0x80)
        finally:
            one.close()
            two.close()

    @staticmethod
    def read_exact(sock, size):
        out = b""
        while len(out) < size:
            out += sock.recv(size - len(out))
        return out

    def test_server_frame_parse(self):
        one,two = socket.socketpair()
        try:
            ws = canary.WS.__new__(canary.WS)
            ws.sock = one
            ws.file = one.makefile("rb")
            raw = json.dumps({"type":"auth_required"}).encode()
            two.sendall(bytes([0x81, len(raw)]) + raw)
            self.assertEqual(ws.recv()["type"], "auth_required")
            ws.file.close()
        finally:
            one.close()
            two.close()

    def test_event_timing_excludes_text(self):
        class FakeSock:
            def settimeout(self, val): pass
        class Events:
            seq = 0
            sock = FakeSock()
            sent = None
            def send(self, obj): self.sent = obj
            def recv(self):
                return next(self.items)
        ws = Events()
        ws.items = iter([
            {"id": 1, "type":"result", "success":True},
            {"id": 1, "type":"event","event":{"type":"intent-start","data":{}}},
            {"id": 1, "type":"event","event":{"type":"intent-end","data":{
                "intent_output":{"response":{"response_type":"query_answer",
                                             "speech":{"plain":{"speech":"private"}}}}}}},
            {"id": 1, "type":"event","event":{"type":"tts-end","data":{"token":"private"}}},
            {"id": 1, "type":"event","event":{"type":"run-end","data":{}}},
        ])
        result = canary.test_intent_tts(ws,"What time is it?",None)
        self.assertEqual(result["end_reason"],"finished")
        self.assertTrue(result["tts_generated"])
        self.assertEqual(result["intent_response_type"],"query_answer")
        self.assertNotIn("private",json.dumps(result))
        self.assertEqual(ws.sent["start_stage"],"intent")
        self.assertEqual(ws.sent["end_stage"],"tts")

if __name__ == "__main__":
    unittest.main()
