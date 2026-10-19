#!/usr/bin/env python3
"""Pure synthetic contract: no phone, recorder, file mutation or API actions."""
import hashlib
import hmac
import unittest
from s9_migrated_save_delete_contract_v181 import (ROOT,preview,
    canonical_receipt,validated_record,receipt_authorized,safe_aggregate)
NAME="motion_1792200000000.mp4"
SHA="a"*64
ROWS={NAME:{"sd_path":ROOT+"/"+NAME,"sha256":SHA,
            "bytes":123456,"indexed":True}}
SECRET=b"synthetic-test-key-for-no-real-remotes-000001"
EVENT={"clip":"clips/"+NAME,"saved":False,"other":"must_survive"}

def make_receipt(action):
    nonce="f"*32
    return {"status":"s9_committed","source":"s9_microsd","durable":True,
            "action":action,"nonce":nonce,
            "hmac_sha256":hmac.new(SECRET,canonical_receipt(NAME,ROWS[NAME],
              action,nonce),hashlib.sha256).hexdigest()}

class Tests(unittest.TestCase):
    def test_verified_source_manifest(self):
        self.assertEqual(validated_record(NAME,ROWS)["bytes"],123456)
        for edited in ({"sha256":"x"},{"bytes":True},{"indexed":False},
                       {"sd_path":"/tmp/"+NAME}):
            with self.subTest(edited=edited),self.assertRaises(ValueError):
                validated_record(NAME,{NAME:{**ROWS[NAME],**edited}})
    def test_no_real_remote_receipt_never_changes_saved_or_delete(self):
        for action in ("save","delete"):
            before=dict(EVENT)
            result=preview(NAME,EVENT,ROWS,action)
            self.assertEqual(result.status,"blocked")
            self.assertFalse(result.may_remove_local_original)
            self.assertFalse(result.remote_mutation_executed)
            self.assertEqual(before,EVENT)
    def test_saved_shadow_requires_signed_durable_remote_ack(self):
        item=make_receipt("save")
        self.assertTrue(receipt_authorized(item,NAME,ROWS[NAME],"save",SECRET))
        outcome=preview(NAME,EVENT,ROWS,"save",receipt=item,secret=SECRET)
        self.assertEqual(outcome.status,"shadow_only")
        self.assertTrue(outcome.proposed_event["saved"])
        self.assertEqual(outcome.proposed_event["other"],"must_survive")
        self.assertFalse(outcome.may_remove_local_original)
        self.assertFalse(EVENT["saved"])
    def test_even_remote_deletion_ack_never_authorizes_local_prune(self):
        item=make_receipt("delete")
        outcome=preview(NAME,EVENT,ROWS,"delete",receipt=item,secret=SECRET)
        self.assertTrue(outcome.proposed_event["remote_deleted"])
        self.assertFalse(outcome.may_remove_local_original)
    def test_receipts_bound_to_action_nonce_source_sha_and_size(self):
        good=make_receipt("delete")
        for changes in ({"action":"save"},{"source":"other"},
           {"durable":False},{"status":"pending"},{"nonce":"0"*32},
           {"hmac_sha256":"b"*64}):
            with self.subTest(changes=changes):
                self.assertFalse(receipt_authorized(
                    {**good,**changes},NAME,ROWS[NAME],"delete",SECRET))
        self.assertFalse(receipt_authorized(good,NAME,ROWS[NAME],"save",SECRET))
        self.assertFalse(receipt_authorized(good,NAME,{**ROWS[NAME],"bytes":999999},
                                           "delete",SECRET))
        self.assertFalse(receipt_authorized(good,NAME,ROWS[NAME],"delete",b"weak"))
    def test_unsafe_names_and_actions_rejected(self):
        for n in ("../secret.mp4","bad/clip.mp4","",NAME+".exe"):
            with self.assertRaises(ValueError):validated_record(n,ROWS)
        with self.assertRaises(ValueError):preview(NAME,EVENT,ROWS,"erase")
        with self.assertRaises(ValueError):preview(NAME,{"clip":"other"},ROWS,"save")
    def test_aggregate_only_no_identifying_filenames(self):
        report=safe_aggregate([EVENT,{**EVENT,"saved":True}],ROWS)
        self.assertEqual(report["verified_remote_entries_in_legacy_catalog"],2)
        self.assertEqual(report["saved_local_flag_count"],1)
        self.assertFalse(report["legacy_local_video_removal_permitted"])
        self.assertNotIn(NAME,str(report))
    def test_no_production_mutation_capabilities(self):
        from pathlib import Path
        src=(Path(__file__).with_name("s9_migrated_save_delete_contract_v181.py")).read_text()
        for banned in ("subprocess", "unlink(", "rmtree(", "adb shell",
            "urlopen(", "open(", "write_bytes(", "send_response(", "os.remove("):
            self.assertNotIn(banned,src)
        self.assertIn('may_remove_local_original: bool=False',src)

if __name__=="__main__":unittest.main(verbosity=2)
