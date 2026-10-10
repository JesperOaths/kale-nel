#!/usr/bin/env python3
"""C720P voice-path diagnostic (read-only, privacy-preserving).

Checks the *configuration and health* of the stages involved in a spoken
Home Assistant command.  It does NOT claim to test an actual spoken command.
No services are restarted, no API commands are sent and no audio is recorded.
Writes a local, mode-0600 report. Raw logs / secrets are NEVER included.
"""
from __future__ import annotations
import json
import os
import re
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

HOME = Path.home()
CONFIG = Path("/opt/homeassistant/config")
OUT = HOME / "c720p-voice-diagnostic.json"
PORTS = [8123, 8790, 10200, 10300, 10400, 10701]
SERVICES = [
    "c720p-openwakeword-v53e.service",
    "c720p-wyoming-satellite.service",
    "c720p-voice-ui-watcher.service",
]
CATEGORIES = {
    "wake": r"wake.word|openwakeword|wake.word.detect|wake.?timeout",
    "capture": r"microphone|mic.?(?:error|failed)|audio.(?:device|input|capture)|alsa|pulse|pipewire",
    "satellite": r"satellite|wyoming|disconnect|connect.refused|broken.pipe",
    "stt": r"whisper|speech.to.text|transcrib|stt.",
    "intent": r"intent.not.supported|no.intent|conversation.process|conversation.agent|unknown.intent",
    "tts": r"piper|text.to.speech|synthesi|tts.",
    "timeout": r"time.?out|timed.out|deadline.exceeded",
    "error": r"\berror\b|\bexception\b|\bfailed\b|traceback",
}

def run(*args: str, timeout: int = 8) -> dict:
    try:
        p = subprocess.run(args, text=True, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, timeout=timeout, check=False)
        return {"ok": p.returncode == 0, "code": p.returncode,
                "text": (p.stdout or "") + (p.stderr or "")}
    except Exception as exc:
        return {"ok": False, "error_type": type(exc).__name__, "text": ""}

