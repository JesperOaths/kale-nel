"""Verified-only anonymous person folders. Raw descriptors never leave the hub."""
import datetime,fcntl,hashlib,json,math,os,re,tempfile,threading
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit
import s9_archive_review_v32 as review

ROOT=review.BASE/'state/s9-verified-people-v33'
VERSION='verified_people_v33';LOCK=threading.RLock()
CACHE_ENABLED=False;_allowed_cache=None;_tracks_cache=None
IMAGE=re.compile('[a-f0-9]{24}[.]jpg\\Z');OBS=re.compile('obs-[a-f0-9]{20}\\Z');PID=re.compile('P[0-9]{4,6}\\Z')
MATCH_KINDS={'face_supported','appearance_supported','single_recording_link'}
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
@contextmanager
def registry_lock():
 ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
 with LOCK,(ROOT/'registry.lock').open('a') as handle:
  fcntl.flock(handle,fcntl.LOCK_EX);yield
def key(item):return item['source']+':'+item['name']
def read(name,default=None):
 try:
  path=ROOT/name
  if path.stat().st_size>24000000:return default
  data=json.loads(path.read_text());return data if isinstance(data,dict) else default
 except (OSError,ValueError,TypeError):return default
def write(name,data):
 ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
 fd,temp=tempfile.mkstemp(dir=ROOT,prefix='.v33-')
 try:
  with os.fdopen(fd,'w') as out:json.dump(data,out,separators=(',',':'),sort_keys=True,allow_nan=False);out.flush();os.fsync(out.fileno())
  os.chmod(temp,0o600);os.replace(temp,ROOT/name)
 finally:
  if os.path.exists(temp):os.unlink(temp)
def current():
 result={}
 for source in ('sd','drive'):
  data=review.report(source)
  if not data.get('ok'):raise ValueError('verification_unavailable')
  result.update({key(c):c for c in data['clips'].values() if c['label'] in ('person','people')})
 return result
def source_signature():
 result=[]
 for path in (ROOT/'approval.json',review.STORE,review.DRIVE_INDEX,Path('/opt/homeassistant/config/www/frontyard-security-new/s9-phone-events.json')):
  try:stat=path.stat();result.append((stat.st_ino,stat.st_size,stat.st_mtime_ns))
  except OSError:result.append(None)
 return tuple(result)
def allowed_fresh():
 approval=read('approval.json',{})
 if approval.get('owner_signal')!='yes, done' or approval.get('version')!=VERSION:return {}
 live=current();return {key(c):{**c,'label':live[key(c)]['label']} for c in approval.get('clips',[]) if key(c) in live and c['revision']==live[key(c)]['revision'] and c['bytes']==live[key(c)]['bytes']}
def allowed():
 global _allowed_cache
 if not CACHE_ENABLED:return allowed_fresh()
 with LOCK:
  signature=source_signature()
  if _allowed_cache is None or _allowed_cache[0]!=signature:_allowed_cache=(signature,allowed_fresh())
  return _allowed_cache[1]
def approve():
 if read('approval.json') is not None:raise ValueError('approval_already_exists')
 clips=sorted(current().values(),key=key)
 if not clips:raise ValueError('no_human_verified_clips')
 digest=hashlib.sha256(json.dumps(clips,sort_keys=True).encode()).hexdigest()
 write('approval.json',{'version':VERSION,'owner_signal':'yes, done','approved_at':utc(),'dataset_sha256':digest,'clips':clips})
 return len(clips)
@lru_cache(maxsize=4096)
def vector_length(values):
 if any(type(v) not in (int,float) or not math.isfinite(v) for v in values):return None
 value=math.sqrt(sum(v*v for v in values));return value if math.isfinite(value) and value>1e-9 else None
def cosine(a,b):
 if not isinstance(a,list) or not isinstance(b,list) or len(a)!=len(b) or not a:return None
 try:na,nb=vector_length(tuple(a)),vector_length(tuple(b))
 except TypeError:return None
 return max(-1,min(1,sum(x*y for x,y in zip(a,b))/(na*nb))) if na is not None and nb is not None else None
def vector_score(a,b,field):
 values=[cosine(x,y) for x in a.get(field,[]) for y in b.get(field,[])]
 values=sorted((v for v in values if v is not None),reverse=True)
 return sum(values[:2])/min(2,len(values)) if values else None
def conflict(a,b):
 return a['clip_key']==b['clip_key'] and a['id']!=b['id'] and max(a['first_s'],b['first_s'])<=min(a['last_s'],b['last_s'])
