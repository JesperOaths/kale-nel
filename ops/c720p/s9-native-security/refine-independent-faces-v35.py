"""Stage temporally independent face probes from SHA-verified approved originals."""
import fcntl,hashlib,importlib.util,json,os,sys,tempfile
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');sys.path.insert(0,str(BASE/'bin'))
spec=importlib.util.spec_from_file_location('native_faces',BASE/'bin/refine-native-faces-v33.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
w=f.w;p=f.p;np=f.np;cv2=f.cv2

def sample_times(tracks,duration):
 anchors=sorted({round(c['time_s'],3) for t in tracks for c in t.get('face_captures',[]) if c.get('comparable')})
 result=[]
 for delta in (-.85,.85,-1.7,1.7,-2.55,2.55):
  for at in anchors:
   target=round(at+delta,3)
   if .05<=target<duration-.05 and all(abs(target-old)>=.75 for old in anchors+result):result.append(target)
   if len(result)>=12:return sorted(result)
 return sorted(result)

def main():
 cv2.setNumThreads(1)
 with (p.ROOT/'worker.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);before=(p.ROOT/'features.json').read_bytes();features=json.loads(before);approved=p.allowed();approval_sha=hashlib.sha256(json.dumps(approved,sort_keys=True).encode()).hexdigest();model=f.models();done=0;probes=0;errors=[]
  for clip_key,item in sorted(approved.items(),key=lambda pair:pair[1]['bytes']):
   entry=features['entries'][clip_key];tracks=entry.get('tracks',[]);plan=sample_times(tracks,entry['duration_s'])
   if not plan:continue
   try:
    w.ensure_allowed(item);candidates={t['id']:f.old_candidates(t) for t in tracks}
    with tempfile.TemporaryDirectory(prefix='independent-faces-v35-',dir='/tmp') as temporary:
     path=Path(temporary)/'original.mp4';assert w.fetch(item,path)==entry['original_sha256'],'original_digest_changed';width,height=f.dimensions(path)
     for at in plan:
      w.ensure_allowed(item);original=f.frame(path,at,width,height);detected=[(score,box) for score,box in model.detect(original) if score>=.44];probes+=1
      for score,box in detected:
       track=f.associate(at,box,tracks,width,height)
       if track is None or not track.get('trajectory') and len(detected)!=1:continue
       image=w.crop(original,box,.04)
       if image.size<100:continue
       faces=model.faces(image)
       if len(faces)!=1 or faces[0]['vector'] is None:continue
       face=faces[0];anchors=track.get('face_vectors',[])
       if anchors and max(p.cosine(v,face['vector']) or -1 for v in anchors)<.65:continue
       candidates[track['id']].append({'time_s':at,'image':face['image'],'vector':face['vector'],'quality':face['quality'],'native_resolution':True})
     for track in tracks:
      old=track.get('face_captures',[]);selected=f.choose(candidates[track['id']])
      # Publish neither fewer clear samples nor an overwritten current image.
      if sum(c['vector'] is not None for c in selected)<sum(c.get('comparable',False) for c in old):continue
      images={name:meta for name,meta in track.get('images',{}).items() if meta.get('kind')=='body'};names=[];captures=[];vectors=[]
      for candidate in selected:
       name,meta=w.image_save(track['id'],'face-v35-'+str(len(names)),candidate['image'])
       if not meta:continue
       names.append(name);images[name]=meta;comparable=candidate['vector'] is not None and len(vectors)<3;captures.append({'image':name,'time_s':round(candidate['time_s'],3),'comparable':comparable,'native_resolution':candidate.get('native_resolution',False)})
       if comparable:vectors.append(candidate['vector'])
      if len(names)<len(old):continue
      track.update(face_images=names,face_captures=captures,face_vectors=vectors,images=images);track['quality']['face_descriptor_samples']=len(vectors)
    w.ensure_allowed(item);entry['independent_face_version']='temporal_original_faces_v35';done+=1
    p.write('features-independent-faces-v35.json',features);print(json.dumps({'face_clips':done,'native_probes':probes,'comparable_tracks':sum(bool(t.get('face_vectors')) for e in features['entries'].values() for t in e.get('tracks',[]))}),flush=True)
   except Exception as error:errors.append({'clip_key':clip_key,'type':type(error).__name__});print('FACE_PROBE_RETRY',type(error).__name__,flush=True)
  assert (p.ROOT/'features.json').read_bytes()==before and hashlib.sha256(json.dumps(p.allowed(),sort_keys=True).encode()).hexdigest()==approval_sha,'source_changed_during_trial'
  p.write('features-independent-faces-v35.json',features);p.write('independent-face-evaluation-v35.json',{'baseline_features_sha256':hashlib.sha256(before).hexdigest(),'approved_sha256':approval_sha,'clips':done,'probes':probes,'errors':errors,'finished_at':p.utc()});print(json.dumps({'complete':not errors,'face_clips':done,'probes':probes,'errors':len(errors)}),flush=True)
if __name__=='__main__':main()
