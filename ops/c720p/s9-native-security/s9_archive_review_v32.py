"""Owner verification of entire recordings; identity work waits for 'yes, done'."""
import datetime,fcntl,hashlib,json,os,re,tempfile,threading
from pathlib import Path
from urllib.parse import parse_qs,urlsplit

BASE=Path('/home/jespern/c720p-home-hub')
STORE=BASE/'state/s9-archive-recording-review-v32.json'
AUDIT=BASE/'state/s9-archive-recording-review-v32-audit.jsonl'
FILE_LOCK=BASE/'state/s9-archive-recording-review-v32.lock'
DRIVE_INDEX=BASE/'state/drive-security-archive.json'
VERSION='archive_recording_review_v32'
APPROVAL=BASE/'state/s9-verified-people-v33/approval.json'
LABELS={'person','people','no_people','uncertain','clear'}
SD_NAME=re.compile(r'(?:(?:motion|native4k)_[0-9]{13}|rec_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2})[.]mp4\Z')
DRIVE_NAME=re.compile(r'(?!.*[.][.])[A-Za-z0-9][A-Za-z0-9._-]{0,179}[.]mp4\Z')
ORIGINS={'http://'+host+':8123' for host in ('192.168.178.141','jesper-hub','jesper-hub.local','localhost','127.0.0.1','homeassistant.local')}
LOCK=threading.RLock()
_sd_rows=lambda:{}

def read_store():
 if not STORE.exists():return {'version':VERSION,'workflow':'awaiting_owner_done','labels':{}}
 try:
  if STORE.stat().st_size>8000000:raise ValueError('too_large')
  data=json.loads(STORE.read_text())
  if not isinstance(data,dict) or data.get('version')!=VERSION or data.get('workflow') not in ('awaiting_owner_done','owner_ready') or not isinstance(data.get('labels'),dict):raise ValueError('invalid')
  for key,item in data['labels'].items():
   if not isinstance(key,str) or not isinstance(item,dict) or item.get('label') not in LABELS-{'clear'} or not re.fullmatch('[a-f0-9]{64}',str(item.get('revision',''))):raise ValueError('invalid_label')
  return data
 except (OSError,ValueError,TypeError):return None

def eligible(source):
 if source=='sd':
  return {name:row for name,row in _sd_rows().items() if isinstance(row,dict) and isinstance(name,str) and SD_NAME.fullmatch(name) and row.get('sd_verified') is True and type(row.get('size')) is int and row['size']>10000}
 if source!='drive':raise ValueError('invalid_source')
 try:items=json.loads(DRIVE_INDEX.read_text()).get('items',[])
 except (OSError,ValueError,TypeError):return {}
 return {row['remote_name']:row for row in items if isinstance(row,dict) and row.get('camera')=='new' and row.get('state')=='verified' and isinstance(row.get('remote_name'),str) and DRIVE_NAME.fullmatch(row['remote_name']) and type(row.get('size')) is int and row['size']>10000}

