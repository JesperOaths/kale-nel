"""Original-resolution face ROI review on the frozen human-verified set only."""
import fcntl,hashlib,importlib.util,json,os,subprocess,sys,tempfile,urllib.error
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');sys.path.insert(0,str(BASE/'bin'))
spec=importlib.util.spec_from_file_location('face_worker',Path(__file__).with_name('verified-people-worker-v33.py'));w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
import numpy as np,cv2
from ai_edge_litert.interpreter import Interpreter
w.np=np;w.cv2=cv2;p=w.store;VERSION='original_resolution_faces_v33e'
def models():
 manifest=json.loads((w.RUNTIME/'models.json').read_text());model=object.__new__(w.Models)
 for name in ('detector','face_embedding','yunet.onnx'):assert w.sha(Path(manifest[name]['path']))==manifest[name]['sha256']
 model.detector=cv2.dnn.readNetFromONNX(manifest['detector']['path']);model.face_detector=cv2.FaceDetectorYN.create(manifest['yunet.onnx']['path'],'',(320,320),.88,.3,2000);model.face=Interpreter(model_path=manifest['face_embedding']['path'],num_threads=1);model.face.allocate_tensors();model.fi=model.face.get_input_details();model.fo=model.face.get_output_details()[0]
 assert len(model.fi)==2 and all(tuple(t['shape'])==(1,3,112,112) for t in model.fi) and tuple(model.fo['shape'])==(2,128)
 return model
def dimensions(path):
 result=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height:stream_tags=rotate:stream_side_data=rotation','-of','json',str(path)],capture_output=True,text=True,timeout=15,check=True);stream=json.loads(result.stdout)['streams'][0];width,height=stream['width'],stream['height'];rotation=int(stream.get('tags',{}).get('rotate',0))
 for data in stream.get('side_data_list',[]):rotation=int(data.get('rotation',rotation))
 if abs(rotation)%180==90:width,height=height,width
 if not 64<=width<=4096 or not 64<=height<=4096 or width*height>9000000:raise ValueError('unsupported_original_resolution')
 return width,height
def sample_times(tracks,duration):
 priorities=[]
 for track in tracks:
  for capture in track.get('face_captures',[]):priorities.append((4 if capture.get('comparable') else 3,capture['time_s']));priorities.append((2.5,capture['time_s']+.35))
  points=track.get('trajectory',[])
  for at,box in sorted(points,key=lambda x:(x[1][2]-x[1][0])*(x[1][3]-x[1][1]),reverse=True)[:12]:priorities.append((2,at))
  for at in (track['first_s']+.5,(track['first_s']+track['last_s'])/2,max(track['first_s'],track['last_s']-.5)):priorities.append((1,at))
 chosen=[]
 for _,at in sorted(priorities,reverse=True):
  at=round(max(0,min(duration-.05,float(at))),3)
  if all(abs(at-other)>=.3 for other in chosen):chosen.append(at)
  if len(chosen)>=6:break
 return sorted(chosen)
def frame(path,at,width,height):
 command=['nice','-n','15','ffmpeg','-nostdin','-hide_banner','-loglevel','error','-threads','1','-ss',str(at),'-i',str(path),'-an','-sn','-frames:v','1','-f','rawvideo','-pix_fmt','bgr24','pipe:1']
 result=subprocess.run(command,capture_output=True,timeout=25,check=True)
 if len(result.stdout)!=width*height*3:raise ValueError('original_frame_shape')
 return np.frombuffer(result.stdout,np.uint8).reshape(height,width,3).copy()
def associate(at,box,tracks,width,height):
 active=[t for t in tracks if t['first_s']-.75<=at<=t['last_s']+.75];ranked=[]
 for track in active:
  points=track.get('trajectory');size=track.get('frame_size')
  if not points or not size:continue
  _,old=min(points,key=lambda point:abs(point[0]-at));predicted=[old[0]*width/size[0],old[1]*height/size[1],old[2]*width/size[0],old[3]*height/size[1]];score=w.overlap(box,predicted)
  if score>=.2:ranked.append((score,track))
 ranked.sort(key=lambda pair:pair[0],reverse=True)
 if ranked and (len(ranked)==1 or ranked[0][0]-ranked[1][0]>=.12):return ranked[0][1]
 return active[0] if not ranked and len(active)==1 and not active[0].get('trajectory') else None
def old_candidates(track):
 result=[];vector_index=0
 for capture in track.get('face_captures',[]):
  vector=None
  if capture.get('comparable'):
   vectors=track.get('face_vectors',[]);vector=vectors[vector_index] if vector_index<len(vectors) else None;vector_index+=1
  image_name=capture['image'];meta=track.get('images',{}).get(image_name);path=p.ROOT/'images'/image_name
  if not meta or not path.is_file():continue
  blob=path.read_bytes()
  if hashlib.sha256(blob).hexdigest()!=meta['sha256']:continue
  image=cv2.imdecode(np.frombuffer(blob,np.uint8),cv2.IMREAD_COLOR)
  if image is None:continue
  result.append({'time_s':capture['time_s'],'image':image,'vector':vector,'quality':min(image.shape[:2])*.88,'native_resolution':capture.get('native_resolution',False)})
 return result
