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
                    "folders":self.folders,"revision":"signed-snapshot-1"}
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

if __name__=="__main__":
    unittest.main(verbosity=2)
