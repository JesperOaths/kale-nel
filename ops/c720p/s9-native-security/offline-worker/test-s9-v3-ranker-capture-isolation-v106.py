#!/usr/bin/env python3
"""Source-only regression for physical S9 V3 cool-ring ranker isolation."""
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SRC=Path(__file__).with_name("run-s9-uniform-appearance-rankings-v3.py")
SPEC=importlib.util.spec_from_file_location("v3_cool_rank_safety",SRC)
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)

class Response:
    status=200
    def __init__(self,data):self.raw=json.dumps(data).encode()
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def read(self,maximum):return self.raw[:maximum]

def status(**kwargs):
    data={"ok":True,"mode":"watching","temperature_c":38.5,
          "native_4k_enabled":True,"continuous_4k_ready":True,
          "continuous_4k_production_persisted":True,
          "preroll_version":"continuous_native_4k_h264_ring_v1",
          "continuous_4k_buffered_ms":7000,
          "continuous_4k_dropped_output_frames":0,"continuous_4k_error":"",
          "face_backfill_queued":False,"historical_import_queued":False,
          "movement_4k_backfill_queued":False,"appearance_backfill_queued":False,
          "garden_archive_triage_queued":False}
    data.update(kwargs)
    return data

class RankerSafety(unittest.TestCase):
    def setUp(self):
        d=tempfile.TemporaryDirectory(prefix="s9-v3-ranked-safety-")
        self.addCleanup(d.cleanup)
        self.original=m.STATE_DIR
        m.STATE_DIR=Path(d.name)
        self.addCleanup(setattr,m,"STATE_DIR",self.original)

    def validate(self,data):
        with patch.object(m.urllib.request,"urlopen",return_value=Response(data)):
            return m.capture_rank_safe()

    def test_verified_production_4k_ring_without_legacy_preroll(self):
        self.assertEqual(self.validate(status(preroll_ready=False,
                    preroll_buffered_ms=0))["mode"],"watching")

    def test_capture_guard_denies_warm_or_degraded_condition(self):
        for changes,reason in (
          ({"temperature_c":41.6},"capture_too_warm"),
          ({"temperature_c":39.6},"capture_too_warm"),
          ({"mode":"recording"},"capture_not_idle"),
          ({"continuous_4k_ready":False},"capture_not_idle"),
          ({"continuous_4k_buffered_ms":4000},"capture_not_idle"),
          ({"continuous_4k_dropped_output_frames":1},"capture_not_idle"),
          ({"preroll_version":"legacy"},"capture_not_idle"),
          ({"face_backfill_queued":True},"capture_not_idle"),
          ({"appearance_backfill_queued":True},"capture_not_idle"),
          ({"historical_import_queued":True},"capture_not_idle"),
          ({"garden_archive_triage_queued":True},"capture_not_idle")):
            with self.subTest(changes=changes):
                with self.assertRaisesRegex(RuntimeError,reason):
                    self.validate(status(**changes))

    def test_readiness_gates_before_work_or_phone_ranking(self):
        with patch.object(sys,"argv",["runner.py","--apply"]), \
             patch.object(m,"capture_rank_safe",
                          side_effect=RuntimeError("capture_too_warm_for_ranker")), \
             patch.object(m,"phone_temperature_c") as battery, \
             patch.object(m,"rank") as rank:
            with self.assertRaisesRegex(RuntimeError,"capture_too_warm"):
                m.run()
            battery.assert_not_called()
            rank.assert_not_called()

    def test_only_once_locked_phone_work_and_dryrun_no_lock(self):
        with patch.object(sys,"argv",["runner.py","--apply"]), \
             patch.object(m,"capture_rank_safe",return_value=status()) as guard, \
             patch.object(m,"phone_temperature_c",return_value=38.4), \
             patch.object(m,"rank",return_value=123) as rank:
            self.assertEqual(m.run(),123)
            self.assertEqual(guard.call_count,1)
            self.assertTrue(rank.call_args.args[0].apply)
        with patch.object(sys,"argv",["runner.py"]), \
             patch.object(m,"capture_rank_safe") as guard, \
             patch.object(m,"rank",return_value=5) as rank:
            self.assertEqual(m.run(),5)
            guard.assert_not_called()
            self.assertFalse(rank.call_args.args[0].apply)

    def test_active_archive_lock_refuses_competing_ranker(self):
        m.STATE_DIR.mkdir(exist_ok=True)
        lock_path=m.STATE_DIR/"s9-v3-archive-backfill.lock"
        fd=os.open(lock_path,os.O_RDWR|os.O_CREAT,0o600)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with patch.object(sys,"argv",["runner.py","--apply"]), \
                 patch.object(m,"capture_rank_safe") as guard, \
                 patch.object(m,"rank") as rank:
                with self.assertRaises(BlockingIOError):
                    m.run()
                guard.assert_not_called()
                rank.assert_not_called()
        finally:
            os.close(fd)

    def test_source_never_controls_camera_or_person_assignments(self):
        code=SRC.read_text()
        for unsafe in ("pm install","am force-stop","delete_original",
                       "review_decide","assign_person", "CameraService.java"):
            self.assertNotIn(unsafe,code)
        self.assertIn('rank(args)',code)
        self.assertIn('fcntl.LOCK_EX|fcntl.LOCK_NB',code)
        self.assertIn('capture_rank_safe()',code)

if __name__=="__main__":unittest.main(verbosity=2)
