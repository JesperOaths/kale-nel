#!/usr/bin/env python3
"""Reject transport loss and malformed S9 batch presence responses, never invent data."""
import importlib.util
from pathlib import Path
import re
from types import SimpleNamespace
import unittest

SRC=Path(__file__).with_name("run-s9-v3-single-orphan-osnet-v113.py")
spec=importlib.util.spec_from_file_location("batched_verified_appearance",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def rows(n=82):
    return [{"key":f"{i+1:064x}","cohort":"v40","source":"s9_sd"}
            for i in range(n)]

class FakePhone:
    ROOT="/data/local/tmp/s9_worker"
    def __init__(self,wrong=None):
        self.calls=[]
        self.wrong=wrong
    def adb(self,operation,script,timeout=0,required=True):
        assert operation=="shell" and required is False
        assert timeout==45
        keys=re.findall(r"S9_PAIR_MASK_V1 ([a-f0-9]{64}) %s %s",script)
        self.calls.append(keys)
        if self.wrong=="offline":
            return SimpleNamespace(returncode=255,stderr="error: device offline",stdout="")
        if self.wrong=="permission":
            return SimpleNamespace(returncode=0,stderr="Permission denied",stdout="")
        if self.wrong=="partial":keys=keys[:-1]
        if self.wrong=="swapped" and len(keys)>1:keys=list(reversed(keys))
        if self.wrong=="unknown":keys=["f"*64]+keys[1:]
        if self.wrong=="badbit":
            return SimpleNamespace(returncode=0,stderr="",
                 stdout="\n".join(f"S9_PAIR_MASK_V1 {key} 2 0" for key in keys)+"\n")
        return SimpleNamespace(returncode=0,stderr="",
           stdout="\n".join(
             f"S9_PAIR_MASK_V1 {key} "
             f"{'0' if key==f'{82:064x}' else '1'} "
             f"{'0' if key==f'{82:064x}' else '1'}" for key in keys)+"\n")

class StrictPresenceTests(unittest.TestCase):
    def test_82_keys_read_in_four_bounded_phone_calls(self):
        h=FakePhone()
        inventory=rows(82)
        lookup=m.presence_inventory(h,inventory)
        self.assertEqual(len(h.calls),4)
        self.assertEqual([len(x) for x in h.calls],[24,24,24,10])
        self.assertTrue(lookup(inventory[0]["key"],"visual"))
        self.assertTrue(lookup(inventory[0]["key"],"hsv"))
        self.assertFalse(lookup(inventory[-1]["key"],"visual"))
        self.assertFalse(lookup(inventory[-1]["key"],"hsv"))
        with self.assertRaisesRegex(RuntimeError,"untrusted_descriptor_presence_lookup"):
            lookup("f"*64,"visual")
        with self.assertRaisesRegex(RuntimeError,"untrusted_descriptor_presence_lookup"):
            lookup(inventory[0]["key"],"unexpected")

    def test_full_400_record_limit_is_chunked_without_truncation(self):
        h=FakePhone()
        data=rows(400)
        fn=m.presence_inventory(h,data)
        self.assertEqual(len(h.calls),17)
        self.assertEqual(len(h.calls[-1]),16)
        self.assertTrue(all(len(x)<=24 for x in h.calls))
        self.assertTrue(fn(data[-1]["key"],"visual"))

    def test_device_disconnect_permission_and_short_reads_abort(self):
        for reason,error in (
            ("offline","indeterminate"),
            ("permission","indeterminate"),
            ("partial","incomplete"),
            ("swapped","untrusted"),
            ("unknown","untrusted"),
            ("badbit","untrusted")):
            with self.subTest(reason=reason):
                with self.assertRaisesRegex(RuntimeError,error):
                    m.presence_inventory(FakePhone(wrong=reason),rows(58))

    def test_invalid_key_duplicate_or_bad_root_never_contacts_phone(self):
        for data in (
          rows(57),
          rows(401),
          rows(58)+[rows(58)[0]],
          [{**x,"key":";rm -f /private"} if i==0 else x
           for i,x in enumerate(rows(58))],
        ):
            with self.subTest(size=len(data)):
                h=FakePhone()
                with self.assertRaisesRegex(RuntimeError,"invalid_"):
                    m.presence_inventory(h,data)
                self.assertEqual(h.calls,[])
        h=FakePhone()
        h.ROOT="/tmp/s9; echo exposed"
        with self.assertRaisesRegex(RuntimeError,"untrusted_phone_feature_root"):
            m.presence_inventory(h,rows(58))
        self.assertEqual(h.calls,[])

    def test_historical_reference_not_mistaken_for_missing_phone_sidecar(self):
        h=FakePhone()
        inventory=rows(82)
        lookup=m.presence_inventory(h,inventory)
        reference_keys=[x["key"] for x in inventory[:57]]
        chosen=m.choose_orphan(inventory,reference_keys,lookup)
        self.assertEqual(chosen["key"],inventory[-1]["key"])

if __name__=="__main__":
    unittest.main(verbosity=2)
