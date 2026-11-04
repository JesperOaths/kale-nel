#!/usr/bin/env python3
"""S21-only Tune Rush engine worker. Supabase transports commands, never executes the game."""
import json
import os
import re
import time
import socket
import urllib.request
import urllib.error
from pathlib import Path
from urllib.parse import quote

HOME = Path("/data/data/com.termux/files/home")
SECRET_PATH = HOME / "tune-rush-solo" / "relay-secret"
STATE_PATH = HOME / ".tunerush-solo" / "state.json"
# The S21 WLAN currently has working IPv6 internet but no outbound IPv4.
# Supabase's HTTPS hostname publishes A records only. Route its TCP connection
# through a reachable Cloudflare IPv6 edge while retaining the original hostname
# for HTTP Host, SNI and certificate verification. No TLS verification bypass.
_RAW_LOOKUP = socket.getaddrinfo
def ipv6_cloudflare_route(host, port, *args, **kwargs):
    if host == "uiqntazgnrxwliaidkmy.supabase.co":
        route = _RAW_LOOKUP("api.audius.co", port,
                            socket.AF_INET6, socket.SOCK_STREAM)
        if route:
            return route
    return _RAW_LOOKUP(host, port, *args, **kwargs)
socket.getaddrinfo = ipv6_cloudflare_route
RPC = "https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/"
PUBLISHABLE = "sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA"
LOCAL = "http://127.0.0.1:8797"
UUID = re.compile(r"^[0-9a-f-]{36}$")
ID = re.compile(r"^[A-Za-z0-9_-]{3,32}$")

def post(fn, payload, timeout=13):
    req = urllib.request.Request(
        RPC + fn,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={"Content-Type": "application/json", "apikey": PUBLISHABLE,
                 "User-Agent": "TuneRushS21Worker/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)

_multiplayer_engine = None
def multiplayer_call(request):
    """Phone-owned game state; SQL is only a message queue."""
    global _multiplayer_engine
    if not isinstance(request, dict):
        return {"ok": False, "error": "invalid_data"}
    from multiplayer import MultiplayerEngine, GameError
    if _multiplayer_engine is None:
        _multiplayer_engine = MultiplayerEngine(HOME / ".tunerush-multiplayer" / "rooms.sqlite3")
    try:
        state = _multiplayer_engine.call(
            request.get("action"), request.get("code"),
            request.get("hash"), request.get("data") or {})
    except GameError as err:
        return {"ok": False, "error": str(err)[:160]}
    return {"ok": True, "body": {"state": state}}

def backend(cmd, token, data):
    if cmd == "multiplayer":
        return multiplayer_call(data)
    target = {"session": "/api/session", "action": "/api/action", "state": "/api/state"}.get(cmd)
    if target is None:
        return {"ok": False, "error": "Command not allowed"}
    headers = {"Accept": "application/json"}
    if token:
        if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{64}", token):
            return {"ok": False, "error": "Invalid session authorization"}
        headers["Authorization"] = "Bearer " + token
    content = None
    method = "GET"
    if cmd != "state":
        content = json.dumps(data, separators=(",", ":")).encode()
        headers["Content-Type"] = "application/json"
        method = "POST"
    req = urllib.request.Request(LOCAL + target, data=content, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=58 if cmd == "session" else 15) as res:
            result = json.load(res)
    except urllib.error.HTTPError as err:
        try: reason = json.load(err).get("error")
        except (ValueError, TypeError): reason = "Game request denied"
        return {"ok": False, "error": str(reason)[:170], "code": err.code}
    except (OSError, ValueError, TimeoutError) as err:
        return {"ok": False, "error": "S21 game engine unavailable: " + type(err).__name__}
    state = result.get("state", {})
    session_token = result.get("token") if cmd == "session" else token
    if isinstance(state, dict) and isinstance(state.get("media"), str):
        try:
            saved = json.loads(STATE_PATH.read_text(encoding="utf-8"))
            session = saved["sessions"][session_token]
            stream_id = session["track"]["id"]
            if not ID.fullmatch(stream_id):
                raise ValueError("Invalid provider identifier")
            # Browser uses Audius' HTTPS CDN for media transport. Selection,
            # verification, scoring and mystery state stay on the S21.
            state["media"] = ("https://api.audius.co/v1/tracks/" +
                              quote(stream_id, safe="") + "/stream")
            state.pop("cueMs", None) if "cueMs" not in state else None
        except (OSError, ValueError, KeyError, TypeError):
            return {"ok": False, "error": "S21 could not resolve selected audio stream"}
    return {"ok": True, "body": result}

def main():
    if not SECRET_PATH.exists():
        raise SystemExit("S21 relay credentials are missing.")
    secret = SECRET_PATH.read_text().strip()
    if not re.fullmatch("[0-9a-f]{64}", secret):
        raise SystemExit("Invalid S21 worker credential.")
    if SECRET_PATH.stat().st_mode & 0o077:
        raise SystemExit("Worker credential permissions too broad.")
    print("S21 game worker started; all scoring remains on phone.", flush=True)
    active_until = 0.0
    errors = 0
    while True:
        try:
            claim_started = time.monotonic()
            response = post("tunerush_s21_claim_v1", {"p_worker_secret": secret})
            claim_ms = round((time.monotonic() - claim_started) * 1000)
            jobs = response.get("jobs") or []
            if jobs:
                active_until = time.monotonic() + 300
            for job in jobs:
                job_id = job.get("id", "")
                if not isinstance(job_id, str) or not UUID.fullmatch(job_id):
                    continue
                request = job.get("request", {})
                operation = request.get("command", "unknown")
                engine_started = time.monotonic()
                try:
                    result = backend(operation, request.get("token"), request.get("data", {}))
                except Exception as err:
                    result = {"ok": False, "error": "S21 game worker error: " + type(err).__name__}
                engine_ms = round((time.monotonic() - engine_started) * 1000)
                completed_started = time.monotonic()
                post("tunerush_s21_complete_v1",
                     {"p_worker_secret": secret, "p_id": job_id, "p_result": result})
                completion_ms = round((time.monotonic() - completed_started) * 1000)
                # Durations only; never log session bearer tokens, guesses, or tracks.
                print("S21 %s processed; claim=%dms engine=%dms publish=%dms" %
                      (operation, claim_ms, engine_ms, completion_ms), flush=True)
            errors = 0
            # Short active polling makes button clicks responsive. A slower idle
            # cadence prevents unnecessary traffic when no one is playing.
            time.sleep(0.65 if time.monotonic() < active_until else 2.2)
        except KeyboardInterrupt:
            raise
        except Exception as err:
            errors += 1
            if errors <= 2 or errors % 12 == 0:
                print("Relay temporarily unavailable (" + type(err).__name__ + "); retrying", flush=True)
            time.sleep(min(30, 3 + errors * 2))

if __name__ == "__main__":
    main()

