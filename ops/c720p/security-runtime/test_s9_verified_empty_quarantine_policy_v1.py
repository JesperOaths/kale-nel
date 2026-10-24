#!/usr/bin/env python3
"""Isolated fixture regressions: no Android/HA or real recordings are touched."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock

PATH=Path(__file__).with_name("s9_verified_empty_quarantine_policy_v1.py")
def module():
    spec=importlib.util.spec_from_file_location("empty_fixture_policy",PATH)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.m=module()
        self.tmp=tempfile.TemporaryDirectory(prefix="s9-empty-fixture-")
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        (self.root/self.m.FIXTURE_MARKER).touch()
        (self.root/"Security4K").mkdir()
        self.name="motion_1791643920305.mp4"
        self.data=b"fake video data for deterministic fixture; no actual media"
        (self.root/"Security4K"/self.name).write_bytes(self.data)
        self.digest=hashlib.sha256(self.data).hexdigest()
        self.state={"scope":"S9_native_microSD","name":self.name,"evidence_revision":"EV1"}
        self.source={"name":self.name,"scope":"S9_native_microSD",
                     "sha256":self.digest,"revision":"REV1","duration_ms":10000,
                     "fully_finalized":True,"separate_preroll_tail_assets":False}
        self.evidence={"state":"verified_empty","source_sha256":self.digest,
             "source_revision":"REV1","evidence_revision":"EV1",
             "model_id":"owner-approved-fixture-model",
             "complete_video_decode":True,"every_decoded_frame_evaluated":True,
             "preroll_and_tail_covered":True,"no_processing_errors":True,
             "visibility_sufficient_everywhere":True,"all_temporal_windows_resolved":True,
             "any_confirmed_person":False,"any_credible_person":False,
             "any_possible_person":False,"decoded_frame_count":300,
             "analyzed_frame_count":300,
             "coverage_windows":[{"start_ms":0,"end_ms":10000,
                                  "person_absent_confidently":True}]}
        self.protection={k:False for k in self.m.REQUIRED_PROTECTION}
    def read(self):
        return self.state,self.source,self.evidence,self.protection
    def trust(self,e,s):
        return e.get("source_revision")==s.get("revision")
    def accept(self,**kw):
        return self.m.fixture_quarantine(self.root,self.name,self.read,
                  trusted_attestation=self.trust,
                  allowed_models={"owner-approved-fixture-model"},
                  shared_lock_contract=True,**kw)
    def rejected(self,reason=None):
        with self.assertRaises(self.m.Protected) as e:self.accept()
        if reason:self.assertIn(reason,str(e.exception))
        self.assertEqual((self.root/"Security4K"/self.name).read_bytes(),self.data)

    def test_verified_empty_fixture_can_quarantine_and_restore_exact_bytes(self):
        ticket=self.accept()
        self.assertEqual(ticket["state"],"quarantined")
        self.assertFalse((self.root/"Security4K"/self.name).exists())
        self.assertEqual((self.root/"private-quarantine"/self.name).read_bytes(),self.data)
        self.assertFalse(ticket["permanently_deleted"])
        r=self.m.fixture_restore(self.root,self.name)
        self.assertEqual(r["state"],"restored")
        self.assertEqual((self.root/"Security4K"/self.name).read_bytes(),self.data)

    def test_bounded_private_quarantine_and_audit_transition_history(self):
        with self.assertRaisesRegex(self.m.Protected,"quarantine_capacity"):
            self.accept(max_bytes=5)
        self.assertTrue((self.root/"Security4K"/self.name).exists())
        ticket=self.accept(max_items=1,max_bytes=1024)
        self.assertEqual([e["action"] for e in ticket["history"]],
                         ["intent","quarantined"])
        qdir=self.root/"private-quarantine"
        self.assertEqual(qdir.stat().st_mode & 0o777,0o700)
        restored=self.m.fixture_restore(self.root,self.name)
        self.assertEqual([e["action"] for e in restored["history"]],
                         ["intent","quarantined","restored"])

    def test_intent_directory_fsync_precedes_original_media_rename(self):
        events=[]
        original_replace=self.m.os.replace
        original_fsync=self.m.fsync_directory
        def replacement(old,new):
            events.append(("rename",str(new)))
            return original_replace(old,new)
        def sync(path):
            events.append(("fsync",str(path)))
            return original_fsync(path)
        with mock.patch.object(self.m.os,"replace",side_effect=replacement),\
             mock.patch.object(self.m,"fsync_directory",side_effect=sync):
            self.accept()
        qdir=self.root/"private-quarantine"
        journal=str(qdir/(self.name+".quarantine.json"))
        media=str(qdir/self.name)
        intent_index=events.index(("rename",journal))
        media_index=events.index(("rename",media))
        self.assertLess(intent_index,media_index)
        self.assertIn(("fsync",str(qdir)),events[intent_index+1:media_index])
        self.assertEqual((qdir/self.name).read_bytes(),self.data)

    def test_dangling_quarantine_target_does_not_get_overwritten(self):
        qdir=self.root/"private-quarantine"
        qdir.mkdir()
        target=qdir/self.name
        target.symlink_to(self.root/"nonexistent-elsewhere")
        self.rejected("existing_quarantine_or_journal")
        self.assertTrue(target.is_symlink())

    def test_quarantine_directory_symlink_is_refused(self):
        other=self.root/"other-fixture-directory"
        other.mkdir()
        (self.root/"private-quarantine").symlink_to(other,target_is_directory=True)
        self.rejected("quarantine_directory_symlink")
        self.assertEqual(list(other.iterdir()),[])

    def test_restoration_rejects_symlink_media_even_if_bytes_match(self):
        self.accept()
        qdir=self.root/"private-quarantine"
        target=qdir/self.name
        other=self.root/"unrelated-synthetic-media"
        other.write_bytes(self.data)
        target.unlink()
        target.symlink_to(other)
        with self.assertRaisesRegex(self.m.Protected,"restore_unsafe_media_path"):
            self.m.fixture_restore(self.root,self.name)
        self.assertFalse((self.root/"Security4K"/self.name).exists())
        self.assertEqual(other.read_bytes(),self.data)

    def test_restoration_rejects_symlinked_journal(self):
        self.accept()
        qdir=self.root/"private-quarantine"
        journal=qdir/(self.name+".quarantine.json")
        other=self.root/"synthetic-untrusted-ticket"
        other.write_bytes(journal.read_bytes())
        journal.unlink()
        journal.symlink_to(other)
        with self.assertRaisesRegex(self.m.Protected,"restore_unsafe_symlink"):
            self.m.fixture_restore(self.root,self.name)
        self.assertFalse((self.root/"Security4K"/self.name).exists())
        self.assertEqual((qdir/self.name).read_bytes(),self.data)

    def test_missing_matching_evidence_revision_must_not_pass(self):
        self.state.pop("evidence_revision")
        self.evidence.pop("evidence_revision")
        self.rejected("evidence_revision")
        self.state["evidence_revision"]="EV1"
        self.rejected("evidence_revision")
        self.evidence["evidence_revision"]="EV1"
        self.assertTrue(self.m.check(self.state,self.source,self.evidence,self.protection,
                       trusted_attestation=self.trust,
                       allowed_models={"owner-approved-fixture-model"}))

    def test_missing_model_id_must_not_pass_even_if_allowlist_has_none(self):
        self.evidence.pop("model_id")
        with self.assertRaisesRegex(self.m.Protected,"model_not_owner_approved"):
            self.m.fixture_quarantine(self.root,self.name,self.read,
                trusted_attestation=self.trust,allowed_models={None},
                shared_lock_contract=True)
        self.assertEqual((self.root/"Security4K"/self.name).read_bytes(),self.data)

    def test_restore_rejects_forged_state_and_schema(self):
        self.accept()
        journal=self.root/"private-quarantine"/(self.name+".quarantine.json")
        import json
        original=json.loads(journal.read_text())
        for override in ({"state":"permanently_deleted"},
                         {"schema":"unknown_archive_ticket"},
                         {"source_scope":"Google_Drive"},
                         {"evidence_revision":None}):
            fake=dict(original,**override)
            journal.write_text(json.dumps(fake)+"\\n")
            with self.assertRaisesRegex(self.m.Protected,"restore_ticket_invalid"):
                self.m.fixture_restore(self.root,self.name)
            self.assertFalse((self.root/"Security4K"/self.name).exists())
        journal.write_text(json.dumps(original)+"\\n")
        self.assertEqual(self.m.fixture_restore(self.root,self.name)["state"],"restored")

    def test_restore_is_idempotent_without_duplicate_history(self):
        self.accept()
        first=self.m.fixture_restore(self.root,self.name)
        second=self.m.fixture_restore(self.root,self.name)
        self.assertEqual(first["history"],second["history"])
        self.assertEqual([h["action"] for h in second["history"]],
                         ["intent","quarantined","restored"])
        self.assertEqual((self.root/"Security4K"/self.name).read_bytes(),self.data)

    def test_hardlinked_source_preserved(self):
        twin=self.root/"second-link-to-synthetic-original"
        import os
        os.link(self.root/"Security4K"/self.name,twin)
        self.rejected("original_missing_or_unsafe")
        self.assertEqual(twin.read_bytes(),self.data)

    def test_marker_symlink_and_live_directory_symlink_rejected(self):
        marker=self.root/self.m.FIXTURE_MARKER
        marker.unlink()
        real=self.root/"synthetic-marker-original"
        real.write_text("synthetic")
        marker.symlink_to(real)
        self.rejected("fixture_marker_required")
        marker.unlink()
        marker.touch()
        original=self.root/"Security4K"
        moved=self.root/"synthetic-live-dir"
        original.rename(moved)
        original.symlink_to(moved,target_is_directory=True)
        self.rejected("live_directory_not_a_real_directory")

    def test_confirmed_person_anywhere_is_never_quarantined(self):
        self.evidence["any_confirmed_person"]=True
        self.rejected("person_evidence")

    def test_credible_or_possible_person_protects(self):
        self.evidence["any_possible_person"]=True
        self.rejected("person_evidence")
        self.evidence["any_possible_person"]=False
        self.evidence["any_credible_person"]=True
        self.rejected("person_evidence")

    def test_uncertain_failed_and_unprocessed_never_quarantine(self):
        for status in ("person_present","uncertain_unprocessed","analysis_failed"):
            self.evidence["state"]=status
            self.rejected("uncertain")
        self.evidence["state"]="verified_empty"
        self.evidence["no_processing_errors"]=False
        self.rejected("full_coverage")

    def test_three_sampled_frames_never_prove_whole_recording_empty(self):
        self.evidence["decoded_frame_count"]=300
        self.evidence["analyzed_frame_count"]=3
        self.rejected("frames_incomplete")

    def test_preroll_tail_coverage_and_decode_gaps_block(self):
        self.evidence["coverage_windows"]=[{"start_ms":0,"end_ms":9000,"person_absent_confidently":True}]
        self.rejected("tail_not")
        self.evidence["coverage_windows"]=[
            {"start_ms":0,"end_ms":4500,"person_absent_confidently":True},
            {"start_ms":4600,"end_ms":10000,"person_absent_confidently":True},
        ]
        self.rejected("gap")
        self.evidence["preroll_and_tail_covered"]=False
        self.rejected("full_coverage")

    def test_low_visibility_blocks(self):
        self.evidence["visibility_sufficient_everywhere"]=False
        self.rejected("full_coverage")

    def test_stale_digest_or_source_replacement_blocks(self):
        self.evidence["source_revision"]="OLD"
        self.rejected("stale")
        self.evidence["source_revision"]="REV1"
        (self.root/"Security4K"/self.name).write_bytes(b"source replaced")
        with self.assertRaisesRegex(self.m.Protected,"original_bytes_changed"):self.accept()

    def test_human_save_group_review_or_hold_block(self):
        for field in ("saved","human_person_assignment","group_filed","protected",
                      "pending_review","active_review","evidence_retention",
                      "conflicting_analysis","unresolved_processing"):
            self.protection[field]=True
            self.rejected("protection")
            self.protection[field]=False

    def test_concurrent_save_wins_recheck(self):
        def save():self.protection["saved"]=True
        with self.assertRaisesRegex(self.m.Protected,"protection"):
            self.accept(precommit_hook=save)
        self.assertFalse((self.root/"private-quarantine"/(self.name+".quarantine.json")).exists())
        self.assertEqual((self.root/"Security4K"/self.name).read_bytes(),self.data)

    def test_recovery_after_interrupted_quarantine_rename(self):
        real=self.m.atomic_json
        n=[0]
        def write(path,data):
            n[0]+=1
            if n[0]==2:raise RuntimeError("simulated_crash_after_atomic_media_move")
            return real(path,data)
        with mock.patch.object(self.m,"atomic_json",side_effect=write):
            with self.assertRaisesRegex(RuntimeError,"simulated_crash"):
                self.accept()
        self.assertFalse((self.root/"Security4K"/self.name).exists())
        self.assertEqual((self.root/"private-quarantine"/self.name).read_bytes(),self.data)
        restored=self.m.fixture_restore(self.root,self.name)
        self.assertEqual(restored["state"],"restored")
        self.assertEqual((self.root/"Security4K"/self.name).read_bytes(),self.data)

    def test_unknown_model_attestation_or_lock_protects(self):
        with self.assertRaisesRegex(self.m.Protected,"lock_not_integrated"):
            self.m.fixture_quarantine(self.root,self.name,self.read,
                 trusted_attestation=self.trust,allowed_models={"owner-approved-fixture-model"},
                 shared_lock_contract=False)
        with self.assertRaisesRegex(self.m.Protected,"model_not_owner_approved"):
            self.m.fixture_quarantine(self.root,self.name,self.read,
                 trusted_attestation=self.trust,allowed_models={"some-other-model"},
                 shared_lock_contract=True)
        with self.assertRaisesRegex(self.m.Protected,"attestation_unverified"):
            self.m.fixture_quarantine(self.root,self.name,self.read,
                 trusted_attestation=lambda e,s:False,
                 allowed_models={"owner-approved-fixture-model"},shared_lock_contract=True)

    def test_real_world_paths_are_not_permitted_without_fixture_marker(self):
        (self.root/self.m.FIXTURE_MARKER).unlink()
        with self.assertRaisesRegex(self.m.Protected,"fixture_marker_required"):
            self.accept()

    def test_separate_preroll_or_unfinished_source_is_preserved(self):
        self.source["separate_preroll_tail_assets"]=True
        self.rejected("companions")
        self.source["separate_preroll_tail_assets"]=False
        self.source["fully_finalized"]=False
        self.rejected("finalization")

if __name__=="__main__":
    unittest.main(verbosity=2)
