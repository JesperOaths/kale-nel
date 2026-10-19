#!/usr/bin/env python3
"""Pure synthetic contract: no phone, recorder, file mutation or API actions."""
import hashlib
import hmac
import unittest
from s9_migrated_save_delete_contract_v181 import (ROOT,preview,
    canonical_receipt,validated_record,receipt_authorized,safe_aggregate,
    receipt_matches_current_journal_projection)
NAME="motion_1792200000000.mp4"
SHA="a"*64
ROWS={NAME:{"sd_path":ROOT+"/"+NAME,"sha256":SHA,
            "bytes":123456,"indexed":True}}
SECRET=b"synthetic-test-key-for-no-real-remotes-000001"
EVENT={"clip":"clips/"+NAME,"saved":False,"other":"must_survive"}

def make_receipt(action,*,status="s9_committed",durable=True,
                 sequence=1,head="e"*64):
    nonce="f"*32
    fields={"schema":"s9_c720p_migrated_action_v2",
            "status":status,"source":"s9_microsd","durable":durable,
            "action":action,"nonce":nonce,
            "ledger_sequence":sequence,"ledger_head_sha256":head}
    body=canonical_receipt(NAME,ROWS[NAME],action,nonce,
          status=status,source=fields["source"],durable=durable,
          ledger_sequence=sequence,ledger_head_sha256=head)
    return {**fields,
            "hmac_sha256":hmac.new(SECRET,body,hashlib.sha256).hexdigest()}

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
           {"hmac_sha256":"b"*64},{"ledger_sequence":2},
           {"ledger_head_sha256":"0"*64},{"schema":"s9_c720p_migrated_action_v1"}):
            with self.subTest(changes=changes):
                self.assertFalse(receipt_authorized(
                    {**good,**changes},NAME,ROWS[NAME],"delete",SECRET))
        self.assertFalse(receipt_authorized(good,NAME,ROWS[NAME],"save",SECRET))
        self.assertFalse(receipt_authorized(good,NAME,{**ROWS[NAME],"bytes":999999},
                                           "delete",SECRET))
        self.assertFalse(receipt_authorized(good,NAME,ROWS[NAME],"delete",b"weak"))
    def test_pending_receipt_cannot_be_relabelled_durable_or_committed(self):
        # A V1 HMAC did NOT cover these claim fields. V2 must cover all of
        # them even when the attacker supplies a legitimate pending HMAC.
        pending=make_receipt("save",status="pending",durable=False)
        self.assertFalse(receipt_authorized(
            pending,NAME,ROWS[NAME],"save",SECRET))
        forged={**pending,"status":"s9_committed","durable":True}
        self.assertFalse(receipt_authorized(
            forged,NAME,ROWS[NAME],"save",SECRET))
        self.assertEqual(preview(NAME,EVENT,ROWS,"save",
                 receipt=forged,secret=SECRET).status,"blocked")
        self.assertFalse(EVENT["saved"])

    def test_ledger_attestation_fields_must_be_signed_and_typed(self):
        valid=make_receipt("save")
        for edit in ({"ledger_sequence":0},{"ledger_sequence":True},
                     {"ledger_sequence":2**63},{"ledger_head_sha256":"z"*64},
                     {"ledger_head_sha256":"e"*63},
                     {"schema":"s9_c720p_migrated_action_v1"}):
            with self.subTest(edit=edit):
                self.assertFalse(receipt_authorized(
                    {**valid,**edit},NAME,ROWS[NAME],"save",SECRET))
        # The receipt is still only a synthetic claim, not a real durable
        # phone-side commit. Even a valid one never permits local unlink.
        result=preview(NAME,EVENT,ROWS,"save",receipt=valid,secret=SECRET)
        self.assertEqual(result.status,"shadow_only")
        self.assertFalse(result.may_remove_local_original)
        self.assertFalse(result.remote_mutation_executed)

    def test_signed_historical_save_is_not_current_after_later_delete(self):
        saved=make_receipt("save",sequence=1,head="e"*64)
        old_state={"ledgerIntegrityVerified":True,"mayRemoveOriginal":False,
         "name":NAME,"action":"save","sourceSha256":SHA,
         "sourceBytes":123456,"ledgerSequence":1,"ledgerHeadSha256":"e"*64}
        current_delete={**old_state,"action":"delete","ledgerSequence":2,
                        "ledgerHeadSha256":"d"*64}
        self.assertTrue(receipt_matches_current_journal_projection(
            saved,NAME,ROWS[NAME],"save",SECRET,old_state))
        self.assertFalse(receipt_matches_current_journal_projection(
            saved,NAME,ROWS[NAME],"save",SECRET,current_delete))
        current_receipt=make_receipt("delete",sequence=2,head="d"*64)
        self.assertTrue(receipt_matches_current_journal_projection(
            current_receipt,NAME,ROWS[NAME],"delete",SECRET,current_delete))
        # Cryptographically authentic old Save cannot change the tombstone.
        self.assertEqual(preview(NAME,EVENT,ROWS,"save",
                         receipt=saved,secret=SECRET).status,"shadow_only")
        self.assertFalse(EVENT["saved"])
    def test_latest_projection_must_match_every_ledger_and_media_field(self):
        saved=make_receipt("save")
        good={"ledgerIntegrityVerified":True,"mayRemoveOriginal":False,
            "name":NAME,"action":"save","sourceSha256":SHA,
            "sourceBytes":123456,"ledgerSequence":1,
            "ledgerHeadSha256":"e"*64}
        for change in ({"ledgerSequence":2},{"ledgerSequence":True},
          {"ledgerHeadSha256":"0"*64},{"ledgerIntegrityVerified":False},
          {"mayRemoveOriginal":True},{"sourceBytes":False},
          {"sourceBytes":123457},{"sourceSha256":"b"*64},
          {"name":"different.mp4"},{"action":"delete"}):
            with self.subTest(change=change):
                self.assertFalse(receipt_matches_current_journal_projection(
                  saved,NAME,ROWS[NAME],"save",SECRET,{**good,**change}))
        self.assertFalse(receipt_matches_current_journal_projection(
            saved,NAME,ROWS[NAME],"save",SECRET,None))
        self.assertFalse(receipt_matches_current_journal_projection(
            {**saved,"hmac_sha256":"f"*64},
            NAME,ROWS[NAME],"save",SECRET,good))
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
