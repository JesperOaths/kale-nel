#!/usr/bin/env python3
"""Fail-closed V3 ranker batch-presence tests, without ADB or private vectors."""
import hashlib
import importlib.util
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("s9_v3_ranker_batch_v192",
    HERE/"run-s9-uniform-appearance-rankings-v3.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def rows(count=82):
    return [{"key":hashlib.sha256(f"private-test-{i}".encode()).hexdigest(),
             "clip":f"motion_{1700000000000+i*1000}.mp4",
             "crop_sha256":"f"*64,
             "cohort":"v40" if i<75 else "approved_new"} for i in range(count)]

class Phone:
    ROOT=m.ROOT
    def __init__(self,items,missing=(),malformed=False,stderr=""):
        self.items=items
        self.missing=set(missing)
        self.malformed=malformed
        self.stderr=stderr
        self.calls=0
        self.visited=[]
    def adb(self,op,script,timeout,required=False):
        assert op=="shell" and required is False and timeout<=45
        self.calls+=1
        keys=re.findall(r"S9_PAIR_MASK_V1 ([a-f0-9]{64})",script)
        self.visited.extend(keys)
        lines=[]
        for key in keys:
            v="0" if (key,"visual") in self.missing else "1"
            h="0" if (key,"hsv") in self.missing else "1"
            lines.append(f"S9_PAIR_MASK_V1 {key} {v} {h}")
        if self.malformed and lines:
            lines[-1]=lines[-1].replace("S9_PAIR_MASK_V1","WRONG")
        return SimpleNamespace(returncode=0,
            stderr=self.stderr,stdout="\n".join(lines)+"\n")
    def safe_visual(self,key,crop):
        assert crop=="f"*64
    def phone_json(self,path):
        key=path.split("/")[-1].removesuffix("-hsv-v2.json")
        return {"schema":m.SCHEMA,"source_qualified_key":key,
                "crop_sha256":"f"*64,
                "method":"hue8_saturation2_value2_center_torso_v2",
                "verified_same_person":False,"identity_probability":False,
                "human_review_required":True,
                "upper_hsv32":[1.0]+[0.0]*31}

class Tests(unittest.TestCase):
    def test_82_crops_four_phone_roundtrips_with_63_complete(self):
        source=rows()
        pending={(r["key"],"visual") for r in source[63:]}
        h=Phone(source,pending)
        with patch.object(m,"existing_sha",return_value="a"*64):
            verified=m.verified_ready_subset(h,source)
        self.assertEqual(len(verified),63)
        self.assertEqual(h.calls,4)
        self.assertEqual(h.visited,[r["key"] for r in source])
        self.assertTrue(all(x["visual_sidecar_sha256"]=="a"*64 for x in verified))
    def test_upper_400_bound_is_17_adb_calls(self):
        source=rows(400)
        p=Phone(source)
        present=m.trusted_pair_presence(p,source)
        self.assertEqual(p.calls,17)
        self.assertTrue(all(present(r["key"],"hsv") for r in source))
        self.assertEqual(len(p.visited),400)
    def test_forged_batch_and_transport_stderr_fail_closed(self):
        source=rows()
        for kw in ({"malformed":True},{"stderr":"permission denied"}):
            with self.subTest(kw=kw):
                p=Phone(source,**kw)
                with self.assertRaisesRegex(RuntimeError,
                       "phone_descriptor_presence_(untrusted|indeterminate)"):
                    m.trusted_pair_presence(p,source)
    def test_duplicate_source_digest_never_silently_dropped(self):
        source=rows()
        source[10]["key"]=source[0]["key"]
        with self.assertRaisesRegex(RuntimeError,"duplicate_source_qualified_key"):
            m.trusted_pair_presence(Phone(source),source)
    def test_missing_hsv_and_visual_both_deferred_not_fabricated(self):
        source=rows()
        missing={(source[62]["key"],"hsv"),
                 (source[63]["key"],"visual")}
        p=Phone(source,missing)
        with patch.object(m,"existing_sha",return_value="b"*64):
            complete=m.verified_ready_subset(p,source)
        self.assertEqual(len(complete),80)
        self.assertTrue(all(r["key"] not in {source[62]["key"],source[63]["key"]}
                            for r in complete))
    def test_still_demands_full_visual_and_histogram_checks(self):
        text=(HERE/"run-s9-uniform-appearance-rankings-v3.py").read_text()
        for exact in ('module.safe_visual(key,crop)',
                      'hsv=module.phone_json(hsv_path)',
                      'visual_sha=existing_sha(',
                      'hsv_sha=existing_sha(',
                      'verified_v2_baseline(rows)',
                      'capture_rank_safe()',
                      'fcntl.LOCK_EX|fcntl.LOCK_NB'):
            self.assertIn(exact,text)
        self.assertNotIn("auto_assign_person(",text)

if __name__=="__main__":
    unittest.main(verbosity=2)
