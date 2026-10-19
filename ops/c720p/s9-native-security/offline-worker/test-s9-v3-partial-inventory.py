#!/usr/bin/env python3
"""Regressions: V3 provisional rankings from old 57 + verified extras only."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from unittest import TestCase,main
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location(
    "s9_partial_rank_v3",ROOT/"run-s9-uniform-appearance-rankings-v3.py")
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)

def encode(doc):
    return (json.dumps(doc,sort_keys=True,separators=(",",":"))+"\n").encode()

def rows():
    result=[]
    for i in range(76):
        cohort="v40" if i<70 else "approved_new"
        result.append({
          "key":hashlib.sha256(("v3-"+str(i)).encode()).hexdigest(),
          "clip":f"motion_{1800000000000+i*1000}.mp4",
          "source":"s9_sd","crop_sha256":"1"*64,"cohort":cohort,
          "crop_name":"synthetic.jpg","crop_bytes":15000})
    return result

class FakeH:
    ROOT="/data/local/tmp/s9_worker"
    def __init__(self,items,missing,missing_visual=()):
        self.items=items;self.missing={x["key"] for x in missing}
        self.missing_visual={x["key"] for x in missing_visual}
        self.verified=0
        self.values={x["key"]:{"schema":m.SCHEMA,"source_qualified_key":x["key"],
          "crop_sha256":x["crop_sha256"],
          "method":"hue8_saturation2_value2_center_torso_v2",
          "verified_same_person":False,"identity_probability":False,
          "human_review_required":True,"upper_hsv32":[1.0]+[0.0]*31} for x in items}
    def remote_exists(self,path):
        if path.endswith("-visual.json") and any(key in path for key in self.missing_visual):
            return False
        return not any(key in path for key in self.missing)
    def safe_visual(self,key,crop):
        if crop!="1"*64:raise RuntimeError("tampered_OSNet")
        self.verified+=1
    def phone_json(self,path):
        key=path.rsplit("/",1)[1].removesuffix("-hsv-v2.json")
        return self.values[key]

class Partial(TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory=Path(self.tmp.name)
        self.catalog=rows()
        # 51 historical V40, 6 historical approved. 19 more V40 are new;
        # exactly one of the 19 has a verified histogram.
        self.legacy=self.catalog[:51]+self.catalog[70:]
        self.old_map={"schema":"s9_multivector_source_map_v2",
                      "visual_model_sha256":m.VISUAL,
                      "color_histogram_schema":m.SCHEMA,
                      "people_assigned_automatically":0,
                      "rows":[{k:x[k] for k in
                         ("key","clip","source","crop_sha256","cohort")}
                         for x in self.legacy]}
        self.file=self.directory/"s9-multivector-crop-map-v2.json"
        self.file.write_bytes(encode(self.old_map))
        self.original=m.BASELINE_V2_MAP
        m.BASELINE_V2_MAP=self.file
        self.addCleanup(setattr,m,"BASELINE_V2_MAP",self.original)

    def test_complete_58_of_76_can_be_used_without_overwriting_v2(self):
        missing=self.catalog[52:70]
        fake=FakeH(self.catalog,missing)
        with patch.object(m,"existing_sha",return_value="2"*64):
            subset=m.verified_ready_subset(fake,self.catalog)
        self.assertEqual(len(subset),58)
        self.assertEqual(fake.verified,58)
        self.assertEqual(len([x for x in subset if x["cohort"]=="v40"]),52)
        self.assertEqual(len([x for x in subset if x["cohort"]=="approved_new"]),6)
        self.assertEqual(m.verified_v2_baseline(subset),
                         m.digest(self.file.read_bytes()))
        self.assertEqual(len(self.catalog),76)
        self.assertTrue(all("hsv_sidecar_sha256" in x for x in subset))

    def test_missing_one_original_v2_reference_fails_closed(self):
        fake=FakeH(self.catalog,self.catalog[1:2])
        with patch.object(m,"existing_sha",return_value="2"*64):
            subset=m.verified_ready_subset(fake,self.catalog)
        with self.assertRaisesRegex(RuntimeError,"Missing or altered"):
            m.verified_v2_baseline(subset)

    def test_extra_verified_histogram_without_visual_stays_pending(self):
        # Physical job #11962 hit the extra V40 HSV-only file. Its visual
        # companion is legitimately absent, not corrupt. Keep all 57 old
        # V2 records and defer V3 until the extra 512-D sidecar exists.
        missing_hsv=self.catalog[52:70]
        one_missing_visual=self.catalog[51:52]
        fake=FakeH(self.catalog,missing_hsv,one_missing_visual)
        with patch.object(m,"existing_sha",return_value="2"*64):
            subset=m.verified_ready_subset(fake,self.catalog)
        self.assertEqual(len(subset),57)
        self.assertTrue(m.verified_v2_baseline(subset))
        self.assertEqual(fake.verified,57)

    def test_absent_visual_of_historic_v2_reference_not_silent(self):
        fake=FakeH(self.catalog,self.catalog[52:70],self.catalog[0:1])
        with patch.object(m,"existing_sha",return_value="2"*64):
            subset=m.verified_ready_subset(fake,self.catalog)
        with self.assertRaisesRegex(RuntimeError,"Missing or altered"):
            m.verified_v2_baseline(subset)

    def test_visual_transport_failure_must_not_look_missing(self):
        fake=FakeH(self.catalog,self.catalog[52:70])
        prior=fake.remote_exists
        def unreadable(path):
            if path.endswith("-visual.json"):
                raise RuntimeError("S9 sidecar presence indeterminate")
            return prior(path)
        fake.remote_exists=unreadable
        with patch.object(m,"existing_sha",return_value="2"*64):
            with self.assertRaisesRegex(RuntimeError,"indeterminate"):
                m.verified_ready_subset(fake,self.catalog)

    def test_existing_bad_descriptor_is_not_skipped(self):
        fake=FakeH(self.catalog,[])
        fake.values[self.catalog[0]["key"]]["upper_hsv32"]=[float("nan")]+[0.0]*31
        with patch.object(m,"existing_sha",return_value="2"*64):
            with self.assertRaisesRegex(RuntimeError,"Malformed existing"):
                m.verified_ready_subset(fake,self.catalog)

    def test_only_historically_invalid_source_does_not_get_ranked(self):
        fake=FakeH(self.catalog,self.catalog[51:70])
        with patch.object(m,"existing_sha",return_value="2"*64):
            ready=m.verified_ready_subset(fake,self.catalog)
        self.assertEqual(len(ready),57)
        self.assertTrue(m.verified_v2_baseline(ready))
        # Even though all 57 are valid, V3 requires at least one additional.
        self.assertLess(len(ready),58)

if __name__=="__main__":main(verbosity=2)
