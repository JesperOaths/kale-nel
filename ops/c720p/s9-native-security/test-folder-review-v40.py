import copy,importlib.util,json,unittest,contextlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('oldtests',HERE/'test-visual-review-v36.py');old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)

class FolderReviewTests(unittest.TestCase):
 def setUp(self):
  self.h=old.ReviewTest();self.h.setUp();self.v=old.v;self.meta=self.h.meta
 def tearDown(self):self.h.tearDown()
 def report(self,**q):return self.v.report({'workflow':['clip_folders_v40'],**{k:[str(value)] for k,value in q.items()}})
 def action(self,action,item=None,**fields):
  item=item or self.report()['items'][0]
  data={k:item[k] for k in ('clip','source_sha256','observation','signature')}
  return self.v.edit({**data,'action':action,'revision':self.report()['revision'],'human_confirmed':True,**fields})
 def seed(self):
  code,result=self.action('seed_folder',label='Person #1',note='Chosen manually');self.assertEqual(code,200);return result['folder']
 def add_clip(self,n,colour='blue'):
  meta=copy.deepcopy(self.meta);meta['name']='motion_'+str(1791998099688+n)+'.mp4'
  for track in meta['tracks']:
   for field in ('full_crop','upper_crop'):track[field]['name']=track[field]['name'].replace(self.meta['name'],meta['name'])
   if colour=='red':
    for field in ('upper_hsv32','lower_hsv32'):track[field]=[0.,1.]+[0.]*30
    track['upper_palette']=[{'name':'red','hex':'#ff0000'}]
  index=self.v.index();index['items'][meta['name']]=meta;self.v.atomic(self.v.ROOT/'catalog.json',index)
  self.h.labels[meta['name']]={'label':'person','bytes':meta['bytes']}
  self.v.source_rows=lambda:{name:{'size':m['bytes']} for name,m in self.v.index()['items'].items()}
  return meta
 def test_one_card_per_recording_with_alternative_views(self):
  second=copy.deepcopy(self.meta['tracks'][0]);second['track_id']=2
  for field in ('full_crop','upper_crop'):second[field]['name']=second[field]['name'].replace('.t1.','.t2.')
  self.meta['tracks'].append(second);self.h.save();result=self.report()
  self.assertEqual(result['total'],1);self.assertEqual(len(result['items'][0]['alternatives']),2)
 def test_no_folder_without_explicit_approval(self):
  self.add_clip(1);result=self.report();self.assertEqual(result['folders'],[])
  self.assertFalse(result['identity_matching']);self.assertFalse(result['auto_assignments'])
 def test_seed_creates_and_approves_atomically(self):
  folder=self.seed();result=self.report(folder=folder,tab='approved')
  self.assertEqual(result['total'],1);self.assertEqual(result['folders'][0]['approved_clips'],1)
  self.assertEqual(result['items'][0]['decision'],'approved');self.assertEqual(self.h.labels[self.meta['name']]['label'],'person')
 def test_changed_extraction_does_not_lose_approved_clip(self):
  folder=self.seed();item=self.report(folder=folder,tab='approved')['items'][0];old_crop=item['full_crop']['name']
  self.meta['tracks'][0]['track_id']=2
  for field in ('full_crop','upper_crop'):self.meta['tracks'][0][field]['name']=self.meta['tracks'][0][field]['name'].replace('.t1.','.t2.')
  self.meta['tracks'][0]['first_ms']=600;self.h.save()
  pinned=self.report(folder=folder,tab='approved')['items'][0]
  self.assertEqual(pinned['full_crop']['name'],old_crop);self.assertEqual(pinned['observation'],item['observation'])
  import s9_folder_review_v40 as module
  self.assertIn(old_crop,{r['name'] for r in module.saved_crops(self.v.folder_backend())})
 def test_reject_applies_to_folder_not_person_presence(self):
  folder=self.seed();item=self.report(folder=folder,tab='approved')['items'][0]
  self.assertEqual(self.action('reject_clip',item,folder=folder)[0],200)
  self.assertEqual(self.report(folder=folder,tab='approved')['total'],0)
  self.assertEqual(self.report(folder=folder,tab='rejected')['total'],1)
  self.assertEqual(self.v.report({})['items'][0]['presence'],'person')
 def test_rejected_recording_not_suggested_after_track_change(self):
  self.add_clip(1);folder=self.seed();candidate=self.report(folder=folder,tab='suggestions')['items'][0]
  self.action('reject_clip',candidate,folder=folder)
  index=self.v.index();m=index['items'][candidate['clip']];m['tracks'][0]['first_ms']=600;self.v.atomic(self.v.ROOT/'catalog.json',index)
  self.assertEqual(self.report(folder=folder,tab='suggestions')['total'],0)
  old_view=self.report(folder=folder,tab='rejected')['items'][0]
  self.assertEqual(self.action('restore_clip',old_view,folder=folder)[0],200)
  self.assertEqual(self.report(folder=folder,tab='suggestions')['total'],1)
 def test_new_approved_colour_example_expands_colour_search_only(self):
  folder=self.seed();self.add_clip(1,'red');self.add_clip(2,'red')
  self.assertEqual(self.report(folder=folder,tab='suggestions')['total'],0)
  red=self.report(tab='all')['items'][0];self.assertEqual(self.action('approve_clip',red,folder=folder)[0],200)
  result=self.report(folder=folder,tab='suggestions');self.assertEqual(result['profile_examples'],2)
  self.assertEqual(result['total'],1);self.assertEqual(result['items'][0]['colour_distance'],0)
  self.assertEqual(result['suggestion_basis'],'clothing_hsv_distance_only')
  self.assertEqual(self.report(folder=folder,tab='approved')['total'],2)
 def test_no_automatic_approval_of_suggestions(self):
  folder=self.seed();self.add_clip(1);self.assertEqual(self.report(folder=folder,tab='suggestions')['total'],1)
  self.assertEqual(self.report(folder=folder,tab='approved')['total'],1)
 def test_revision_and_exact_view_are_both_required(self):
  item=self.report()['items'][0];revision=self.report()['revision']
  self.meta['tracks'][0]['first_ms']=600;self.h.save()
  data={k:item[k] for k in ('clip','source_sha256','observation','signature')}
  self.assertEqual(self.v.edit({**data,'action':'seed_folder','label':'Wrong view','revision':revision,'human_confirmed':True})[0],409)
  self.assertEqual(self.report()['folders'],[])
 def test_replaced_source_or_revoked_verification_hides_saved_clip(self):
  folder=self.seed();self.h.labels[self.meta['name']]['label']='no_people'
  self.assertEqual(self.report(folder=folder,tab='approved')['total'],0)
  self.h.labels[self.meta['name']]['label']='person'
  self.assertEqual(self.report(folder=folder,tab='approved')['total'],1)
  self.meta['sha256']='c'*64
  for track in self.meta['tracks']:
   for field in ('full_crop','upper_crop'):track[field]['name']=track[field]['name'].replace('a'*12,'c'*12)
  self.h.save();self.assertEqual(self.report(folder=folder,tab='approved')['total'],0)
 def test_skip_is_reversible_and_keeps_archive_labels(self):
  item=self.report()['items'][0];self.action('skip_clip',item)
  self.assertEqual(self.report()['total'],0);self.assertEqual(self.report(tab='skipped')['total'],1)
  self.action('restore_inbox_clip',item);self.assertEqual(self.report()['total'],1)
  self.assertEqual(self.h.labels[self.meta['name']]['label'],'person')
 def test_pinned_approval_survives_catalog_rebuild_with_original_hash_proof(self):
  folder=self.seed();self.h.labels[self.meta['name']]['source_sha256']=self.meta['sha256']
  self.v.atomic(self.v.ROOT/'catalog.json',{'items':{}})
  self.assertEqual(self.report(folder=folder,tab='approved')['total'],1)
  self.h.labels[self.meta['name']]['source_sha256']='f'*64
  result=self.report(folder=folder,tab='approved');self.assertEqual(result['total'],0)
  self.assertEqual(result['folders'][0]['approved_clips'],1)
  self.assertEqual(result['folders'][0]['unavailable_clips'],1)
 def test_approval_clears_a_previous_inbox_rejection(self):
  item=self.report()['items'][0];self.action('skip_clip',item)
  self.assertEqual(self.report(tab='skipped')['total'],1)
  self.assertEqual(self.action('seed_folder',item,label='Chosen after review')[0],200)
  self.assertEqual(self.report(tab='skipped')['total'],0)
  self.assertEqual(self.report()['folders'][0]['approved_clips'],1)
 def test_invalid_parameters_and_unconfirmed_action_rejected(self):
  for query in ({'distance':'nan'},{'weak':'yes'},{'tab':'approved'},{'folder':'missing','tab':'approved'},{'embedding':'x'}):
   with self.assertRaises(ValueError):self.report(**query)
  self.assertEqual(self.v.edit({'action':'seed_folder','revision':0,'label':'No approval'})[0],400)
 def test_legacy_explicit_approvals_migrate_without_new_assignments(self):
  key=next(iter(self.v.observations()));_,created=self.h.edit(action='create_folder',label='Previous manual folder')
  self.h.edit(action='presence',presence='person',observations=[key]);self.h.edit(action='assign',folder=created['folder'],observations=[key])
  result=self.report(folder=created['folder'],tab='approved');self.assertEqual(result['total'],1)
  self.assertEqual(result['folders'][0]['label'],'Previous manual folder')
  before=self.v.report({})['revision'];self.report();self.assertEqual(self.v.report({})['revision'],before)

if __name__=='__main__':unittest.main()
