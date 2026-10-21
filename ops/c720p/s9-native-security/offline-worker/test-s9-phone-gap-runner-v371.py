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
            "min_phone_mem_available_kib":200000,
            "min_phone_sd_free_bytes":20*1024**3,
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
        self.assertEqual(m.policy(self.file)["min_phone_mem_available_kib"],200000)
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
            if args[1]=="cat /proc/meminfo":return "MemAvailable: 500000 kB\n"
            if args[1].startswith("df -k"):return "Filesystem Size Used Available Use%\nfoo 1000 300 400 70%\n"
            raise AssertionError("unexpected staged phone command")
        with patch.object(m,"adb",fake),self.assertRaises(m.frames.Deferred):
            m.phone_readiness(approved())
    def test_pinned_jar_and_recorder_ready_synthetic(self):
        def fake(*args,**kwargs):
            if args==("get-state",):return "device"
            if args[1].startswith("pidof"):return "1234"
            if args[1]=="cat /proc/meminfo":return "MemAvailable: 500000 kB\n"
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
            if args[1]=="cat /proc/meminfo":return "MemAvailable: 500000 kB\n"
            if args[1].startswith("df -k"):return "Filesystem Size Used Available Use%\nfoo 90000000 4000 60000000 4%\n"
            if args[1].startswith("ps -A"):
                return "PID ARGS\n4321 app_process -Djava.library.path=/data/local/tmp/s9_worker/lib /system/bin nl.kalenel.s9offline.S9Original4KGapAuditV370\n"
            raise AssertionError("phone probe reached unsafe step")
        with patch.object(m,"adb",fake),self.assertRaisesRegex(m.frames.Deferred,"already_running"):
            m.phone_readiness(approved())
    def test_release_launch_matches_existing_jni_convention(self):
        row={"clip_no":"motion_1792095266692.mp4","source":"s9_original_4k_microsd",
             "source_bytes":48831739,"source_sha256":H,"media_revision":"b"*64,
             "model_sha256":m.frames.MODEL_SHA,
             "native_pass":"s9_onphone_36_samples_overlapping_tiles_v5",
             "required_analysis":m.frames.ANALYSIS,"priority_reason":"no_indexed_image"}
        seen=[]
        def fake(*args,**kwargs):
            seen.append(args)
            return m.PREFIX+'{"schema":"synthetic_only"}'
        with patch.object(m,"adb",fake):
            m.phone_probe(row,2000,60,approved())
        self.assertEqual(seen[0][0],"shell")
        self.assertIn("export LD_LIBRARY_PATH=",seen[0][1])
        self.assertIn("export CLASSPATH=",seen[0][1])
        self.assertIn("app_process -Djava.library.path=",seen[0][1])
        self.assertIn("--probe-one-frame motion_1792095266692.mp4",seen[0][1])
if __name__=="__main__":unittest.main()
