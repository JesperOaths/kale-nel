#!/usr/bin/env python3
"""C720P Assist WebSocket canary and tightly-scoped, reversible agent repair.

Python standard library only. No passwords or transcripts in output.
Default operations: read-only pipeline/agent discovery plus a *query-only*
intent->TTS test. --repair-unavailable-agent changes one preferred pipeline
ONLY when its agent is provably absent and HA built-in agent exists.
No microphone capture, service restart, security/camera actions, or disk deletion.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
import socket
import struct
import sys
import time
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8123
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
REPAIR_FIELDS = (
    "name", "language", "conversation_engine", "conversation_language",
    "stt_engine", "stt_language", "tts_engine", "tts_language",
    "tts_voice", "wake_word_entity", "wake_word_id", "prefer_local_intents",
)

class ProtocolError(Exception):
    pass

class WS:
    def __init__(self, token: str, timeout: float = 12):
        self.sock = socket.create_connection((HOST, PORT), timeout)
        self.sock.settimeout(timeout)
        self.file = self.sock.makefile("rb")
        key = base64.b64encode(os.urandom(16)).decode()
        headers = (
            f"GET /api/websocket HTTP/1.1\r\n"
            f"Host: {HOST}:{PORT}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(headers.encode("ascii"))
        status = self.file.readline(4096)
        if b"101" not in status:
            raise ProtocolError("websocket_upgrade_failed")
        response = {}
        while True:
            line = self.file.readline(4096)
            if line in (b"\r\n", b"\n", b""):
                break
            if b":" in line:
                k, v = line.split(b":", 1)
                response[k.strip().lower()] = v.strip()
        expected = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest())
        if response.get(b"sec-websocket-accept") != expected:
            raise ProtocolError("bad_websocket_accept")
        challenge = self.recv()
        if challenge.get("type") != "auth_required":
            raise ProtocolError("unexpected_auth_handshake")
        self.send({"type": "auth", "access_token": token})
        auth = self.recv()
        if auth.get("type") != "auth_ok":
            raise ProtocolError("home_assistant_auth_failed")
        self.seq = 0

    def close(self):
        try:
            self.sock.close()
        finally:
            self.file.close()

    def send_frame(self, payload: bytes, opcode: int = 1):
        size = len(payload)
        header = bytearray([0x80 | opcode])
        if size < 126:
            header.append(0x80 | size)
        elif size < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", size))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", size))
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + mask + masked)

    def send(self, data: dict):
        self.send_frame(json.dumps(data, separators=(",", ":")).encode())

    def _read_exact(self, n: int) -> bytes:
        data = self.file.read(n)
        if data is None or len(data) != n:
            raise ProtocolError("websocket_connection_closed")
        return data

    def recv(self) -> dict:
        chunks = []
        while True:
            h1, h2 = self._read_exact(2)
            opcode = h1 & 0x0F
            n = h2 & 0x7F
            if n == 126:
                n = struct.unpack("!H", self._read_exact(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._read_exact(8))[0]
            if n > 1_000_000:
                raise ProtocolError("websocket_message_too_large")
            mask = self._read_exact(4) if (h2 & 0x80) else None
            payload = self._read_exact(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 8:
                raise ProtocolError("websocket_closed")
            if opcode == 9:
                self.send_frame(payload, opcode=10)
                continue
            if opcode in (0, 1):
                chunks.append(payload)
                if (h1 & 0x80):
                    try:
                        return json.loads(b"".join(chunks))
                    except (ValueError, UnicodeDecodeError) as e:
                        raise ProtocolError("invalid_websocket_json") from e
            elif opcode == 10:
                continue
            else:
                raise ProtocolError("unexpected_websocket_opcode")

    def cmd(self, typ: str, **kwargs):
        self.seq += 1
        req_id = self.seq
        self.send({"id": req_id, "type": typ, **kwargs})
        while True:
            event = self.recv()
            if event.get("id") != req_id:
                continue
            if event.get("type") == "result":
                if not event.get("success"):
                    err = event.get("error") or {}
                    raise ProtocolError("api_" + str(err.get("code", "failed")))
                return event.get("result")
            raise ProtocolError("unexpected_api_reply")

def choose_preferred(data):
    if not isinstance(data, dict):
        return None
    ids = data.get("pipelines") or []
    if not isinstance(ids, list):
        return None
    preferred_id = data.get("preferred_pipeline")
    return next((p for p in ids if isinstance(p, dict) and p.get("id") == preferred_id), None)

def agent_ids(data):
    if isinstance(data, dict):
        data = data.get("agents") or []
    if not isinstance(data, list):
        return set()
    return {str(i.get("id") or i.get("agent_id")) for i in data
            if isinstance(i, dict) and (i.get("id") or i.get("agent_id"))}

def classify_unavailable_agent(pipeline, agents):
    if not pipeline or not agents:
        return False
    return pipeline.get("conversation_engine") not in agents and "homeassistant" in agents

def sanitize_pipeline(data):
    preferred = choose_preferred(data)
    return {
        "pipeline_count": len(data.get("pipelines") or []) if isinstance(data, dict) else 0,
        "preferred_exists": bool(preferred),
        "preferred": {
            "language": preferred.get("language"),
            "conversation_language": preferred.get("conversation_language"),
            "stt_set": bool(preferred.get("stt_engine")),
            "tts_set": bool(preferred.get("tts_engine")),
            "wake_word_set": bool(preferred.get("wake_word_entity")),
            "conversation_engine": preferred.get("conversation_engine"),
        } if preferred else None,
    }

def repair(ws, original, agents):
    """One-field change via HA WebSocket; preserves all other original settings.
    Uses full update payload, verifies readback; attempts rollback on mismatch.
    """
    if not classify_unavailable_agent(original, agents):
        return "not_needed_or_not_proven"
    if any(k not in original for k in REPAIR_FIELDS if k != "prefer_local_intents"):
        return "unsupported_pipeline_fields_no_change"
    original_id = original.get("id")
    if not original_id:
        return "missing_pipeline_id"
    payload = {k: original[k] for k in REPAIR_FIELDS if k in original}
    payload["pipeline_id"] = original_id
    previous = payload["conversation_engine"]
    payload["conversation_engine"] = "homeassistant"
    ws.cmd("assist_pipeline/pipeline/update", **payload)
    readback = choose_preferred(ws.cmd("assist_pipeline/pipeline/list"))
    if readback and readback.get("id") == original_id and readback.get("conversation_engine") == "homeassistant":
        return "repaired_and_verified"
    payload["conversation_engine"] = previous
    try:
        ws.cmd("assist_pipeline/pipeline/update", **payload)
        return "verification_failed_rollback_submitted"
    except Exception:
        return "verification_failed_rollback_failed"

def test_intent_tts(ws, text: str, pipeline_id: str | None, timeout: float = 45) -> dict:
    """Test query-only intent->TTS by default. No captured audio is involved."""
    ws.seq += 1
    rid = ws.seq
    message = {
        "id": rid, "type": "assist_pipeline/run",
        "start_stage": "intent", "end_stage": "tts",
        "input": {"text": text}, "timeout": timeout,
    }
    if pipeline_id:
        message["pipeline"] = pipeline_id
    start = time.monotonic()
    ws.send(message)
    seen, marks, errors = [], {}, []
    response_type = None
    end_reason = "incomplete"
    ws.sock.settimeout(timeout + 5)
    while time.monotonic() - start < timeout + 4:
        try:
            evt = ws.recv()
        except socket.timeout:
            end_reason = "timeout"
            break
        if evt.get("id") != rid:
            continue
        typ = evt.get("type")
        if typ == "result":
            if not evt.get("success"):
                error = evt.get("error") or {}
                errors.append(str(error.get("code") or "command_failed"))
                end_reason = "command_rejected"
                break
            continue
        if typ != "event":
            continue
        data = evt.get("event") or {}
        name = str(data.get("type") or "")
        stage = data.get("data") or {}
        seen.append(name)
        marks[name] = round(1000 * (time.monotonic() - start))
        if name == "intent-end":
            resp = stage.get("intent_output") or {}
            response_type = (resp.get("response") or {}).get("response_type")
        elif name == "error":
            errors.append(str(stage.get("code") or "pipeline_error"))
            end_reason = "pipeline_error"
        if name == "run-end":
            end_reason = "finished"
            break
    return {
        "end_reason": end_reason,
        "events": seen,
        "event_ms": marks,
        "error_codes": errors,
        "intent_response_type": response_type,
        "tts_generated": "tts-end" in seen,
        "transcript_saved": False,
    }

def load_token(path: str | None) -> str | None:
    if path:
        p = Path(path).expanduser()
        if p.stat().st_mode & 0o077:
            raise ProtocolError("token_file_permissions_too_open")
        return p.read_text(encoding="utf-8").strip()
    return os.environ.get("HA_TOKEN", "").strip() or None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token-file", help="existing local HA token file (must have mode 0600)")
    ap.add_argument("--repair-unavailable-agent", action="store_true")
    ap.add_argument("--skip-test", action="store_true")
    ap.add_argument("--query", default="What time is it?", help="query-only phrase; avoid state-changing text")
    ap.add_argument("--output", default=str(Path.home() / "c720p-voice-canary-latest.json"))
    args = ap.parse_args()
    out = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "has_auth": False, "running_on_hub": socket.gethostname(),
           "repair": "not_requested", "test": "not_run"}
    ws = None
    try:
        token = load_token(args.token_file)
        if not token:
            raise ProtocolError("missing_HA_TOKEN_or_token_file")
        ws = WS(token)
        out["has_auth"] = True
        pipelines = ws.cmd("assist_pipeline/pipeline/list")
        out["pipelines"] = sanitize_pipeline(pipelines)
        agents_response = ws.cmd("conversation/agent/list")
        agents = agent_ids(agents_response)
        out["agents"] = {"count": len(agents), "built_in_available": "homeassistant" in agents}
        original = choose_preferred(pipelines)
        out["preferred_agent_available"] = bool(original and original.get("conversation_engine") in agents)
        if args.repair_unavailable_agent:
            out["repair"] = repair(ws, original, agents)
        if not args.skip_test:
            # Refresh after repair; verify preferred pipeline again.
            current = choose_preferred(ws.cmd("assist_pipeline/pipeline/list"))
            out["test"] = test_intent_tts(ws, args.query, current.get("id") if current else None)
    except Exception as exc:
        out["error_type"] = (str(exc) if isinstance(exc, ProtocolError)
                             else type(exc).__name__)
    finally:
        if ws:
            ws.close()
    target = Path(args.output).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".tmp")
    fd = os.open(str(tmp), os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    os.replace(tmp, target)
    os.chmod(target, 0o600)
    print(json.dumps(out, indent=2))
    if "error_type" in out:
        return 2
    test = out["test"]
    if isinstance(test, dict) and (test.get("end_reason") != "finished" or not test.get("tts_generated")):
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
