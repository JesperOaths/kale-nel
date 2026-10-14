"""Native head review at each real stored detection; no interpolated identities."""
import fcntl,hashlib,importlib.util,json,sys,tempfile
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');sys.path.insert(0,str(BASE/'bin'))
spec=importlib.util.spec_from_file_location('native_faces',BASE/'bin/refine-native-faces-v33.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
w=f.w;p=f.p;np=f.np;cv2=f.cv2;VERSION='dense_native_observed_heads_v35'

def observed_box(track,at,width,height):
 points=track.get('trajectory',[]);size=track.get('frame_size')
 if not points or not size:return None
 time,box=min(points,key=lambda pair:abs(pair[0]-at))
 if abs(time-at)>.03:return None
 return [box[0]*width/size[0],box[1]*height/size[1],box[2]*width/size[0],box[3]*height/size[1]]

def main():
 cv2.setNumThreads(1)
 with (p.ROOT/'worker.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);before=(p.ROOT/'features.json').read_bytes();approved=p.allowed();approval_sha=hashlib.sha256(json.dumps(approved,sort_keys=True).encode()).hexdigest();evaluation=p.read('original-views-evaluation-v35.json');assert evaluation and not evaluation['errors'] and evaluation['clips']==len(approved)
  assert evaluation['baseline_features_sha256']==hashlib.sha256(before).hexdigest() and evaluation['approved_sha256']==approval_sha
  features=p.read('features-dense-headfaces-v35.json') or p.read('features-original-views-v35.json');model=f.models();done=0;scans=0;errors=[]
  for clip_key,item in sorted(approved.items(),key=lambda pair:pair[1]['bytes']):
   entry=features['entries'][clip_key];tracks=entry.get('tracks',[]);targets=[t for t in tracks if t.get('trajectory') and t.get('frame_size') and len(t.get('face_vectors',[]))<3]
   if entry.get('dense_head_version')==VERSION or not targets:done+=1;continue
   try:
    w.ensure_allowed(item);candidates={t['id']:f.old_candidates(t) for t in targets}
    with tempfile.TemporaryDirectory(prefix='dense-heads-v35-',dir='/tmp') as temporary:
     path=Path(temporary)/'original.mp4';assert w.fetch(item,path)==entry['original_sha256'],'original_digest_changed';width,height=f.dimensions(path);fps=entry.get('sample_fps',1);assert 0<fps<=1
     for at,original in w.frames(path,fps,width,height):
      w.ensure_allowed(item)
      boxes={t['id']:observed_box(t,round(at,3),width,height) for t in tracks}
      for track in targets:
       box=boxes[track['id']]
       if box is None or any(other is not None and name!=track['id'] and w.overlap(box,other)>.25 for name,other in boxes.items()):continue
       # Same fps filter and start phase as the source tracking pass: this is
       # the exact observed frame, not a guessed frame at an interpolated time.
       image=w.crop(original,box,.04)
       if image.size<100:continue
       faces=model.faces(image);scans+=1
       if len(faces)!=1 or faces[0]['vector'] is None:continue
       face=faces[0]
       if track['face_vectors'] and max(p.cosine(v,face['vector']) or -1 for v in track['face_vectors'])<.65:continue
       candidates[track['id']].append({'time_s':at,'image':face['image'],'vector':face['vector'],'quality':face['quality'],'native_resolution':True})
     for track in targets:
      selected=f.choose(candidates[track['id']]);old_count=len(track['face_vectors']);images={name:meta for name,meta in track['images'].items() if meta['kind'].startswith('body')};names=[];captures=[];vectors=[]
      if sum(c['vector'] is not None for c in selected)<old_count:continue
      for candidate in selected:
       name,meta=w.image_save(track['id'],'face-v35d-'+str(len(names)),candidate['image'])
       if not meta:continue
       names.append(name);images[name]=meta;comparable=candidate['vector'] is not None and len(vectors)<3;captures.append({'image':name,'time_s':round(candidate['time_s'],3),'comparable':comparable,'native_resolution':candidate.get('native_resolution',False)})
       if comparable:vectors.append(candidate['vector'])
      if len(vectors)>=old_count and len(names)>=len(track['face_images']):track.update(face_images=names,face_captures=captures,face_vectors=vectors,images=images);track['quality']['face_descriptor_samples']=len(vectors)
    w.ensure_allowed(item);entry['dense_head_version']=VERSION;done+=1;p.write('features-dense-headfaces-v35.json',features)
    print(json.dumps({'clips':done,'total':len(approved),'observed_head_scans':scans,'comparable_face_tracks':sum(bool(t.get('face_vectors')) for e in features['entries'].values() for t in e.get('tracks',[])),'face_templates':sum(len(t.get('face_vectors',[])) for e in features['entries'].values() for t in e.get('tracks',[]))}),flush=True)
   except Exception as error:errors.append({'clip_key':clip_key,'type':type(error).__name__});print('DENSE_HEAD_RETRY',type(error).__name__,flush=True)
  assert (p.ROOT/'features.json').read_bytes()==before and hashlib.sha256(json.dumps(p.allowed(),sort_keys=True).encode()).hexdigest()==approval_sha,'source_changed_during_trial'
  p.write('dense-head-evaluation-v35.json',{'baseline_features_sha256':hashlib.sha256(before).hexdigest(),'approved_sha256':approval_sha,'clips':done,'errors':errors,'scans_this_run':scans,'finished_at':p.utc()});print(json.dumps({'complete':not errors,'clips':done,'errors':len(errors),'observed_head_scans':scans}),flush=True)
if __name__=='__main__':main()
