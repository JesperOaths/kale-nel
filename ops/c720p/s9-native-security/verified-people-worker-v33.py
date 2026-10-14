"""Offline inference on the owner's frozen, currently verified archive set only."""
import argparse,datetime,fcntl,hashlib,json,math,os,shutil,signal,statistics,subprocess,sys,tempfile,time,urllib.request
from zoneinfo import ZoneInfo
from pathlib import Path
RUNTIME=Path('/tmp/people-v33-runtime');BASE=Path('/home/jespern/c720p-home-hub')
sys.path.insert(0,str(RUNTIME/'venv/lib/python3.13/site-packages'))
sys.path.append(str(BASE/'person-detector/venv/lib/python3.13/site-packages'))
sys.path.insert(0,str(BASE/'bin'))
import s9_verified_people_v33 as store
import s9_sd_proxy_extension as proxy
import s9_archive_delete_v1 as archive_delete
store.review._sd_rows=lambda:{k:v for k,v in proxy.rows().items() if k not in archive_delete.deleted()}
ALGORITHM='yolo5n-youtu-mfn-movenet-v33a'
FACE_SAMPLING='whole_appearance_head_sampling_v33b'
MOTION_VERSION='projected_two_axis_leg_motion_v33c'
def sha(path,algorithm='sha256'):
 h=hashlib.new(algorithm)
 with path.open('rb') as source:
  while chunk:=source.read(1048576):h.update(chunk)
 return h.hexdigest()
def ensure_allowed(item):
 approved=store.allowed().get(store.key(item))
 if not approved or approved['revision']!=item['revision']:raise ValueError('verification_revoked_or_file_changed')
def fetch(item,path):
 ensure_allowed(item);size=item['bytes']
 if not 10000<size<=500000000 or shutil.disk_usage(path.parent).free<size+100000000:raise ValueError('insufficient_temporary_space')
 if item['source']=='drive':
  config=json.loads((BASE/'config/drive-security-archive.json').read_text());index=json.loads((BASE/'state/drive-security-archive.json').read_text())
  row=next(r for r in index['items'] if r.get('camera')=='new' and r.get('state')=='verified' and r.get('remote_name')==item['name'])
  command=[config['rclone'],'--config',config['rclone_config'],'cat',config['remote']+':'+item['name'],'--drive-root-folder-id',str(config['folders']['new']['id']),'--max-transfer',str(size+1)]
  with path.open('wb') as out:result=subprocess.run(command,stdout=out,stderr=subprocess.DEVNULL,timeout=240)
  if result.returncode:raise ValueError('archive_download_failed')
  if row.get('md5') and sha(path,'md5')!=row['md5']:raise ValueError('archive_digest_changed')
 else:
  with urllib.request.urlopen('http://127.0.0.1:18808/clip/'+item['name'],timeout=60) as response,path.open('wb') as out:
   copied=0
   while chunk:=response.read(1048576):
    copied+=len(chunk)
    if copied>size:raise ValueError('archive_size_changed')
    out.write(chunk)
 if path.stat().st_size!=size:raise ValueError('archive_size_changed')
 os.chmod(path,0o600);ensure_allowed(item);return sha(path)
def metadata(path):
 result=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height:stream_tags=rotate:stream_side_data=rotation:format=duration','-of','json',str(path)],capture_output=True,text=True,timeout=15,check=True)
 data=json.loads(result.stdout);stream=data['streams'][0];duration=float(data['format']['duration']);w,h=stream['width'],stream['height']
 rotation=int(stream.get('tags',{}).get('rotate',0))
 for side in stream.get('side_data_list',[]):rotation=int(side.get('rotation',rotation))
 if abs(rotation)%180==90:w,h=h,w
 if not 0<duration<=1800:raise ValueError('unsupported_recording_duration')
 scale=min(1,960/w,720/h);return duration,max(2,int(w*scale)//2*2),max(2,int(h*scale)//2*2)
def frames(path,fps,w,h,start=0,duration=None):
 command=['nice','-n','15','ffmpeg','-nostdin','-hide_banner','-loglevel','error','-threads','1','-filter_threads','1']
 if start:command+=['-ss',str(start)]
 if str(path).startswith('http://127.0.0.1:'):command+=['-rw_timeout','20000000']
 command+=['-i',str(path)]
 if duration is not None:command+=['-t',str(duration)]
 command+=['-an','-sn','-vf',f'fps={fps},scale={w}:{h}','-f','rawvideo','-pix_fmt','bgr24','pipe:1']
 process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL);n=w*h*3;index=0
 try:
  while True:
   raw=process.stdout.read(n)
   if not raw:break
   if len(raw)!=n:raise ValueError('incomplete_decoded_frame')
   yield start+index/fps,np.frombuffer(raw,np.uint8).reshape(h,w,3).copy();index+=1
  if process.wait(timeout=15):raise ValueError('video_decode_failed')
 finally:
  process.stdout.close()
  if process.poll() is None:process.terminate()
  try:process.wait(timeout=5)
  except subprocess.TimeoutExpired:process.kill();process.wait()
