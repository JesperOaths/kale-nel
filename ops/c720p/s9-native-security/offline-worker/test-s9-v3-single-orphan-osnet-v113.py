#!/usr/bin/env python3
"""No-phone S9 V3 single-crop OSNet recovery privacy and thermal tests."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
P=HERE/"run-s9-v3-single-orphan-osnet-v113.py"
S=importlib.util.spec_from_file_location("one_v40_visual_repair",P)
m=importlib.util.module_from_spec(S);S.loader.exec_module(m)

def inventory():
    rows=[]
    for i in range(58):
        rows.append({"key":f"{i+1:064x}",
            "clip":f"motion_{1700000000000+i*1000}.mp4",
            "crop_sha256":"b"*64,"source":"s9_sd",
            "cohort":"v40" if i<52 else "approved_new"})
    rows[57]["cohort"]="v40"
    return rows

class Resp:
    status=200
    def __init__(self,data):self.raw=json.dumps(data).encode()
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def read(self,n):return self.raw[:n]

def camera(**changes):
    d={"ok":True,"mode":"watching","temperature_c":38.9,
       "native_4k_enabled":True,"continuous_4k_production_persisted":True,
       "continuous_4k_ready":True,
       "preroll_version":"continuous_native_4k_h264_ring_v1",
       "continuous_4k_buffered_ms":6900,
       "continuous_4k_dropped_output_frames":0,
       "continuous_4k_error":""}
    d.update(changes);return d

class Tests(unittest.TestCase):
    def test_exactly_one_new_v40_histogram_only_crop(self):
        rows=inventory();baseline=[x["key"] for x in rows[:57]]
        # Exactly as the real h.inventory() V40 output: no "source" key.
        for row in rows:row.pop("source")
        paired=set(baseline)
        present=lambda key,kind:(key in paired if kind=="visual" else True)
        row=m.choose_orphan(rows,baseline,present)
        self.assertEqual(row["key"],rows[57]["key"])
        self.assertEqual(row["cohort"],"v40")
    def test_explicit_foreign_source_is_rejected(self):
        rows=inventory();baseline=[x["key"] for x in rows[:57]]
        rows[57]["source"]="gdrive_archive"
        with self.assertRaisesRegex(RuntimeError,"bad_source_qualified_crop"):
            m.choose_orphan(rows,baseline,lambda key,kind:(
                 key in baseline if kind=="visual" else True))

    def test_never_replace_missing_original_v2_embedding(self):
        rows=inventory();baseline=[x["key"] for x in rows[:57]]
        paired=set(baseline[1:])
        with self.assertRaisesRegex(RuntimeError,"historical_v2_reference_missing"):
            m.choose_orphan(rows,baseline,
                 lambda key,kind:(key in paired if kind=="visual" else True))
    def test_two_new_hsv_only_crops_recover_deterministically_one_per_window(self):
        rows=inventory();baseline=[x["key"] for x in rows[:57]]
        with self.assertRaisesRegex(RuntimeError,"no_pending_v40_histogram_only_crop"):
            m.choose_orphan(rows,baseline,lambda key,kind:True)
        extra={"key":"a"*64,"clip":"motion_1700009999000.mp4",
               "crop_sha256":"b"*64,"source":"s9_sd","cohort":"v40"}
        rows.append(extra)
        # First pass chooses the lower SHA key and does not attempt two crops.
        chosen=m.choose_orphan(rows,baseline,lambda key,kind:(
            key in baseline if kind=="visual" else True))
        self.assertEqual(chosen["key"],rows[57]["key"])
        # After the first real OSNet sidecar exists, the next window selects
        # only the second pending crop, never an already-complete one.
        paired=set(baseline+[chosen["key"]])
        self.assertEqual(
            m.choose_orphan(rows,baseline,
                lambda key,kind:(key in paired if kind=="visual" else True))["key"],
            extra["key"])
    def test_missing_both_features_is_a_real_pending_v40_visual(self):
        rows=inventory()
        baseline=[x["key"] for x in rows[:57]]
        # A newly extracted V40 JPEG has neither HSV32 nor OSNet yet.
        chosen=m.choose_orphan(rows,baseline,
            lambda key,kind:key in baseline)
        self.assertEqual(chosen["key"],rows[57]["key"])
        self.assertEqual(chosen["cohort"],"v40")
        # No synthetic HSV32 should be claimed when visual is recovered.
        body=P.read_text()
        self.assertIn('"hsv32_completion_still_pending":not has_hsv',body)
        self.assertIn('h.safe_visual(orphan["key"],orphan["crop_sha256"])',body)
        self.assertIn('digest=rank.existing_sha(visual)',body)

    def test_prefers_histogram_only_over_both_missing(self):
        rows=inventory()
        baseline=[x["key"] for x in rows[:57]]
        # A lexically earlier V40 missing both must not block a later crop
        # whose genuine HSV histogram is already complete.
        later=dict(rows[57])
        later["key"]="a"*64
        rows.append(later)
        def present(key,kind):
            return key in baseline or (key==later["key"] and kind=="hsv")
        self.assertEqual(m.choose_orphan(rows,baseline,present)["key"],later["key"])

    def test_refuse_approved_orphan_or_nonunique_crop(self):
        rows=inventory();rows[57]["cohort"]="approved_new"
        base=[x["key"] for x in rows[:57]]
        with self.assertRaisesRegex(RuntimeError,"orphan_is_not_unassigned_v40"):
            m.choose_orphan(rows,base,lambda key,kind:(
                key in base if kind=="visual" else True))
        class V40:
            def catalog_items(self):return []
            def record_index(self):return {}
            def planned(self,*args):
                return [{"source_key":rows[57]["key"],"source":"s9_sd",
                         "crop_sha256":"b"*64} for _ in range(2)]
        with self.assertRaisesRegex(RuntimeError,"v40_crop_provenance_mismatch"):
            m.choose_v40_source(V40(),rows[57])
    def test_camera_not_cool_and_native_4k_ready_is_refused(self):
        for changes,reason in (
            ({"temperature_c":40.8},"camera_too_warm"),
            ({"continuous_4k_ready":False},"4k_capture_not_idle_ready"),
            ({"mode":"recording"},"4k_capture_not_idle_ready"),
            ({"continuous_4k_buffered_ms":0},"4k_capture_not_idle_ready"),
            ({"continuous_4k_dropped_output_frames":1},"4k_capture_not_idle_ready"),
            ({"face_backfill_queued":True},"4k_capture_not_idle_ready"),
            ({"preroll_version":"legacy"},"4k_capture_not_idle_ready")):
            with self.subTest(changes=changes):
                with patch.object(m.urllib.request,"urlopen",
                     return_value=Resp(camera(**changes))):
                    with self.assertRaisesRegex(RuntimeError,reason):
                        m.healthy()
    def test_real_4k_ring_is_preroll_not_old_legacy(self):
        with patch.object(m.urllib.request,"urlopen",
            return_value=Resp(camera(preroll_ready=False))):
            self.assertTrue(m.healthy()["continuous_4k_ready"])
    def test_stage_marker_is_fixed_and_never_contains_clip_identity(self):
        for stage in ("camera_health","historical_v2_provenance",
                      "original_v40_crop_sha_provenance",
                      "one_actual_on_phone_osnet_inference",
                      "persisted_visual_and_hsv_sha_readback"):
            m.mark(stage)
            self.assertEqual(m.STAGE["value"],stage)
            self.assertNotIn("motion_",m.STAGE["value"])
        src=P.read_text()
        self.assertIn('"stage":STAGE["value"]',src)
        self.assertNotIn('traceback.print_exc(',src)
        self.assertNotIn('print(str(exc))',src)

    def test_idempotent_resume_never_rewrites_a_complete_vector(self):
        script=P.read_text()
        self.assertIn('mark("reconcile_preexisting_real_descriptor_pair")',script)
        self.assertIn('rank.verified_ready_subset(h,rows)',script)
        self.assertIn('rank.verified_v2_baseline(complete)',script)
        self.assertIn('"already_complete_readonly_reconciliation":True',script)
        self.assertIn('"new_osnet_sidecar_created":False',script)
        self.assertIn('WRITES["started"]=True',script)
        self.assertIn('"may_have_written_one_real_sidecar":WRITES["started"]',script)
        m.WRITES["started"]=False
        self.assertFalse(m.WRITES["started"])

    def test_cool_window_schedule_is_unique_and_staggered(self):
        wf=Path(__file__).resolve().parents[4]/".github/workflows/s9-v3-single-orphan-osnet-v113.yml"
        content=wf.read_text()
        self.assertIn("cron: '19 1,5,9,13,17,21 * * *'",content)
        self.assertIn("${GITHUB_RUN_ID}",content)
        self.assertIn("github.event_name == 'schedule'",content)
        self.assertIn("github.event_name == 'push'",content)
        self.assertIn("S9_V3_ORPHAN_OSNET_DEFERRED",content)

    def test_concurrent_archive_worker_is_a_safe_deferral(self):
        import tempfile
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory(prefix="s9-busy-v3-") as tmp:
            lock=m.LOCK
            m.LOCK=Path(tmp)/"archive.lock"
            try:
                with patch.object(m.shutil,"disk_usage",
                         return_value=SimpleNamespace(free=3_000_000_000)), \
                     patch.object(m.fcntl,"flock",
                         side_effect=BlockingIOError()), \
                     patch.object(m,"healthy") as camera:
                    with self.assertRaisesRegex(RuntimeError,
                                                "shared_archive_worker_busy"):
                        m.run(apply=True)
                    camera.assert_not_called()
            finally:
                m.LOCK=lock
        self.assertIn('"shared_archive_worker_busy"',P.read_text())

    def test_script_preserves_manual_evidence_and_no_auto_assign(self):
        src=P.read_text()
        for token in ("old.extract_one(old_source)",
                      'rank.verified_ready_subset(h,[orphan])',
                      "rank.BASELINE_V2_MAP",
                      "fcntl.LOCK_EX|fcntl.LOCK_NB",
                      "ctrl.approved_names()","ctrl.primary_events()",
                      "MAX_START_C=39.5","original_map.read_bytes()!=frozen_bytes"):
            self.assertIn(token,src)
        for forbidden in ("pm install","am force-stop","review_decide",
                          "auto_assign_person","delete_original",
                          'unlink(', "rank.publish_verified_active"):
            self.assertNotIn(forbidden,src)

if __name__=="__main__":unittest.main(verbosity=2)