def compare(a,b):
 if a['id']==b['id'] or conflict(a,b):return {'kind':'conflict','score':0,'reasons':['Simultaneously visible people stay separate']}
 face=vector_score(a,b,'face_vectors');body=vector_score(a,b,'body_vectors');colour=cosine(a.get('colour'),b.get('colour'))
 shape=cosine(a.get('shape'),b.get('shape'));ma,mb=a.get('metrics',{}),b.get('metrics',{})
 ca,cb=ma.get('cadence_spm'),mb.get('cadence_spm');gait=ca is not None and cb is not None and abs(ca-cb)<=12
 reasons=[]
 if face is not None:reasons.append('Face descriptors '+str(round(face,3)))
 if body is not None:reasons.append('Body appearance '+str(round(body,3)))
 if colour is not None:reasons.append('Clothing colours '+str(round(colour,3)))
 if shape is not None:reasons.append('Measured body proportions '+str(round(shape,3)))
 if gait:reasons.append('Similar measured step cadence')
 if ma.get('posture') and ma.get('posture')==mb.get('posture'):reasons.append('Similar measured posture')
 sa,sb=ma.get('normalized_speed_body_heights_s'),mb.get('normalized_speed_body_heights_s')
 if sa is not None and sb is not None and min(sa,sb)>.1 and abs(sa-sb)<max(.1,.25*max(sa,sb)):reasons.append('Similar observed movement speed')
 aa,ab=ma.get('arm_swing_torso_lengths'),mb.get('arm_swing_torso_lengths')
 if aa is not None and ab is not None and min(aa,ab)>.1 and abs(aa-ab)<max(.1,.25*max(aa,ab)):reasons.append('Similar measured arm swing')
 if face is not None and face<.4 and len(a.get('face_vectors',[]))>=2 and len(b.get('face_vectors',[]))>=2:return {'kind':'conflict','score':0,'reasons':['Conflicting face evidence']}
 if a['clip_key']==b['clip_key'] and a.get('human_clip_label')==b.get('human_clip_label')=='person':return {'kind':'single_recording_link','score':.96,'reasons':['Separate sightings in the recording you verified as one person',*reasons]}
 if face is not None and face>=.86 and min(len(a.get('face_vectors',[])),len(b.get('face_vectors',[])))>=2:
  return {'kind':'face_supported','score':face,'reasons':reasons}
 gap=abs(a.get('recorded_at',0)-b.get('recorded_at',0));same_visit=gap<=7200
 # ReID/outfit matches are provisional collections, never a verified identity.
 if body is not None and colour is not None and body>=.88 and colour>=.90 and (same_visit or shape is not None and shape>=.97 and gait):
  return {'kind':'appearance_supported','score':body,'reasons':reasons}
 if body is not None and body>=.72 or face is not None and face>=.72:
  return {'kind':'suggestion','score':max(body or -1,face or -1),'reasons':reasons}
 return {'kind':'separate','score':0,'reasons':reasons}
def tracks_fresh():
 approved=allowed();data=read('features.json',{'entries':{}});result={}
 for clip_key,entry in data.get('entries',{}).items():
  if clip_key not in approved or entry.get('revision')!=approved[clip_key]['revision']:continue
  for track in entry.get('tracks',[]):
   item=approved[clip_key];first,last=track.get('first_s'),track.get('last_s')
   valid_time=type(first) in (int,float) and type(last) in (int,float) and math.isfinite(first) and math.isfinite(last) and 0<=first<=last<=1800
   if OBS.fullmatch(str(track.get('id',''))) and track.get('clip_key')==clip_key and track.get('source')==item['source'] and track.get('name')==item['name'] and valid_time:result[track['id']]={**track,'human_clip_label':item['label']}
 return result
def tracks_now():
 global _tracks_cache
 if not CACHE_ENABLED:return tracks_fresh()
 with LOCK:
  path=ROOT/'features.json'
  try:stat=path.stat();feature_signature=(stat.st_ino,stat.st_size,stat.st_mtime_ns)
  except OSError:feature_signature=None
  signature=(source_signature(),feature_signature)
  if _tracks_cache is None or _tracks_cache[0]!=signature:_tracks_cache=(signature,tracks_fresh())
  return _tracks_cache[1]
def comparison_result(cache,a,b):
 pair=tuple(sorted((a,b)));return cache.get(pair,cache.get('|'.join(pair),{'kind':'separate','score':0,'reasons':[]}))