def revision(source,name,row):
 # Bind the human decision to file identity, not a changing thumbnail/model result.
 identity={'source':source,'name':name,'bytes':row['size']}
 for field in ('sha256','md5','remote_id','file_id'):
  value=row.get(field)
  if isinstance(value,str) and 0<len(value)<=160:identity[field]=value
 return hashlib.sha256(json.dumps(identity,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def atomic_save(data):
 STORE.parent.mkdir(parents=True,exist_ok=True)
 fd,temp=tempfile.mkstemp(dir=STORE.parent,prefix='.s9-recording-review-v32-')
 try:
  with os.fdopen(fd,'w') as out:json.dump(data,out,sort_keys=True,separators=(',',':'));out.write('\n');out.flush();os.fsync(out.fileno())
  os.chmod(temp,0o600);os.replace(temp,STORE)
 finally:
  if os.path.exists(temp):os.unlink(temp)

def matching_started():
 try:
  approval=json.loads(APPROVAL.read_text());return isinstance(approval,dict) and approval.get('version')=='verified_people_v33' and approval.get('owner_signal')=='yes, done'
 except (OSError,ValueError,TypeError):return False

def report(source='sd'):
 with LOCK:
  data=read_store()
  if data is None:return {'ok':False,'error':'review_registry_unavailable'}
  clips={};counts={'person':0,'people':0,'no_people':0,'uncertain':0,'unreviewed':0}
  for name,row in eligible(source).items():
   token=revision(source,name,row);label=data['labels'].get(source+':'+name,{})
   current=label.get('label') if label.get('revision')==token else None
   counts[current or 'unreviewed']+=1
   clips[name]={'source':source,'name':name,'revision':token,'label':current,'bytes':row['size']}
  started=matching_started()
  return {'ok':True,'version':VERSION,'source':source,'scope':'human_verification_of_entire_recording',
   'workflow':'verified_matching_enabled' if started else data['workflow'],'matching_started':started,'awaiting_owner_done':not started and data['workflow']=='awaiting_owner_done',
   'clips':clips,'counts':counts,'verified_people_clips':counts['person']+counts['people'],
   'instructions':'Review verified recordings in People & faces.' if started else 'Verify recordings in Archive, then tell the assistant yes, done. Matching has not started.'}

def save_batch(items,label,human_confirmed):
 if not isinstance(label,str) or label not in LABELS or human_confirmed is not True:return 400,{'ok':False,'error':'explicit_human_verification_required'}
 if not isinstance(items,list) or not 1<=len(items)<=50:return 400,{'ok':False,'error':'select_1_to_50_recordings_per_request'}
 checked=[];seen=set();sources={}
 for item in items:
  if not isinstance(item,dict) or set(item)!={'source','name','revision'}:return 400,{'ok':False,'error':'invalid_recording_reference'}
  source,name,token=item['source'],item['name'],item['revision']
  if source not in ('sd','drive') or not isinstance(name,str) or not (SD_NAME if source=='sd' else DRIVE_NAME).fullmatch(name) or not isinstance(token,str) or not re.fullmatch('[a-f0-9]{64}',token):return 400,{'ok':False,'error':'invalid_recording_reference'}
  key=source+':'+name
  if key in seen:return 400,{'ok':False,'error':'duplicate_recording'}
  seen.add(key);checked.append((key,source,name,token))
 with LOCK:
  FILE_LOCK.parent.mkdir(parents=True,exist_ok=True)
  with FILE_LOCK.open('a+') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX)
   before=read_store()
   if before is None:return 503,{'ok':False,'error':'review_registry_unavailable'}
   for key,source,name,token in checked:
    if source not in sources:sources[source]=eligible(source)
    row=sources[source].get(name)
    if row is None:return 404,{'ok':False,'error':'recording_not_in_archive','name':name}
    if revision(source,name,row)!=token:return 409,{'ok':False,'error':'recording_changed_refresh_before_verifying','name':name}
   data=json.loads(json.dumps(before));now=datetime.datetime.now(datetime.timezone.utc).isoformat()
   for key,source,name,token in checked:
    if label=='clear':data['labels'].pop(key,None)
    else:data['labels'][key]={'label':label,'revision':token,'updated_at':now,'source':source,'name':name,'scope':'entire_recording','human_confirmed':True}
   try:
    atomic_save(data)
    with AUDIT.open('a') as out:
     out.write(json.dumps({'utc':now,'action':'owner_recording_verification','label':label,'items':items,'matching_started':False},sort_keys=True)+'\n');out.flush();os.fsync(out.fileno())
    os.chmod(AUDIT,0o600)
   except OSError:
    atomic_save(before);return 503,{'ok':False,'error':'review_storage_failed_no_changes_saved'}
 started=matching_started()
 return 200,{'ok':True,'updated':len(checked),'label':None if label=='clear' else label,'workflow':'verified_matching_enabled' if started else data['workflow'],'matching_started':started}

def install(handler,sd_rows):
 global _sd_rows
 _sd_rows=sd_rows
 prior_get,prior_post=handler.go,handler.do_POST
 def get(self):
  parsed=urlsplit(self.path)
  if parsed.path=='/new/api/archive-review':
   source=parse_qs(parsed.query).get('source',['sd'])[0]
   if source not in ('sd','drive'):return self.js(400,{'ok':False,'error':'invalid_source'})
   data=report(source);return self.js(200 if data['ok'] else 503,data)
  if parsed.path=='/new/api/person-folders' and (read_store() or {}).get('workflow')!='owner_ready':
   data=report('sd');return self.js(200 if data['ok'] else 503,{'ok':data['ok'],'workflow':'awaiting_owner_done','matching_started':False,'verified_people_clips':data.get('verified_people_clips',0),'profiles':[],'candidates':[],'suggestions':[],'unassigned':[],'summary':{'profiles':0,'recorded_appearances':0,'confirmed_appearances':0,'unassigned_appearances':0,'face_supported_candidates':0,'review_suggestions':0}})
  return prior_get(self)
 def post(self):
  path=urlsplit(self.path).path
  if path=='/new/api/person-folders/review' and (read_store() or {}).get('workflow')!='owner_ready':return self.js(423,{'ok':False,'error':'verify_archive_then_say_yes_done','matching_started':False})
  if path!='/new/api/archive-review/batch':return prior_post(self)
  if self.headers.get('X-S9-Archive-Review-Intent')!='human-recording-review-v32':return self.js(403,{'ok':False,'error':'explicit_review_intent_required'})
  origin=self.headers.get('Origin','')
  if origin and origin not in ORIGINS:return self.js(403,{'ok':False,'error':'untrusted_origin'})
  try:
   size=int(self.headers.get('Content-Length','0'))
   if not 2<=size<=18000 or 'application/json' not in self.headers.get('Content-Type','').lower():raise ValueError('invalid_body')
   data=json.loads(self.rfile.read(size))
   if not isinstance(data,dict) or set(data)!={'items','label','human_confirmed'}:raise ValueError('invalid_body')
   status,body=save_batch(data['items'],data['label'],data['human_confirmed'])
  except (ValueError,TypeError,UnicodeError):return self.js(400,{'ok':False,'error':'invalid_review_request'})
  return self.js(status,body)
 handler.go=get;handler.do_POST=post
