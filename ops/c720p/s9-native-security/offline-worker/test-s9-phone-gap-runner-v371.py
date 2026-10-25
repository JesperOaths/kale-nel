#!/usr/bin/env python3
"""Pure-local test: no adb, camera, model, MP4, archive or queue is accessed."""
import hashlib
import importlib.util
import json
import pathlib
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

BASE=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(BASE))
import s9_phone_gap_runner_v371 as m
H="a"*64

def approved():
    return {"schema":m.POLICY_SCHEMA,"active":True,
            "authorization_basis":"user_explicit_guarded_task9_20261021",
            "camera2_apk_unchanged":True,
            "approval_record":"task9-source-only-synthetic-fixture",
            "phone_frame_jar_sha256":H,
            "coordinator_sha256":H,"runner_sha256":H,
            "min_phone_mem_available_kib":1536*1024,
            "min_phone_sd_free_bytes":20*1024**3,
            "observer_sha256":H,
            "protected_runtime_reserve_kib":512*1024,
            "source_reader":"s9_source_current_priority_reader_v369",
            "consumer":"s9_anonymous_quality_consumption_v361"}

class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.file=pathlib.Path(self.temp.name)/"release.json"
        self.calls=[]
    def write(self,data=None):
        self.file.write_text(json.dumps(data if data is not None else approved()))
        self.file.chmod(0o600)
    def test_release_absent_refuses(self):
        with self.assertRaises(m.frames.Deferred):m.policy(self.file)
    def test_unsafe_arbitrary_phone_floor_rejected(self):
        p=approved()
        p["min_phone_mem_available_kib"]=200000
        self.write(p)
        with self.assertRaises(m.frames.Deferred):
            m.policy(self.file)
    def test_release_unapproved_refuses(self):
        p=approved();p["authorization_basis"]="unverified_external_authorization"
        self.write(p)
        with self.assertRaises(m.frames.Deferred):m.policy(self.file)
    def test_release_without_source_pins_refuses(self):
        p=approved();p.pop("runner_sha256")
        self.write(p)
        with self.assertRaises(m.frames.Deferred):m.policy(self.file)
    def test_release_world_readable_refuses(self):
        self.write();self.file.chmod(0o644)
        with self.assertRaises(m.frames.Deferred):m.policy(self.file)
    def test_private_source_pinned_release_parse_only(self):
        self.write()
        observer_file=pathlib.Path(self.temp.name)/"observer-v373.py"
        observer_file.write_bytes((BASE/"s9_phone_first_peak_observer_v373.py").read_bytes())
        p=approved()
        p["observer_sha256"]=hashlib.sha256(observer_file.read_bytes()).hexdigest()
        self.write(p)
        with patch.object(m,"OBSERVER",observer_file):
            self.assertEqual(m.policy(self.file)["min_phone_mem_available_kib"],1536*1024)
    def test_phone_low_memory_blocks_before_inference(self):
        def fake(*args,**kwargs):
            self.calls.append(args)
            if args==("get-state",):return "device"
            if args[0]=="shell" and args[1].startswith("pidof"):return "1234"
            if args[0]=="shell" and args[1]=="cat /proc/meminfo":
                return "MemAvailable: 100000 kB\n"
            raise AssertionError("probe went beyond low-memory guard")
        with patch.object(m,"adb",fake),self.assertRaises(m.frames.Deferred):
            m.phone_readiness(approved())
        self.assertFalse(any("app_process" in str(s) for s in self.calls))
    def test_recorder_pid_change_refuses_before_inference(self):
        def fake(*args,**kwargs):
            if args==("get-state",):return "device"
            if args[0]=="shell" and args[1].startswith("pidof"):return "5678"
            raise AssertionError("probe went beyond PID guard")
        with patch.object(m,"adb",fake),self.assertRaises(m.frames.Deferred):
            m.phone_readiness(approved(),recorder_pid="1234")
    def test_low_sd_headroom_fails_closed(self):
        def fake(*args,**kwargs):
            if args==("get-state",):return "device"
            if args[1].startswith("pidof"):return "1234"
            if args[1]=="cat /proc/meminfo":return "MemAvailable: 2250000 kB\n"
            if args[1].startswith("df -k"):return "Filesystem Size Used Available Use%\nfoo 1000 300 400 70%\n"
            raise AssertionError("unexpected staged phone command")
        with patch.object(m,"adb",fake),self.assertRaises(m.frames.Deferred):
            m.phone_readiness(approved())
    def test_pinned_jar_and_recorder_ready_synthetic(self):
        def fake(*args,**kwargs):
            if args==("get-state",):return "device"
            if args[1].startswith("pidof"):return "1234"
            if args[1]=="cat /proc/meminfo":return "MemAvailable: 2250000 kB\n"
            if args[1].startswith("df -k"):return "Filesystem Size Used Available Use%\nfoo 90000000 4000 60000000 4%\n"
            if args[1].startswith("ps -A"):return "PID ARGS\n1234 /system/bin/nl.kalenel.s9security\n"
            if args[1].startswith("sha256sum"):return H+"  /data/local/tmp/s9_worker/s9_gap_v371.dex.jar"
            raise AssertionError(args)
        with patch.object(m,"adb",fake):
            self.assertEqual(m.phone_readiness(approved(),recorder_pid="1234"),"1234")

    def test_orphaned_app_process_prevents_new_frame(self):
        def fake(*args,**kwargs):
            if args==("get-state",):return "device"
            if args[1].startswith("pidof"):return "1234"
            if args[1]=="cat /proc/meminfo":return "MemAvailable: 2250000 kB\n"
            if args[1].startswith("df -k"):return "Filesystem Size Used Available Use%\nfoo 90000000 4000 60000000 4%\n"
            if args[1].startswith("ps -A"):
                return "PID ARGS\n4321 app_process -Djava.library.path=/data/local/tmp/s9_worker/lib /system/bin nl.kalenel.s9offline.S9Original4KGapAuditV370\n"
            raise AssertionError("phone probe reached unsafe step")
        with patch.object(m,"adb",fake),self.assertRaisesRegex(m.frames.Deferred,"already_running"):
            m.phone_readiness(approved())
    def test_observer_digest_checked_before_module_execution(self):
        marker=pathlib.Path(self.temp.name)/'imported.txt'
        # The string below is only a deliberately mismatched test fixture.
        untrusted=pathlib.Path(self.temp.name)/'observer-v373.py'
        untrusted.write_text("from pathlib import Path\nPath("+repr(str(marker))+ ").write_text('executed')\n")
        p=approved()
        p['observer_sha256']='f'*64
        self.write(p)
        with patch.object(m,'OBSERVER',untrusted):
            with self.assertRaisesRegex(m.frames.Deferred,'source_'):
                m.policy(self.file)
        self.assertFalse(marker.exists(),'unverified observer executed')

    def test_phone_probe_invokes_monitored_worker_not_blocking_adb(self):
        """No device: prove real phone_probe delegates to observer.supervise."""
        row={"clip_no":"motion_1792095266692.mp4",
             "source":"s9_original_4k_microsd","source_bytes":48831739,
             "source_sha256":H,"media_revision":"b"*64,
             "model_sha256":m.frames.MODEL_SHA,
             "native_pass":"s9_onphone_36_samples_overlapping_tiles_v5",
             "required_analysis":m.frames.ANALYSIS,"priority_reason":"no_indexed_image"}
        checked=[]
        report={"sample_count":1,"worker_vm_hwm_peak_kib":250000}
        def monitor(**kw):
            checked.append(kw)
            return m.PREFIX+'{"schema":"synthetic_only"}',report
        release=approved()
        release["protected_runtime_reserve_kib"]=512*1024
        with patch.object(m,'observer',m.importlib.import_module('s9_phone_first_peak_observer_v373')):
            with patch.object(m.observer,'supervise',side_effect=monitor):
                receipt=m.phone_probe(row,2000,60,release,recorder_pid="1234",
                                      camera_guard=lambda:None)
        self.assertEqual(receipt["schema"],"synthetic_only")
        self.assertEqual(len(checked),1)
        self.assertEqual(checked[0]["expected"][2],row["clip_no"])
        self.assertEqual(checked[0]["protected_runtime_reserve_kib"],512*1024)
        self.assertEqual(checked[0]["frame_budget_seconds"],60)

    def test_phone_monitor_failure_cannot_publish_partial(self):
        row={"clip_no":"motion_1792095266692.mp4",
             "source":"s9_original_4k_microsd","source_bytes":48831739,
             "source_sha256":H,"media_revision":"b"*64,
             "model_sha256":m.frames.MODEL_SHA,
             "native_pass":"s9_onphone_36_samples_overlapping_tiles_v5",
             "required_analysis":m.frames.ANALYSIS,"priority_reason":"no_indexed_image"}
        release=approved()
        release["protected_runtime_reserve_kib"]=512*1024
        from s9_phone_first_peak_observer_v373 import Unqualified
        with patch.object(m,'observer',m.importlib.import_module('s9_phone_first_peak_observer_v373')):
            with patch.object(m.observer,'supervise',side_effect=Unqualified("lost_peak")):
                with self.assertRaisesRegex(m.frames.Deferred,"unqualified"):
                    m.phone_probe(row,2000,60,release,recorder_pid="1234",
                                  camera_guard=lambda:None)

if __name__=="__main__":unittest.main()