def connected(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False

def classify(text: str) -> dict:
    """Never preserve raw journal text, recognized speech or auth headers."""
    lines = text.splitlines()
    counts = Counter()
    for line in lines:
        for k, regex in CATEGORIES.items():
            if re.search(regex, line, flags=re.IGNORECASE):
                counts[k] += 1
    return {"lines_examined": len(lines),
            "pattern_counts": dict(counts),
            "note": "Counts indicate log mentions, not verified errors or latencies."}

def pipeline_config() -> dict:
    file = CONFIG / ".storage" / "assist_pipeline.pipelines"
    if not file.is_file():
        return {"found": False}
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
        payload = data.get("data") or {}
        items = payload.get("items") or []
        # Deliberately omit entity names, tokens, voice transcripts and full config.
        safe = []
        for p in items:
            if not isinstance(p, dict):
                continue
            safe.append({
                "id_suffix": str(p.get("id", ""))[-6:],
                "language": p.get("language"),
                "conversation_engine_set": bool(p.get("conversation_engine")),
                "stt_engine_set": bool(p.get("stt_engine")),
                "tts_engine_set": bool(p.get("tts_engine")),
                "wake_word_set": bool(p.get("wake_word_entity_id")),
                "stt_language": p.get("stt_language"),
                "tts_language": p.get("tts_language"),
            })
        return {"found": True, "pipeline_count": len(safe),
                "preferred_set": bool(payload.get("preferred_item")),
                "pipelines": safe}
    except (OSError, ValueError, TypeError) as exc:
        return {"found": True, "parse_error": type(exc).__name__}

def integrations() -> dict:
    file = CONFIG / ".storage" / "core.config_entries"
    if not file.is_file():
        return {"found": False}
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
        domains = ["wyoming", "whisper", "piper", "conversation", "assist_pipeline"]
        entries = (data.get("data") or {}).get("entries") or []
        counts = Counter(str(e.get("domain", "")) for e in entries
                         if isinstance(e, dict) and not e.get("disabled_by"))
        return {"found": True, "enabled_domains": {d: counts.get(d, 0) for d in domains}}
    except (OSError, ValueError, TypeError) as exc:
        return {"found": True, "parse_error": type(exc).__name__}

def wyoming_describe(port: int) -> dict:
    """Check Wyoming protocol response rather than merely an open TCP socket."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2) as conn:
            conn.settimeout(2)
            conn.sendall(b'{"type":"describe","data":{}}\\n')
            payload = bytearray()
            while len(payload) < 65536:
                chunk = conn.recv(1024)
                if not chunk:
                    break
                payload.extend(chunk)
                if b"\\n" in payload:
                    break
        first = bytes(payload).split(b"\\n", 1)[0]
        msg = json.loads(first)
        capabilities = msg.get("data") or {}
        return {
            "responded": msg.get("type") == "info",
            "response_type": msg.get("type"),
            "capabilities": sorted(k for k in ("asr", "tts", "wake", "mic", "snd", "handle")
                                   if k in capabilities),
        }
    except Exception as exc:
        return {"responded": False, "error_type": type(exc).__name__}

def host_audio() -> dict:
    result = {}
    for name, argv in [
        ("microphone_hardware", ["arecord", "-l"]),
        ("pulse_sources", ["pactl", "list", "short", "sources"]),
        ("pulse_default_source", ["pactl", "get-default-source"]),
        ("pulse_default_sink", ["pactl", "get-default-sink"]),
    ]:
        p = run(*argv)
        if name == "microphone_hardware":
            result[name] = {"ok": p["ok"], "device_lines":
                            sum("card " in line.lower() for line in p["text"].splitlines())}
        elif name == "pulse_sources":
            result[name] = {"ok": p["ok"], "source_count":
                            sum(bool(line.strip()) for line in p["text"].splitlines())}
        else:
            # No raw values: local audio device names can reveal private details.
            result[name] = {"ok": p["ok"], "present": bool(p["text"].strip()) and p["ok"]}
    return result

def ha_http() -> dict:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8123/", timeout=3) as r:
            return {"reachable": True, "status": r.status}
    except urllib.error.HTTPError as e:
        return {"reachable": True, "status": e.code}
    except Exception as e:
        return {"reachable": False, "error_type": type(e).__name__}

def recommendations(x: dict) -> list[str]:
    rec = []
    if not all(x["listeners"].values()):
        rec.append("Restore unavailable listener(s) before tuning wake/Whisper.")
    if x["disk"]["free_mb"] < 512:
        rec.append("Low root free space: reclaim regeneratable caches only, protect recordings/config.")
    if not x["audio"]["pulse_default_source"]["ok"] or x["audio"]["pulse_sources"]["source_count"] == 0:
        rec.append("Inspect input routing and the USB microphone; do not change wake sensitivity yet.")
    if x["pipelines"].get("found") and x["pipelines"].get("pipeline_count", 0) == 0:
        rec.append("Home Assistant has no configured Assist pipeline.")
    if any(not p["conversation_engine_set"] or not p["stt_engine_set"]
           for p in x["pipelines"].get("pipelines", [])):
        rec.append("At least one Assist pipeline lacks its conversation or STT engine.")
    if x["journal_counts"].get("homeassistant", {}).get("pattern_counts", {}).get("intent", 0):
        rec.append("Inspect Home Assistant conversation/intent errors; open ports do not prove command handling.")
    rec.append("Final verification must involve real spoken command(s), observed entity state change and audible response.")
    return rec

def main() -> None:
    usage = shutil.disk_usage("/")
    x = {
        "collected_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "readonly": True,
        "end_to_end_speech_test_performed": False,
        "listeners": {str(p): connected(p) for p in PORTS},
        "disk": {"free_mb": round(usage.free / 1048576, 1),
                 "used_percent": round(100 * usage.used / usage.total, 1)},
        "wyoming_protocol": {str(p): wyoming_describe(p) for p in (10200, 10300, 10400, 10701)},\n        "ha_http": ha_http(),
        "audio": host_audio(),
        "pipelines": pipeline_config(),
        "integrations": integrations(),
        "services": {},
        "journal_counts": {},
    }
    for name in SERVICES:
        p = run("systemctl", "--user", "show", name,
                "--property=LoadState,ActiveState,SubState,NRestarts,ExecMainStatus")
        properties = {}
        for line in p["text"].splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                if key in {"LoadState", "ActiveState", "SubState", "NRestarts", "ExecMainStatus"}:
                    properties[key] = value
        x["services"][name] = properties
        j = run("journalctl", "--user", "-u", name, "--since=-30 minutes",
                "--no-pager", "--output=cat", timeout=10)
        x["journal_counts"][name] = classify(j["text"]) if j["ok"] else {"accessible": False}
    # Docker CLI can require sudo on this machine; do not attempt privilege escalation.
    ha_logs = run("docker", "logs", "--tail", "250", "homeassistant", timeout=10)
    x["journal_counts"]["homeassistant"] = (
        classify(ha_logs["text"]) if ha_logs["ok"] else {"accessible": False}
    )
    x["suggested_next_checks"] = recommendations(x)
    # Atomic private write; no transcripts, raw logs or secret material are saved.
    tmp = OUT.with_suffix(".json.tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fp:
        json.dump(x, fp, indent=2)
    os.replace(tmp, OUT)
    os.chmod(OUT, 0o600)
    print(json.dumps(x, indent=2))

if __name__ == "__main__":
    main()
