#!/usr/bin/env python3
"""No-media, no-network acceptance for the opt-in folder suggestion route."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
for name in ("folder_suggestion_engine", "folder_suggestion_api"):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name+".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
eng = sys.modules["folder_suggestion_engine"]
api = sys.modules["folder_suggestion_api"]


def feature(name):
    vec = [0.0] * 512
    vec[0] = 1.
    return {"source":"sd","clip_id":name,"media_sha256":"a"*64,
            "media_revision":"original-revision-1",
            "visual_model_id":"model-sha","structural_model_id":"face-sha",
            "visual_embedding":vec,"structural_crop_embedding":vec,
            "structural_aligned_verified":True}


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.journal=eng.ReviewJournal(Path(self.temp.name)/"decisions.json")
        self.a=feature("reference.mp4")
        self.b=feature("candidate.mp4")
        self.refs=[self.a,self.b]
        self.folders=[{"id":"P1"},{"id":"P2"}]
        self.index={"features_verified":True,"clips":self.refs,
                    "folders":self.folders,"revision":"signed-snapshot-1",
                    "historic_review_index_verified":True,
                    "historic_reviewed_keys":[]}
        self.provider=lambda:self.index
        self.known=eng.ClipFeatures.from_dict(self.a)
        self.journal.record(clip=self.known,folder_id="P1",action="approve",
                            expected_revision=0,opened_sha256=self.known.media_sha256,
                            opened_revision=self.known.media_revision,
                            authoritative_persisted=True,human_confirmed=True)
        self.journal.record(clip=self.known,folder_id="P2",action="approve",
                            expected_revision=1,opened_sha256=self.known.media_sha256,
                            opened_revision=self.known.media_revision,
                            authoritative_persisted=True,human_confirmed=True)
        self.calls=[]

    def body(self,action="approve", folder="P1"):
        return {"action":action,"source":"sd","clip_id":"candidate.mp4",
                "folder_id":folder,"media_sha256":"a"*64,
                "media_revision":"original-revision-1",
                "journal_revision":self.journal.read()["revision"],
                "feature_snapshot_revision":"signed-snapshot-1",
                "opened_ticket":"signed-session-ticket-123",
                "human_confirmed":True}

    def commit(self,**kw):
        self.calls.append(kw)
        return {"persisted":True,"media_verified":True,
                "source":kw["source"],"clip_id":kw["clip_id"],
                "folder_id":kw["folder_id"],
                "status":"approved" if kw["action"]=="approve" else "rejected"}

    def test_suggestion_snapshot_returns_no_vectors(self):
        result=api.snapshot(self.provider,self.journal)
        self.assertEqual(result["schema"],eng.SCHEMA)
        self.assertEqual(result["journal_revision"],2)
        self.assertEqual(result["raw_embeddings_exposed"],False)
        self.assertEqual(result["matches"][0]["state"],"pending_review")
        self.assertNotIn("visual_embedding",str(result))

    def test_only_attested_open_can_commit(self):
        body=self.body()
        denied=api.review(body,self.provider,self.journal,lambda *args:False,self.commit)
        self.assertEqual(denied[0],409)
        self.assertEqual(self.calls,[])
        self.assertEqual(self.journal.read()["revision"],2)
        ok=api.review(body,self.provider,self.journal,lambda *args:True,self.commit)
        self.assertEqual(ok[0],200)
        self.assertEqual(ok[1]["status"],"approved")
        self.assertEqual(self.journal.read()["revision"],3)
        self.assertEqual(len(self.calls),1)

    def test_reject_only_this_folder(self):
        status,receipt=api.review(self.body("reject"),self.provider,self.journal,
                                  lambda *args:True,self.commit)
        self.assertEqual(status,200)
        self.assertEqual(receipt["status"],"rejected")
        snapshot=api.snapshot(self.provider,self.journal)
        self.assertFalse(any(r["folder_id"]=="P1" and r["clip_id"]=="candidate.mp4"
                             for r in snapshot["matches"]))
        self.assertTrue(any(r["folder_id"]=="P2" and r["clip_id"]=="candidate.mp4"
                            for r in snapshot["matches"]))

    def test_stale_journal_or_media_blocks_review(self):
        bad=self.body()
        bad["media_revision"]="replaced-video"
        self.assertEqual(api.review(bad,self.provider,self.journal,
                         lambda *args:True,self.commit)[0],409)
        old=self.body()
        old["journal_revision"]=1
        self.assertEqual(api.review(old,self.provider,self.journal,
                         lambda *args:True,self.commit)[0],409)
        self.assertEqual(self.calls,[])

    def test_old_feature_snapshot_refuses_commit(self):
        stale=self.body()
        stale["feature_snapshot_revision"]="previous-model-revision"
        result=api.review(stale,self.provider,self.journal,
                          lambda *args:True,self.commit)
        self.assertEqual(result[0],409)
        self.assertEqual(result[1]["error"],"feature_snapshot_changed")
        self.assertEqual(self.calls,[])

    def test_feature_changed_while_attesting_original(self):
        def attest(*args):
            self.index={**self.index,"revision":"signed-snapshot-2"}
            return True
        result=api.review(self.body(),self.provider,self.journal,attest,self.commit)
        self.assertEqual(result[0],409)
        self.assertEqual(result[1]["error"],"original_changed_during_review")
        self.assertEqual(self.calls,[])

    def test_invalid_authoritative_receipt_never_creates_reference(self):
        bad_commit=lambda **kw:{"persisted":True,"media_verified":False}
        response=api.review(self.body(),self.provider,self.journal,
                            lambda *args:True,bad_commit)
        self.assertEqual(response[0],503)
        self.assertEqual(self.journal.read()["revision"],2)

    def test_no_automatic_install_without_hooks(self):
        class Fake:
            def go(self): pass
            def do_POST(self): pass
        with self.assertRaises(ValueError):
            api.install(Fake, self.provider, self.journal)
        self.assertEqual(Fake.go.__name__,"go")

    def test_cold_start_provisional_member_can_seed_first_approved_reference(self):
        # Historical media lacks decision-time digest binding; a new signed
        # original-open review must be able to bootstrap a named folder.
        cold = eng.ReviewJournal(Path(self.temp.name)/"cold-start.json")
        snap = api.snapshot(self.provider, cold)
        self.assertEqual(snap["approved_reference_counts"]["P1"], 0)
        members = [member for group in snap["provisional_clusters"]
                   for member in group["members"]]
        self.assertTrue(any(m["clip_id"] == "candidate.mp4" for m in members))
        body = self.body()
        body["journal_revision"] = 0
        status, result = api.review(body, self.provider, cold,
                                    lambda *args: True, self.commit)
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "approved")
        self.assertEqual(cold.read()["decisions"][0]["status"], "approved")
        self.assertEqual(api.snapshot(self.provider,cold)
                         ["approved_reference_counts"]["P1"], 1)
        self.assertEqual(len(self.calls), 1)

    def test_cold_start_still_requires_genuine_open_ticket(self):
        cold = eng.ReviewJournal(Path(self.temp.name)/"cold-reject.json")
        body = self.body("reject", folder="P2")
        body["journal_revision"] = 0
        outcome = api.review(body,self.provider,cold,
                             lambda *args: False,self.commit)
        self.assertEqual(outcome[0],409)
        self.assertEqual(cold.read()["revision"],0)

    def test_historic_review_index_never_reopens_assigned_clips(self):
        # The old 48 human decisions may lack review-time digest proof.
        # They are suppressed as already reviewed, but never used as vectors.
        self.index["historic_reviewed_keys"] = ["sd:candidate.mp4"]
        snap = api.snapshot(self.provider, self.journal)
        self.assertEqual(snap["suppressed_historical_reviewed_clips"],1)
        self.assertFalse(any(row["clip_id"] == "candidate.mp4"
                             for row in snap["matches"]))
        self.assertFalse(any(member["clip_id"] == "candidate.mp4"
                             for group in snap["provisional_clusters"]
                             for member in group["members"]))
        status, result = api.review(self.body(),self.provider,self.journal,
                                    lambda *args:True,self.commit)
        self.assertEqual(status,409)
        self.assertEqual(self.calls,[])

    def test_provider_must_verify_completeness_of_historic_review_index(self):
        self.index.pop("historic_review_index_verified")
        with self.assertRaises(ValueError):
            api.snapshot(self.provider,self.journal)
        status,_ = api.review(self.body(),self.provider,self.journal,
                              lambda *args:True,self.commit)
        self.assertEqual(status,503)
        self.assertEqual(self.calls,[])

class VectorIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.fx = ApiTest("test_suggestion_snapshot_returns_no_vectors")
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)

    def p1_only(self):
        import json
        fx=self.fx
        doc=fx.journal.read()
        doc["decisions"]=[x for x in doc["decisions"] if x["folder_id"]=="P1"]
        doc["revision"]=1
        fx.journal.path.write_text(json.dumps(doc))
        self.assertEqual(api.snapshot(fx.provider, fx.journal)["approved_reference_counts"], {"P1":1,"P2":0})

    def test_cosine_distance_rows(self):
        a=[1.0]+[0.0]*511
        b=[0.0,1.0]+[0.0]*510
        self.assertEqual(eng.calculate_matrix_distance(a,[a,b,[-v for v in a]]),(0.0,1.0,2.0))
        self.assertEqual(eng.calculate_matrix_distance(a,[]),())
        with self.assertRaises(ValueError):
            eng.calculate_matrix_distance([0.0]*512,[a])
        with self.assertRaises(ValueError):
            eng.calculate_matrix_distance(a,[[float("nan")]*512])

    def test_confirm_reassignment_adds_target_reference_immediately(self):
        self.p1_only()
        fx=self.fx
        self.assertEqual({m["folder_id"] for m in api.snapshot(fx.provider,fx.journal)["matches"]},{"P1"})
        code,result=api.review(fx.body(folder="P2"),fx.provider,fx.journal,lambda *a:True,fx.commit)
        self.assertEqual(code,200)
        self.assertTrue(result["reference_updated"])
        self.assertEqual(fx.calls[-1]["folder_id"],"P2")
        later=api.snapshot(fx.provider,fx.journal)
        self.assertEqual(later["approved_reference_counts"],{"P1":1,"P2":1})
        self.assertEqual(later["matches"],[])

    def test_reassigned_reject_only_suppresses_selected_folder(self):
        self.p1_only()
        fx=self.fx
        code,result=api.review(fx.body("reject",folder="P2"),fx.provider,fx.journal,lambda *a:True,fx.commit)
        self.assertEqual(code,200)
        self.assertFalse(result["reference_updated"])
        self.assertEqual(fx.calls[-1]["folder_id"],"P2")
        self.assertEqual(api.snapshot(fx.provider,fx.journal)["approved_reference_counts"],{"P1":1,"P2":0})
        self.assertTrue(any(m["folder_id"]=="P1" for m in api.snapshot(fx.provider,fx.journal)["matches"]))

    def test_reassignment_requires_original_ticket(self):
        self.p1_only()
        fx=self.fx
        self.assertEqual(api.review(fx.body(folder="P2"),fx.provider,fx.journal,
                                    lambda *a:False,fx.commit)[0],409)
        self.assertEqual(fx.calls,[])

    def test_invalid_folder_does_not_call_authoritative_writer(self):
        fx=self.fx
        self.assertEqual(api.review(fx.body(folder="missing"),fx.provider,fx.journal,
                                    lambda *a:True,fx.commit)[0],409)
        self.assertEqual(fx.calls,[])

if __name__=="__main__":
    unittest.main(verbosity=2)
