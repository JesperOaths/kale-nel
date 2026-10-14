"""Native-resolution multi-view gallery from frozen verified originals, hub only."""
import fcntl,hashlib,importlib.util,json,subprocess,sys,tempfile
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');sys.path[:0]=[str(Path(__file__).parent),str(BASE/'bin')]
spec=importlib.util.spec_from_file_location('native_faces',BASE/'bin/refine-native-faces-v33.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
spec=importlib.util.spec_from_file_location('motion_refinement',BASE/'bin/refine-verified-motion-v33.py');motion=importlib.util.module_from_spec(spec);spec.loader.exec_module(motion)
spec=importlib.util.spec_from_file_location('body_ensemble',Path(__file__).with_name('refine-body-ensemble-v35.py'));e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
w=f.w;p=f.p;cv2=f.cv2;np=f.np;VERSION='original_multiview_gallery_v35'

def plan(track,duration):
 points=track.get('trajectory',[])
 if points:
  ranked=sorted(points,key=lambda v:(v[1][2]-v[1][0])*(v[1][3]-v[1][1]),reverse=True);chosen=[]
  for at,box in ranked:
   if all(abs(at-old)>=1.5 for old in chosen):chosen.append(at)
   if len(chosen)==2:break
 else:chosen=[track['first_s'],track['last_s']]
 # The 1 fps extractor's frame selection can lie within the following half second.
 # Association is revalidated against the original frame's person detections.
 return sorted({round(min(duration-.05,max(.05,at+.4)),3) for at in chosen})

def frame(url,at,width,height):
 command=['nice','-n','17','ffmpeg','-nostdin','-hide_banner','-loglevel','error','-threads','1','-filter_threads','1','-ss',str(at),'-i',url,'-an','-sn','-frames:v','1','-f','rawvideo','-pix_fmt','bgr24','pipe:1']
 result=subprocess.run(command,capture_output=True,timeout=40,check=True)
 if len(result.stdout)!=width*height*3:raise ValueError('original_frame_shape')
 return np.frombuffer(result.stdout,np.uint8).reshape(height,width,3).copy()

def main():
 cv2.setNumThreads(1)
 with (p.ROOT/'worker.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);before=(p.ROOT/'features.json').read_bytes();approved=p.allowed();approval_sha=e.sha(json.dumps(approved,sort_keys=True).encode());receipt=p.read('best-fit-preview-v35.json');assert receipt['baseline_features_sha256']==e.sha(before) and receipt['approved_sha256']==approval_sha
  features=p.read('features-original-views-v35.json') or p.read('features-ready-v35.json');manifest=json.loads((e.MODEL_ROOT/'public-manifest.json').read_text());assert e.sha((e.MODEL_ROOT/'osnet-ain-msmt17.onnx').read_bytes())==manifest['osnet-ain-msmt17.onnx']['sha256']
  model=f.models();old_manifest=json.loads((w.RUNTIME/'models.json').read_text());assert w.sha(Path(old_manifest['reid.onnx']['path']))==old_manifest['reid.onnx']['sha256'];model.body=cv2.dnn.readNetFromONNX(old_manifest['reid.onnx']['path']);reid=cv2.dnn.readNetFromONNX(str(e.MODEL_ROOT/'osnet-ain-msmt17.onnx'));done=0;errors=[];native_views=0
  for clip_key,item in sorted(approved.items(),key=lambda pair:pair[1]['bytes']):
   entry=features['entries'][clip_key];tracks=entry.get('tracks',[])
   if entry.get('original_views_version')==VERSION or not tracks:done+=1;continue
   temporary=None
   try:
    w.ensure_allowed(item);assert item['source']=='drive';temporary=tempfile.TemporaryDirectory(prefix='native-views-v35-',dir='/tmp');local=Path(temporary.name)/'original.mp4'
    assert w.fetch(item,local)==entry['original_sha256'],'original_digest_changed';url=str(local);width,height=f.dimensions(local)
    candidates={t['id']:f.old_candidates(t) for t in tracks};seen={t['id']:[] for t in tracks};body_images={};new_vectors={t['id']:[] for t in tracks};old_vectors={t['id']:[] for t in tracks}
    schedule=sorted({at for t in tracks for at in plan(t,entry['duration_s'])})
    for at in schedule:
     w.ensure_allowed(item);original=frame(url,at,width,height);detected=[(score,box) for score,box in model.detect(original) if score>=.44]
     for score,box in detected:
      track=f.associate(at,box,tracks,width,height);image=w.crop(original,box,.04)
      if image.size<100:continue
      embedding=None
      if track is None:
       # Older tracks lack boxes: require a distinctive within-recording match.
       active=[t for t in tracks if not t.get('trajectory') and t['first_s']-.6<=at<=t['last_s']+.6]
       if not active:continue
       embedding=e.embedding(reid,image);ranked=sorted(((max(p.cosine(v,embedding) or -1 for v in t['reid_v35_vectors']),t) for t in active),key=lambda pair:pair[0],reverse=True)
       if ranked[0][0]<.75 or len(ranked)>1 and ranked[0][0]-ranked[1][0]<.08:continue
       track=ranked[0][1]
      if not track.get('trajectory') and len(detected)>1:
       embedding=embedding or e.embedding(reid,image)
       if max(p.cosine(v,embedding) or -1 for v in track['reid_v35_vectors'])<.75:continue
      if any(abs(at-other)<1.5 for other in seen[track['id']]) or len(seen[track['id']])>=2:continue
      seen[track['id']].append(at);embedding=embedding or e.embedding(reid,image);new_vectors[track['id']].append(embedding);old_vectors[track['id']].append(model.body_vector(image));native_views+=1
      quality=score*min(600,image.shape[0]);best=body_images.get(track['id'])
      if best is None or quality>best[0]:body_images[track['id']]=(quality,image.copy())
      faces=model.faces(image)
      if len(faces)==1:
       face=faces[0]
       if face['vector'] is not None and (not track.get('face_vectors') or max(p.cosine(v,face['vector']) or -1 for v in track['face_vectors'])>=.65):candidates[track['id']].append({'time_s':at,'image':face['image'],'vector':face['vector'],'quality':face['quality'],'native_resolution':True})
    w.ensure_allowed(item)
    for track in tracks:
     added=new_vectors[track['id']]
     if added:
      track['reid_v35_vectors']=track['reid_v35_vectors']+added;track['body_vectors']=track['body_vectors']+old_vectors[track['id']];track['reid_v35_evidence']['original_frame_times_s']=seen[track['id']];track['reid_v35_evidence']['views']=1+len(added);track['reid_v35_evidence']['original_sha256']=entry['original_sha256']
      name,meta=w.image_save(track['id'],'body-v35',body_images[track['id']][1])
      if meta:track['body_image']=name;track['images'][name]=meta
     selected=f.choose(candidates[track['id']]);old_count=len(track['face_vectors'])
     if sum(c['vector'] is not None for c in selected)<old_count:continue
     images={name:meta for name,meta in track['images'].items() if meta['kind'].startswith('body')};names=[];captures=[];vectors=[]
     for candidate in selected:
      name,meta=w.image_save(track['id'],'face-v35-'+str(len(names)),candidate['image'])
      if not meta:continue
      names.append(name);images[name]=meta;comparable=candidate['vector'] is not None and len(vectors)<3;captures.append({'image':name,'time_s':candidate['time_s'],'comparable':comparable,'native_resolution':candidate.get('native_resolution',False)})
      if comparable:vectors.append(candidate['vector'])
     if len(vectors)>=old_count and len(names)>=len(track['face_images']):track.update(face_images=names,face_captures=captures,face_vectors=vectors,images=images);track['quality']['face_descriptor_samples']=len(vectors)
    entry['original_views_version']=VERSION;done+=1;p.write('features-original-views-v35.json',features);print(json.dumps({'clips':done,'total':len(approved),'new_native_body_views':native_views,'comparable_face_tracks':sum(bool(t.get('face_vectors')) for e in features['entries'].values() for t in e.get('tracks',[]))}),flush=True)
   except Exception as error:errors.append({'clip_key':clip_key,'type':type(error).__name__});print('ORIGINAL_VIEW_RETRY',type(error).__name__,flush=True)
   finally:
    if temporary is not None:temporary.cleanup()
  assert (p.ROOT/'features.json').read_bytes()==before and e.sha(json.dumps(p.allowed(),sort_keys=True).encode())==approval_sha,'source_changed_during_trial'
  p.write('original-views-evaluation-v35.json',{'baseline_features_sha256':e.sha(before),'approved_sha256':approval_sha,'clips':done,'errors':errors,'new_native_views_this_run':native_views,'finished_at':p.utc()});print(json.dumps({'complete':not errors,'clips':done,'errors':len(errors),'new_native_body_views':native_views}),flush=True)
if __name__=='__main__':main()
