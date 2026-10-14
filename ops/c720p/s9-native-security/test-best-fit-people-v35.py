"""Actual-frame constraints, ensemble corroboration and presence/identity separation."""
import importlib.util,math,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import s9_best_fit_people_v35 as m
from s9_person_observations_v35 import simultaneous,continuity,observed_times

def vector(c):return [c,math.sqrt(max(0,1-c*c))]
def track(i,clip=None,start=0,end=5,body=None,reid=None,colour=None):
 return {'id':str(i),'clip_key':clip or str(i),'first_s':start,'last_s':end,'recorded_at':1000,'human_clip_label':'person','body_vectors':[body or [1,0]],'reid_v35_vectors':[reid or [1,0]],'face_vectors':[],'colour':colour or [1,0],'metrics':{}}
class Tests(unittest.TestCase):
 def build(self,*rows):return m.build({r['id']:r for r in rows})
 def test_overlapping_lifetimes_are_not_observed_cooccurrence(self):
  a,b=track(1,'same'),track(2,'same',1,4);self.assertFalse(simultaneous(a,b))
 def test_actual_shared_frame_is_a_hard_constraint(self):
  a,b=track(1,'same'),track(2,'same',1,4);a['trajectory']=[[0,[0,0,1,4]],[2,[0,0,1,4]],[5,[0,0,1,4]]];b['trajectory']=[[1,[8,0,9,4]],[2,[8,0,9,4]],[4,[8,0,9,4]]]
  self.assertTrue(simultaneous(a,b));self.assertEqual(len(self.build(a,b)['groups']),2)
 def test_legacy_genuine_endpoints_can_prove_cooccurrence(self):self.assertTrue(simultaneous(track(1,'a'),track(2,'a')))
 def test_different_recordings_are_never_a_cooccurrence(self):self.assertFalse(simultaneous(track(1),track(2)))
 def test_malformed_detection_times_are_not_evidence(self):
  a=track(1);a['trajectory']=[[float('nan'),[]],['2',[]],[True,[]]];self.assertEqual(observed_times(a),[])
 def test_presence_alone_does_not_join_unrelated_sightings(self):
  a,b=track(1,'same',end=2),track(2,'same',4,6,body=[0,1],reid=[0,1],colour=[0,1]);self.assertEqual(len(self.build(a,b)['groups']),2)
 def test_short_spatially_consistent_break_with_matching_appearance_joins(self):
  a,b=track(1,'same',end=2),track(2,'same',4,6);a['frame_size']=b['frame_size']=[100,100];a['trajectory']=[[2,[5,5,25,80]]];b['trajectory']=[[4,[10,5,30,80]]]
  result=self.build(a,b);self.assertTrue(continuity(a,b));self.assertEqual(result['comparisons']['1|2']['kind'],'single_recording_link')
 def test_implausible_position_jump_is_not_track_continuity(self):
  a,b=track(1,'same',end=2),track(2,'same',4,6);a['frame_size']=b['frame_size']=[1000,100];a['trajectory']=[[2,[5,5,25,80]]];b['trajectory']=[[4,[900,5,920,80]]];self.assertFalse(continuity(a,b))
 def test_two_body_models_can_group_changed_clothing(self):
  a,b=track(1),track(2,body=vector(.8),reid=vector(.9),colour=[0,1]);self.assertEqual(len(self.build(a,b)['groups']),1)
 def test_one_model_disagreement_does_not_create_a_supported_match(self):
  a,b=track(1),track(2,body=vector(.8),reid=[0,1]);result=self.build(a,b);self.assertEqual(len(result['groups']),2);self.assertNotEqual(result['comparisons']['1|2']['kind'],'best_fit_supported')
 def test_clothing_does_not_overrule_both_body_models(self):
  a,b=track(1),track(2,body=[0,1],reid=[0,1]);self.assertEqual(len(self.build(a,b)['groups']),2)
 def test_face_supported_outfit_change(self):
  a,b=track(1),track(2,body=[0,1],reid=[0,1],colour=[0,1]);a['face_vectors']=b['face_vectors']=[[1,0],[1,0]];self.assertEqual(len(self.build(a,b)['groups']),1)
 def test_independent_face_contradiction_overrules_body_match(self):
  a,b=track(1),track(2);a['face_vectors']=[[1,0],[1,0]];b['face_vectors']=[[0,1],[0,1]];self.assertEqual(len(self.build(a,b)['groups']),2)
 def test_single_lucky_face_pair_cannot_masquerade_as_two_probes(self):
  a,b=track(1),track(2,body=[0,1],reid=[0,1],colour=[0,1]);a['face_vectors']=[[1,0],[0,1]];b['face_vectors']=[[1,0],[1,0]];self.assertEqual(m.face_views(a,b),.5);self.assertNotEqual(self.build(a,b)['comparisons']['1|2']['kind'],'face_supported')
 def test_presence_labels_are_never_training_identity_pairs(self):
  a,b=track(1,'same',end=2),track(2,'same',4,6);result=self.build(a,b);self.assertFalse(result['grouping']['presence_labels_used_as_identity']);self.assertEqual(result['grouping']['positive_pairs'],0)
 def test_cache_is_versioned(self):
  a,b=track(1),track(2);rows={t['id']:t for t in (a,b)};first=m.build(rows);self.assertEqual(first,m.build(rows,first['comparisons']));self.assertEqual(first['grouping']['algorithm'],m.ALGORITHM)
 def test_all_observations_appear_once(self):
  rows=[track(i) for i in range(8)];result=self.build(*rows);assigned=[k for group in result['groups'] for k in group];self.assertEqual(sorted(assigned),sorted(t['id'] for t in rows));self.assertEqual(len(assigned),len(set(assigned)))
 def test_input_order_does_not_change_membership(self):
  a,b,c=track(1),track(2),track(3,body=[0,1],reid=[0,1],colour=[0,1]);self.assertEqual(self.build(a,b,c)['groups'],self.build(c,b,a)['groups'])
 def test_calibration_uses_independent_original_views_only(self):
  rows={}
  for i in range(8):
   t=track(i);t['body_vectors']=[[1,0],vector(.5)];t['reid_v35_vectors']=[[1,0],vector(.65)];t['reid_v35_evidence']={'original_frame_times_s':[0,2]};rows[t['id']]=t
  negatives={}
  for i in range(8):
   a,b=track(20+2*i,'negative'+str(i)),track(21+2*i,'negative'+str(i));rows[a['id']]=a;rows[b['id']]=b;negatives[a['id'],b['id']]={'body':.2,'reid':.4}
  settings=m.calibrate(rows,negatives);self.assertTrue(settings['calibration_trained']);self.assertEqual(settings['positive_pairs'],8);self.assertEqual(settings['positive_recordings'],8)
  for t in rows.values():
   if 'reid_v35_evidence' in t:t['reid_v35_evidence']['original_frame_times_s']=[0,.2]
  self.assertFalse(m.calibrate(rows,negatives)['calibration_trained'])
 def test_transitive_chain_cannot_drift_into_one_identity(self):
  rows=[track(i,body=[math.cos(i*math.pi/4),math.sin(i*math.pi/4)],reid=[math.cos(i*math.pi/4),math.sin(i*math.pi/4)]) for i in range(4)];self.assertGreater(len(self.build(*rows)['groups']),1)
if __name__=='__main__':unittest.main(verbosity=2)
