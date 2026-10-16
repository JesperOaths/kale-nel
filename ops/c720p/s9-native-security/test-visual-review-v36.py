import contextlib,copy,hashlib,importlib.util,json,sqlite3,tempfile,unittest,types,sys,re
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('visual',Path(__file__).with_name('s9_visual_review_v36.py'));v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
real_archive_verifications=v.archive_verifications
def fixture():
 name='motion_1791998099688.mp4';digest='a'*64;hist=[1.0]+[0.0]*31
 def crop(kind):return {'name':name+'.t1.'+digest[:12]+'.1000.'+kind+'.jpg','bytes':1000,'sha256':'b'*64,'time_ms':1000,'source_box_pixels':[100,100,300,600],'width':200,'height':500,'resized':False,'quality':.5}
 return {'version':v.VERSION,'count_version':'anonymous_repeated_concurrent_v36','name':name,'bytes':50000,'sha256':digest,'width':3840,'height':2160,'duration_ms':5000,'identity_matching':False,'decoder':'synthetic_test','repeated_simultaneous':1,'peak_simultaneous':1,'tracklet_count':1,'tracks':[{'track_id':1,'samples':3,'first_ms':500,'last_ms':3000,'upper_hsv32':hist,'lower_hsv32':hist,'upper_lab32':hist,'lower_lab32':hist,'upper_palette':[{'hex':'#123456','name':'blue'}],'lower_palette':[],'full_crop':crop('full'),'upper_crop':crop('upper'),'entry_zone':'garden_left','exit_zone':'garden_right','direction':'image_right'}]}
class ReviewTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent,prefix='.visual-tests-');assert Path(__file__).resolve().parent in Path(self.tmp.name).resolve().parents
  v.ROOT=Path(self.tmp.name)/'state';v.CACHE=Path(self.tmp.name)/'cache';self.meta=fixture();v.source_rows=lambda:{self.meta['name']:{'size':self.meta['bytes']}}
  self.labels={self.meta['name']:{'label':'person','bytes':self.meta['bytes']}}
  v.archive_verifications=lambda:{'ok':True,'clips':self.labels}
  self.save()
 def tearDown(self):self.tmp.cleanup()
 def save(self):v.atomic(v.ROOT/'catalog.json',{'items':{self.meta['name']:self.meta},'updated_at':'test'})
 def revision(self):return v.report({})['revision']
 def edit(self,**kw):return v.edit({'revision':self.revision(),'human_confirmed':True,**kw})
 def test_valid_original(self):self.assertIs(v.validate(self.meta),self.meta)
 def test_route_registration_is_idempotent_without_auth_downgrade(self):
  class Handler:
   def go(self):pass
   def do_POST(self):pass
  v.install(Handler,external=True);installed=Handler.go;v.install(Handler,external=True)
  self.assertIs(Handler.go,installed)
  with self.assertRaises(ValueError):v.install(Handler,external=False)
 def test_reject_upscaled(self):
  self.meta['width']=1920
  with self.assertRaises(ValueError):v.validate(self.meta)
 def test_reject_outside_frame(self):
  self.meta['tracks'][0]['full_crop']['source_box_pixels'][2]=4000
  with self.assertRaises(ValueError):v.validate(self.meta)
 def test_reject_non_normalized_histogram(self):
  self.meta['tracks'][0]['upper_hsv32']=[1.0]*32
  with self.assertRaises(ValueError):v.validate(self.meta)
 def test_reject_foreign_crop(self):
  self.meta['tracks'][0]['full_crop']['name']='../../secret.jpg'
  with self.assertRaises(ValueError):v.validate(self.meta)
 def test_colour_sort_never_assigns(self):
  key=next(iter(v.observations()));result=v.report({'reference':[key]});self.assertEqual(result['items'][0]['colour_distance'],0);self.assertIsNone(result['items'][0]['verified_group_id']);self.assertEqual(result['folders'],[])
 def test_colour_and_trajectory_filter(self):
  self.assertEqual(v.report({'color':['blue'],'direction':['image_right']})['total'],1)
  self.assertEqual(v.report({'color':['red']})['total'],0)
 def test_manual_folder_survives_catalog_rebuild(self):
  key=next(iter(v.observations()));code,result=self.edit(action='create_folder',label='Resident review',note='Manually assigned');self.assertEqual(code,200)
  self.edit(action='presence',presence='person',observations=[key])
  self.assertEqual(self.edit(action='assign',folder=result['folder'],observations=[key])[0],200)
  self.assertEqual(self.edit(action='annotate',observations=[key],note='Keep this view',label='My label',pinned=True)[0],200)
  self.save();review=v.report({})['items'][0]['review'];self.assertEqual(review['note'],'Keep this view');self.assertEqual(review['pinned'],1)
 def test_reclassified_geometry_requires_recheck_without_losing_review(self):
  key=next(iter(v.observations()));self.edit(action='annotate',observations=[key],note='Preserved')
  self.meta['tracks'][0]['first_ms']=600;self.save();item=v.report({})['items'][0];self.assertTrue(item['review_changed']);self.assertIsNone(item['review']);self.assertEqual(item['previous_review']['note'],'Preserved')
  with contextlib.closing(v.db()) as connection:self.assertEqual(connection.execute('SELECT note FROM reviews').fetchone()[0],'Preserved')
 def test_stale_review_rejected(self):
  before=self.revision();self.edit(action='create_folder',label='One')
  self.assertEqual(v.edit({'action':'create_folder','revision':before,'human_confirmed':True,'label':'Stale'})[0],409)
 def test_removed_video_hides_metadata(self):
  v.source_rows=lambda:{};self.assertEqual(v.report({})['total'],0)
 def test_unknown_review_never_creates_folder(self):self.assertEqual(self.edit(action='assign',folder='anything',observations=['missing'])[0],404)
 def test_requires_human_action(self):self.assertEqual(v.edit({'action':'create_folder','revision':0,'label':'No confirmation'})[0],400)
 def test_distance_bounded(self):self.assertEqual(v.bhattacharyya([1,0],[0,1]),1)
 def test_fragments_do_not_create_group_count(self):
  self.meta['tracklet_count']=6;self.save();result=v.count_metrics(self.meta['name'],{'size':self.meta['bytes']});self.assertEqual(result['person_count'],1);self.assertNotEqual(result['scene_category'],'multiple_people')
 def test_unrepeated_multiple_boxes_require_review(self):
  self.meta['peak_simultaneous']=3;self.save();result=v.count_metrics(self.meta['name'],{'size':self.meta['bytes']});self.assertEqual(result['person_count'],1);self.assertNotEqual(result['scene_category'],'multiple_people')
 def test_no_arbitrary_query_keys(self):
  with self.assertRaises(ValueError):v.report({'embedding':['x']})
 def test_unverified_clips_are_excluded(self):
  self.labels.clear();self.assertEqual(v.report({})['total'],0);self.assertEqual(v.observations(),{})
 def test_negative_uncertain_and_stale_verification_excluded(self):
  for label in ('no_people','uncertain',None):
   self.labels[self.meta['name']]['label']=label;self.assertEqual(v.report({})['total'],0)
  self.labels[self.meta['name']]={'label':'people','bytes':self.meta['bytes']+1};self.assertEqual(v.report({})['total'],0)
 def test_both_positive_labels_allowed(self):
  for label in ('person','people'):
   self.labels[self.meta['name']]['label']=label;self.assertEqual(v.report({})['total'],1)
 def test_rejected_crop_hidden_and_restorable(self):
  key=next(iter(v.observations()));self.assertEqual(self.edit(action='presence',presence='no_person',observations=[key])[0],200)
  self.assertEqual(v.report({})['total'],0)
  self.assertEqual(v.report({'presence':['no_person']})['items'][0]['presence'],'no_person')
  self.assertEqual(self.edit(action='presence',presence='pending',observations=[key])[0],200)
  self.assertEqual(v.report({})['total'],1)
 def test_confirmation_does_not_assign_folder(self):
  key=next(iter(v.observations()));self.edit(action='presence',presence='person',observations=[key])
  item=v.report({'presence':['person']})['items'][0];self.assertIsNone(item['verified_group_id']);self.assertEqual(item['presence'],'person')
 def test_revoked_recording_cannot_be_edited_or_cropped(self):
  key=next(iter(v.observations()));name=self.meta['tracks'][0]['full_crop']['name'];self.labels.clear()
  self.assertEqual(self.edit(action='presence',presence='person',observations=[key])[0],404)
  with self.assertRaises(FileNotFoundError):v.crop_bytes(name)
 def test_changed_extraction_resets_presence(self):
  key=next(iter(v.observations()));self.edit(action='presence',presence='person',observations=[key]);self.meta['tracks'][0]['first_ms']=600;self.save()
  self.assertEqual(v.report({})['items'][0]['presence'],'pending')
  self.edit(action='annotate',observations=[key],note='rechecked note only');self.assertEqual(v.report({})['items'][0]['presence'],'pending')
 def test_invalid_presence_rejected(self):
  with self.assertRaises(ValueError):v.report({'presence':['identity']})
  self.assertEqual(self.edit(action='presence',presence='identity',observations=[])[0],400)
 def test_folder_assignment_requires_current_crop_confirmation(self):
  key=next(iter(v.observations()));_,folder=self.edit(action='create_folder',label='Manual')
  self.assertEqual(self.edit(action='assign',folder=folder['folder'],observations=[key])[0],409)
  self.edit(action='presence',presence='no_person',observations=[key]);self.assertEqual(self.edit(action='assign',folder=folder['folder'],observations=[key])[0],409)
 def test_schema_migration_preserves_labels_notes_and_folders(self):
  with contextlib.closing(v.db()) as connection:
   connection.execute('ALTER TABLE reviews DROP COLUMN presence');connection.execute("INSERT INTO folders VALUES('G1','Keep','Folder note','now')")
   connection.execute("INSERT INTO reviews VALUES('view','signature','G1','Label','Keep note',1)");connection.commit()
  with contextlib.closing(v.db()) as connection:
   row=dict(connection.execute("SELECT * FROM reviews WHERE observation='view'").fetchone())
   self.assertEqual((row['folder'],row['label'],row['note'],row['pinned'],row['presence']),('G1','Label','Keep note',1,'pending'))
 def test_shared_registry_works_without_archive_handler_callback(self):
  name=self.meta['name'];decision={'label':'person','revision':'current','human_confirmed':True}
  fake=types.SimpleNamespace(SD_NAME=re.compile(r'motion_[0-9]{13}[.]mp4'),read_store=lambda:{'labels':{'sd:'+name:decision}},revision=lambda *args:'current')
  v.source_rows=lambda:{name:{'size':self.meta['bytes'],'sd_verified':True}}
  with patch.dict(sys.modules,{'s9_archive_review_v32':fake}):
   self.assertEqual(real_archive_verifications()['clips'][name]['label'],'person')
   decision['revision']='old';self.assertIsNone(real_archive_verifications()['clips'][name]['label'])
   decision['revision']='current';decision['human_confirmed']=False;self.assertIsNone(real_archive_verifications()['clips'][name]['label'])
   fake.read_store=lambda:None
   with self.assertRaises(OSError):real_archive_verifications()
 def test_singletons_held_but_recoverable(self):
  self.meta['tracks'][0]['samples']=1;self.save()
  self.assertEqual(v.report({})['total'],1);self.assertEqual(v.report({})['weak_views_held'],1)
  self.assertEqual(v.report({'support':['supported']})['total'],0)
  self.assertEqual(v.report({'support':['weak']})['total'],1)
  key=next(iter(v.observations()));self.edit(action='presence',presence='person',observations=[key])
  self.assertEqual(v.report({})['total'],1)
 def test_short_span_is_not_temporal_support(self):
  self.meta['tracks'][0]['last_ms']=1000;self.meta['tracks'][0]['first_ms']=600;self.save()
  self.assertEqual(v.report({})['total'],1)
  self.assertFalse(v.report({})['items'][0]['temporal_support'])
  self.assertEqual(v.count_metrics(self.meta['name'],{'size':self.meta['bytes']})['person_count'],0)
 def test_versioned_native_crop_preserves_provenance(self):
  for version in ('v37','v38','v39'):
   meta=fixture()
   for field in ('full_crop','upper_crop'):meta['tracks'][0][field]['name']=meta['tracks'][0][field]['name'].replace('.1000.','.'+version+'.1000.')
   self.assertIs(v.validate(meta),meta)
 def test_attribute_comparison_sets_never_create_or_assign_folders(self):
  second=copy.deepcopy(self.meta);second['name']='motion_1791998099788.mp4'
  for field in ('full_crop','upper_crop'):second['tracks'][0][field]['name']=second['tracks'][0][field]['name'].replace(self.meta['name'],second['name'])
  rows={m['name']:{'size':m['bytes']} for m in (self.meta,second)};v.source_rows=lambda:rows
  self.labels[second['name']]={'label':'people','bytes':second['bytes']}
  v.atomic(v.ROOT/'catalog.json',{'items':{m['name']:m for m in (self.meta,second)}})
  report=v.report({});self.assertEqual(len(report['attribute_sets']),1);group=report['attribute_sets'][0]
  self.assertEqual((group['clips'],group['views']),(2,2));self.assertEqual(report['folders'],[])
  self.assertTrue(all(r['verified_group_id'] is None for r in v.report({'attribute_set':[group['id']]})['items']))
  with contextlib.closing(v.db()) as c:self.assertEqual(c.execute('select count(*) from audit').fetchone()[0],0)
  self.assertEqual(v.report({})['coverage']['verified_positive_clips'],2)
  key=report['items'][0]['observation'];self.edit(action='presence',presence='person',observations=[key])
  _,folder=self.edit(action='create_folder',label='Manual selection');self.edit(action='assign',folder=folder['folder'],observations=[key])
  self.assertEqual(v.report({'attribute_set':[group['id']]})['total'],1)
  self.assertEqual(v.report({'folder':[folder['folder']]})['total'],1)
  self.labels[second['name']]['label']='no_people';self.assertEqual(v.report({})['attribute_sets'],[])
 def test_invalid_attribute_set_is_rejected(self):
  with self.assertRaises(ValueError):v.report({'attribute_set':['../../private']})
 def test_phone_queue_contains_only_positive_owner_decisions(self):
  self.labels['motion_1791998099689.mp4']={'label':'no_people','bytes':50000}
  with patch.object(v.subprocess,'run',return_value=types.SimpleNamespace(returncode=0)) as execute:
   self.assertEqual(v.publish_queue(),1)
   queue=json.loads((v.ROOT/'phone-work-queue.json').read_text());self.assertEqual(len(queue['clips']),1)
   self.assertTrue(queue['clips'][0]['human_verified']);self.assertEqual(queue['clips'][0]['name'],self.meta['name'])
   self.assertEqual(execute.call_count,2)
 def test_revised_sidecar_reloads_when_original_bytes_unchanged(self):
  changed=copy.deepcopy(self.meta);changed['tracks'][0]['samples']=7
  raw=json.dumps(changed).encode();digest=hashlib.sha256(raw).hexdigest()
  reads=[]
  def execute(args,**kwargs):
   if 'sha256sum' in args:return types.SimpleNamespace(returncode=0,stderr='',stdout=digest+'  '+v.SD+'/'+self.meta['name']+'.visual-v36.json\n')
   if 'exec-out' in args:reads.append(args);return types.SimpleNamespace(returncode=0,stdout=raw)
   return types.SimpleNamespace(returncode=0,stderr='',stdout='')
  with patch.object(v.subprocess,'run',side_effect=execute):
   self.assertEqual(v.sync()['new_clips'],1);self.assertEqual(v.report({})['items'][0]['samples'],7)
   self.assertEqual(v.sync()['new_clips'],0);self.assertEqual(len(reads),1)
if __name__=='__main__':unittest.main()
