#!/usr/bin/env python3
"""Offline release-invariant checks. No subprocess, ADB, camera or media use.

Run with a source-tree path as the first argument. Failures expose defects;
this harness never edits a source file or grants release approval.
"""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(sys.argv.pop(1)).resolve()
AREA = ROOT / 'ops/c720p/s9-native-security'
OFFLINE = AREA / 'offline-worker'

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

o = load('audit_observer', OFFLINE / 's9_phone_first_peak_observer_v373.py')
c = load('audit_coordinator', OFFLINE / 's9_phone_gap_coordinator_v371.py')
CLIP = 'motion_1792604351921.mp4'
EXPECTED = o.required_args(CLIP, 'a' * 64, 52107994, 'b' * 64, 2887)
ARGV = ['adb', '-s', '192.168.178.250:5555', 'shell', 'NOT_EXECUTED']
WORDS = 'app_process /system/bin ' + ' '.join(EXPECTED)

def snapshot(_):
    stat = '4321 (app_process) ' + ' '.join(['S'] + ['0'] * 18 + ['10020'] + ['0'] * 5)
    return {'ps': 'PID ARGS\n4321 ' + WORDS + '\n', 'pid': '4321',
            'stat_before': stat, 'stat_after': stat, 'argv': WORDS,
            'status': 'VmRSS: 250000 kB\nVmHWM: 330000 kB\n',
            'meminfo': 'MemAvailable: 2300000 kB\n'}

class FakeProcess:
    def __init__(self):
        self.calls = 0
        self.returncode = None
    def communicate(self, timeout):
        self.calls += 1
        if self.calls == 1:
            raise subprocess.TimeoutExpired(ARGV, timeout)
        self.returncode = 0
        return ('S9_ORIGINAL4K_PHONE_FRAME_V370 {}', '')
    def poll(self): return self.returncode
    def terminate(self): self.returncode = -15
    def kill(self): self.returncode = -9

def monitor(now, *, guard=lambda: None, cleanup=lambda *a: None, start=None, budget=65):
    return o.supervise(argv=ARGV, expected=EXPECTED, recorder_pid='5789',
        startup_floor_kib=1536 * 1024, protected_runtime_reserve_kib=512 * 1024,
        frame_budget_seconds=budget, camera_guard=guard, snapshot=snapshot,
        cleanup_remote=cleanup, start=start or (lambda *a, **k: FakeProcess()),
        monotonic=lambda: now[0])

def row():
    return dict(clip_no=CLIP, source='s9_original_4k_microsd', source_bytes=52107994,
        source_sha256='a' * 64, media_revision='b' * 64,
        model_sha256=c.MODEL_SHA, native_pass='s9_onphone_36_samples_overlapping_tiles_v5',
        required_analysis=c.ANALYSIS, priority_reason='no_indexed_image',
        attempts=1, status='processing', lease_until=1041)

class RemainingBoundaryTests(unittest.TestCase):
    def test_initial_guard_cannot_consume_budget_then_launch(self):
        now, launches = [0.0], []
        def guard(): now[0] = 2.0
        def start(*a, **k):
            launches.append(True)
            return FakeProcess()
        try:
            monitor(now, guard=guard, start=start, budget=1)
        except o.Unqualified:
            pass
        self.assertEqual(launches, [], 'worker launched after prelaunch guard exhausted budget')

    def test_launch_overhead_is_inside_frame_deadline(self):
        now = [0.0]
        def start(*a, **k):
            now[0] = 70.0
            return FakeProcess()
        with self.assertRaises(o.Unqualified):
            monitor(now, start=start)

    def test_success_cleanup_cannot_qualify_late_frame(self):
        now = [0.0]
        def cleanup(identity, expected, aborted):
            if not aborted: now[0] = 70.0
        with self.assertRaises(o.Unqualified):
            monitor(now, cleanup=cleanup)

    def test_remote_cleanup_is_attempted_when_host_teardown_times_out(self):
        now, cleaned, guards = [0.0], [], []
        class StuckFakeProcess(FakeProcess):
            def communicate(self, timeout):
                raise subprocess.TimeoutExpired(ARGV, timeout)
        def guard():
            guards.append(True)
            if len(guards) > 1: raise o.Unqualified('synthetic_camera_guard')
        try:
            monitor(now, guard=guard, start=lambda *a, **k: StuckFakeProcess(),
                    cleanup=lambda *a: cleaned.append(True))
        except (o.Unqualified, subprocess.TimeoutExpired):
            pass
        self.assertTrue(cleaned, 'remote cleanup skipped after local host teardown timeout')

    def check_coordinator_expiry(self, phase):
        now, launches = [1000.0], []
        def guard(_):
            if phase == 'guard': now[0] += 2.0
        def source(_):
            if phase == 'source': now[0] += 2.0
            return True
        def probe(*args):
            launches.append(args[-1])
            raise c.Deferred('synthetic_launch_stop')
        with self.assertRaises(c.Deferred):
            c.coordinate(row(), 12000, guard=guard, source_check=source,
                         probe=probe, clock=lambda: now[0], wall=lambda: now[0])
        self.assertEqual(launches, [], 'expired coordinator budget was passed into probe')

    def test_coordinator_rechecks_budget_after_guard(self):
        self.check_coordinator_expiry('guard')

    def test_coordinator_rechecks_budget_after_source_validation(self):
        self.check_coordinator_expiry('source')

    def test_v304_verifies_runner_before_executing_module(self):
        fixture = load('audit_queue_fixture', AREA / 'test-s9-priority-rescan-feedback-v304.py')
        case = fixture.QueueTest()
        case.setUp()
        self.addCleanup(case.doCleanups)
        v = fixture.v
        v.produce()
        release = case.root / 'release.json'
        release.write_text('{}')
        release.chmod(0o600)
        runner = case.root / 'unapproved_runner.py'
        coordinator = case.root / 'coordinator.py'
        marker = case.root / 'unapproved_module_executed.txt'
        coordinator.write_text('# harmless synthetic source\n')
        runner.write_text('from pathlib import Path\nPath(' + repr(str(marker)) +
            ').write_text("synthetic import marker")\n' +
            'def policy(path):\n    return {"runner_sha256": "f"*64, "coordinator_sha256": "e"*64}\n')
        before = v.QUEUE.read_bytes()
        with patch.object(v, 'PHONE_RELEASE', release), \
             patch.object(v, 'PHONE_RUNNER', runner), \
             patch.object(v, 'PHONE_COORDINATOR', coordinator), \
             patch.object(v, 'camera_guard', return_value=None):
            with self.assertRaises(v.Refusal):
                v.work()
        self.assertEqual(v.QUEUE.read_bytes(), before)
        self.assertFalse(marker.exists(), 'unapproved runner executed before digest rejection')

if __name__ == '__main__':
    unittest.main(verbosity=2)
