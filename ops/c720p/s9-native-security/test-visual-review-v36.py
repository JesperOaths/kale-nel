import contextlib,copy,hashlib,importlib.util,json,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('visual',Path(__file__).with_name('s9_visual_review_v36.py'));v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
def fixture():
 name='motion_1791998099688.mp4';digest='a'*64;hist=[1.0]+[0.0]*31
 def crop(kind):return {'name':name+'.t1.'+digest[:12]+'.1000.'+kind+'.jpg','bytes':1000,'sha256':'b'*64,'time_ms':1000,'source_box_pixels':[100,100,300,600],'width':200,'height':500,'resized':False,'quality':.5}
 return {'version':v.VERSION,'count_version':'anonymous_repeated_concurrent_v36','name':name,'bytes':50000,'sha256':digest,'width':3840,'height':2160,'duration_ms':5000,'identity_matching':False,'decoder':'synthetic_test','repeated_simultaneous':1,'peak_simultaneous':1,'tracklet_count':1,'tracks':[{'track_id':1,'first_ms':500,'last_ms':3000,'upper_hsv32':hist,'lower_hsv32':hist,'upper_lab32':hist,'lower_lab32':hist,'upper_palette':[{'hex':'#123456','name':'blue'}],'lower_palette':[],'full_crop':crop('full'),'upper_crop':crop('upper'),'entry_zone':'garden_left','exit_zone':'garden_right','direction':'image_right'}]}
class ReviewTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent,prefix='.visual-tests-');assert Path(__file__).resolve().parent in Path(self.tmp.name).resolve().parents
  v.ROOT=Path(self.tmp.name)/'state';v.CACHE=Path(self.tmp.name)/'cache';self.meta=fixture();v.source_rows=lambda:{self.meta['name']:{'size':self.meta['bytes']}}
  self.save()
 def tearDown(self):self.tmp.cleanup()
 def save(self):v.atomic(v.ROOT/'catalog.json',{'items':{self.meta['name']:self.meta},'updated_at':'test'})
 def revision(self):return v.report({})['revision']
 def edit(self,**kw):return v.edit({'revision':self.revision(),'human_confirmed':True,**kw})
 def test_valid_original(self):self.assertIs(v.validate(self.meta),self.meta)
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
  self.meta['peak_simultaneous']=3;self.save();result=v.count_metrics(self.meta['name'],{'size':self.meta['bytes']});self.assertEqual(result['person_count'],1);self.assertEqual(result['scene_category'],'unreviewed')
 def test_no_arbitrary_query_keys(self):
  with self.assertRaises(ValueError):v.report({'embedding':['x']})
if __name__=='__main__':unittest.main()
