#!/usr/bin/env python3
"""Verify private derived playback, original fidelity, ranges, and bounded jobs."""
import importlib.util
import json
import subprocess
import tempfile
import threading
import time
import unittest
from io import BytesIO
from pathlib import Path
from unittest import mock

SOURCE = Path(__file__).resolve().parent.parent / "s9-person-ml-v1" / "s9_hub_playback.py"
spec = importlib.util.spec_from_file_location("smooth_playback", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class Handler:
    command = "GET"
    def __init__(self, value=""):
        self.headers = {"Range": value} if value else {}
        self.wfile = BytesIO()
        self.sent = {}
    def send_response(self, code): self.status = code
    def send_header(self, name, value): self.sent[name] = value
    def end_headers(self): pass


class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.patches = [mock.patch.object(mod, "CACHE", self.root / "cache"),
                        mock.patch.object(mod, "ROOTS", {"new": self.root / "local", "s3": self.root / "s3"})]
        for patch in self.patches: patch.start()
        mod.JOBS.clear()
        mod.WORKER = None
    def tearDown(self):
        for patch in reversed(self.patches): patch.stop()
        self.tmp.cleanup()

    def test_local_sources_are_allowlisted_and_original_unchanged(self):
        home = mod.ROOTS["new"]
        home.mkdir()
        original = home / "20261009-203934-1064.mp4"
        content = b"original video" * 1000
        original.write_bytes(content)
        src = mod.source("new", original.name, lambda: {})
        self.assertEqual(src["source_kind"], "local")
        self.assertEqual(src["url"], str(original.resolve()))
        self.assertEqual(original.read_bytes(), content)
        for name in ("../private.mp4", "/etc/private.mp4", "evil;rm.mp4", "video.mp4?url=https://evil.test"):
            with self.assertRaises(ValueError): mod.source("new", name, lambda: {})

    def test_phone_source_does_not_cache_original(self):
        name = "motion_1791676672365.mp4"
        src = mod.source("new", name, lambda: {name: {"size": 40402536}})
        self.assertEqual(src["url"], "http://127.0.0.1:8795/new/saved/clip/" + name)
        command = mod.transcode_command(src, self.root / "derived.part")
        self.assertEqual(command[command.index("-i") + 1], src["url"])
        self.assertIn("19", command)
        self.assertIn("ultrafast", command)
        self.assertIn("+faststart", command)
        self.assertIn(str(mod.FILE_MAX), command)

    def test_range_seeks_copy_exact_bytes(self):
        content = bytes(i % 256 for i in range(145678))
        path = self.root / "derived.mp4"
        path.write_bytes(content)
        for value, start, end in (("bytes=1234-9876", 1234, 9876),
                                   ("bytes=-10", len(content) - 10, len(content) - 1),
                                   ("bytes=145000-", 145000, len(content) - 1)):
            h = Handler(value)
            mod.serve(h, path, {"source_fps": 29.9})
            self.assertEqual(h.status, 206)
            self.assertEqual(h.wfile.getvalue(), content[start:end + 1])
            self.assertEqual(h.sent["Content-Range"], f"bytes {start}-{end}/{len(content)}")
            self.assertEqual(h.sent["Cache-Control"], "private,no-store")

    def test_empty_out_of_range_and_multi_range_rejected(self):
        path = self.root / "derived.mp4"
        path.write_bytes(b"x" * 10000)
        for value in ("bytes=-", "bytes=0-1,3-4", "bytes=10000-", "bytes=-0", "bytes=20-10"):
            h = Handler(value)
            mod.serve(h, path, {"source_fps": 30})
            self.assertEqual(h.status, 416)
            self.assertEqual(h.wfile.getvalue(), b"")

    def test_head_never_sends_video(self):
        path = self.root / "derived.mp4"
        path.write_bytes(b"x" * 10000)
        h = Handler("bytes=5-20")
        h.command = "HEAD"
        mod.serve(h, path, {"source_fps": 30})
        self.assertEqual(h.status, 206)
        self.assertEqual(h.sent["Content-Length"], "16")
        self.assertEqual(h.wfile.getvalue(), b"")

    def test_partial_generation_is_not_published(self):
        src = {"key": "a" * 64, "url": "safe", "source_kind": "phone"}
        mod.CACHE.mkdir()
        def run(*args, **kwargs):
            (mod.CACHE / (src["key"] + ".part")).write_bytes(b"x" * 10001)
            return mock.Mock(returncode=0)
        probes = [{"fps": 30, "duration": 120, "width": 3840, "height": 2160},
                  {"fps": 30, "duration": 3, "width": 1280, "height": 720}]
        with mock.patch.object(mod, "cache_home"), mock.patch.object(mod, "trim_cache"), \
             mock.patch.object(mod, "probe", side_effect=probes), mock.patch.object(mod.subprocess, "run", side_effect=run):
            with self.assertRaises(OSError): mod.build(src)
        self.assertEqual(list(mod.CACHE.glob("*")), [])

    def test_below_24fps_original_is_never_claimed_smooth(self):
        src = {"key": "b" * 64, "url": "safe", "source_kind": "phone"}
        mod.CACHE.mkdir()
        with mock.patch.object(mod, "cache_home"), mock.patch.object(mod, "trim_cache"), \
             mock.patch.object(mod, "probe", return_value={"fps": 15, "duration": 30}), \
             mock.patch.object(mod.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "source_below_24fps"): mod.build(src)
            run.assert_not_called()

    def test_hardware_timeout_leaves_only_remaining_budget_for_successful_fallback(self):
        src = {"key": "c" * 64, "url": "safe", "source_kind": "phone"}
        mod.CACHE.mkdir()
        elapsed = [0.0]
        calls = []
        real_exists, real_is_file = Path.exists, Path.is_file
        def exists(path):
            return True if str(path).replace("\\", "/") == "/dev/dri/renderD128" else real_exists(path)
        def is_file(path):
            return True if str(path).replace("\\", "/") == "/usr/lib/x86_64-linux-gnu/dri/i965_drv_video.so" else real_is_file(path)
        def probe(url, timeout):
            elapsed[0] += 25 if url == "safe" else 20
            self.assertGreaterEqual(timeout, 20)
            return {"fps": 30, "duration": 120, "width": 3840 if url == "safe" else 1280,
                    "height": 2160 if url == "safe" else 720}
        def run(command, **kwargs):
            calls.append(kwargs["timeout"])
            if "-hwaccel" in command:
                elapsed[0] += kwargs["timeout"]
                raise subprocess.TimeoutExpired(command, kwargs["timeout"])
            self.assertLess(kwargs["timeout"], mod.JOB_TIMEOUT)
            self.assertGreater(kwargs["timeout"], 100)
            elapsed[0] += 100
            Path(command[-1]).write_bytes(b"x" * 10001)
            return mock.Mock(returncode=0)
        with mock.patch.object(mod, "cache_home"), mock.patch.object(mod, "trim_cache"), \
             mock.patch.object(mod.time, "monotonic", side_effect=lambda: elapsed[0]), \
             mock.patch.object(mod.Path, "exists", autospec=True, side_effect=exists), \
             mock.patch.object(mod.Path, "is_file", autospec=True, side_effect=is_file), \
             mock.patch.object(mod, "probe", side_effect=probe), \
             mock.patch.object(mod.subprocess, "run", side_effect=run):
            data = mod.build(src)
        self.assertEqual(data["decoder"], "software")
        self.assertEqual(calls, [390, 155])
        self.assertLess(data["generated_seconds"], mod.JOB_TIMEOUT)
        self.assertTrue((mod.CACHE / (src["key"] + ".mp4")).is_file())

    def test_exhausted_hardware_budget_does_not_start_another_full_timeout(self):
        src = {"key": "d" * 64, "url": "safe", "source_kind": "phone"}
        mod.CACHE.mkdir()
        elapsed = [0.0]
        real_exists, real_is_file = Path.exists, Path.is_file
        def exists(path):
            return True if str(path).replace("\\", "/") == "/dev/dri/renderD128" else real_exists(path)
        def is_file(path):
            return True if str(path).replace("\\", "/") == "/usr/lib/x86_64-linux-gnu/dri/i965_drv_video.so" else real_is_file(path)
        def probe(*args, **kwargs):
            elapsed[0] += 25
            return {"fps": 30, "duration": 200}
        def run(command, **kwargs):
            Path(command[-1]).write_bytes(b"incomplete")
            elapsed[0] += kwargs["timeout"]
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])
        with mock.patch.object(mod, "cache_home"), mock.patch.object(mod, "trim_cache"), \
             mock.patch.object(mod.time, "monotonic", side_effect=lambda: elapsed[0]), \
             mock.patch.object(mod.Path, "exists", autospec=True, side_effect=exists), \
             mock.patch.object(mod.Path, "is_file", autospec=True, side_effect=is_file), \
             mock.patch.object(mod, "probe", side_effect=probe), \
             mock.patch.object(mod.subprocess, "run", side_effect=run) as execute:
            with self.assertRaisesRegex(OSError, "playback_copy_deadline_exceeded"):
                mod.build(src)
            self.assertEqual(execute.call_count, 1)
        self.assertLessEqual(elapsed[0], mod.JOB_TIMEOUT)
        self.assertEqual(list(mod.CACHE.glob("*")), [])

    def test_queue_has_one_worker_and_a_hard_pending_limit(self):
        now = time.monotonic()
        for i in range(mod.MAX_PENDING):
            mod.JOBS[str(i)] = {"state": "queued", "created": now, "touched": now}
        src = {"key": "new", "route": "/new/saved/clip/motion_1791676672365.mp4", "source_kind": "phone"}
        with mock.patch.object(mod, "cache_home"), mock.patch.object(mod, "cached", return_value=None), \
             mock.patch.object(mod.threading, "Thread") as thread:
            result = mod.prepare(src)
            self.assertEqual(result["error"], "playback_queue_busy")
            thread.assert_not_called()

    def test_evicted_ready_job_returns_to_queue(self):
        now = time.monotonic()
        src = {"key": "gone", "route": "/new/saved/clip/motion_1791676672365.mp4", "source_kind": "phone"}
        mod.JOBS["gone"] = {"state": "ready", "created": now, "touched": now}
        with mock.patch.object(mod, "cache_home"), mock.patch.object(mod, "cached", return_value=None), \
             mock.patch.object(mod.threading, "Thread") as thread:
            result = mod.prepare(src)
            self.assertEqual(result["state"], "queued")
            thread.assert_called_once()

    def test_transient_failure_is_reported_then_retry_succeeds(self):
        src = {"key": "retry", "route": "/new/saved/clip/motion_1791676672365.mp4", "source_kind": "phone"}
        attempted = threading.Event()
        ready = threading.Event()
        result = [None]
        calls = []
        def generate(_src):
            calls.append(_src["key"])
            if len(calls) == 1:
                attempted.set()
                raise OSError("temporary_phone_read_failure")
            data = {"fps": 30, "source_fps": 29.9}
            result[0] = (self.root / "derived.mp4", data)
            ready.set()
            return data
        with mock.patch.object(mod, "cache_home"), \
             mock.patch.object(mod, "cached", side_effect=lambda _src: result[0]), \
             mock.patch.object(mod, "build", side_effect=generate):
            mod.prepare(src)
            self.assertTrue(attempted.wait(2))
            first_worker = mod.WORKER
            if first_worker is not None: first_worker.join(2)
            failure = mod.prepare(src)
            self.assertEqual(failure["state"], "failed")
            self.assertEqual(failure["error"], "smooth_playback_unavailable")
            retry = mod.prepare(src)
            self.assertIn(retry["state"], ("queued", "preparing"))
            self.assertTrue(ready.wait(2))
            second_worker = mod.WORKER
            if second_worker is not None: second_worker.join(2)
            success = mod.prepare(src)
            self.assertEqual(success["state"], "ready")
            self.assertEqual(success["fps"], 30)
            self.assertEqual(len(calls), 2)

    def test_low_frame_rate_failure_remains_stable_across_retry(self):
        src = {"key": "slow", "route": "/new/saved/clip/20261009-202734-1061.mp4", "source_kind": "local"}
        completed = threading.Event()
        def generate(_src):
            completed.set()
            raise mod.SourceFrameRateError(4)
        with mock.patch.object(mod, "cache_home"), mock.patch.object(mod, "cached", return_value=None), \
             mock.patch.object(mod, "build", side_effect=generate) as build:
            mod.prepare(src)
            self.assertTrue(completed.wait(2))
            active = mod.WORKER
            if active is not None: active.join(2)
            for _ in range(3):
                result = mod.prepare(src)
                self.assertEqual(result["state"], "failed")
                self.assertEqual(result["error"], "source_below_24fps")
                self.assertEqual(result["source_fps"], 4)
            self.assertEqual(build.call_count, 1)

    def test_trim_removes_only_bounded_derived_files(self):
        mod.CACHE.mkdir()
        src_name = "motion_1791676672365.mp4"
        source = mod.CACHE / src_name
        source.write_bytes(b"source untouched")
        for key in ("a" * 64, "b" * 64):
            (mod.CACHE / (key + ".mp4")).write_bytes(b"x" * 10000)
            (mod.CACHE / (key + ".json")).write_text("{}")
        with mock.patch.object(mod, "cache_home"), mock.patch.object(mod, "CACHE_MAX", 15000):
            mod.trim_cache()
        self.assertEqual(source.read_bytes(), b"source untouched")
        self.assertEqual(len([p for p in mod.CACHE.glob("*.mp4") if p.name != src_name]), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
