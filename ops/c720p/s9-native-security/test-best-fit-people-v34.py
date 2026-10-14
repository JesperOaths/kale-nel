"""Synthetic multiview grouping, ambiguity, provenance-independent math guards."""
import importlib.util,math,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('fit',Path(__file__).with_name('s9_best_fit_people_v34.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def track(index,body=None,colour=None,clip=None,start=0,end=5):
 return {'id':str(index),'clip_key':clip or str(index),'first_s':start,'last_s':end,'recorded_at':1000,'human_clip_label':'people','body_vectors':[body or [1,0]],'face_vectors':[],'colour':colour or [1,0],'metrics':{}}
def at_cosine(value):return [value,math.sqrt(1-value*value)]
class Tests(unittest.TestCase):
 def build(self,*tracks):return m.build({t['id']:t for t in tracks})
 def test_multiview_fit_joins_without_legacy_point_eight_eight_gate(self):
  a,b=track(1),track(2,at_cosine(.75),at_cosine(.85));self.assertEqual(len(self.build(a,b)['groups']),1)
 def test_simultaneous_people_stay_separate_even_with_identical_vectors(self):
  a,b=track(1,clip='same'),track(2,clip='same');self.assertEqual(len(self.build(a,b)['groups']),2)
 def test_single_face_can_be_corroborated_by_body(self):
  a,b=track(1),track(2,at_cosine(.5));a['face_vectors']=[[1,0]];b['face_vectors']=[at_cosine(.85)]
  result=self.build(a,b);self.assertEqual(len(result['groups']),1);self.assertEqual(result['comparisons']['1|2']['kind'],'face_appearance_supported')
 def test_single_face_without_other_evidence_is_only_a_suggestion(self):
  a,b=track(1),track(2);a['body_vectors']=b['body_vectors']=[];a['colour']=b['colour']=None;a['face_vectors']=[[1,0]];b['face_vectors']=[at_cosine(.85)]
  self.assertEqual(len(self.build(a,b)['groups']),2)
 def test_conflicting_independent_faces_veto_outfit_match(self):
  a,b=track(1),track(2);a['face_vectors']=[[1,0],[1,0]];b['face_vectors']=[[0,1],[0,1]];self.assertEqual(len(self.build(a,b)['groups']),2)
 def test_face_match_handles_a_changed_outfit(self):
  a,b=track(1),track(2,[0,1],[0,1]);a['face_vectors']=b['face_vectors']=[[1,0],[1,0]];self.assertEqual(len(self.build(a,b)['groups']),1)
 def test_human_single_person_units_allow_obscured_fragments(self):
  a,b,c=track(1,clip='one',end=2),track(2,[0,1],clip='one',start=3),track(3,at_cosine(.8),at_cosine(.85));a['human_clip_label']=b['human_clip_label']='person'
  self.assertEqual(len(self.build(a,b,c)['groups']),1)
 def test_chain_cannot_join_two_incompatible_people(self):
  a,b,c=track(1,clip='same'),track(2,at_cosine(.9)),track(3,clip='same')
  result=self.build(a,b,c);self.assertGreaterEqual(len(result['groups']),2)
 def test_weak_chain_does_not_become_one_identity(self):
  rows=[track(i+1,[math.cos(i*math.pi/4),math.sin(i*math.pi/4)]) for i in range(4)];self.assertGreater(len(self.build(*rows)['groups']),1)
 def test_colour_and_posture_alone_do_not_create_identity(self):
  a,b=track(1),track(2);a['body_vectors']=b['body_vectors']=[];a['metrics']=b['metrics']={'posture':'upright'};self.assertEqual(len(self.build(a,b)['groups']),2)
 def test_real_competition_marks_the_best_assignment_tentative(self):
  a,c=track(1,clip='same'),track(3,clip='same');b=track(2,at_cosine(.9));result=self.build(a,b,c);self.assertEqual(len(result['groups']),2);self.assertTrue(result['fits']['2']['review_required'])
 def test_similar_noncompeting_views_can_share_one_folder(self):
  self.assertEqual(len(self.build(track(1),track(2),track(3))['groups']),1)
 def test_proportion_cosine_does_not_hide_different_ratios(self):
  a,b=track(1),track(2);a['shape']=[1,2,3];b['shape']=[2,4,6];self.assertEqual(m.proportions(a,b),0)
 def test_bad_vectors_are_not_matching_evidence(self):
  self.assertIsNone(m.cosine([float('nan'),0],[1,0]));self.assertIsNone(m.cosine([0,0],[0,0]));self.assertIsNone(m.cosine([True,0],[1,0]))
 def test_permutation_does_not_change_membership(self):
  a,b,c=track(1),track(2),track(3,[0,1],[0,1]);self.assertEqual(self.build(a,b,c)['groups'],self.build(c,a,b)['groups'])
 def test_comparison_cache_preserves_results(self):
  tracks={t['id']:t for t in (track(1),track(2))};first=m.build(tracks);second=m.build(tracks,first['comparisons']);self.assertEqual(first,second)
 def test_no_count_or_target_number_is_fitted(self):
  result=self.build(track(1),track(2));self.assertEqual(result['grouping']['score_kind'],'similarity_not_identity_probability');self.assertNotIn('target_people',result['grouping'])
 def test_empty_dataset_has_no_folders(self):self.assertEqual(self.build()['groups'],[])
 def test_overflow_vectors_are_rejected(self):self.assertIsNone(m.cosine([1e308,1e308],[1,0]))
 def test_fresh_build_does_not_reuse_a_mutated_descriptor(self):
  a,b=track(1),track(2);self.assertEqual(len(self.build(a,b)['groups']),1);b['body_vectors'][0][:]=[0,1];b['colour']=[0,1];self.assertEqual(len(self.build(a,b)['groups']),2)
if __name__=='__main__':unittest.main(verbosity=2)
