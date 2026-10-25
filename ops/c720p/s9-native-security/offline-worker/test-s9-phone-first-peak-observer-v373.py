#!/usr/bin/env python3
"""Proposed no-device tests; no Camera2/ADB/model/inference accessed."""
import importlib.util
from pathlib import Path
import subprocess
import unittest

src = Path(__file__).with_name('s9_phone_first_peak_observer_v373.py')
spec = importlib.util.spec_from_file_location('observer', src)
o = importlib.util.module_from_spec(spec)
spec.loader.exec_module(o)
CLIP = 'motion_1792604351921.mp4'
SHA = 'a' * 64
REV = 'b' * 64
EXPECT = o.required_args(CLIP, SHA, 52107994, REV, 2887)
CMD = ['adb','-s','192.168.178.250:5555','shell','PINNED_FAKE_TASK']
ARG_LINE = 'app_process -Djava.library.path=/data/local/tmp/s9_worker/lib /system/bin ' + ' '.join(EXPECT)

def stat(pid='4321', start=10020):
    values = ['S'] + ['0'] * 18 + [str(start)] + ['0'] * 5
    return str(pid) + ' (app_process) ' + ' '.join(values)

def snap(pid='4321', start=10020, available=2300000, hwm=330000,
         argv=ARG_LINE, args_before=None, stale_stat=False):
    return {
        'ps':'PID ARGS\n'+pid+' '+argv+'\n', 'pid':pid,
        'stat_before':stat(pid,start),
        'stat_after':stat(pid,start+1 if stale_stat else start),
        'argv':args_before or argv,
        'status':'VmRSS: 250000 kB\nVmHWM: '+str(hwm)+' kB\n',
        'meminfo':'MemAvailable: '+str(available)+' kB\n',
    }

class FakeProcess:
    def __init__(self, exits_after=3, exitcode=0):
        self.calls=0;self.exits_after=exits_after;self.returncode=None
        self.terminated=False;self.exitcode=exitcode
    def communicate(self,timeout):
        self.calls+=1
        if self.terminated:return ('','')
        if self.calls >= self.exits_after:
            self.returncode=self.exitcode
            return ('S9_ORIGINAL4K_PHONE_FRAME_V370 {"unverified":true}', '')
        raise subprocess.TimeoutExpired(CMD,timeout)
    def poll(self):return self.returncode
    def terminate(self):self.terminated=True;self.returncode=-15
    def kill(self):self.terminated=True;self.returncode=-9

