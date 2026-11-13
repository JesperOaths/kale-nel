#!/usr/bin/env python3
"""Outbound transport only. The S21 remains the game and audio authority."""
import json
import ipaddress
import subprocess
from urllib.parse import urlsplit
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid

MAX_RESULT = 1_500_000
TOKEN = re.compile(r"[a-f0-9]{64}\Z")
ACTIONS = frozenset(("clue", "answer", "reveal", "next", "finish"))
MULTIPLAYER_ACTIONS = frozenset(("create","state","join","settings","start","next",
    "play","replay","pause","resume","buzz","steal","expire","forfeit","answer","skip"))
INTERRUPTED = {
    "ok": False,
    "error": "The game connection was interrupted. Reload to check your saved game before retrying.",
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Transport:
    def __init__(self, config):
        self.config = config
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect())
        self._phone_url = config["upstream"]
        self._last_discovery = 0.0

    def phone_url(self,port=8797):
        # The S21 changes its WLAN IPv4 prefix. Discover the verified Samsung
        # device's mDNS IPv6 address; never use arbitrary request-supplied URLs.
        if time.monotonic()-self._last_discovery>30:
            self._last_discovery=time.monotonic()
            try:
                found=subprocess.run(
                    ["/usr/bin/avahi-resolve","-6","-n","Android-2.local"],
                    capture_output=True,text=True,timeout=4)
                address=found.stdout.strip().split()[-1]
                ipv6=ipaddress.IPv6Address(address)
                if found.returncode==0 and not ipv6.is_unspecified and not ipv6.is_loopback:
                    self._phone_url="http://["+str(ipv6)+"]:8797"
            except (OSError,ValueError,IndexError,subprocess.TimeoutExpired):
                pass
        return self._phone_url.rsplit(":",1)[0]+":"+str(port)

    def json_request(self, url, data=None, headers=None, timeout=12):
        headers = {"Accept": "application/json", **(headers or {})}
        body = None
        if data is not None:
            body = json.dumps(data, separators=(",", ":")).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=body, headers=headers)
        with self.opener.open(req, timeout=timeout) as response:
            raw = response.read(MAX_RESULT + 1)
        if len(raw) > MAX_RESULT:
            raise ValueError("Oversized game result")
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError("Invalid game result")
        return result

    def ready(self):
        try:
            result = self.json_request(self.phone_url() + "/api/health", timeout=3)
            return result.get("ready") is True and result.get("service") == "tunerush-s21-solo"
        except (OSError, ValueError):
            return False

    def rpc(self, name, data):
        return self.json_request(
            self.config["rpc_base"] + name, data,
            {"apikey": self.config["publishable_key"],
             "User-Agent": "TuneRushHubTransport/1.0"})

    def engine(self, request):
        command, token, data = validate_request(request)
        if command == "multiplayer":
            body = self.json_request(self.phone_url(8798) + "/api/multiplayer",
                                     data, timeout=15)
            return {"ok": True, "body": body}
        path = {"session": "/api/session", "state": "/api/state", "action": "/api/action"}[command]
        headers = {"Authorization": "Bearer " + token} if token else {}
        try:
            body = self.json_request(self.phone_url() + path,
                                     None if command == "state" else data,
                                     headers, timeout=15)
            return {"ok": True, "body": body}
        except urllib.error.HTTPError as error:
            # Never log the response, credential, guesses, or audio.
            try:
                detail = json.loads(error.read(4096)).get("error", "Game request denied")
            except (OSError, ValueError, AttributeError):
                detail = "Game request denied"
            return {"ok": False, "error": str(detail)[:170], "code": error.code}
        except (OSError, ValueError):
            # A timed-out mutation may already have committed on the phone.
            # Return an error; never execute the same action a second time.
            return dict(INTERRUPTED)


