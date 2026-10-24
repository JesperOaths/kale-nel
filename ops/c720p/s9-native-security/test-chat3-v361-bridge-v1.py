"""Standalone read-only regression for Chat3's current V369 -> V361 route.

No recording, review, model, or phone side effects.
"""
import json
import pathlib
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'s9-person-ml-v1'))
from s9_anonymous_quality_http_adapter_v1 import accept,parse_request,SCHEMA,READER,PATH

NAME='motion_1792573997079.mp4'
class Consumer:
    SCHEMA=SCHEMA
    def __init__(self,status=200):self.status=status;self.count=0
    def consume(self,document,current,clip):
        self.count+=1
        if self.status!=200:
            return self.status,{'ok':False,'schema_version':SCHEMA,
                                'error':'source_revision_or_evidence_revoked'}
        return 200,dict(ok=True,schema_version=SCHEMA,clip_no=clip,
            verified_same_person=False,automatic_person_assignments=0,
            human_review_required=True,
            source_binding_status='revalidated_original_and_queue_at_consumption')
def reader(marker=READER):
    return (200,json.dumps(dict(ok=True,gap_reader_contract=marker,
            original_gap_benchmark={'recordings':[]})).encode())
class Tests(unittest.TestCase):
    def test_allowlist(self):
        self.assertEqual(parse_request(PATH+'?clip='+NAME),NAME)
        for u in [PATH,PATH+'?clip=wrong.mp4',PATH+'?clip='+NAME+'&x=1',
                  PATH+'?clip='+NAME+'#frag',PATH+'?clip='+NAME+'&clip='+NAME]:
            self.assertIsNone(parse_request(u))
    def test_current_200(self):
        c=Consumer();status,body=accept(NAME,lambda _:reader(),lambda:{},c)
        self.assertEqual(status,200);self.assertEqual(c.count,1)
        self.assertTrue(body['human_review_required'])
    def test_revocation_410(self):
        c=Consumer(410);status,_=accept(NAME,lambda _:reader(),lambda:{},c)
        self.assertEqual(status,410);self.assertEqual(c.count,1)
    def test_v369_old_handler_refused(self):
        c=Consumer();status,_=accept(NAME,lambda _:reader(None),lambda:{},c)
        self.assertEqual(status,503);self.assertEqual(c.count,0)
    def test_current_source_unavailable(self):
        status,_=accept(NAME,lambda _:reader(),lambda:None,Consumer())
        self.assertEqual(status,503)
    def test_invalid_400_no_read(self):
        def crash(_):raise AssertionError('unexpected read')
        status,_=accept('bad',crash,lambda:{},Consumer())
        self.assertEqual(status,400)
    def test_no_auto_identity(self):
        class Bad(Consumer):
            def consume(self,*args):
                code,body=super().consume(*args);body['verified_same_person']=True
                return code,body
        status,_=accept(NAME,lambda _:reader(),lambda:{},Bad())
        self.assertEqual(status,503)
if __name__=='__main__':unittest.main()
