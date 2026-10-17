import contextlib,importlib.util,unittest,json,copy
from pathlib import Path
HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('folders_test',HERE/'test-folder-review-v40.py');old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
class AppearanceTests(unittest.TestCase):
 def setUp(self):
  self.h=old.FolderReviewTests();self.h.setUp();self.v=self.h.v
  self.v.atomic(self.v.ROOT/'appearance-groups-v43-enabled.json',{'enabled':True})
 def tearDown(self):self.h.tearDown()
 def report(self,**q):return self.h.report(**q)
 def counts(self):
  with contextlib.closing(self.v.db()) as c:return {t:c.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in ('folders','reviews','audit','folder_clips_v40')}
 def test_similar_clothing_gets_one_persistent_unapproved_folder(self):
  self.h.add_clip(1);report=self.report();group=report['folders'][0]
  self.assertEqual(len(report['folders']),1);self.assertEqual(group['suggested_clips'],2)
  self.assertTrue(group['automatic_appearance_group']);self.assertEqual(group['approved_clips'],0)
  self.assertEqual(self.counts(),{'folders':1,'reviews':0,'audit':0,'folder_clips_v40':0})
  again=self.report();self.assertEqual(again['folders'][0]['id'],group['id']);self.assertEqual(again['revision'],report['revision'])
 def test_distinct_colours_get_separate_folders(self):
  self.h.add_clip(1,'red');self.assertEqual(len(self.report()['folders']),2)
 def test_similar_colour_chain_cannot_bridge_incompatible_endpoints(self):
  self.h.add_clip(1);self.h.add_clip(2);catalog=self.v.index()
  for i,m in enumerate(sorted(catalog['items'].values(),key=lambda m:m['name'])):
   hist=([1.,0.] if i==0 else [.9,.1] if i==1 else [.5,.5])+[0.]*30
   for key in ('upper_hsv32','lower_hsv32'):m['tracks'][0][key]=hist
  self.v.atomic(self.v.ROOT/'catalog.json',catalog)
  self.assertEqual(sorted(f['suggested_clips'] for f in self.report()['folders']),[1,2])
 def test_approve_is_explicit_and_pending_rejection_persists(self):
  self.h.add_clip(1);group=self.report()['folders'][0]['id'];items=self.report(folder=group,tab='suggestions')['items']
  self.assertEqual(self.h.action('approve_clip',items[0],folder=group)[0],200)
  self.assertEqual(self.h.action('reject_clip',items[1],folder=group)[0],200)
  for _ in range(3):
   self.assertEqual(self.report(folder=group,tab='suggestions')['total'],0)
   self.assertEqual(self.report(folder=group,tab='approved')['total'],1)
   self.assertEqual(self.report(folder=group,tab='rejected')['total'],1)
  self.assertEqual(self.counts()['audit'],2)
 def test_rename_is_human_and_survives_rebuild(self):
  group=self.report()['folders'][0]['id']
  code,_=self.v.edit({'action':'edit_folder','folder':group,'label':'Jesper','note':'Chosen by owner','revision':self.report()['revision'],'human_confirmed':True});self.assertEqual(code,200)
  self.assertEqual(self.report()['folders'][0]['label'],'Jesper')
 def test_human_approved_folders_untouched(self):
  # Seed manually before enabling proposal generation.
  (self.v.ROOT/'appearance-groups-v43-enabled.json').unlink();group=self.h.seed();self.h.add_clip(1)
  before=self.counts();self.v.atomic(self.v.ROOT/'appearance-groups-v43-enabled.json',{'enabled':True});report=self.report()
  self.assertEqual(self.counts()['reviews'],before['reviews']);self.assertEqual(self.counts()['audit'],before['audit'])
  self.assertEqual(self.report(folder=group,tab='approved')['total'],1)
  self.assertEqual(len(report['folders']),2)
 def test_revoked_clips_not_grouped(self):
  self.h.h.labels.clear();self.assertEqual(self.report()['folders'],[])
 def test_existing_proposals_do_not_approve_after_new_clips(self):
  group=self.report()['folders'][0]['id'];self.h.add_clip(1);again=self.report()
  self.assertEqual(len(again['folders']),1);self.assertEqual(self.report(folder=group,tab='suggestions')['total'],2)
  self.assertEqual(self.counts()['folder_clips_v40'],0)
 def test_no_identity_metrics_used_for_membership(self):
  self.h.add_clip(1);catalog=self.v.index()
  for n,m in enumerate(catalog['items'].values()):
   m['tracks'][0]['direction']='image_left' if n else 'image_right';m['tracks'][0]['entry_zone']='garden_left' if n else 'garden_right'
  self.v.atomic(self.v.ROOT/'catalog.json',catalog);self.assertEqual(len(self.report()['folders']),1)
if __name__=='__main__':unittest.main(verbosity=2)