def validate_request(request):
    if not isinstance(request, dict):
        raise ValueError("Invalid request")
    command, token, data = request.get("command"), request.get("token"), request.get("data", {})
    if command not in ("session", "state", "action", "multiplayer") or not isinstance(data, dict):
        raise ValueError("Unsupported game command")
    if len(json.dumps(data).encode()) > 4096:
        raise ValueError("Oversized request")
    if command == "multiplayer":
        # The queue submit RPC already enforces these fields. Check them again
        # before forwarding, without ever logging secrets or full request JSON.
        action,code,credential = data.get("action"),data.get("code"),data.get("hash")
        if (token is not None or action not in MULTIPLAYER_ACTIONS
            or not isinstance(code,str) or not re.fullmatch(r"[A-HJ-NP-Z2-9]{6}",code)
            or not isinstance(credential,str) or not TOKEN.fullmatch(credential)
            or not isinstance(data.get("data"),dict)):
            raise ValueError("Invalid multiplayer command")
        return command,None,data
    if command != "session" and (not isinstance(token, str) or not TOKEN.fullmatch(token)):
        raise ValueError("Invalid game credential")
    if command == "action" and data.get("op") not in ACTIONS:
        raise ValueError("Unsupported game action")
    return command, token if command != "session" else None, data


class Relay:
    def __init__(self, transport, journal):
        self.transport = transport
        self.journal = sqlite3.connect(journal)
        self.journal.execute("CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, seen REAL NOT NULL)")
        self.journal.commit()
        # Only job IDs and times are stored. Audio and answers are never written here.
        self.pending = None
        self.active_until = 0
        self.cleanup_at = 0

    def execute_once(self, job):
        job_id = str(uuid.UUID(job["id"]))
        if job_id != job["id"]:
            raise ValueError("Invalid job identifier")
        try:
            validate_request(job.get("request"))
        except (TypeError, ValueError):
            return job_id, {"ok": False, "error": "Invalid game request"}
        if self.journal.execute("SELECT 1 FROM attempts WHERE id=?", (job_id,)).fetchone():
            return job_id, dict(INTERRUPTED)
        self.journal.execute("INSERT INTO attempts VALUES (?,?)", (job_id, time.time()))
        self.journal.commit()  # Commit before sending any mutation to the S21.
        try:
            result = self.transport.engine(job["request"])
        except Exception:
            result = dict(INTERRUPTED)
        return job_id, result

    def publish_pending(self):
        job_id, result = self.pending
        response = self.transport.rpc("tunerush_s21_complete_v1", {
            "p_worker_secret": self.transport.config["worker_secret"],
            "p_id": job_id, "p_result": result})
        if not isinstance(response.get("ok"), bool):
            raise ValueError("Invalid completion response")
        # False means the queue has already expired the job. Never replay it.
        self.pending = None

    def tick(self):
        if self.pending:
            self.publish_pending()
            return 0.1
        if not self.transport.ready():
            return 3
        response = self.transport.rpc("tunerush_s21_claim_v1", {
            "p_worker_secret": self.transport.config["worker_secret"]})
        jobs = response.get("jobs") or []
        if not isinstance(jobs, list) or len(jobs) > 1:
            raise ValueError("Invalid claim response")
        if jobs:
            self.active_until = time.monotonic() + 300
            self.pending = self.execute_once(jobs[0])
            self.publish_pending()
            print("Forwarded S21 game request", flush=True)
        if time.monotonic() >= self.cleanup_at:
            self.journal.execute("DELETE FROM attempts WHERE seen<?", (time.time() - 86400,))
            self.journal.commit()
            self.cleanup_at = time.monotonic() + 300
        return 0.5 if time.monotonic() < self.active_until else 2


def load_config(path):
    if path.stat().st_mode & 0o077:
        raise ValueError("Configuration permissions must be private")
    config = json.loads(path.read_text())
    if not TOKEN.fullmatch(config.get("worker_secret", "")):
        raise ValueError("Invalid worker credential")
    if config.get("rpc_base") != "https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/":
        raise ValueError("Unexpected relay")
    if config.get("upstream") != "http://192.168.178.196:8797":
        raise ValueError("Unexpected game engine")
    return config


def main():
    os.umask(0o077)
    config = load_config(Path(sys.argv[1]).expanduser())
    state_dir = Path.home() / ".local/state/tunerush-relay"
    state_dir.mkdir(parents=True, mode=0o700, exist_ok=True)
    relay = Relay(Transport(config), state_dir / "attempts.sqlite3")
    errors = 0
    print("Outbound Tune Rush transport started; engine remains on S21", flush=True)
    while True:
        try:
            delay = relay.tick()
            errors = 0
        except (OSError, ValueError, KeyError, sqlite3.Error):
            errors += 1
            if errors <= 2 or errors % 12 == 0:
                print("Game transport unavailable; reconnecting without replaying actions", flush=True)
            delay = min(15, 1 + errors * 2)
        time.sleep(delay)


if __name__ == "__main__":
    main()