class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.proc=FakeProcess()
        self.cleaned=[]
        self.guards=[]
        self.clock_calls=0
    def clock(self):
        self.clock_calls+=1
        return float(self.clock_calls*3)
    def monitor(self,read=lambda:snap(), *, proc=None, guard=None, cleanup=None,
                runtime_reserve=512*1024):
        return o.supervise(
            argv=CMD,expected=EXPECT,recorder_pid='5789',
            startup_floor_kib=1536*1024,
            protected_runtime_reserve_kib=runtime_reserve,
            frame_budget_seconds=65,
            camera_guard=guard or (lambda:self.guards.append('guard')),
            snapshot=lambda exp:read(),
            cleanup_remote=cleanup or (lambda ident,exp,aborted:self.cleaned.append((ident,aborted))),
            start=lambda *a,**k:(proc or self.proc),
            monotonic=self.clock)
    def test_blocking_frame_peak_success(self):
        payload, receipt=self.monitor()
        self.assertIn('S9_ORIGINAL4K_PHONE_FRAME',payload)
        self.assertEqual(receipt['worker_vm_hwm_peak_kib'],330000)
        self.assertEqual(receipt['sample_count'],2)
        self.assertTrue(receipt['peak_is_observed_not_hard_cap'])
        self.assertEqual(self.cleaned[0][1],False)
    def test_real_android_argv_not_claspath(self):
        self.assertTrue(o.process_matches(ARG_LINE, EXPECT))
        self.assertNotIn(o.PHONE_CLASS,'CLASSPATH=/data/local/tmp/s9_worker/s9_gap_v371.dex.jar')
    def test_runtime_reserve_distinct_from_startup_floor(self):
        _,receipt=self.monitor(read=lambda:snap(available=800000))
        self.assertEqual(receipt['startup_floor_kib'],1536*1024)
        self.assertEqual(receipt['protected_runtime_reserve_kib'],512*1024)
        self.assertLess(receipt['minimum_phone_available_kib'],1536*1024)
    def test_breach_aborts_and_cleanup(self):
        with self.assertRaisesRegex(o.Unqualified,'reserve_breached'):
            self.monitor(read=lambda:snap(available=500000))
        self.assertTrue(self.proc.terminated)
        self.assertEqual(self.cleaned[0][1],True)
    def test_host_exits_before_telemetry_refused(self):
        with self.assertRaisesRegex(o.Unqualified,'telemetry_missing'):
            self.monitor(proc=FakeProcess(exits_after=1))
        self.assertEqual(self.cleaned[0][1],True)
    def test_nonzero_host_exit_refused(self):
        with self.assertRaisesRegex(o.Unqualified,'phone_exit'):
            self.monitor(proc=FakeProcess(exits_after=2,exitcode=3))
        self.assertTrue(self.cleaned[0][1])
    def test_pid_reuse_refused(self):
        with self.assertRaisesRegex(o.Unqualified,'pid_reuse'):
            self.monitor(read=lambda:snap(stale_stat=True))
        self.assertTrue(self.cleaned[0][1])
    def test_different_task_cannot_be_cleanup_target(self):
        changed=ARG_LINE.replace(CLIP,'motion_1792095266692.mp4')
        with self.assertRaisesRegex(o.Unqualified,'different_phone_worker'):
            self.monitor(read=lambda:snap(argv=changed))
        self.assertTrue(self.cleaned[0][1])
    def test_camera_pid_never_targeted(self):
        with self.assertRaisesRegex(o.Unqualified,'phone_pid_is_camera2'):
            self.monitor(read=lambda:snap(pid='5789'))
        self.assertTrue(self.cleaned[0][1])
    def test_camera_guard_fails_during_blocked_call(self):
        def guard():
            self.guards.append('guard')
            if len(self.guards)>1:raise o.Unqualified('original_v304_camera_guard')
        with self.assertRaisesRegex(o.Unqualified,'camera_guard'):
            self.monitor(guard=guard)
        self.assertTrue(self.cleaned[0][1])
    def test_unproven_cleanup_overrides_result(self):
        def fail(*args):raise o.Unqualified('remote_identity_or_cleanup_unknown')
        with self.assertRaisesRegex(o.Unqualified,'cleanup_unknown'):
            self.monitor(cleanup=fail)
    def test_no_weak_new_startup_floor(self):
        with self.assertRaisesRegex(o.Unqualified,'unapproved_worker_launch'):
            o.supervise(argv=CMD,expected=EXPECT,recorder_pid='5789',
                startup_floor_kib=900*1024,protected_runtime_reserve_kib=512*1024,
                camera_guard=lambda:None,snapshot=lambda _:snap(),
                frame_budget_seconds=65,
                cleanup_remote=lambda *a:None,start=lambda *a,**k:self.proc)
    def test_no_weak_runtime_protected_reserve(self):
        with self.assertRaisesRegex(o.Unqualified,'unapproved_worker_launch'):
            self.monitor(runtime_reserve=400000)
    def test_one_second_budget_rejected_after_slow_telemetry(self):
        now=[0.0]
        class ClockProc(FakeProcess):
            def communicate(self,timeout):
                self.calls+=1
                if self.terminated:return ('','')
                if self.calls==1:
                    now[0]=1.2
                    raise subprocess.TimeoutExpired(CMD, timeout)
                raise AssertionError('second ADB wait should not occur')
        with self.assertRaisesRegex(o.Unqualified,'deadline_reached'):
            o.supervise(argv=CMD,expected=EXPECT,recorder_pid='5789',
                startup_floor_kib=1536*1024,protected_runtime_reserve_kib=512*1024,
                frame_budget_seconds=1,camera_guard=lambda:None,
                snapshot=lambda _:snap(),cleanup_remote=lambda *a:None,
                start=lambda *a,**k:ClockProc(),monotonic=lambda:now[0])

    def test_final_guard_overshoots_frame_budget(self):
        now=[0.0]
        calls=[0]
        class ClockProc(FakeProcess):
            def communicate(self,timeout):
                self.calls+=1
                if self.calls==1:
                    now[0]=60.
                    raise subprocess.TimeoutExpired(CMD, timeout)
                now[0]=63.
                self.returncode=0
                return ('S9_ORIGINAL4K_PHONE_FRAME_V370 {}','')
        def slow_guard():
            calls[0]+=1
            if calls[0]==3:now[0]=72.
        with self.assertRaisesRegex(o.Unqualified,'deadline_reached'):
            o.supervise(argv=CMD,expected=EXPECT,recorder_pid='5789',
                startup_floor_kib=1536*1024,protected_runtime_reserve_kib=512*1024,
                frame_budget_seconds=65,camera_guard=slow_guard,
                snapshot=lambda _:snap(),cleanup_remote=lambda *a:None,
                start=lambda *a,**k:ClockProc(),monotonic=lambda:now[0])

    def test_stat_parses_comm_parenthesis(self):
        s=stat().replace('(app_process)','(app)process)')
        self.assertEqual(o.parse_start_ticks(s,'4321'),10020)

    def test_start_exception_still_runs_remote_identity_gate(self):
        calls=[]
        def fail_start(*args,**kwargs):raise OSError('synthetic launch uncertainty')
        with self.assertRaises(OSError):
            o.supervise(argv=CMD,expected=EXPECT,recorder_pid='5789',
                startup_floor_kib=1536*1024,protected_runtime_reserve_kib=512*1024,
                frame_budget_seconds=65,camera_guard=lambda:None,
                snapshot=lambda _:snap(),
                cleanup_remote=lambda *a:calls.append(a),
                start=fail_start,monotonic=lambda:0.)
        self.assertEqual(len(calls),1)
        self.assertTrue(calls[0][-1])

    def test_poll_error_does_not_skip_remote_verification(self):
        calls=[]
        class BadPoll(FakeProcess):
            def poll(self):raise OSError('synthetic poll failed')
        proc=BadPoll(exits_after=100)
        with self.assertRaisesRegex(o.Unqualified,'cleanup_unverified'):
            o.supervise(argv=CMD,expected=EXPECT,recorder_pid='5789',
                startup_floor_kib=1536*1024,protected_runtime_reserve_kib=512*1024,
                frame_budget_seconds=65,camera_guard=lambda:None,
                snapshot=lambda _:snap(available=100000),
                cleanup_remote=lambda *a:calls.append(a),
                start=lambda *a,**k:proc,
                monotonic=lambda:0.)
        self.assertEqual(len(calls),1)
if __name__=='__main__':unittest.main()
