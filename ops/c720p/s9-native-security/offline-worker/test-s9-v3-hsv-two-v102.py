#!/usr/bin/env python3
"""No-device tests for two-crop phone HSV32 preservation and thermal gates."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

SRC=Path(__file__).with_name("run-s9-v3-hsv-two-v102.py")
spec=importlib.util.spec_from_file_location("v102_hsv",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class FakeResp:
    status=200
    def __init__(self,payload):self.data=json.dumps(payload).encode()
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def read(self,limit):return self.data[:limit]

def good_capture(**changes):
    status={"ok":True,"mode":"watching","native_4k_enabled":True,
            "continuous_4k_ready":True,"continuous_4k_buffered_ms":7000,
            "continuous_4k_production_persisted":True,
            "preroll_version":"continuous_native_4k_h264_ring_v1",
            "continuous_4k_dropped_output_frames":0,"continuous_4k_error":"",
            "continuous_4k_trial_active":True,"recording_active":False,
            "preroll_ready":False,"preroll_buffered_ms":0,
            "temperature_c":38.0}
    status.update(changes)
    return status

class FakeH:
    ROOT="/data/local/tmp/s9_worker"
    def __init__(self, temp=38.0, count=76, initially_missing=18):
        self.temp=temp
        self.pid="8088"
        self.rows=[{"key":f"{i+1:064x}","crop_sha256":"f"*64,
             "cohort":"v40" if i<70 else "approved_new"} for i in range(count)]
        self.cached={r["key"] for r in self.rows[initially_missing:]}
        self.visual={r["key"] for r in self.rows}
        self.verified=[]
        self.new=[]
    def adb(self, *argv, **kw):
        if argv[:2]==("shell","pidof nl.kalenel.s9security"):
            return SimpleNamespace(returncode=0,stdout=self.pid+"\n",stderr="")
        if argv[:2]==("shell","dumpsys battery"):
            return SimpleNamespace(returncode=0,stdout=f"temperature: {int(self.temp*10)}\n",stderr="")
        if argv[:2]==("shell","test -s "+self.ROOT+"/features/"):
            raise AssertionError("test -s call must contain exact key")
        if argv[0]=="shell" and argv[1].startswith("test -s "):
            match=argv[1].removeprefix("test -s ").removeprefix(self.ROOT+"/features/")
            if match.endswith("-hsv-v2.json"):
                found=match.removesuffix("-hsv-v2.json") in self.cached
            elif match.endswith("-visual.json"):
                found=match.removesuffix("-visual.json") in self.visual
            else:raise AssertionError("unexpected descriptor path")
            return SimpleNamespace(returncode=0 if found else 1,stdout="",stderr="")
        raise AssertionError("unexpected phone command "+str(argv))
    def inventory(self, include_unreviewed=False):
        assert include_unreviewed
        return list(self.rows)
    def safe_visual(self,key,cropsha):
        if (cropsha!="f"*64 or key not in self.visual
            or key not in {r["key"] for r in self.rows}):
            raise RuntimeError("forged_visual")
        self.verified.append(key)
        return True
    def v2_histogram(self,row):
        if row["key"] not in self.cached:
            self.new.append(row["key"])
            self.cached.add(row["key"])
        return "verified_histogram_and_osnet"

class FakeCtrl:
    def __init__(self):
        self.decisions={"approved"}
        self.originals={"motion_1700000000000.mp4":{}}
    def approved_names(self):return set(self.decisions)
    def primary_events(self):return dict(self.originals)

class Tests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory()
        self.old_lock=m.LOCK
        m.LOCK=Path(self.t.name)/"archive.lock"
        self.disk=patch.object(m.shutil,"disk_usage",return_value=SimpleNamespace(free=3_000_000_000))
        self.disk.start()
        self.http=patch.object(m.urllib.request,"urlopen",
             return_value=FakeResp(good_capture()))
        self.http.start()
    def tearDown(self):
        self.disk.stop()
        self.http.stop()
        m.LOCK=self.old_lock
        self.t.cleanup()
    def test_exact_two_real_sidecars_and_resume(self):
        h=FakeH()
        c=FakeCtrl()
        first=m.run(h,c)
        self.assertEqual(first["verified_crops"],76)
        self.assertEqual(first["missing_before"],18)
        self.assertEqual(first["new_verified_histograms"],2)
        self.assertEqual(first["missing_after"],16)
        self.assertEqual(len(h.new),2)
        self.assertFalse(first["private_identifiers_disclosed"])
        self.assertFalse(first["rankings_modified"])
        self.assertEqual(first["automatic_people_assigned"],0)
        self.assertEqual(len(h.verified),2)
        again=m.run(h,c)
        self.assertEqual(again["missing_before"],16)
        self.assertEqual(again["missing_after"],14)
        self.assertEqual(len(h.new),4)
    def test_missing_both_features_waits_for_real_osnet_first(self):
        h=FakeH()
        c=FakeCtrl()
        missing_visual=h.rows[0]["key"]
        h.visual.remove(missing_visual)
        # 18 histograms missing in total, only 17 backed by visual data.
        first=m.run(h,c)
        self.assertEqual(first["missing_before"],17)
        self.assertEqual(first["pending_real_visual_sidecars"],1)
        self.assertEqual(first["new_verified_histograms"],2)
        self.assertNotIn(missing_visual,h.new)
        # After the source-qualified ONNX worker actually produces the
        # visual sidecar, it becomes eligible in the next cool window.
        h.visual.add(missing_visual)
        second=m.run(h,c)
        self.assertIn(missing_visual,h.new)
        self.assertEqual(second["pending_real_visual_sidecars"],0)

    def test_no_visual_sidecar_never_generates_fake_hsv(self):
        h=FakeH(initially_missing=76)
        h.visual.clear()
        result=m.run(h,FakeCtrl())
        self.assertEqual(result["new_verified_histograms"],0)
        self.assertEqual(result["pending_real_visual_sidecars"],76)
        self.assertEqual(h.new,[])

    def test_warm_phone_prevents_phone_writes(self):
        h=FakeH(temp=41.6)
        with self.assertRaisesRegex(RuntimeError,"phone_warm"):
            m.run(h,FakeCtrl())
        self.assertEqual(h.new,[])
    def test_changed_pid_before_histogram_prevents_writes(self):
        h=FakeH()
        old=h.safe_visual
        def change(key,sha):
            h.pid="unknown"
            return old(key,sha)
        h.safe_visual=change
        with self.assertRaisesRegex(RuntimeError,"camera_pid_missing"):
            m.run(h,FakeCtrl())
        self.assertEqual(h.new,[])
    def test_refuses_hot_or_degraded_capture_without_descriptor_writes(self):
        for attrs,expected in [
          ({"temperature_c":41.5},"camera_too_warm"),
          ({"continuous_4k_ready":False},"camera_capture"),
          ({"continuous_4k_buffered_ms":1000},"camera_capture"),
          ({"preroll_version":"legacy_preroll"},"camera_capture"),
          ({"continuous_4k_production_persisted":False},"camera_capture"),
          ({"recording_active":True},"camera_capture"),
          ({"continuous_4k_dropped_output_frames":2},"camera_capture"),
          ({"mode":"restarting"},"camera_capture")]:
            with self.subTest(attrs=attrs):
                h=FakeH()
                with patch.object(m.urllib.request,"urlopen",
                                  return_value=FakeResp(good_capture(**attrs))):
                    with self.assertRaisesRegex(RuntimeError,expected):
                        m.run(h,FakeCtrl())
                self.assertEqual(h.new,[])
    def test_camera_guard_can_resume_after_stable_cool_buffer(self):
        with patch.object(m.urllib.request,"urlopen",
                          return_value=FakeResp(good_capture(
                            temperature_c=39.5,continuous_4k_buffered_ms=6000))):
            self.assertEqual(m.run(FakeH(temp=39.5),FakeCtrl())["new_verified_histograms"],2)

    def test_thermal_deferral_is_not_a_completed_batch(self):
        for reason in ("camera_too_warm_for_offline_processing",
                       "phone_warm_before_batch",
                       "phone_warm_before_descriptor",
                       "phone_thermal_post_limit",
                       "camera_capture_not_stably_ready"):
            marker,data,status=m.classify_abort(reason)
            self.assertEqual(marker,m.DEFER)
            self.assertEqual(status,0)
            self.assertIs(data["verified_batch_completed"],False)
            self.assertIs(data["intermediate_sidecars_may_have_been_written"],True)
            self.assertIs(data["private_output_suppressed"],True)
            self.assertNotIn("new_verified_histograms",data)

    def test_integrity_or_transport_failure_is_not_a_deferral(self):
        for reason in ("phone_transport_untrusted",
                       "previous crop /private/filename.mp4 invalid",
                       "hub_free_disk_guard"):
            marker,data,status=m.classify_abort(reason)
            self.assertEqual(marker,m.REJECT)
            self.assertEqual(status,2)
            self.assertIs(data["private_output_suppressed"],True)
            self.assertNotIn(".mp4",str(data))
            self.assertNotIn("new_verified_histograms",data)

    def test_source_key_validation_prevents_writes(self):
        h=FakeH()
        h.rows[0]["key"]="../bad"
        with self.assertRaisesRegex(RuntimeError,"invalid_source_qualified_key"):
            m.run(h,FakeCtrl())
        self.assertEqual(h.new,[])
    def test_indeterminate_adb_error_is_not_absence(self):
        h=FakeH()
        old=h.adb
        def err(*args,**kw):
            if args[0]=="shell" and args[1].startswith("test -s "):
                return SimpleNamespace(returncode=255,stderr="device offline",stdout="")
            return old(*args,**kw)
        h.adb=err
        with self.assertRaisesRegex(RuntimeError,"phone_transport_untrusted"):
            m.run(h,FakeCtrl())
        self.assertEqual(h.new,[])

if __name__=="__main__":unittest.main(verbosity=2)