def compatible_groups(first,second,tracks,cache):
 results=[comparison_result(cache,a,b) for a in first for b in second]
 if any(result['kind']=='conflict' for result in results):return False
 if any(result['kind']=='single_recording_link' for result in results):return True
 for source_a in {tracks[k]['clip_key'] for k in first}:
  for source_b in {tracks[k]['clip_key'] for k in second}:
   if not any(comparison_result(cache,a,b)['kind'] in MATCH_KINDS for a in first for b in second if tracks[a]['clip_key']==source_a and tracks[b]['clip_key']==source_b):return False
 return bool(results)
def evidence_signature(track):
 return hashlib.sha256(json.dumps({field:track.get(field) for field in ('body_vectors','face_vectors','colour','shape','metrics','human_clip_label')},sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def build_registry(tracks,cache=None):
 groups=[[k] for k in sorted(tracks)];pairs=[];comparisons={}
 keys=sorted(tracks)
 for i,a in enumerate(keys):
  for b in keys[i+1:]:
   pair=(a,b);result=comparison_result(cache,a,b) if cache is not None and ('|'.join(pair) in cache or pair in cache) else compare(tracks[a],tracks[b]);comparisons[pair]=result
   if result['kind'] in MATCH_KINDS:pairs.append((result['score']+(1 if result['kind']=='face_supported' else .5 if result['kind']=='single_recording_link' else 0),a,b))
 for _,a,b in sorted(pairs,reverse=True):
  first=next(g for g in groups if a in g);second=next(g for g in groups if b in g)
  if first is second:continue
  if compatible_groups(first,second,tracks,comparisons):first.extend(second);groups.remove(second)
 groups.sort(key=lambda g:min((tracks[k].get('recorded_at',0),k) for k in g))
 profiles={};links={}
 for index,group in enumerate(groups,1):
  pid=f'P{index:04d}';profiles[pid]={'name':f'Person #{index}','reviewed':False,'created_at':utc()}
  links.update({k:pid for k in group})
 return {'version':VERSION,'next_id':len(groups)+1,'profiles':profiles,'links':links,'comparisons':{'|'.join(pair):value for pair,value in comparisons.items()},'evidence_signatures':{k:evidence_signature(t) for k,t in tracks.items()},'generated_at':utc()}
def public_track(track):
 return {k:track.get(k) for k in ('id','source','name','clip_key','first_s','last_s','recorded_at','samples','body_image','face_images','face_captures','metrics','quality')}
def advance_registry():
 """Publish newly processed appearances without renumbering or undoing reviews."""
 with registry_lock():
  tracks=tracks_now();data=read('registry.json')
  if data is None:
   if (ROOT/'registry.json').exists():raise ValueError('registry_invalid')
   data=build_registry(tracks);write('registry.json',data);return len(tracks)
  added=0;changed=False;signatures={k:evidence_signature(t) for k,t in tracks.items()};old_signatures=data.get('evidence_signatures',{})
  for first in tracks:
   for second in tracks:
    if first>=second:continue
    if old_signatures.get(first)!=signatures[first] or old_signatures.get(second)!=signatures[second]:data['comparisons'][first+'|'+second]=compare(tracks[first],tracks[second]);changed=True
  data['evidence_signatures']=signatures
  for observation in sorted(set(tracks)-set(data['links'])):
   current_track=tracks[observation];candidates=[]
   for other in tracks:
    if other==observation:continue
    pair='|'.join(sorted((observation,other)))
    if pair not in data['comparisons']:data['comparisons'][pair]=compare(current_track,tracks[other])
   for pid,profile in data['profiles'].items():
    if profile.get('reviewed') or profile.get('name')!='Person #'+str(int(pid[1:])):continue
    members=[k for k,v in data['links'].items() if v==pid and k in tracks]
    if not members:continue
    matches=[data['comparisons']['|'.join(sorted((observation,k)))] for k in members]
    if compatible_groups([observation],members,tracks,data['comparisons']):
     ranks=[m['score']+(1 if m['kind']=='face_supported' else .5 if m['kind']=='single_recording_link' else 0) for m in matches if m['kind'] in MATCH_KINDS]
     candidates.append((max(ranks),pid))
   candidates.sort(reverse=True)
   if candidates and (len(candidates)==1 or candidates[0][0]-candidates[1][0]>=.04):pid=candidates[0][1]
   else:
    number=data['next_id'];data['next_id']+=1;pid=f'P{number:04d}';data['profiles'][pid]={'name':f'Person #{number}','reviewed':False,'created_at':utc()}
   data['links'][observation]=pid;added+=1
  if added or changed:data['updated_at']=utc();write('registry.json',data)
  return added
def reconcile_registry():
 """Final complete-recording grouping; preserve every named or confirmed folder."""
 with registry_lock():
  tracks=tracks_now();old=read('registry.json')
  if old is None:raise ValueError('registry_not_ready')
  protected={pid for pid,p in old['profiles'].items() if p.get('reviewed') or p.get('name')!='Person #'+str(int(pid[1:]))}
  editable={k:t for k,t in tracks.items() if old['links'].get(k) not in protected};complete=build_registry(tracks);grouped=build_registry(editable,complete['comparisons'])
  data=json.loads(json.dumps(old));data['links']={k:v for k,v in old['links'].items() if v in protected};used=set(protected)
  for group_id in grouped['profiles']:
   members=[k for k,v in grouped['links'].items() if v==group_id];counts={}
   for k in members:
    previous=old['links'].get(k)
    if previous and previous not in used:counts[previous]=counts.get(previous,0)+1
   if counts:pid=min(counts,key=lambda value:(-counts[value],value))
   else:
    number=data['next_id'];data['next_id']+=1;pid=f'P{number:04d}';data['profiles'][pid]={'name':f'Person #{number}','reviewed':False,'created_at':utc()}
   used.add(pid);data['links'].update({k:pid for k in members})
  data['comparisons']=complete['comparisons'];data['evidence_signatures']=complete['evidence_signatures'];data['refined_at']=utc()
  backup='registry-before-final-grouping-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json';write(backup,old)
  try:
   write('registry.json',data);audit({'action':'verified_dataset_grouping','protected_folders':len(protected),'active_folders':len({data['links'][k] for k in tracks if k in data['links']}),'backup':backup})
  except OSError:write('registry.json',old);raise
  return len({data['links'][k] for k in tracks if k in data['links']})
def report():
 with LOCK:
  approved=allowed();tracks=tracks_now();registry=read('registry.json',{'profiles':{},'links':{}});features=read('features.json',{'entries':{}});status=read('status.json',{})
  folders=[];comparisons=registry.get('comparisons',{})
  def comparison(a,b):return comparisons.get('|'.join(sorted((a['id'],b['id']))),{'kind':'separate','score':0,'reasons':[]})
  for pid,p in registry.get('profiles',{}).items():
   items=[tracks[k] for k,v in registry.get('links',{}).items() if v==pid and k in tracks]
   if not items:continue
   items.sort(key=lambda t:(t.get('recorded_at',0),t['first_s']),reverse=True)
   faces=sum(len(t.get('face_images',[])) for t in items);methods=set()
   for i,a in enumerate(items):
    for b in items[i+1:]:methods.add(comparison(a,b)['kind'])
   folders.append({'id':pid,'name':p['name'],'reviewed':p.get('reviewed',False),'recordings':len({t['clip_key'] for t in items}),'appearances':len(items),'face_crops':faces,'methods':sorted(methods),'items':[public_track(t) for t in items]})
  unmeasured=[]
  for k,c in approved.items():
   entry=features.get('entries',{}).get(k)
   if entry and not entry.get('tracks'):unmeasured.append({'source':c['source'],'name':c['name'],'reason':entry.get('error') or 'Person verified; usable individual track not extracted'})
  grouped={k:registry.get('links',{}).get(k) for k in tracks};suggestions=[];seen=set()
  keys=sorted(tracks)
  for i,a in enumerate(keys):
   for b in keys[i+1:]:
    pa,pb=grouped[a],grouped[b]
    if not pa or not pb or pa==pb or tuple(sorted((pa,pb))) in seen:continue
    result=comparison(tracks[a],tracks[b])
    if result['kind'] in MATCH_KINDS|{'suggestion'}:
     suggestions.append({'first':pa,'second':pb,**result});seen.add(tuple(sorted((pa,pb))))
  suggestions.sort(key=lambda r:r['score'],reverse=True)
  return {'ok':True,'version':VERSION,'matching_started':bool(read('approval.json')),'status':status,'approved_clips':len(approved),'processed_clips':sum(k in approved for k in features.get('entries',{})),'folders':folders,'unmeasured':unmeasured,'suggestions':suggestions[:30],'metrics':{'tracks':len(tracks),'with_faces':sum(bool(t.get('face_vectors')) for t in tracks.values()),'with_posture':sum(t.get('metrics',{}).get('posture') is not None for t in tracks.values()),'with_gait':sum(t.get('metrics',{}).get('cadence_spm') is not None for t in tracks.values())},'identity_status':'Anonymous visual groups; automatic matches need review'}
def audit(data):
 path=ROOT/'review-audit.jsonl'
 with path.open('a') as out:out.write(json.dumps({'utc':utc(),**data})+'\n');out.flush();os.fsync(out.fileno())
 os.chmod(path,0o600)
def edit(data):
 if not isinstance(data,dict) or data.get('human_confirmed') is not True:return 400,{'ok':False,'error':'explicit_review_required'}
 with registry_lock():
  registry=read('registry.json');tracks=tracks_now()
  if not registry:return 409,{'ok':False,'error':'folders_not_ready'}
  action=data.get('action');pid=data.get('profile_id');other=data.get('other_id');observation=data.get('observation_id')
  if not isinstance(pid,str) or pid not in registry['profiles']:return 404,{'ok':False,'error':'folder_not_found'}
  before=json.loads(json.dumps(registry))
  if action=='rename':
   name=data.get('name')
   if not isinstance(name,str) or not 1<=len(name.strip())<=56 or any(not c.isprintable() or c in '<>' for c in name):return 400,{'ok':False,'error':'invalid_name'}
   registry['profiles'][pid]['name']=name.strip()
  elif action=='confirm':registry['profiles'][pid]['reviewed']=True
  elif action=='merge':
   if not isinstance(other,str) or other==pid or other not in registry['profiles']:return 400,{'ok':False,'error':'invalid_other_folder'}
   first=[t for k,t in tracks.items() if registry['links'].get(k)==pid];second=[t for k,t in tracks.items() if registry['links'].get(k)==other]
   if any(conflict(a,b) for a in first for b in second):return 409,{'ok':False,'error':'simultaneously_visible_people_cannot_merge'}
   registry['links']={k:pid if v==other else v for k,v in registry['links'].items()};registry['profiles'][pid]['reviewed']=True
  elif action=='split':
   if observation not in tracks or registry['links'].get(observation)!=pid:return 404,{'ok':False,'error':'appearance_not_in_folder'}
   number=registry['next_id'];new=f'P{number:04d}';registry['next_id']+=1;registry['profiles'][new]={'name':f'Person #{number}','reviewed':True,'created_at':utc()};registry['links'][observation]=new;registry['profiles'][pid]['reviewed']=False
  else:return 400,{'ok':False,'error':'invalid_action'}
  try:
   write('registry.json',registry);audit({'action':action,'request':data,'before':before})
  except OSError:
   write('registry.json',before);return 503,{'ok':False,'error':'review_not_saved'}
 return 200,{'ok':True}
def image_bytes(name):
 if not IMAGE.fullmatch(name):return None
 for track in tracks_now().values():
  meta=track.get('images',{}).get(name)
  if meta:
   kind=meta.get('kind','')
   if not re.fullmatch('body|face-[0-3]',kind) or hashlib.sha256((track['id']+':'+kind).encode()).hexdigest()[:24]+'.jpg'!=name:return None
   path=ROOT/'images'/name
   if path.is_symlink() or not path.is_file() or not 500<=path.stat().st_size<=600000:return None
   blob=path.read_bytes()
   return blob if hashlib.sha256(blob).hexdigest()==meta['sha256'] else None
 return None
def install(handler):
 global CACHE_ENABLED
 CACHE_ENABLED=True
 previous_get,previous_post=handler.go,handler.do_POST
 def get(self):
  path=urlsplit(self.path).path
  try:
   if path=='/new/api/verified-people':return self.js(200,report())
   match=re.fullmatch('/new/api/verified-people/image/([a-f0-9]{24}[.]jpg)',path)
   if match:
    blob=image_bytes(match[1])
    if blob is None:return self.js(404,{'ok':False,'error':'image_not_in_verified_set'})
    self.send_response(200);self.send_header('Content-Type','image/jpeg');self.send_header('Content-Length',str(len(blob)));self.send_header('Cache-Control','private,no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers()
    if self.command!='HEAD':self.wfile.write(blob)
    return
  except (OSError,ValueError,TypeError,KeyError):return self.js(503,{'ok':False,'error':'verified_people_unavailable'})
  return previous_get(self)
 def post(self):
  if urlsplit(self.path).path!='/new/api/verified-people/review':return previous_post(self)
  if self.headers.get('X-S9-Verified-People-Intent')!='owner-folder-review-v33' or self.headers.get('Origin') not in review.ORIGINS:return self.js(403,{'ok':False,'error':'explicit_review_required'})
  try:
   size=int(self.headers.get('Content-Length','0'))
   if not 2<=size<=1500 or 'application/json' not in self.headers.get('Content-Type',''):raise ValueError('body')
   status,data=edit(json.loads(self.rfile.read(size)));return self.js(status,data)
  except (ValueError,TypeError,KeyError):return self.js(400,{'ok':False,'error':'invalid_review_request'})
 handler.go=get;handler.do_POST=post
