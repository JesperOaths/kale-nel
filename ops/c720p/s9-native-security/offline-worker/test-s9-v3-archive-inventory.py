#!/usr/bin/env python3
"""Offline-only archive inventory integration: never turn identity guesses into approvals."""
import ast
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class ArchiveHistogramContract(unittest.TestCase):
    def test_v2_remains_approved_only_by_default(self):
        h=load("s9_hist_archive", "backfill-s9-hsv32-uniform-v2.py")
        self.assertFalse(h.inventory.__defaults__[0])
        source=Path(h.__file__).read_text()
        self.assertIn('mode="archive" if include_unreviewed else "approved"',source)
        self.assertIn('opts.include_unreviewed',source)
        self.assertIn('"archive_unassigned"',source)
        self.assertIn('if row["cohort"]!="v40":',source)

    def test_v3_uses_all_complete_real_crops_not_only_approved(self):
        source=(ROOT/"run-s9-uniform-appearance-rankings-v3.py").read_text()
        self.assertIn('module.inventory(include_unreviewed=True)',source)
        self.assertIn('"archive_unassigned"',source)
        self.assertIn('present=trusted_pair_presence(module,inventory)',source)
        self.assertIn('if not present(key,"hsv")',source)
        self.assertIn('if not present(key,"visual")',source)
        self.assertIn('phone_descriptor_presence_indeterminate',source)
        self.assertIn('module.safe_visual(key,crop)',source)
        self.assertIn('complete["hsv_sidecar_sha256"]=hsv_sha',source)
        self.assertIn('verified_v2_baseline(rows)',source)

    def test_unassigned_crop_provenance_without_identity_assertion(self):
        h=load("s9_hist_archive_sources","backfill-s9-hsv32-uniform-v2.py")
        import hashlib
        source="motion_1700000000000.mp4"
        key=hashlib.sha256(("s9_sd\x00"+source).encode()).hexdigest()
        class Old:
            def record_index(self):return {}
            def catalog_items(self):
                return [
                  {"clip":f"motion_{1700000001000+i*1000}.mp4",
                   "full_crop":{"sha256":f"{i+1:064x}"}}
                  for i in range(51)]
            def planned(self,items,index):
                return [
                    {"source":"s9_sd",
                     "source_key":hashlib.sha256("\x00".join(
                         ("s9_sd",x["clip"],x["full_crop"]["sha256"])).encode()).hexdigest(),
                     "crop_sha256":x["full_crop"]["sha256"],
                     "crop_name":f"crop{i}.jpg","crop_bytes":2048}
                    for i,x in enumerate(items)]
        class New:
            def primary_events(self):return {source:{"person_count":0}}
            def approved_names(self):return set()
            def candidates(self,events,approved,mode):
                return [(True,source,events[source])] if mode=="archive" else []
        def get_sibling(file,alias):return Old() if file.startswith("backfill-v40") else New()
        data={"schema":"s9_offline_single_person_roi_v1","source":"s9_sd",
              "source_clip":source,"source_qualified_key":key,
              "detector_sha256":h.DETECT,
              "identity_verified":False,"crop_sha256":"b"*64}
        with patch.object(h,"sibling",side_effect=get_sibling),\
             patch.object(h,"remote_exists",return_value=True),\
             patch.object(h,"phone_json",return_value=data):
            baseline=h.inventory()
            self.assertEqual(len(baseline),51)
            self.assertEqual({x["cohort"] for x in baseline},{"v40"})
            rows=h.inventory(include_unreviewed=True)
            self.assertEqual(len(rows),52)
            recovered=[row for row in rows if row["cohort"]=="archive_unassigned"]
            self.assertEqual(len(recovered),1)
            self.assertEqual(recovered[0]["cohort"],"archive_unassigned")
            self.assertEqual(recovered[0]["clip"],source)

if __name__=="__main__":unittest.main(verbosity=2)
