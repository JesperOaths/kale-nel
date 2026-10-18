#!/home/jespern/c720p-home-hub/person-detector/venv/bin/python
import ast,hashlib,importlib.util,json,os,pathlib,datetime,fcntl,sys
BASE=pathlib.Path('/home/jespern/c720p-home-hub');ROOT=pathlib.Path('/opt/homeassistant/config/www/frontyard-security-new')
DET=BASE/'state/person-detection-index.json';LOCK=BASE/'state/person-detection-index.lock';REPORT=BASE/'state/person-no-person-clean-last.json'
HYBRID=BASE/'bin/c720p-person-hybrid-v126.py'
MODEL_FILES=('mobilenet_iter_73000.caffemodel','deploy.prototxt','yolov5n-v7.0.onnx')

def file_digest(path):
 if path.is_symlink():raise ValueError('unexpected_source_symlink')
 digest=hashlib.sha256()
 with path.open('rb') as stream:
  for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
 return digest.hexdigest()

def detector_version():
 raw=HYBRID.read_bytes();tree=ast.parse(raw)
 model=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign)
            and any(isinstance(t,ast.Name) and t.id=='MODEL_ID' for t in n.targets))
 if not isinstance(model,str) or not model:raise ValueError('invalid_detector_model_version')
 parts=[hashlib.sha256(raw).hexdigest()]
 for name in MODEL_FILES:
  p=BASE/'person-detector/model'/name
  if p.is_symlink():raise ValueError('unexpected_detector_model_symlink')
  parts.append([name,file_digest(p)])
 return model,hashlib.sha256(json.dumps(parts,separators=(',',':')).encode()).hexdigest()

def source_signature(path,version):
 return hashlib.sha256(json.dumps(['sha256-v2',path.name,file_digest(path),version],separators=(',',':')).encode()).hexdigest()

def needs_scan(row,path,model,version,force=False):
 eligible=row.get('model')!=model or str(row.get('person_status') or '') in ('no_person_sampled','uncertain','unknown','')
 completed=(row.get('model')==model and row.get('person_fullscan_source_signature')==source_signature(path,version)
            and type(row.get('person_fullscan_samples')) is int and row['person_fullscan_samples']>0
            and bool(row.get('person_fullscan_at')))
 return eligible and (force or not completed)

def load_detector():
 sp=importlib.util.spec_from_file_location('c720p_person_hybrid_v126',HYBRID)
 m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);return m

def atomic(p,o):
 p=pathlib.Path(p);q=p.with_suffix(p.suffix+'.tmp-v126-'+str(os.getpid()));q.write_text(json.dumps(o,indent=2)+'\n');os.replace(q,p)
def main():
 if sys.argv[1:] not in ([],['--force']):raise SystemExit('usage: person-no-person-clean [--force]')
 model,version=detector_version()
 with open(LOCK,'a+') as lk:
  fcntl.flock(lk,fcntl.LOCK_EX)
  try:ev=json.loads((ROOT/'events.json').read_text())
  except:ev=[]
  if isinstance(ev,dict):ev=ev.get('events',[])
  try:idx=json.loads(DET.read_text())
  except:idx={'items':{}}
  items=idx.setdefault('items',{});cands=[]
  for e in ev if isinstance(ev,list) else []:
   name=pathlib.Path(str(e.get('clip') or '')).name;cp=ROOT/'clips'/name
   if not name or not cp.is_file():continue
   d=items.get('new:'+name,{})
   if needs_scan(d,cp,model,version,force='--force' in sys.argv[1:]):
    cands.append((str(e.get('timestamp') or ''),e,name,cp,d))
  cands.sort(reverse=True,key=lambda x:x[0]);reviewed=[]
  if cands:
   _,e,name,cp,d=cands[0];fingerprint=source_signature(cp,version);hy=load_detector()
   if hy.MODEL_ID!=model:raise ValueError('concurrent_detector_update')
   res=hy.HybridDetector().analyze_clip(cp,'full')
   if source_signature(cp,version)!=fingerprint or detector_version()!=(model,version):
    raise ValueError('source_or_detector_changed_during_scan')
   d.update({'model':hy.MODEL_ID,'person_status':res['status'],'person_status_reason':res['reason'],
    'person_confidence':res['person_confidence'],'person_confidence_mobile':res['mobile_peak'],
    'person_confidence_yolo':res['yolo_peak'],'person_confidence_yolo_clean':res['yolo_clean_person_peak'],
    'car_confidence':res['vehicle_confidence'],'road_vehicle_confidence':res['road_vehicle_peak'],
    'truck_confidence':res['truck_peak'],'vehicle_conflict_frames':res['vehicle_conflict_frames'],
    'vehicle_only_frames':res.get('vehicle_only_frames',0),'vehicle_margin':res.get('vehicle_margin',0),
    'truck_conflict':res.get('truck_conflict',False),
    'night_scene':res['night_scene'],'night_vehicle_guard_triggered':res['guard_triggered'],
    'person_fullscan_at':datetime.datetime.now().astimezone().isoformat(),
    'person_fullscan_source_signature':fingerprint,
    'person_fullscan_samples':res['sample_count'],'brightness_mean':res['brightness_mean']})
   items['new:'+name]=d
   reviewed=[{'clip_no':e.get('clip_no'),'clip':name,'status':res['status'],'reason':res['reason'],
              'road_vehicle':res['road_vehicle_peak'],'truck':res['truck_peak'],'guard':res['guard_triggered']}]
  if reviewed:
   idx['model']=model;idx['updated_at']=datetime.datetime.now().astimezone().isoformat();atomic(DET,idx)
  atomic(REPORT,{'at':datetime.datetime.now().astimezone().isoformat(),'policy':'hybrid-v126-classification-only',
                 'reviewed':reviewed,'deleted':[],'remaining_events':len(ev)})
  print(json.dumps({'ok':True,'reviewed':reviewed,'deleted':0}))
 return 0
if __name__=='__main__':raise SystemExit(main())

