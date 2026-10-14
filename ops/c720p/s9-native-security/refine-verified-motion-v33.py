"""Final bounded pose-only review. Reuses face/body features and original ranges."""
import fcntl,hashlib,importlib.util,json,os,statistics,subprocess,sys,tempfile,time,urllib.parse,urllib.request
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');sys.path.insert(0,str(BASE/'bin'))
spec=importlib.util.spec_from_file_location('verified_worker',Path(__file__).with_name('verified-people-worker-v33.py'));w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
import numpy as np,cv2
from ai_edge_litert.interpreter import Interpreter
w.np=np;w.cv2=cv2;p=w.store;VERSION='verified_dense_motion_final_v33d'
def models():
 manifest=json.loads((w.RUNTIME/'models.json').read_text());result=object.__new__(w.Models)
 for name in ('detector','pose'):assert w.sha(Path(manifest[name]['path']))==manifest[name]['sha256']
 result.detector=cv2.dnn.readNetFromONNX(manifest['detector']['path']);result.pose=Interpreter(model_path=manifest['pose']['path'],num_threads=1);result.pose.allocate_tensors();result.pi=result.pose.get_input_details()[0];result.po=result.pose.get_output_details()[0]
 return result
def window(track):
 first,last=track['first_s'],track['last_s'];center=(first+last)/2
 points=track.get('trajectory',[])
 if len(points)>=5:
  choices=[]
  for (ta,a),(tb,b) in zip(points,points[1:]):
   at=(ta+tb)/2
   if tb-ta>1.5 or at<first+2 or at>last-2:continue
   distance=np.linalg.norm(np.array([(a[0]+a[2]-b[0]-b[2])/2,(a[1]+a[3]-b[1]-b[3])/2]));height=max(1,(a[3]-a[1]+b[3]-b[1])/2)
   choices.append((min(2,float(distance/height))*min(height,350),at))
  if choices:center=max(choices)[1]
 start=max(first,min(center-3,last-6));return start,min(last,start+6)
def sequence(url,track,others,model,width,height,item=None):
 start,end=window(track)
 if end-start<4:return [],'appearance_too_short'
 trajectory=track.get('trajectory') or []
 if not trajectory:
  if any(o['id']!=track['id'] and max(start,o['first_s'])<=min(end,o['last_s']) for o in others):return [],'multiple_people_track_association_unclear'
  trajectory=[]
  for at,frame in w.frames(url,1,width,height,start,end-start):
   detected=[box for score,box in model.detect(frame) if score>=.45]
   if len(detected)>1:return [],'multiple_people_track_association_unclear'
   if len(detected)==1:trajectory.append([at,detected[0]])
 if len(trajectory)<4:return [],'insufficient_continuous_person_boxes'
 observed=[];seen=set();source_signature=p.source_signature()
 for at,frame in w.frames(url,8,width,height,start,end-start):
  if item is not None and p.source_signature()!=source_signature:w.ensure_allowed(item);source_signature=p.source_signature()
  fingerprint=hashlib.blake2b(frame.tobytes(),digest_size=12).digest()
  if fingerprint in seen:continue
  seen.add(fingerprint)
  before=max((point for point in trajectory if point[0]<=at),default=trajectory[0]);after=min((point for point in trajectory if point[0]>=at),default=trajectory[-1])
  if after[0]-before[0]>1.5:continue
  factor=(at-before[0])/max(.001,after[0]-before[0]);box=[a+(b-a)*factor for a,b in zip(before[1],after[1])]
  if any(o['id']!=track['id'] and any(abs(t-at)<=.6 and w.overlap(box,b)>.2 for t,b in o.get('trajectory',[])) for o in others):continue
  image=w.crop(frame,box,.04)
  if image.size>100:observed.append([round(at,3),w.point_metrics(model.pose_points(image))])
 return observed,None
def remote_identity(item):
 config=json.loads((BASE/'config/drive-security-archive.json').read_text());index=json.loads((BASE/'state/drive-security-archive.json').read_text());row=next(r for r in index['items'] if r.get('camera')=='new' and r.get('state')=='verified' and r.get('remote_name')==item['name'])
 command=[config['rclone'],'--config',config['rclone_config'],'lsjson',config['remote']+':'+item['name'],'--stat','--hash','--drive-root-folder-id',str(config['folders']['new']['id'])]
 result=subprocess.run(command,capture_output=True,text=True,timeout=30,check=True);actual=json.loads(result.stdout);hashes={k.lower():v.lower() for k,v in actual.get('Hashes',{}).items() if isinstance(v,str)}
 if actual.get('Size')!=item['bytes'] or not row.get('md5') or hashes.get('md5')!=row['md5'].lower():raise ValueError('original_remote_digest_changed_or_unavailable')
