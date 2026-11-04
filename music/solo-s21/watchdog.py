#!/usr/bin/env python3
"""Isolated Termux watchdog for the S21 Tune Rush services.

Does not control other phone apps, Home Assistant, or the existing multiplayer
SQL service. Start under native Termux (not Android run-as) so network works.
"""
from __future__ import annotations

import fcntl
import os
import subprocess
import sys
import time
from pathlib import Path

HOME = Path("/data/data/com.termux/files/home")
PREFIX = Path("/data/data/com.termux/files/usr")
APP = HOME / "tune-rush-solo"
STATE = HOME / ".tunerush-solo"
LOG = APP / "watchdog.log"
SERVICES = (
    ("solo-engine", APP / "start-solo.sh", str(APP / "server.py")),
    ("cloud-relay", APP / "start-relay.sh", str(APP / "relay-worker.py")),
)
POLL_SECONDS = 30
MIN_RESTART_SECONDS = 60


def process_running(script: str) -> bool:
    # Look only at Termux's own Python process arguments; never match names
    # of unrelated apps or interpret the shell's process title.
    for item in Path("/proc").iterdir():
        if not item.name.isdecimal():
            continue
        try:
            args = (item / "cmdline").read_bytes().split(b"\x00")
            if any(part.decode(errors="ignore") == script for part in args):
                return True
        except (OSError, PermissionError, ValueError):
            continue
    return False


def write_log(event: str) -> None:
    try:
        if LOG.exists() and LOG.stat().st_size > 262144:
            LOG.rename(LOG.with_suffix(".log.previous"))
        with LOG.open("a", encoding="utf-8") as out:
            out.write(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) +
                      " " + event + "\n")
    except OSError:
        print(event, flush=True)


def launch(label: str, script: Path) -> None:
    env = os.environ.copy()
    env.update({
        "PREFIX": str(PREFIX),
        "HOME": str(HOME),
        "PATH": str(PREFIX / "bin") + ":/system/bin",
        "TMPDIR": str(PREFIX / "tmp"),
    })
    with (APP / (label + ".out.log")).open("ab", buffering=0) as out:
        child = subprocess.Popen(
            [str(script)], cwd=APP, env=env,
            stdin=subprocess.DEVNULL, stdout=out,
            stderr=subprocess.STDOUT,
            close_fds=True, start_new_session=True,
        )
    write_log("started " + label + " process " + str(child.pid))


def main() -> int:
    if not APP.is_dir() or not STATE.is_dir():
        print("Tune Rush install is incomplete; not starting.", flush=True)
        return 2
    for label, script, _ in SERVICES:
        if not script.is_file() or not os.access(script, os.X_OK):
            print("Missing executable for " + label, flush=True)
            return 2
    if "--check" in sys.argv:
        for label, _, marker in SERVICES:
            print(label, "running" if process_running(marker) else "stopped",
                  flush=True)
        return 0

    # A second invocation must not start a second watchdog or relay.
    lock_path = STATE / "tunerush-watchdog.lock"
    with lock_path.open("a+b") as lock:
        os.chmod(lock_path, 0o600)
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Tune Rush watchdog already running", flush=True)
            return 0
        last_launch = {label: 0.0 for label, _, _ in SERVICES}
        write_log("watchdog started")
        try:
            while True:
                for label, script, marker in SERVICES:
                    if process_running(marker):
                        continue
                    now = time.monotonic()
                    if now - last_launch[label] < MIN_RESTART_SECONDS:
                        continue
                    try:
                        launch(label, script)
                    except OSError as err:
                        write_log("could not restart " + label + ": " +
                                  type(err).__name__)
                    last_launch[label] = now
                time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            write_log("watchdog stopped")
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
