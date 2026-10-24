#!/usr/bin/env python3
"""No-phone/no-model deterministic V373 observer tests."""
import importlib.util
from pathlib import Path
import subprocess
import unittest

path=Path(__file__).with_name("s9_phone_first_peak_observer_v373.py")
spec=importlib.util.spec_from_file_location("observer",path)
o=importlib.util.module_from_spec(spec);spec.loader.exec_module(o)

CMD=["adb","-s","192.168.178.250:5555","shell","PINNED_FAKE"]

def sample(mem=2300000,peak=330000,pid="4321",cmd=None):
    cmdline=cmd or ("app_process -Djava.library.path=/data/local/tmp/s9_worker/lib "+
        o.PHONE_JAR+" "+o.PHONE_CLASS)
    return {"ps":"PID ARGS\n"+pid+" "+cmdline+"\n",
            "status":"VmRSS: 300000 kB\nVmHWM: "+str(peak)+" kB\n",
            "meminfo":"MemAvailable: "+str(mem)+" kB\n",
            "cmdline":cmdline}

class FakeProc:
    def __init__(self,finish_at=3):
        self.calls=0
        self.finish_at=finish_at
        self.returncode=None
        self.terminated=False
    def communicate(self,timeout):
        self.calls+=1
        if self.terminated:return ("","")
        if self.calls>=self.finish_at:
            self.returncode=0
            return ("S9_ORIGINAL4K_PHONE_FRAME_V370 {}\n","")
        raise subprocess.TimeoutExpired(CMD,timeout)
    def poll(self):return self.returncode
    def terminate(self):self.terminated=True;self.returncode=-15
    def kill(self):self.terminated=True;self.returncode=-9

class PeakObserverTests(unittest.TestCase):
    def setUp(self):
        self.proc=FakeProc()
        self.guards=[]
        self.cleanup=[]
        self.clocktick=[0]
    def clock(self):
        self.clocktick[0]+=3
        return float(self.clocktick[0])
    def run_observer(self,*,snap=None,proc=None,guard=None,cleanup=None):
        return o.supervise(
            command=CMD,recorder_pid="5789",
            phone_mem_floor_kib=1536*1024,
            camera_guard=guard or (lambda:self.guards.append("guard")),
            read_phone=snap or (lambda:sample()),
            cleanup_remote=cleanup or (lambda pid,cam:self.cleanup.append((pid,cam))),
            start=lambda *args,**kwargs:proc or self.proc,
            clock=self.clock)
    def test_success_tracks_actual_peak_and_guard_checks(self):
        raw,report=self.run_observer()
        self.assertIn("S9_ORIGINAL4K_PHONE_FRAME",raw)
        self.assertEqual(report["peak_rss_kib"],330000)
        self.assertEqual(report["min_phone_available_kib"],2300000)
        self.assertEqual(report["worker_pid"],"4321")
        self.assertGreaterEqual(report["samples"],2)
        self.assertEqual(self.cleanup,[])
        self.assertGreaterEqual(len(self.guards),3)
    def test_low_available_phone_memory_aborts_and_cleans(self):
        with self.assertRaisesRegex(o.Unsafe,"phone_available_memory_below"):
            self.run_observer(snap=lambda:sample(mem=1000000))
        self.assertTrue(self.proc.terminated)
        self.assertEqual(self.cleanup,[("4321","5789")])
    def test_thermal_or_hub_guard_abort_cleans(self):
        calls=[0]
        def guard():
            calls[0]+=1
            if calls[0]>=2:raise o.Unsafe("existing_v304_camera_guard_failed")
        with self.assertRaisesRegex(o.Unsafe,"existing_v304_camera_guard_failed"):
            self.run_observer(guard=guard)
        self.assertTrue(self.proc.terminated)
        self.assertEqual(len(self.cleanup),1)
    def test_ambiguous_multiple_workers_fail_closed(self):
        other=sample()
        other["ps"]+="5678 app_process "+o.PHONE_JAR+" "+o.PHONE_CLASS+"\n"
        with self.assertRaisesRegex(o.Unsafe,"multiple_phone_workers"):
            self.run_observer(snap=lambda:other)
        self.assertTrue(self.proc.terminated)
    def test_bad_worker_cmdline_fail_closed(self):
        with self.assertRaisesRegex(o.Unsafe,"worker_cmdline_not_pinned"):
            self.run_observer(snap=lambda:sample(cmd="app_process "+o.PHONE_JAR+" "+o.PHONE_CLASS).copy() | {"cmdline":"unknown"})
        self.assertTrue(self.proc.terminated)
    def test_no_telemetry_even_success_is_refusal(self):
        with self.assertRaisesRegex(o.Unsafe,"no_peak_memory_telemetry"):
            self.run_observer(proc=FakeProc(finish_at=1))
    def test_camera_pid_must_differ(self):
        with self.assertRaisesRegex(o.Unsafe,"phone_worker_pid_matches_recorder"):
            self.run_observer(snap=lambda:sample(pid="5789"))
    def test_low_floor_refused_before_start(self):
        started=[]
        with self.assertRaisesRegex(o.Unsafe,"unapproved_phone_ram_floor"):
            o.supervise(command=CMD,recorder_pid="5789",
                        phone_mem_floor_kib=100000,
                        camera_guard=lambda:None,read_phone=lambda:sample(),
                        cleanup_remote=lambda a,b:None,
                        start=lambda *x,**y:started.append(1))
        self.assertEqual(started,[])
    def test_invalid_adb_command_refused_before_start(self):
        with self.assertRaisesRegex(o.Unsafe,"command_not_pinned_adb"):
            o.supervise(command=["adb","-s","OTHER","shell","fake"],
                        recorder_pid="5789",phone_mem_floor_kib=1536*1024,
                        camera_guard=lambda:None,read_phone=lambda:sample(),
                        cleanup_remote=lambda a,b:None)
    def test_absent_remote_cleanup_fails_closed(self):
        with self.assertRaisesRegex(o.Unsafe,"remote_phone_cleanup_not_available"):
            self.run_observer(snap=lambda:sample(mem=1000000),
                              cleanup_remote=None) if False else o.supervise(
                command=CMD,recorder_pid="5789",phone_mem_floor_kib=1536*1024,
                camera_guard=lambda:None,read_phone=lambda:sample(mem=1000000),
                cleanup_remote=None,start=lambda *a,**kw:self.proc,clock=self.clock)
    def test_parse_prohibits_missing_hwm(self):
        with self.assertRaisesRegex(o.Unsafe,"telemetry_missing"):
            o.process_memory("VmRSS: 300000 kB\n","MemAvailable: 2300000 kB\n")

if __name__=="__main__":unittest.main()
