#!/usr/bin/env python3
"""Offline time-boundary regressions; no process, ADB or media is accessed."""
import importlib.util
from pathlib import Path
import subprocess
import unittest

BASE = Path(__file__).resolve().parent

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

observer = load('deadline_observer', BASE / 's9_phone_first_peak_observer_v373.py')
coordinator = load('deadline_coordinator', BASE / 's9_phone_gap_coordinator_v371.py')
EXPECTED = observer.required_args('motion_1792604351921.mp4', 'a' * 64,
                                  52107994, 'b' * 64, 2887)
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

class ObserverDeadlineTests(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        self.started = []
        self.cleaned = []
    def start(self, *args, **kwargs):
        self.started.append(True)
        return FakeProcess()
    def monitor(self, *, budget=65, guard=lambda: None, start=None, cleanup=None):
        return observer.supervise(argv=ARGV, expected=EXPECTED,
            recorder_pid='5789', startup_floor_kib=1536 * 1024,
            protected_runtime_reserve_kib=512 * 1024,
            frame_budget_seconds=budget, camera_guard=guard, snapshot=snapshot,
            cleanup_remote=cleanup or (lambda *a: self.cleaned.append(a)),
            start=start or self.start, monotonic=lambda: self.now)
    def test_guard_consuming_budget_prevents_launch(self):
        def guard(): self.now = 2.0
        with self.assertRaisesRegex(observer.Unqualified, 'before_launch'):
            self.monitor(budget=1, guard=guard)
        self.assertEqual(self.started, [])
        self.assertEqual(self.cleaned, [])
    def test_launch_overhead_cannot_reset_deadline(self):
        def start(*args, **kwargs):
            self.now = 70.0
            return FakeProcess()
        with self.assertRaisesRegex(observer.Unqualified, 'during_launch'):
            self.monitor(start=start)
        self.assertEqual(len(self.cleaned), 1)
        self.assertIs(self.cleaned[0][-1], True)
    def test_success_cleanup_consuming_budget_prevents_qualification(self):
        def cleanup(identity, expected, aborted):
            self.cleaned.append(aborted)
            if not aborted: self.now = 70.0
        with self.assertRaisesRegex(observer.Unqualified, 'during_cleanup'):
            self.monitor(cleanup=cleanup)
        self.assertEqual(self.cleaned, [False, True])
    def test_remote_absence_check_runs_after_each_host_teardown_failure(self):
        for failing_operation in ('terminate', 'kill', 'final_wait'):
            with self.subTest(operation=failing_operation):
                cleaned = []
                guards = []
                class StuckFakeProcess(FakeProcess):
                    def communicate(self, timeout):
                        raise subprocess.TimeoutExpired(ARGV, timeout)
                    def terminate(self):
                        if failing_operation == 'terminate':
                            raise OSError('synthetic terminate failure')
                    def kill(self):
                        if failing_operation == 'kill':
                            raise OSError('synthetic kill failure')
                def guard():
                    guards.append(True)
                    if len(guards) > 1:
                        raise observer.Unqualified('synthetic_camera_guard')
                with self.assertRaises(observer.Unqualified):
                    self.monitor(guard=guard,
                        start=lambda *a, **k: StuckFakeProcess(),
                        cleanup=lambda *a: cleaned.append(a))
                self.assertEqual(len(cleaned), 1)
                self.assertIs(cleaned[0][-1], True)
    def test_start_failure_still_requires_remote_absence_check(self):
        def unavailable(*args, **kwargs): raise OSError('synthetic launch failure')
        with self.assertRaises(OSError):
            self.monitor(start=unavailable)
        self.assertEqual(len(self.cleaned), 1)
    def test_guard_failure_does_not_start_or_touch_remote_process(self):
        def refused(): raise observer.Unqualified('synthetic guard refusal')
        with self.assertRaises(observer.Unqualified):
            self.monitor(guard=refused)
        self.assertEqual(self.started, [])
        self.assertEqual(self.cleaned, [])

class CoordinatorDeadlineTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000.0
        self.probes = []
        self.row = dict(clip_no=EXPECTED[2], source='s9_original_4k_microsd',
            source_bytes=52107994, source_sha256='a' * 64,
            media_revision='b' * 64, model_sha256=coordinator.MODEL_SHA,
            native_pass='s9_onphone_36_samples_overlapping_tiles_v5',
            required_analysis=coordinator.ANALYSIS, priority_reason='no_indexed_image',
            attempts=1, status='processing', lease_until=1041)
    def exercise(self, *, guard=lambda _: None, source=lambda _: True):
        def probe(*args):
            self.probes.append(args[-1])
            raise coordinator.Deferred('synthetic_stop_before_any_hardware')
        return coordinator.coordinate(self.row, 12000, guard=guard,
            source_check=source, probe=probe,
            clock=lambda: self.now, wall=lambda: self.now)
    def test_guard_expiry_prevents_probe(self):
        def guard(_): self.now += 2.0
        with self.assertRaises(coordinator.Deferred): self.exercise(guard=guard)
        self.assertEqual(self.probes, [])
    def test_source_validation_expiry_prevents_probe(self):
        def source(_):
            self.now += 2.0
            return True
        with self.assertRaises(coordinator.Deferred): self.exercise(source=source)
        self.assertEqual(self.probes, [])
    def test_probe_receives_budget_reduced_by_guard_and_source_reads(self):
        self.row['lease_until'] = 1060
        def guard(_): self.now += 3.0
        def source(_):
            self.now += 4.0
            return True
        with self.assertRaises(coordinator.Deferred):
            self.exercise(guard=guard, source=source)
        self.assertEqual(self.probes, [13.0])
    def test_production_guard_receives_live_budget_without_unbounded_fallback(self):
        self.row['lease_until'] = 1060
        def legacy_guard(_): raise AssertionError('unbounded fallback guard used')
        budgets = []
        def bounded_guard(row, budget):
            budgets.append(budget)
            self.now += 3.0
        def probe(row, requested, budget):
            self.probes.append(budget)
            raise coordinator.Deferred('synthetic_stop_before_any_hardware')
        with self.assertRaises(coordinator.Deferred):
            coordinator.coordinate(self.row, 12000, guard=legacy_guard,
                guard_with_budget=bounded_guard, source_check=lambda _: True,
                probe=probe, clock=lambda: self.now, wall=lambda: self.now)
        self.assertEqual(budgets, [20.0])
        self.assertEqual(self.probes, [17.0])

if __name__ == '__main__': unittest.main()
