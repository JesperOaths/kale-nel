"""Synthetic evidence only: provenance, grouping constraints, review and metrics."""
import hashlib,importlib.util,json,math,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parent))
import s9_verified_people_v33 as mod

def track(index,clip=None,start=0,end=5):
 return {'id':'obs-'+str(index).zfill(20),'clip_key':clip or 'drive:test'+str(index)+'.mp4','source':'drive','name':'test'+str(index)+'.mp4','first_s':start,'last_s':end,'recorded_at':1000,'face_vectors':[],'body_vectors':[[1,0,0]],'colour':[1,0],'shape':None,'metrics':{},'images':{},'face_images':[]}
class Tests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.patch=patch.object(mod,'ROOT',Path(self.temp.name));self.patch.start()
  self.a={'source':'drive','name':'a.mp4','bytes':123456,'revision':'a'*64,'label':'person'};self.b={**self.a,'name':'b.mp4','revision':'b'*64,'label':'people'}
  self.current={mod.key(c):c for c in (self.a,self.b)};self.current_patch=patch.object(mod,'current',lambda:self.current);self.current_patch.start();mod.approve()
 def tearDown(self):self.current_patch.stop();self.patch.stop();self.temp.cleanup()
 def features(self,tracks):
  mod.write('features.json',{'entries':{mod.key(self.a):{'revision':self.a['revision'],'tracks':tracks}}})
  for t in tracks:t['clip_key']=mod.key(self.a)
  self.features_write(tracks)
 def features_write(self,tracks):
  for track in tracks:track['source']=self.a['source'];track['name']=self.a['name']
  mod.write('features.json',{'entries':{mod.key(self.a):{'revision':self.a['revision'],'tracks':tracks}}})
 def test_frozen_dataset_excludes_new_clips(self):
  c={**self.a,'name':'new.mp4'};self.current[mod.key(c)]=c;self.assertEqual(len(mod.allowed()),2)
 def test_revocation_and_revision_changes_remove_eligibility(self):
  del self.current[mod.key(self.a)];self.assertEqual(list(mod.allowed()),[mod.key(self.b)])
  self.current[mod.key(self.b)]={**self.b,'revision':'c'*64};self.assertEqual(mod.allowed(),{})
 def test_approval_cannot_be_silently_replaced(self):
  with self.assertRaises(ValueError):mod.approve()
 def test_simultaneous_people_never_merge(self):
  a,b=track(1,'same'),track(2,'same');a['face_vectors']=b['face_vectors']=[[1,0],[1,0]]
  self.assertEqual(mod.compare(a,b)['kind'],'conflict');self.assertEqual(len(mod.build_registry({a['id']:a,b['id']:b})['profiles']),2)
 def test_no_faces_or_gait_are_invented(self):
  a,b=track(1),track(2);a['body_vectors']=b['body_vectors']=[]
  self.assertEqual(mod.compare(a,b)['kind'],'separate');self.assertEqual(mod.public_track(a)['metrics'],{})
 def test_appearance_group_is_provisional_and_day_bounded(self):
  a,b=track(1),track(2);self.assertEqual(mod.compare(a,b)['kind'],'appearance_supported')
  b['recorded_at']+=90000;self.assertEqual(mod.compare(a,b)['kind'],'suggestion')
 def test_conflicting_faces_veto_clothing_match(self):
  a,b=track(1),track(2);a['face_vectors']=[[1,0],[1,0]];b['face_vectors']=[[0,1],[0,1]]
  self.assertEqual(mod.compare(a,b)['kind'],'conflict')
 def test_face_matches_require_multiple_samples(self):
  a,b=track(1),track(2);a['body_vectors']=b['body_vectors']=[];a['face_vectors']=b['face_vectors']=[[1,0]]
  self.assertEqual(mod.compare(a,b)['kind'],'suggestion');a['face_vectors']*=2;b['face_vectors']*=2;self.assertEqual(mod.compare(a,b)['kind'],'face_supported')
 def test_complete_link_prevents_transitive_identity_chains(self):
  a,b,c=track(1),track(2),track(3)
  scores={(a['id'],b['id']):{'kind':'face_supported','score':.95,'reasons':[]},(b['id'],c['id']):{'kind':'face_supported','score':.9,'reasons':[]},(a['id'],c['id']):{'kind':'conflict','score':0,'reasons':[]}}
  with patch.object(mod,'compare',lambda x,y:scores[tuple(sorted((x['id'],y['id'])))]) :result=mod.build_registry({t['id']:t for t in (a,b,c)})
  self.assertEqual(len(result['profiles']),2)
 def test_public_report_and_images_filter_revoked_clips(self):
  a=track(1);self.features([a]);mod.write('registry.json',mod.build_registry({a['id']:a}))
  result=mod.report();self.assertEqual(len(result['folders']),1);raw=json.dumps(result);self.assertNotIn('body_vectors',raw);self.assertNotIn('face_vectors',raw)
  del self.current[mod.key(self.a)];self.assertEqual(mod.report()['folders'],[]);self.assertIsNone(mod.image_bytes('a'*24+'.jpg'));self.assertIsNone(mod.image_bytes('../secret'))
 def test_review_requires_human_confirmation_and_valid_name(self):
  a=track(1);self.features([a]);mod.write('registry.json',mod.build_registry({a['id']:a}))
  self.assertEqual(mod.edit({'action':'rename','profile_id':'P0001','name':'Test'})[0],400)
  self.assertEqual(mod.edit({'action':'rename','profile_id':'P0001','name':'<bad>','human_confirmed':True})[0],400)
  self.assertEqual(mod.edit({'action':'rename','profile_id':'P0001','name':'Person A','human_confirmed':True})[0],200);self.assertEqual(mod.report()['folders'][0]['name'],'Person A')
 def test_split_persists_and_overlapping_merge_is_rejected(self):
  a,b=track(1),track(2);self.features([a,b]);registry=mod.build_registry({a['id']:a,b['id']:b});mod.write('registry.json',registry)
  self.assertEqual(mod.edit({'action':'merge','profile_id':'P0001','other_id':'P0002','human_confirmed':True})[0],409)
  self.assertEqual(mod.edit({'action':'split','profile_id':'P0001','observation_id':a['id'],'human_confirmed':True})[0],200)
 def test_audit_failure_restores_registry(self):
  a=track(1);self.features([a]);before=mod.build_registry({a['id']:a});mod.write('registry.json',before)
  with patch.object(mod,'audit',side_effect=OSError):status,_=mod.edit({'action':'confirm','profile_id':'P0001','human_confirmed':True})
  self.assertEqual(status,503);self.assertEqual(mod.read('registry.json'),before)
 def test_bad_vectors_fail_closed(self):
  self.assertIsNone(mod.cosine([float('nan')],[1]));self.assertIsNone(mod.cosine([0],[0]));self.assertIsNone(mod.cosine([1],[1,2]))
 def test_incremental_publication_keeps_ids_and_reviewed_groups(self):
  a=track(1);a['clip_key']=mod.key(self.a);self.features_write([a]);self.assertEqual(mod.advance_registry(),1)
  mod.edit({'action':'confirm','profile_id':'P0001','human_confirmed':True})
  b=track(2,start=6,end=9);b['clip_key']=mod.key(self.a);self.features_write([a,b]);self.assertEqual(mod.advance_registry(),1)
  data=mod.read('registry.json');self.assertEqual(data['links'][a['id']],'P0001');self.assertNotEqual(data['links'][b['id']],'P0001');self.assertTrue(data['profiles']['P0001']['reviewed']);self.assertEqual(mod.advance_registry(),0)
 def test_cached_previews_invalidate_on_verification_changes(self):
  a=track(1);self.features([a]);version=[1]
  with patch.multiple(mod,CACHE_ENABLED=True,_allowed_cache=None,_tracks_cache=None),patch.object(mod,'source_signature',lambda:version[0]):
   self.assertEqual(len(mod.tracks_now()),1);self.assertEqual(len(mod.tracks_now()),1)
   del self.current[mod.key(self.a)];version[0]+=1;self.assertEqual(mod.tracks_now(),{})
 def test_single_person_review_links_nonoverlapping_fragments_only(self):
  a,b=track(1,'one',0,3),track(2,'one',4,8);a['human_clip_label']=b['human_clip_label']='person';a['body_vectors']=b['body_vectors']=[]
  self.assertEqual(mod.compare(a,b)['kind'],'single_recording_link');self.assertEqual(len(mod.build_registry({t['id']:t for t in (a,b)})['profiles']),1)
  b['first_s']=2;self.assertEqual(mod.compare(a,b)['kind'],'conflict');b['first_s']=4;b['human_clip_label']='people';self.assertEqual(mod.compare(a,b)['kind'],'separate')
 def test_clear_face_anchor_can_represent_verified_single_person_fragments(self):
  a,b,c=track(1,'one',0,3),track(2,'one',4,8),track(3,'other');a['human_clip_label']=b['human_clip_label']='person';b['body_vectors']=[];a['face_vectors']=c['face_vectors']=[[1,0],[1,0]]
  result=mod.build_registry({t['id']:t for t in (a,b,c)});self.assertEqual(len(result['profiles']),1)
 def test_final_grouping_preserves_named_and_confirmed_folders(self):
  a,b=track(1,start=0,end=3),track(2,start=4,end=8);b['body_vectors']=[[0,1,0]];self.features([a,b]);mod.write('registry.json',mod.build_registry({t['id']:t for t in (a,b)}))
  mod.edit({'action':'rename','profile_id':'P0001','name':'Reviewed person','human_confirmed':True});self.assertEqual(mod.reconcile_registry(),2);self.assertEqual(mod.read('registry.json')['profiles']['P0001']['name'],'Reviewed person')
 def test_final_grouping_can_join_verified_single_person_fragments(self):
  a,b=track(1,start=0,end=3),track(2,start=4,end=8);b['body_vectors']=[[0,1,0]];self.features([a,b]);mod.write('registry.json',mod.build_registry({t['id']:t for t in (a,b)}))
  self.assertEqual(mod.reconcile_registry(),1);self.assertEqual(len(set(mod.read('registry.json')['links'].values())),1)
 def test_mismatched_clip_fields_never_reach_the_public_set(self):
  a=track(1);self.features([a]);a['name']='not-approved.mp4';mod.write('features.json',{'entries':{mod.key(self.a):{'revision':self.a['revision'],'tracks':[a]}}});self.assertEqual(mod.tracks_now(),{})
 def test_images_are_bound_to_their_own_verified_appearance(self):
  a=track(1);name=hashlib.sha256((a['id']+':body').encode()).hexdigest()[:24]+'.jpg';blob=b'\xff\xd8'+b'0'*600+b'\xff\xd9';a['images']={name:{'sha256':hashlib.sha256(blob).hexdigest(),'kind':'body'}};self.features([a]);(mod.ROOT/'images').mkdir();(mod.ROOT/'images'/name).write_bytes(blob)
  self.assertEqual(mod.image_bytes(name),blob);del self.current[mod.key(self.a)];self.assertIsNone(mod.image_bytes(name))
 def best_fit(self):mod.write('grouping-policy.json',{'algorithm':'verified_multiview_best_fit_v34'})
 def test_best_fit_policy_builds_profiles_and_keeps_descriptors_private(self):
  a,b=track(1,start=0,end=2),track(2,start=3,end=6);self.features([a,b]);self.best_fit();tracks=mod.tracks_now();registry=mod.build_registry(tracks);mod.write('registry.json',registry)
  self.assertEqual(len(registry['profiles']),1);self.assertIn('fits',registry);raw=json.dumps(mod.report());self.assertNotIn('body_vectors',raw);self.assertNotIn('"evidence"',raw);self.assertNotIn('"colour"',raw)
 def test_best_fit_preserves_named_folders(self):
  a,b=track(1,start=0,end=2),track(2,start=3,end=6);b['body_vectors']=[[0,1,0]];self.features([a,b]);mod.write('registry.json',mod.build_registry({t['id']:t for t in (a,b)}));mod.edit({'action':'rename','profile_id':'P0001','name':'Owner name','human_confirmed':True});self.best_fit();self.assertEqual(mod.reconcile_registry(),2);self.assertEqual(mod.read('registry.json')['profiles']['P0001']['name'],'Owner name')
 def test_best_fit_honours_a_manual_separation(self):
  a,b=track(1,start=0,end=2),track(2,start=3,end=6);self.features([a,b]);self.best_fit();mod.write('registry.json',mod.build_registry(mod.tracks_now()));self.assertEqual(mod.edit({'action':'split','profile_id':'P0001','observation_id':a['id'],'human_confirmed':True})[0],200);self.assertEqual(mod.reconcile_registry(),2)
 def test_confirming_a_group_clears_tentative_marks(self):
  a=track(1);self.features([a]);registry=mod.build_registry(mod.tracks_now());registry['fits']={a['id']:{'review_required':True,'support':'tentative_profile_fit','similarity':.5}};mod.write('registry.json',registry);self.assertEqual(mod.edit({'action':'confirm','profile_id':'P0001','human_confirmed':True})[0],200);self.assertFalse(mod.read('registry.json')['fits'][a['id']]['review_required'])
 def test_grouping_receipt_provides_an_exact_rollback(self):
  a=track(1);self.features([a]);mod.write('registry.json',mod.build_registry(mod.tracks_now()));before=mod.read('registry.json');self.best_fit();receipt={};mod.reconcile_registry(receipt=receipt);self.assertEqual(mod.read(receipt['backup']),before);self.assertEqual(hashlib.sha256((mod.ROOT/'registry.json').read_bytes()).hexdigest(),receipt['after_sha256'])
 def test_best_fit_still_excludes_revoked_footage(self):
  a=track(1);self.features([a]);self.best_fit();mod.write('registry.json',mod.build_registry(mod.tracks_now()));del self.current[mod.key(self.a)];self.assertEqual(mod.report()['folders'],[]);self.assertEqual(mod.reconcile_registry(),0)

if __name__=='__main__':unittest.main(verbosity=2)
