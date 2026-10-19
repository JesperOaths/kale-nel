#!/usr/bin/env python3
"""S9+ V3 ledger hygiene: real model successes are not permanent if cache vanished."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
path=ROOT/"run-s9-v3-resumable-archive.py"
spec=importlib.util.spec_from_file_location("s9_v3_audit_test",path)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def src(i):return f"motion_{1700000000000+i*1000}.mp4"
def proc(code=0,output="",error=""):
    return SimpleNamespace(returncode=code,stdout=output,stderr=error)

class Phone:
    ROOT="/data/local/tmp/s9_worker"
    def __init__(self,missing=None,offline=False):
        self.missing=set(missing or [])
        self.offline=offline
        self.touched=[]
    def adb(self,*args,**kwargs):
        self.touched.append(args)
        if len(args)>=2 and str(args[1]).startswith("pidof"):
            return proc(output="9341")
        if args[0]=="shell" and len(args)>1 and str(args[1]).startswith("test -s "):
            path=args[1].split("test -s ",1)[1]
            if self.offline:return proc(code=1,error="error: device offline")
            if path in self.missing:return proc(code=1)
            return proc()
        if args[0]=="exec-out":
            return proc(output=json.dumps({"visual_embedding":[1.0]+[0.0]*511}))
        raise AssertionError("Unexpected test ADB command "+str(args))
    def detector_provenance(self,clip,key,metadata):
        return "b"*64
    def valid_visual(self,doc,key,crop):
        return crop=="b"*64 and isinstance(doc.get("visual_embedding"),list)

class LedgerAudit(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.old=(m.STATE,m.LEDGER,m.AUDIT)
        m.STATE=Path(self.temp.name)
        m.LEDGER=m.STATE/"ledger.jsonl"
        m.AUDIT=m.STATE/"cursor.json"
        self.addCleanup(self.restore)
    def restore(self):
        m.STATE,m.LEDGER,m.AUDIT=self.old

    def test_missing_remote_sidecar_requeues_processed_clip(self):
        clip=src(1)
        key=hashlib.sha256(("s9_sd\x00"+clip).encode()).hexdigest()
        missing=Phone.ROOT+"/features/"+key+"-visual.json"
        ctrl=Phone(missing={missing})
        self.assertEqual(m.check_existing_feature(ctrl,clip),"missing_visual")
        m.append_ledger(clip,"new_real_512d_vector")
        previous=m.reviewed_ledger()
        audit=m.reconcile_ledger(ctrl,previous)
        self.assertEqual(audit,{"checked":1,"stale":1,
                                "reasons":{"missing_visual":1}})
        self.assertEqual(previous[clip],"stale_feature")
        self.assertEqual(m.reviewed_ledger()[clip],"stale_feature")
        self.assertTrue(m.AUDIT.is_file())
        self.assertEqual(m.reconcile_ledger(ctrl,previous)["checked"],0)

    def test_transport_failure_is_not_misreported_as_loss(self):
        clip=src(2)
        with self.assertRaisesRegex(RuntimeError,"ADB transport"):
            m.check_existing_feature(Phone(offline=True),clip)
        self.assertFalse(m.LEDGER.exists())

    def test_round_robin_audit_covers_all_previous_successes(self):
        records={src(i):"new_real_512d_vector" for i in range(5)}
        first=m.reconcile_ledger(Phone(),records,max_checks=2)
        second=m.reconcile_ledger(Phone(),records,max_checks=2)
        third=m.reconcile_ledger(Phone(),records,max_checks=2)
        self.assertEqual([first["checked"],second["checked"],third["checked"]],[2,2,2])
        self.assertEqual([x["stale"] for x in (first,second,third)],[0,0,0])
        self.assertEqual(json.loads(m.AUDIT.read_text())["last_clip"],src(0))

    def test_worker_cannot_assert_stale_as_success(self):
        accepted={"attempted":1,"counts":{"already_verified":1},
                  "human_review_required":True,"recordings_modified":False,
                  "camera_apk_modified":False,"review_decisions_modified":False}
        self.assertEqual(m.single_status(accepted),"already_verified")
        accepted["counts"]={"stale_feature":1}
        with self.assertRaisesRegex(RuntimeError,"Untrusted"):
            m.single_status(accepted)

    def test_other_sources_are_rejected_from_ledger(self):
        m.LEDGER.write_text(json.dumps({"source":"gdrive_archive",
           "clip":src(2),"status":"already_verified"})+"\n")
        with self.assertRaisesRegex(RuntimeError,"Invalid"):
            m.reviewed_ledger()

if __name__=="__main__":unittest.main(verbosity=2)