def choose(candidates):
 candidates.sort(key=lambda c:(c['vector'] is not None,c['quality'],c.get('native_resolution',False)),reverse=True);result=[]
 for candidate in candidates:
  if all(abs(candidate['time_s']-other['time_s'])>=.75 for other in result):result.append(candidate)
  if len(result)>=4:break
 anchor=None
 for candidate in result:
  vector=candidate['vector']
  if vector is None:continue
  if anchor is None:anchor=vector
  elif (p.cosine(anchor,vector) or -1)<.65:candidate['vector']=None
 return result
def main():
 cv2.setNumThreads(1)
 with (p.ROOT/'worker.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);approved=p.allowed();features=p.read('features.json');assert features and all(k in features['entries'] and not features['entries'][k].get('error') for k in approved)
  backup=p.ROOT/'features-before-native-faces-v33.json'
  if not backup.exists():backup.write_bytes((p.ROOT/'features.json').read_bytes());os.chmod(backup,0o600)
  model=models();errors=[];done=0
  for clip_key,item in sorted(approved.items(),key=lambda pair:pair[1]['bytes']):
   entry=features['entries'][clip_key];tracks=entry.get('tracks',[])
   if entry.get('native_face_version')==VERSION or not tracks:done+=1;continue
   p.write('status.json',{'phase':'refining_faces','processed':len(approved),'total':len(approved),'message':f'Reviewing original-resolution faces: {done} of {len(approved)} verified clips','updated_at':p.utc()})
   try:
    w.ensure_allowed(item);candidates={t['id']:old_candidates(t) for t in tracks}
    with tempfile.TemporaryDirectory(prefix='verified-native-face-',dir='/tmp') as temporary:
     path=Path(temporary)/'original.mp4'
     if w.fetch(item,path)!=entry['original_sha256']:raise ValueError('original_digest_changed')
     width,height=dimensions(path)
     for at in sample_times(tracks,entry['duration_s']):
      w.ensure_allowed(item);original=frame(path,at,width,height);detected=[(score,box) for score,box in model.detect(original) if score>=.44]
      for score,box in detected:
       track=associate(at,box,tracks,width,height)
       if track is None or not track.get('trajectory') and len(detected)!=1:continue
       person=w.crop(original,box,.04)
       if person.size<100:continue
       faces=model.faces(person)
       if len(faces)!=1:continue
       face=faces[0];candidates[track['id']].append({'time_s':at,'image':face['image'],'vector':face['vector'],'quality':face['quality'],'native_resolution':True})
     for track in tracks:
      selected=choose(candidates[track['id']]);images={name:meta for name,meta in track.get('images',{}).items() if meta.get('kind')=='body'};names=[];captures=[];vectors=[]
      for candidate in selected:
       name,meta=w.image_save(track['id'],'face-'+str(len(names)),candidate['image'])
       if meta:
        names.append(name);images[name]=meta;captures.append({'image':name,'time_s':round(candidate['time_s'],3),'comparable':candidate['vector'] is not None,'native_resolution':candidate.get('native_resolution',False)})
        if candidate['vector'] is not None and len(vectors)<3:vectors.append(candidate['vector'])
      track['face_images']=names;track['face_captures']=captures;track['face_vectors']=vectors;track['images']=images;track['quality']['face_descriptor_samples']=len(vectors)
    w.ensure_allowed(item);entry['native_face_version']=VERSION;entry['native_frame_size']=[width,height];p.write('features.json',features);done+=1
    print(json.dumps({'native_face_clips':done,'total':len(approved),'face_crops':sum(len(t['face_images']) for t in tracks),'comparable_tracks':sum(bool(t['face_vectors']) for t in tracks)}),flush=True)
   except Exception as error:errors.append({'clip_key':clip_key,'type':type(error).__name__});print('NATIVE_FACE_RETRY_REQUIRED',type(error).__name__,flush=True)
  approved=p.allowed();errors=[error for error in errors if error['clip_key'] in approved];done=sum(not features['entries'][k].get('tracks') or features['entries'][k].get('native_face_version')==VERSION for k in approved)
  if not errors:p.reconcile_registry()
  p.write('native-face-evaluation.json',{'version':VERSION,'approved_clips':len(approved),'processed_clips':done,'errors':errors,'finished_at':p.utc()});p.write('status.json',{'phase':'complete' if not errors else 'native_face_retry_required','processed':len(approved),'total':len(approved),'errors':len(errors),'finished_at':p.utc(),'identity_accuracy':'Not measurable from presence-only verification'})
  print('ORIGINAL_RESOLUTION_FACE_PASS',json.dumps({'processed':done,'total':len(approved),'errors':len(errors)}),flush=True)
if __name__=='__main__':main()
