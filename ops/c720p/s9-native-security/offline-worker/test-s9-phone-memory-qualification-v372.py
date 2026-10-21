#!/usr/bin/env python3
"""V372 deterministic no-phone tests; all measurements are synthetic."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

mod=Path(__file__).with_name("s9_phone_memory_qualification_v372.py")
spec=importlib.util.spec_from_file_location("t9qual",mod)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def healthy(pid="5789",available=2200000,hot=34.1,excluded=()):
    return {"recorder_pid":pid,
            "phone":{"total_kib":5755748,"available_kib":available,"swap_free_kib":400000},
            "recorder":{"rss_kib":254912,"peak_rss_kib":334812},
            "camera":{"camera_four_k_ready":hot<=34.5,"temperature_c":hot,
                      "active_exclusions":list(excluded)}}

class QualTests(unittest.TestCase):
    def test_budget_is_conservative_and_explicit(self):
        b=m.budget()
        self.assertGreaterEqual(b["enforced_provisional_phone_floor_kib"],1536*1024)
        self.assertGreater(b["computed_reservation_bytes"],m.PIXELS*4)
        self.assertIn("not_measured",b["classification"])
    def test_current_phone_feasible_but_never_certifies_inference(self):
        d=m.assess([healthy()]*3,950*1024,900*m.MIB)
        self.assertTrue(d["phone_static_envelope_pass"])
        self.assertTrue(d["existing_hub_guard_pass"])
        self.assertFalse(d["qualified_for_phone_inference"])
        self.assertFalse(d["actual_phone_onnx_codec_peak_rss_measured"])
    def test_camera_heat_and_exclusion_are_independent_failures(self):
        d=m.assess([healthy(hot=34.9,excluded=["historical_import_queued"])]*3,
                   750*1024,900*m.MIB)
        self.assertFalse(d["existing_hub_guard_pass"])
        self.assertFalse(d["existing_4k_thermal_guard_pass"])
        self.assertFalse(d["existing_worker_exclusions_clear"])
    def test_degraded_phone_reserve(self):
        d=m.assess([healthy(available=300000)]*3,1000*1024,900*m.MIB)
        self.assertFalse(d["phone_static_envelope_pass"])
    def test_missing_samples_fail(self):
        with self.assertRaises(RuntimeError):m.assess([healthy()],1000000,1000000000)
    def test_changed_recorder_pid_fail(self):
        with self.assertRaises(RuntimeError):m.assess(
            [healthy(),healthy(pid="6000"),healthy()],1000000,1000000000)
    def test_meminfo_validation(self):
        r=m.meminfo("MemTotal: 5755748 kB\nMemAvailable: 2215340 kB\nSwapFree: 400000 kB\n")
        self.assertEqual(r["available_kib"],2215340)
        with self.assertRaises(RuntimeError):m.meminfo("MemAvailable: 100 kB")
    def test_recorder_hwm_validation(self):
        r=m.recorder_status("VmRSS:\t254912 kB\nVmHWM:\t334812 kB\nRssAnon:\t94280 kB\n")
        self.assertEqual(r["peak_rss_kib"],334812)
        with self.assertRaises(RuntimeError):
            m.recorder_status("VmRSS: 400000 kB\nVmHWM: 300000 kB")
    def test_camera_guards(self):
        d={"ok":True,"mode":"watching","native_4k_enabled":True,
           "continuous_4k_ready":True,"continuous_4k_buffered_ms":8995,
           "continuous_4k_dropped_output_frames":0,"temperature_c":34.1,
           "face_backfill_queued":True}
        s=m.camera(d)
        self.assertFalse(s["camera_and_exclusion_ok"])
        self.assertIn("face_backfill_queued",s["active_exclusions"])
    def test_max_probes_not_extensible(self):
        events=[]
        sample=lambda:events.append("read") or healthy()
        sleeper=lambda n:events.append("sleep")
        self.assertEqual(len(m.obtain(sampler=sample,sleep=sleeper)),3)
        self.assertEqual(events,["read","sleep","read","sleep","read"])
        with self.assertRaises(ValueError):m.obtain(n=40)
        with self.assertRaises(ValueError):m.obtain(pause=0)
    def test_private_receipt_written_once(self):
        with tempfile.TemporaryDirectory() as path:
            p=Path(path)/"qualification.json"
            digest=m.write_receipt(p,{"qualified_for_phone_inference":False})
            self.assertEqual(len(digest),64)
            self.assertEqual(p.stat().st_mode&0o077,0)
            with self.assertRaises(RuntimeError):
                m.write_receipt(p,{"qualified_for_phone_inference":True})

if __name__=="__main__":unittest.main()
