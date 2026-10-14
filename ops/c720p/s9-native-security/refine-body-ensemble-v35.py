"""Private, staged second-model evidence. Does not alter published folders."""
import hashlib,importlib.util,json,os,sys
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');sys.path[:0]=[str(BASE/'bin'),'/tmp/people-v33-runtime/venv/lib/python3.13/site-packages',str(BASE/'person-detector/venv/lib/python3.13/site-packages')]
import numpy as np,cv2
import s9_verified_people_v33 as p
import s9_sd_proxy_extension as proxy
import s9_archive_delete_v1 as deletion
p.review._sd_rows=lambda:{k:v for k,v in proxy.rows().items() if k not in deletion.deleted()}
MODEL_ROOT=Path('/tmp/people-v35-models')

def sha(blob):return hashlib.sha256(blob).hexdigest()
def normalized(v):
 v=np.asarray(v,np.float32).reshape(-1)
 if v.shape!=(512,) or not np.isfinite(v).all() or np.linalg.norm(v)<1e-8:raise ValueError('invalid_reid_embedding')
 return (v/np.linalg.norm(v)).tolist()
def embedding(model,image):
 rgb=cv2.cvtColor(cv2.resize(image,(128,256)),cv2.COLOR_BGR2RGB).astype(np.float32)/255
 blob=((rgb-np.asarray([.485,.456,.406],np.float32))/np.asarray([.229,.224,.225],np.float32)).transpose(2,0,1)[None]
 model.setInput(blob);return normalized(model.forward())
def detector_input(image):
 height,width=image.shape[:2];ratio=min(640/height,640/width);out=np.full((640,640,3),114,np.float32)
 out[:int(height*ratio),:int(width*ratio)]=cv2.resize(image,(int(width*ratio),int(height*ratio)))
 return out
def main():
 cv2.setNumThreads(1);manifest=json.loads((MODEL_ROOT/'public-manifest.json').read_text())
 for name in ('osnet-ain-msmt17.onnx','yolox.onnx','yolox.py'):
  assert sha((MODEL_ROOT/name).read_bytes())==manifest[name]['sha256']
 spec=importlib.util.spec_from_file_location('public_yolox',MODEL_ROOT/'yolox.py');y=importlib.util.module_from_spec(spec);spec.loader.exec_module(y)
 detector=y.YoloX(str(MODEL_ROOT/'yolox.onnx'),confThreshold=.25);model=cv2.dnn.readNetFromONNX(str(MODEL_ROOT/'osnet-ain-msmt17.onnx'))
 # Export parity is independently checked on the actual OpenCV backend.
 reference=np.load(MODEL_ROOT/'synthetic-parity.npz')
 for index in range(3):
  model.setInput(reference['x'+str(index)]);actual=model.forward();expected=reference['y'+str(index)]
  assert actual.shape==(1,512) and np.isfinite(actual).all(),'opencv_output_shape'
  first,second=np.asarray(normalized(actual)),np.asarray(normalized(expected))
  # Instance norm on a constant input magnifies raw rounding; matching uses L2 vectors.
  assert float(np.dot(first,second))>.99999 and np.max(np.abs(first-second))<.0005,'opencv_export_parity'
 before=(p.ROOT/'features.json').read_bytes();features=json.loads(before);approved=p.allowed();approval_sha=sha(json.dumps(approved,sort_keys=True).encode());tracks=p.tracks_now();counts={'tracks':len(tracks),'embedded':0,'detector_supported':0,'detector_uncertain':0};scores=[]
 for clip_key,entry in features['entries'].items():
  if clip_key not in approved:continue
  for track in entry.get('tracks',[]):
   assert track['id'] in tracks
   name=track.get('body_image');meta=track.get('images',{}).get(name);assert name and p.IMAGE.fullmatch(name) and meta and meta['kind']=='body'
   blob=(p.ROOT/'images'/name).read_bytes();assert sha(blob)==meta['sha256'];image=cv2.imdecode(np.frombuffer(blob,np.uint8),cv2.IMREAD_COLOR);assert image is not None
   # A reflection is an augmentation of this view, never an independent sighting.
   vectors=[embedding(model,image),embedding(model,cv2.flip(image,1))];combined=normalized(np.mean(vectors,axis=0))
   detected=detector.infer(detector_input(image));score=max((float(row[4]) for row in detected if int(row[5])==0),default=0.)
   track['reid_v35_vectors']=[combined];track['reid_v35_evidence']={'model_sha256':manifest['osnet-ain-msmt17.onnx']['sha256'],'source_image_sha256':meta['sha256'],'views':1,'augmentation':'horizontal_flip_average','person_detector_score':round(score,4)}
   counts['embedded']+=1;counts['detector_supported']+=score>=.35;counts['detector_uncertain']+=score<.35;scores.append(score)
   if counts['embedded']%12==0:print(json.dumps(counts),flush=True)
 assert (p.ROOT/'features.json').read_bytes()==before and sha(json.dumps(p.allowed(),sort_keys=True).encode())==approval_sha,'source_changed_during_trial'
 p.write('features-ensemble-v35.json',features)
 p.write('ensemble-evaluation-v35.json',{'baseline_features_sha256':sha(before),'staged_features_sha256':sha((p.ROOT/'features-ensemble-v35.json').read_bytes()),'approved_sha256':approval_sha,'counts':counts,'model':manifest['osnet-ain-msmt17.onnx'],'detector_score_quantiles':[round(float(np.quantile(scores,q)),3) for q in (0,.1,.25,.5,.75,.9,1)],'finished_at':p.utc(),'private':True})
 print(json.dumps({'complete':True,**counts}),flush=True)
if __name__=='__main__':main()