def norm(value):
 a=np.asarray(value,np.float32).reshape(-1);length=np.linalg.norm(a)
 if not np.all(np.isfinite(a)) or length<1e-9:raise ValueError('nonfinite_or_zero_descriptor')
 return a/length
def overlap(a,b):
 x=max(0,min(a[2],b[2])-max(a[0],b[0]));y=max(0,min(a[3],b[3])-max(a[1],b[1]));area=x*y
 return area/max(1,(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-area)
def crop(frame,box,pad=0):
 h,w=frame.shape[:2];x,y,r,b=box;dx=(r-x)*pad;dy=(b-y)*pad
 return frame[max(0,int(y-dy)):min(h,int(b+dy)),max(0,int(x-dx)):min(w,int(r+dx))].copy()
def colours(image):
 values=[];h,w=image.shape[:2]
 for top,bottom in ((.20,.52),(.55,.93)):
  region=image[int(h*top):max(int(h*top)+1,int(h*bottom)),int(w*.18):max(int(w*.18)+1,int(w*.82))]
  hsv=cv2.cvtColor(region,cv2.COLOR_BGR2HSV)
  hist=cv2.calcHist([hsv],[0,1],None,[12,4],[0,180,0,256]).reshape(-1)
  gray=cv2.calcHist([hsv],[2],None,[8],[0,256]).reshape(-1)
  values.extend(norm(hist).tolist());values.extend(norm(gray).tolist())
 return norm(values)
class Models:
 def __init__(self):
  from ai_edge_litert.interpreter import Interpreter
  self.manifest=json.loads((RUNTIME/'models.json').read_text())
  for meta in self.manifest.values():assert sha(Path(meta['path']))==meta['sha256']
  self.detector=cv2.dnn.readNetFromONNX(self.manifest['detector']['path']);self.body=cv2.dnn.readNetFromONNX(self.manifest['reid.onnx']['path'])
  self.face_detector=cv2.FaceDetectorYN.create(self.manifest['yunet.onnx']['path'],'',(320,320),.88,.3,2000)
  self.face=Interpreter(model_path=self.manifest['face_embedding']['path'],num_threads=1);self.face.allocate_tensors()
  self.pose=Interpreter(model_path=self.manifest['pose']['path'],num_threads=1);self.pose.allocate_tensors()
  self.fi=self.face.get_input_details();self.fo=self.face.get_output_details()[0];self.pi=self.pose.get_input_details()[0];self.po=self.pose.get_output_details()[0]
  assert len(self.fi)==2 and all(tuple(t['shape'])==(1,3,112,112) for t in self.fi) and tuple(self.fo['shape'])==(2,128)
  assert tuple(self.pi['shape'])==(1,192,192,3) and self.pi['dtype']==np.uint8 and tuple(self.po['shape'])==(1,1,17,3)
  self.timings={}
  def measured(name,method):
   def call(*args):
    start=time.monotonic()
    try:return method(*args)
    finally:self.timings[name]=self.timings.get(name,0)+time.monotonic()-start
   return call
  for name in ('detect','body_vector','pose_points','faces'):setattr(self,name,measured(name,getattr(self,name)))
 def detect(self,image):
  h,w=image.shape[:2];ratio=min(640/w,640/h);sw,sh=round(w*ratio),round(h*ratio);left,top=(640-sw)//2,(640-sh)//2
  padded=np.full((640,640,3),114,np.uint8);padded[top:top+sh,left:left+sw]=cv2.resize(image,(sw,sh))
  self.detector.setInput(cv2.dnn.blobFromImage(padded,1/255.,(640,640),swapRB=True));out=self.detector.forward()[0]
  scores=out[:,4]*out[:,5];indices=np.where((scores>=.32)&(np.argmax(out[:,5:],axis=1)==0))[0];boxes=[];conf=[]
  for index in indices:
   cx,cy,bw,bh=out[index,:4];x=max(0,(cx-bw/2-left)/ratio);y=max(0,(cy-bh/2-top)/ratio);r=min(w,(cx+bw/2-left)/ratio);b=min(h,(cy+bh/2-top)/ratio)
   if r-x<9 or b-y<30 or not .65<(b-y)/max(1,r-x)<6:continue
   boxes.append([float(x),float(y),float(r-x),float(b-y)]);conf.append(float(scores[index]))
  keep=cv2.dnn.NMSBoxes(boxes,conf,.32,.4)
  return [(conf[int(i)],[boxes[int(i)][0],boxes[int(i)][1],boxes[int(i)][0]+boxes[int(i)][2],boxes[int(i)][1]+boxes[int(i)][3]]) for i in np.asarray(keep).reshape(-1)[:12]]
 def body_vector(self,image):
  rgb=cv2.cvtColor(cv2.resize(image,(128,256)),cv2.COLOR_BGR2RGB).astype(np.float32)/255
  rgb=(rgb-np.array([.485,.456,.406],np.float32))/np.array([.229,.224,.225],np.float32)
  self.body.setInput(np.transpose(rgb,(2,0,1))[None]);out=norm(self.body.forward())
  if out.size!=768:raise ValueError('body_model_contract')
  return out.tolist()
 def pose_points(self,image):
  h,w=image.shape[:2];side=max(h,w)*1.12;scale=192/side;left=(192-w*scale)/2;top=(192-h*scale)/2
  transform=np.array([[scale,0,left],[0,scale,top]],np.float32)
  rgb=cv2.cvtColor(cv2.warpAffine(image,transform,(192,192)),cv2.COLOR_BGR2RGB)[None]
  self.pose.set_tensor(self.pi['index'],rgb);self.pose.invoke();out=self.pose.get_tensor(self.po['index'])[0,0].copy()
  out[:,0]=(out[:,0]*192-top)/scale/max(1,h);out[:,1]=(out[:,1]*192-left)/scale/max(1,h)
  if not np.all(np.isfinite(out)):raise ValueError('nonfinite_pose')
  outside=(out[:,0]<0)|(out[:,0]>1)|(out[:,1]<0)|(out[:,1]>w/max(1,h));out[outside,2]=0
  return out
 def faces(self,image):
  h,w=image.shape[:2];head=image[:max(1,int(h*.58))];scale=min(3,640/max(head.shape[:2]));large=cv2.resize(head,None,fx=scale,fy=scale)
  self.face_detector.setInputSize((large.shape[1],large.shape[0]));found=self.face_detector.detect(large)[1];result=[]
  if found is None:return result
  targets=np.array([[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],[41.5493,92.3655],[70.7299,92.2041]],np.float32)
  for face in found[:3]:
   x,y,bw,bh=face[:4]/scale
   if min(bw,bh)<16 or not .10*w<x+bw/2<.90*w or y+bh/2>.38*h:continue
   box=[x,y,x+bw,y+bh];portrait=crop(head,box,.15)
   if portrait.size<100:continue
   landmarks=face[4:14].reshape(5,2)/scale;eye=np.linalg.norm(landmarks[0]-landmarks[1]);yaw=abs(float(landmarks[2,0]-(landmarks[0,0]+landmarks[1,0])/2))/max(1,eye)
   gray=cv2.cvtColor(portrait,cv2.COLOR_BGR2GRAY);blur=float(cv2.Laplacian(gray,cv2.CV_64F).var());brightness=float(gray.mean());vector=None
   if min(bw,bh)>=28 and eye>=9 and yaw<=.30 and blur>=25 and 25<=brightness<=235:
    transform,_=cv2.estimateAffinePartial2D(landmarks,targets,method=cv2.LMEDS)
    if transform is not None:
     aligned=cv2.warpAffine(image,transform,(112,112));tensor=np.transpose((cv2.cvtColor(aligned,cv2.COLOR_BGR2RGB).astype(np.float32)-127.5)/128,(2,0,1))[None]
     for inp in self.fi:self.face.set_tensor(inp['index'],tensor)
     self.face.invoke();raw=self.face.get_tensor(self.fo['index']);a,b=norm(raw[0]),norm(raw[1])
     if float(a@b)<.99:raise ValueError('face_paired_self_check')
     vector=a.tolist()
   result.append({'image':portrait,'vector':vector,'quality':float(face[-1])*min(bw,bh),'recognition_quality':vector is not None})
  return result
def point_metrics(points):
 def valid(ids):return all(points[i,2]>=.45 and -.1<=points[i,0]<=1.1 and -.1<=points[i,1]<=1.1 for i in ids)
 def length(a,b):return float(np.linalg.norm(points[a,:2]-points[b,:2]))
 result={}
 if valid((5,6,11,12)):
  shoulder=(points[5,:2]+points[6,:2])/2;hip=(points[11,:2]+points[12,:2])/2;torso=float(np.linalg.norm(shoulder-hip))
  angle=math.degrees(math.atan2(abs(float(shoulder[1]-hip[1])),max(.01,abs(float(shoulder[0]-hip[0])))))
  result.update({'torso_lean_degrees':angle,'posture':'leaning' if angle>28 else 'upright'})
  if torso>.05 and valid((7,8,9,10,13,14,15,16)):
   result['shape']=[length(5,6)/torso,length(11,12)/torso,(length(11,13)+length(13,15)+length(12,14)+length(14,16))/(2*torso),(length(5,7)+length(7,9)+length(6,8)+length(8,10))/(2*torso)]
 if valid((11,12,15,16)) and min(points[15,2],points[16,2])>=.6:
  result['ankle_signal']=float(points[15,0]-points[16,0]);result['ankle_x']=float(points[15,1]-points[16,1]);result['ankle_y']=result['ankle_signal'];result['full_legs']=True
 if valid((5,6,9,10,11,12)):
  shoulder=(points[5,:2]+points[6,:2])/2;hip=(points[11,:2]+points[12,:2])/2;torso=float(np.linalg.norm(shoulder-hip))
  if torso>.05:result['wrist_relative_torso']=((points[[9,10],:2]-hip)/torso).reshape(-1).tolist()
 return result
def gait_metrics(sequence,speed):
 # Eight actual decoded frames/s; no cadence claim from coarse or repeated frames.
 good=[(t,p) for t,p in sequence if p.get('full_legs')]
 if len(good)<32 or speed<.12:return {'cadence_spm':None,'gait_status':'insufficient_clear_continuous_walking'}
 times=np.array([t for t,_ in good]);xy=np.array([[p.get('ankle_x',0),p.get('ankle_y',p['ankle_signal'])] for _,p in good]);xy-=xy.mean(axis=0)
 _,axes=np.linalg.eigh(xy.T@xy);signal=xy@axes[:,-1]
 if np.max(np.diff(times))>.38 or times[-1]-times[0]<4 or signal.std()<.015:return {'cadence_spm':None,'gait_status':'occluded_or_insufficient_leg_motion'}
 grid=np.arange(times[0],times[-1]+.01,.125)
 if len(good)/len(grid)<.75:return {'cadence_spm':None,'gait_status':'too_many_missing_leg_observations'}
 signal=np.interp(grid,times,signal);signal-=signal.mean()
 correlations=[]
 for lag in range(5,min(22,len(signal)//2)+1):
  a,b=signal[:-lag],signal[lag:];den=np.linalg.norm(a)*np.linalg.norm(b)
  correlations.append((float(a@b/den) if den>1e-8 else 0,lag))
 maximum=max(score for score,_ in correlations)
 peaks=[(score,lag) for index,(score,lag) in enumerate(correlations) if (index==0 or score>=correlations[index-1][0]) and (index==len(correlations)-1 or score>=correlations[index+1][0]) and score>=max(.65,maximum*.9)]
 strength,lag=min(peaks,key=lambda pair:pair[1]) if peaks else max(correlations)
 if strength<.65:return {'cadence_spm':None,'gait_status':'no_repeatable_step_cycle'}
 cadence=960/lag
 if not 45<=cadence<=210:return {'cadence_spm':None,'gait_status':'step_cycle_outside_measurable_range'}
 return {'cadence_spm':round(cadence,1),'gait_status':'projected_step_cycle_measured','gait_cycle_support':round(strength,3),'gait_samples':len(good),'projected_leg_swing_amplitude':round(float(signal.std()),4)}
def motion_summary(sequence,speed):
 result=gait_metrics(sequence,speed);wrists=[p['wrist_relative_torso'] for _,p in sequence if p.get('wrist_relative_torso')]
 if len(wrists)>=24 and speed>=.12:
  values=np.asarray(wrists);span=np.percentile(values,90,axis=0)-np.percentile(values,10,axis=0);result['arm_swing_torso_lengths']=round(float(np.mean(np.linalg.norm(span.reshape(2,2),axis=1))),3)
 leaning=[p['torso_lean_degrees'] for _,p in sequence if p.get('torso_lean_degrees') is not None]
 if len(leaning)>=20:result['torso_lean_variation_degrees']=round(float(np.percentile(leaning,90)-np.percentile(leaning,10)),1)
 return result
def image_save(observation,kind,image):
 name=hashlib.sha256((observation+':'+kind).encode()).hexdigest()[:24]+'.jpg';folder=store.ROOT/'images';folder.mkdir(mode=0o700,exist_ok=True)
 h,w=image.shape[:2];scale=min(1,400/max(h,w));ok,encoded=cv2.imencode('.jpg',cv2.resize(image,(max(1,int(w*scale)),max(1,int(h*scale)))),[cv2.IMWRITE_JPEG_QUALITY,88])
 if not ok or not 500<=encoded.size<=600000:return None,None
 blob=encoded.tobytes();path=folder/name;path.write_bytes(blob);os.chmod(path,0o600);return name,{'sha256':hashlib.sha256(blob).hexdigest(),'kind':kind}
def recorded_at(item):
 try:
  if item['source']=='drive':return datetime.datetime.strptime(item['name'][4:18],'%Y%m%d%H%M%S').replace(tzinfo=ZoneInfo('Europe/Amsterdam')).timestamp()
  return int(item['name'].split('_')[1].split('.')[0])/1000
 except (ValueError,IndexError):return 0
def analyze(path,item,models):
 ensure_allowed(item)
 duration,w,h=metadata(path);fps=min(1,240/duration);stride=1/fps;tracks=[];face_scans=0
 for at,frame in frames(path,fps,w,h):
  if int(at)%12==0:ensure_allowed(item)
  detections=models.detect(frame);available=[t for t in tracks if at-t['last']<=max(3.1,stride*2.1)];used=set()
  for score,box in sorted(detections,reverse=True):
   image=crop(frame,box,.04)
   if image.size<60:continue
   colour=colours(image);choices=[]
   for track in available:
    if track['index'] in used:continue
    old=track['points'][-1][1];height=max(1,old[3]-old[1]);distance=math.hypot((box[0]+box[2]-old[0]-old[2])/2,(box[1]+box[3]-old[1]-old[3])/2)/height
    affinity=float(colour@track['colour']);iou=overlap(box,old)
    if distance<.85 and affinity>.45 and (iou>.05 or distance<.45):choices.append((iou+.4*affinity-.3*distance,track))
   if choices:track=max(choices,key=lambda x:x[0])[1]
   else:
    if len(tracks)>=48:continue
    track={'index':len(tracks)+1,'first':at,'last':at,'points':[],'best':[],'colour':colour,'faces':[],'last_face':-100};tracks.append(track)
   used.add(track['index']);track['last']=at;track['points'].append((at,box,score));track['colour']=norm(track['colour']*.8+colour*.2)
   quality=score*min(450,image.shape[0])*min(1,image.shape[0]/80)
   if face_scans<96 and image.shape[0]>=70 and score>=.45 and at-track['last_face']>=max(1.8,stride):
    for face in models.faces(image):track['faces'].append((face['quality'],at,face))
    track['faces'].sort(key=lambda x:x[0],reverse=True);track['faces']=track['faces'][:6];track['last_face']=at;face_scans+=1
   if not track['best'] or at-track['best'][-1][1]>=.8:
    track['best'].append((quality,at,image));track['best'].sort(key=lambda x:x[0],reverse=True);track['best']=track['best'][:4]
 result=[]
 for track in tracks:
  if len(track['points'])<2 or max(p[2] for p in track['points'])<.44:continue
  observation='obs-'+hashlib.sha256((store.key(item)+':'+str(track['index'])+':'+str(round(track['first'],3))).encode()).hexdigest()[:20]
  images={};face_images=[];face_captures=[];face_vectors=[];body=[];poses=[];all_colours=[]
  best=track['best'];body_image,meta=image_save(observation,'body',best[0][2])
  if meta:images[body_image]=meta
  faces=track['faces'];seen_face_times={round(at,3) for _,at,_ in faces}
  for _,at,image in best[:3]:
   body.append(models.body_vector(image));all_colours.append(colours(image));poses.append(point_metrics(models.pose_points(image)))
   if round(at,3) not in seen_face_times:
    for face in models.faces(image):faces.append((face['quality'],at,face))
  for _,at,face in sorted(faces,key=lambda x:x[0],reverse=True)[:4]:
   image_name,meta=image_save(observation,'face-'+str(len(face_images)),face['image'])
   if meta:
    images[image_name]=meta;face_images.append(image_name);face_captures.append({'image':image_name,'time_s':round(at,3),'comparable':face['recognition_quality']})
   if face['vector'] is not None:face_vectors.append(face['vector'])
  points=track['points'];speeds=[]
  for (ta,a,_),(tb,b,_) in zip(points,points[1:]):
   if 0<tb-ta<=2.5:speeds.append(math.hypot((b[0]+b[2]-a[0]-a[2])/2,(b[1]+b[3]-a[1]-a[3])/2)/(tb-ta)/max(1,(a[3]-a[1]+b[3]-b[1])/2))
  speed=statistics.median(speeds) if speeds else 0;dense=[]
  # Bounded dense review on the clearest continuous section, never sparse cadence.
  if stride<=1.1 and len(points)>=5 and len(result)<4:
   center=best[0][1];start=max(track['first'],min(center-2.5,track['last']-5));end=min(track['last'],start+6)
   if end-start>=4:
    seen_frames=set()
    for at,frame in frames(path,8,w,h,start,end-start):
     before=max((p for p in points if p[0]<=at),default=points[0]);after=min((p for p in points if p[0]>=at),default=points[-1])
     if after[0]-before[0]>1.5:continue
     factor=(at-before[0])/max(.001,after[0]-before[0]);box=[a+(b-a)*factor for a,b in zip(before[1],after[1])]
     ambiguous=False
     for other in tracks:
      if other is track:continue
      near=[p for p in other['points'] if abs(p[0]-at)<=.6]
      if any(overlap(box,p[1])>.2 for p in near):ambiguous=True;break
     if ambiguous:continue
     image=crop(frame,box,.04)
     if image.size<100:continue
     fingerprint=hashlib.blake2b(image.tobytes(),digest_size=12).digest()
     if fingerprint in seen_frames:continue
     seen_frames.add(fingerprint)
     pose=point_metrics(models.pose_points(image));dense.append((at,pose));poses.append(pose)
  known=[p for p in poses if p.get('posture')];shapes=[p['shape'] for p in poses if p.get('shape')]
  if len(known)<2 and max(p[2] for p in points)<.60 and not face_vectors:continue
  posture=max(set(p['posture'] for p in known),key=lambda x:sum(p['posture']==x for p in known)) if len(known)>=2 else None
  metrics={'posture':posture,'pose_samples':len(known),'normalized_speed_body_heights_s':round(speed,3),'torso_lean_degrees':round(statistics.median(p['torso_lean_degrees'] for p in known),1) if known else None,**motion_summary(dense,speed)}
  shape=np.median(np.array(shapes),axis=0).tolist() if len(shapes)>=2 else None
  if shape:metrics['body_proportions']=[round(v,3) for v in shape]
  result.append({'id':observation,'clip_key':store.key(item),'source':item['source'],'name':item['name'],'first_s':round(track['first'],3),'last_s':round(track['last'],3),'recorded_at':recorded_at(item),'samples':len(points),'frame_size':[w,h],'trajectory':[[round(t,3),[round(x,2) for x in box]] for t,box,_ in points],'motion_samples':dense,'motion_version':MOTION_VERSION,'body_image':body_image,'face_images':face_images,'face_captures':face_captures,'images':images,'body_vectors':body,'face_vectors':face_vectors[:3],'colour':norm(np.mean(all_colours,axis=0)).tolist(),'shape':shape,'metrics':metrics,'quality':{'person_peak_score':round(max(p[2] for p in points),3),'face_descriptor_samples':min(3,len(face_vectors)),'review_required':True}})
 ensure_allowed(item);return {'duration_s':round(duration,3),'sample_fps':round(fps,4),'face_sampling_version':FACE_SAMPLING,'tracks':result}
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--approve-owner-done',action='store_true');parser.add_argument('--max-clips',type=int,default=0);args=parser.parse_args()
 store.ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
 with (store.ROOT/'worker.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if args.approve_owner_done:print('OWNER_VERIFIED_DATASET_FROZEN',store.approve(),flush=True)
  approved=store.allowed()
  if not approved:raise ValueError('no_approved_current_clips')
  global np,cv2
  import numpy as np,cv2
  cv2.setNumThreads(1);initial=time.monotonic();models=Models();print('MODELS_READY_SECONDS',round(time.monotonic()-initial,2),flush=True);features=store.read('features.json',{'version':store.VERSION,'algorithm':ALGORITHM,'entries':{}})
  assert features.get('algorithm')==ALGORITHM
  items=sorted(approved.values(),key=lambda c:c['bytes']);processed=0
  store.write('status.json',{'phase':'analyzing','total':len(items),'processed':len(features['entries']),'started_at':store.utc()})
  for item in items:
   k=store.key(item);existing=features['entries'].get(k)
   if existing and existing.get('revision')==item['revision'] and existing.get('face_sampling_version')==FACE_SAMPLING and not existing.get('error'):continue
   if args.max_clips and processed>=args.max_clips:break
   start=time.monotonic();timings_before=dict(models.timings);entry={'revision':item['revision'],'source':item['source'],'name':item['name'],'tracks':[],'algorithm':ALGORITHM}
   try:
    with tempfile.TemporaryDirectory(prefix='verified-person-',dir='/tmp') as temporary:
     os.chmod(temporary,0o700);path=Path(temporary)/'recording.mp4';entry['original_sha256']=fetch(item,path);entry['download_s']=round(time.monotonic()-start,2);entry.update(analyze(path,item,models))
   except Exception as error:entry['error']=str(error) if isinstance(error,ValueError) else type(error).__name__
   try:ensure_allowed(item)
   except ValueError:
    features['entries'].pop(k,None);store.write('features.json',features);store.advance_registry();print('VERIFICATION_REMOVED_CLIP_EXCLUDED',flush=True);continue
   entry['elapsed_s']=round(time.monotonic()-start,2);entry['inference_seconds']={k:round(v-timings_before.get(k,0),2) for k,v in models.timings.items()};features['entries'][k]=entry;store.write('features.json',features);processed+=1
   store.advance_registry()
   store.write('status.json',{'phase':'analyzing','total':len(items),'processed':len(features['entries']),'errors':sum(bool(e.get('error')) for e in features['entries'].values()),'updated_at':store.utc()})
   print(json.dumps({'processed':len(features['entries']),'total':len(items),'tracks':len(entry['tracks']),'faces':sum(len(t['face_images']) for t in entry['tracks']),'pose_tracks':sum(t['metrics']['posture'] is not None for t in entry['tracks']),'gait_tracks':sum(t['metrics']['cadence_spm'] is not None for t in entry['tracks']),'elapsed_s':entry['elapsed_s'],'download_s':entry.get('download_s'),'inference_seconds':entry['inference_seconds'],'error':entry.get('error')}),flush=True)
  approved=store.allowed();phase='complete' if all(k in features['entries'] for k in approved) else 'partial'
  tracks=store.tracks_now()
  if phase=='complete' and not store.read('registry.json'):store.write('registry.json',store.build_registry(tracks))
  summary={'phase':phase,'total':len(items),'processed':len(features['entries']),'errors':sum(bool(e.get('error')) for e in features['entries'].values()),'finished_at':store.utc(),'identity_accuracy':'not_measurable_without_owner_identity_labels','models':{k:v['sha256'] for k,v in models.manifest.items()}}
  store.write('status.json',summary);print('VERIFIED_PEOPLE_PASS',json.dumps({k:v for k,v in summary.items() if k!='models'}),flush=True)
if __name__=='__main__':main()
