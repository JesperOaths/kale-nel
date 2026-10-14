"""Exercise recording verification in isolated state; never writes production labels."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest import mock
from io import BytesIO

spec=importlib.util.spec_from_file_location('archive_review',Path(__file__).with_name('s9_archive_review_v32.py'))
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class ReviewTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
  self.a='motion_1791933495875.mp4';self.b='motion_1791934137487.mp4'
  self.rows={self.a:{'name':self.a,'size':123456,'sd_verified':True,'person_count':0},self.b:{'name':self.b,'size':234567,'sd_verified':True,'person_count':2}}
  self.patch=mock.patch.multiple(mod,STORE=self.root/'review.json',AUDIT=self.root/'audit.jsonl',FILE_LOCK=self.root/'review.lock',DRIVE_INDEX=self.root/'drive.json',_sd_rows=lambda:self.rows);self.patch.start()
  mod.DRIVE_INDEX.write_text(json.dumps({'items':[{'remote_name':'saved_2026-10-12.mp4','camera':'new','state':'verified','size':345678,'md5':'a'*32}]}))
 def tearDown(self):self.patch.stop();self.temp.cleanup()
 def ref(self,name=None,source='sd'):
  name=name or self.a;return {k:v for k,v in mod.report(source)['clips'][name].items() if k in ('source','name','revision')}
 def save(self,items=None,label='person',human=True):return mod.save_batch(items or [self.ref()],label,human)
 def test_no_model_or_thumbnail_prediction_counts_as_human_verification(self):
  result=mod.report();self.assertEqual(result['verified_people_clips'],0);self.assertEqual(result['counts']['unreviewed'],2);self.assertFalse(result['matching_started']);self.assertEqual(result['workflow'],'awaiting_owner_done')
 def test_single_and_bulk_whole_recording_labels_persist(self):
  self.assertEqual(self.save()[0],200);self.assertEqual(mod.report()['clips'][self.a]['label'],'person')
  self.assertEqual(self.save([self.ref(),self.ref(self.b)],'people')[1]['updated'],2)
  self.assertEqual(mod.report()['counts']['people'],2);self.assertEqual(mod.read_store()['labels']['sd:'+self.a]['scope'],'entire_recording');self.assertFalse(mod.report()['matching_started'])
 def test_clear_and_negative_review(self):
  self.save();self.save(label='no_people');self.assertEqual(mod.report()['verified_people_clips'],0)
  self.save(label='clear');self.assertIsNone(mod.report()['clips'][self.a]['label']);self.assertEqual(len(mod.AUDIT.read_text().splitlines()),3)
 def test_changed_file_invalidates_label_but_model_metadata_does_not(self):
  self.save();self.rows[self.a]['person_count']=8;self.rows[self.a]['thumbnail']='new.jpg';self.assertEqual(mod.report()['verified_people_clips'],1)
  self.rows[self.a]['size']+=1;self.assertEqual(mod.report()['verified_people_clips'],0)
 def test_stale_bulk_is_atomic(self):
  refs=[self.ref(),self.ref(self.b)];self.rows[self.b]['size']+=1
  self.assertEqual(self.save(refs)[0],409);self.assertFalse(mod.STORE.exists());self.assertEqual(mod.report()['verified_people_clips'],0)
 def test_non_archive_and_traversal_are_rejected(self):
  ref=self.ref();ref['name']='../secret.mp4';self.assertEqual(self.save([ref])[0],400)
  ref=self.ref();ref['name']='motion_1791933000000.mp4';self.assertEqual(self.save([ref])[0],404)
 def test_duplicates_and_oversized_batch(self):
  self.assertEqual(self.save([self.ref(),self.ref()])[0],400);self.assertEqual(self.save([self.ref()]*51)[0],400)
 def test_explicit_human_attestation_and_exact_reference_required(self):
  self.assertEqual(self.save(human=False)[0],400);self.assertEqual(self.save(label={'bad':'value'})[0],400)
  self.assertEqual(self.save([{**self.ref(),'unexpected':'yes'}])[0],400)
 def test_drive_labels_are_separate_and_bound_to_digest(self):
  name='saved_2026-10-12.mp4';reference=self.ref(name,'drive');self.assertEqual(self.save([reference],'people')[0],200)
  self.assertEqual(mod.report('drive')['verified_people_clips'],1);self.assertEqual(mod.report('sd')['verified_people_clips'],0)
  data=json.loads(mod.DRIVE_INDEX.read_text());data['items'][0]['md5']='b'*32;mod.DRIVE_INDEX.write_text(json.dumps(data));self.assertEqual(mod.report('drive')['verified_people_clips'],0)
 def test_audit_failure_restores_previous_registry(self):
  self.save();before=mod.STORE.read_bytes();mod.AUDIT=self.root/'missing'/'audit.jsonl'
  self.assertEqual(self.save(label='people')[0],503);self.assertEqual(mod.STORE.read_bytes(),before)
 def test_corrupt_registry_fails_closed(self):
  reference=self.ref();mod.STORE.write_text('corrupt');self.assertFalse(mod.report()['ok']);self.assertEqual(self.save([reference])[0],503)
 def test_new_people_api_is_gated_and_old_writes_are_locked(self):
  class Handler:
   path='/new/api/person-folders';headers={};command='GET'
   def go(self):raise AssertionError('Old identity report must not run')
   def do_POST(self):raise AssertionError('Old identity write must not run')
   def js(self,status,data):self.status=status;self.data=data
  mod.install(Handler,lambda:self.rows);h=Handler();h.go();self.assertEqual(h.status,200);self.assertEqual(h.data['profiles'],[]);self.assertFalse(h.data['matching_started'])
  h.path='/new/api/person-folders/review';h.do_POST();self.assertEqual(h.status,423)
 def test_http_write_guards_precede_any_state_change(self):
  class Handler:
   path='/new/api/archive-review/batch';headers={};rfile=BytesIO(b'{}')
   def go(self):pass
   def do_POST(self):pass
   def js(self,status,data):self.status=status;self.data=data
  mod.install(Handler,lambda:self.rows);h=Handler();h.do_POST();self.assertEqual(h.status,403)
  h.headers={'X-S9-Archive-Review-Intent':'human-recording-review-v32','Origin':'https://evil.example'};h.do_POST();self.assertEqual(h.status,403);self.assertFalse(mod.STORE.exists())

if __name__=='__main__':unittest.main(verbosity=2)