def main():
 cv2.setNumThreads(1)
 with (p.ROOT/'worker.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);approved=p.allowed();features=p.read('features.json');assert features and all(k in features['entries'] and not features['entries'][k].get('error') for k in approved),'initial_batch_not_complete'
  backup=p.ROOT/'features-before-final-motion.json'
  if not backup.exists():backup.write_bytes((p.ROOT/'features.json').read_bytes());os.chmod(backup,0o600)
  model=models();errors=[];done=0
  for clip_key,item in sorted(approved.items(),key=lambda pair:pair[1]['bytes']):
   entry=features['entries'][clip_key];tracks=entry.get('tracks',[])
   if all(t.get('motion_version')==VERSION for t in tracks):done+=1;continue
   p.write('status.json',{'phase':'refining_movement','processed':len(approved),'total':len(approved),'message':f'Refining walking measurements: {done} of {len(approved)} verified clips','updated_at':p.utc()})
   temporary=None
   try:
    w.ensure_allowed(item);url='http://127.0.0.1:8795'+('/new/drive/saved/clip/' if item['source']=='drive' else '/new/saved/clip/')+urllib.parse.quote(item['name'],safe='')
    dimensions=None
    needs_review=any(t.get('motion_version')!=VERSION and t['last_s']-t['first_s']>=4 and t.get('metrics',{}).get('normalized_speed_body_heights_s',0)>=.12 for t in tracks)
    if needs_review:
     size=next((t['frame_size'] for t in tracks if isinstance(t.get('frame_size'),list) and len(t['frame_size'])==2),None)
     if size:
      if item['source']=='drive':remote_identity(item)
      dimensions=(entry['duration_s'],size[0],size[1])
     else:
      temporary=tempfile.TemporaryDirectory(prefix='verified-motion-',dir='/tmp');path=Path(temporary.name)/'original.mp4';original=w.fetch(item,path)
      if original!=entry['original_sha256']:raise ValueError('original_digest_changed')
      url=str(path);dimensions=w.metadata(path)
    for track in tracks:
     if track.get('motion_version')==VERSION:continue
     speed=track.get('metrics',{}).get('normalized_speed_body_heights_s',0);observed=[];reason='stationary_or_short_appearance'
     if track['last_s']-track['first_s']>=4 and speed>=.12:
      if dimensions is None:raise ValueError('verified_source_not_ready')
      w.ensure_allowed(item);_,width,height=dimensions;observed,reason=sequence(url,track,tracks,model,width,height,item)
     metrics=w.motion_summary(observed,speed)
     if reason:metrics['gait_status']=reason
     track['metrics'].update(metrics);track['motion_samples']=observed;track['motion_version']=VERSION;track['recorded_at']=w.recorded_at(item)
     shapes=[pose['shape'] for _,pose in observed if pose.get('shape')]
     if len(shapes)>=2:track['shape']=np.median(np.asarray(shapes),axis=0).tolist();track['metrics']['body_proportions']=[round(x,3) for x in track['shape']]
    w.ensure_allowed(item);p.write('features.json',features);done+=1
    print(json.dumps({'refined':done,'total':len(approved),'cadence_tracks':sum(t['metrics'].get('cadence_spm') is not None for t in tracks),'arm_motion_tracks':sum(t['metrics'].get('arm_swing_torso_lengths') is not None for t in tracks)}),flush=True)
   except Exception as error:errors.append({'clip_key':clip_key,'type':type(error).__name__});print('MOTION_REFINEMENT_RETRY_REQUIRED',type(error).__name__,flush=True)
   finally:
    if temporary is not None:temporary.cleanup()
  if not errors:p.reconcile_registry()
  p.write('motion-evaluation.json',{'version':VERSION,'approved_clips':len(approved),'refined_clips':done,'errors':errors,'finished_at':p.utc()})
  p.write('status.json',{'phase':'complete' if not errors else 'motion_retry_required','processed':len(approved),'total':len(approved),'errors':len(errors),'finished_at':p.utc(),'identity_accuracy':'Not measurable from presence-only verification'})
  print('FINAL_MOTION_PASS',json.dumps({'refined':done,'total':len(approved),'errors':len(errors)}),flush=True)
if __name__=='__main__':main()
