#!/usr/bin/env python3
"""Fail-closed regression for EXACT reconciled current live People V50/V320.

A future intentional UI upgrade must update the provenance hashes AND the
review-safety invariants together. This test never touches production services.
"""
import ast
import hashlib
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent
FILES={
    "security-people-v50.html":"b796e555e51651286a4ae99da5d27cb5ae03c2be",
    "security-people-v320.js":"d9cf5fb73db2ff7ce11da24fb3b2a28bfeac23bb",
}
def git_blob(data):
    return hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()

class LivePeopleSourceParity(unittest.TestCase):
    def test_preserved_live_byte_provenance(self):
        for file,expected in FILES.items():
            data=(ROOT/file).read_bytes()
            self.assertEqual(git_blob(data),expected,file)
    def test_current_route_and_review_controls(self):
        html=(ROOT/"security-people-v50.html").read_text()
        self.assertIn("security-people-v320.js?v=",html)
        self.assertNotIn('src="/local/frontyard-security-new/security-people-v45.js',html)
        for field in ('id="review"','id="clothing"','id="automatic"',
                      'id="approvalDialog"','id="approvalPlay"',
                      'id="viewer"','id="peopleRecheckNotice"'):
            self.assertIn(field,html)
    def test_source_isolation_and_anonymous_evidence_guards(self):
        js=(ROOT/"security-people-v320.js").read_text()
        for phrase in (
            "function assignmentKey(item)",
            "item.source==='drive'?'drive':'sd'",
            "if(item?.source==='drive')return null",
            "item?.source==='drive'?'':String(item?.clip||'')",
            "credibleFaceCrop(f)", "source_sha256",
            "qualifiedOutfitReference(item,personId=null)",
            "item?.source!=='sd'",
            "reviewed_view_changed_refresh",
            "review_changed_refresh_then_retry",
            "person_reference_eligible",
        ):
            if phrase=="person_reference_eligible":continue # produced by Task9, not yet live
            self.assertIn(phrase,js,phrase)
        self.assertIn("identity_probability!==false",js)
        self.assertIn("verified_same_person!==false",js)
        self.assertIn("appearance_only!==true",js)
    def test_v45_deployer_refuses_to_overwrite_v320(self):
        source=(ROOT/"deploy-people-v45.py").read_text()
        node=ast.parse(source)
        main=next(x for x in node.body if isinstance(x,ast.FunctionDef) and x.name=="main")
        found=[x for x in main.body if isinstance(x,ast.If) and
               'protected_live_people_v320_requires_versioned_deployer' in
               (ast.get_source_segment(source,x) or '')]
        self.assertEqual(len(found),1)
        gate=compile(ast.Module(body=found,type_ignores=[]),"<v320_old_deploy_guard>","exec")
        with self.assertRaisesRegex(RuntimeError,"protected_live_people_v320"):
            exec(gate,{"prior":{"people50":(b'<script src="security-people-v320.js">',None)}})
        exec(gate,{"prior":{"people50":(b'<script src="security-people-v45.js">',None)}})
        self.assertLess(source.index("protected_live_people_v320_requires_versioned_deployer"),
                        source.index("for k,source in ORIG.items():"))
if __name__=="__main__":
    unittest.main()
