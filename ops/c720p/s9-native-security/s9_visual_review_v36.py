"""Deterministic colour/scene catalog and exclusively manual review folders."""
import contextlib,datetime,hashlib,json,math,os,re,sqlite3,subprocess,tempfile,threading,time
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
BASE=Path('/home/jespern/c720p-home-hub')
ROOT=BASE/'state/s9-visual-attributes-v36'
CACHE=Path('/tmp/s9-visual-crops-v36')
PHONE='192.168.178.250:5555'
SD='/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K'
VERSION='original_4k_visual_attributes_v36'
CLIP=re.compile(r'motion_[0-9]{13}[.]mp4\Z')
CROP=re.compile(r'motion_[0-9]{13}[.]mp4[.]t[1-9][0-9]?[.][a-f0-9]{12}[.](?:v37[.])?[0-9]{1,9}[.](?:full|upper)[.]jpg\Z')
ORIGINS={'http://'+h+':8123' for h in ('192.168.178.141','jesper-hub','jesper-hub.local','localhost','127.0.0.1','homeassistant.local')}
INTENT='manual-attributes-v36'
CROP_READS=threading.BoundedSemaphore(2)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic(path,data):
 path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
 fd,name=tempfile.mkstemp(dir=path.parent,prefix='.visual-')
 try:
  with os.fdopen(fd,'w') as out:json.dump(data,out,allow_nan=False,separators=(',',':'));out.flush();os.fsync(out.fileno())
  os.chmod(name,0o600);os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)
def db():
 ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
 connection=sqlite3.connect(ROOT/'review.sqlite3',timeout=8)
 connection.row_factory=sqlite3.Row;connection.execute('PRAGMA foreign_keys=ON')
 connection.executescript('''CREATE TABLE IF NOT EXISTS revision(value INTEGER NOT NULL);
 INSERT INTO revision SELECT 0 WHERE NOT EXISTS(SELECT 1 FROM revision);
 CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY,label TEXT NOT NULL,note TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reviews(observation TEXT PRIMARY KEY,signature TEXT NOT NULL,folder TEXT REFERENCES folders(id),label TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',pinned INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL);''')
 if 'presence' not in {r[1] for r in connection.execute('PRAGMA table_info(reviews)')}:
  try:connection.execute("ALTER TABLE reviews ADD COLUMN presence TEXT NOT NULL DEFAULT 'pending'")
  except sqlite3.OperationalError:
   if 'presence' not in {r[1] for r in connection.execute('PRAGMA table_info(reviews)')}:connection.close();raise
  connection.commit()
 os.chmod(ROOT/'review.sqlite3',0o600);return connection
def finite(value,low,high):return type(value) in (int,float) and math.isfinite(value) and low<=value<=high
def histogram(value):
 return isinstance(value,list) and len(value)==32 and all(finite(x,0,1) for x in value) and abs(sum(value)-1)<.015
def validate(meta):
 if not isinstance(meta,dict) or meta.get('version')!=VERSION or not CLIP.fullmatch(str(meta.get('name',''))):raise ValueError('invalid_visual_metadata')
 if meta.get('width')!=3840 or meta.get('height')!=2160 or meta.get('identity_matching') is not False:raise ValueError('not_original_4k_attributes')
 if not re.fullmatch('[a-f0-9]{64}',str(meta.get('sha256',''))) or not finite(meta.get('bytes'),10000,1000000000):raise ValueError('invalid_source_proof')
 duration=meta.get('duration_ms');tracks=meta.get('tracks')
 if not finite(duration,1000,125000) or not isinstance(tracks,list) or len(tracks)>64:raise ValueError('invalid_track_list')
 seen=set()
 for track in tracks:
  tid=track.get('track_id')
  if type(tid) is not int or not 1<=tid<=64 or tid in seen:raise ValueError('invalid_track_id')
  seen.add(tid)
  if not finite(track.get('first_ms'),0,duration) or not finite(track.get('last_ms'),track['first_ms'],duration):raise ValueError('invalid_track_time')
  for field in ('upper_hsv32','lower_hsv32','upper_lab32','lower_lab32'):
   if not histogram(track.get(field)):raise ValueError('invalid_colour_histogram')
  for field in ('full_crop','upper_crop'):
   crop=track.get(field,{})
   if not CROP.fullmatch(str(crop.get('name',''))) or not crop['name'].startswith(meta['name']+'.t'+str(tid)+'.'+meta['sha256'][:12]+'.'):raise ValueError('invalid_crop_reference')
   if not re.fullmatch('[a-f0-9]{64}',str(crop.get('sha256',''))) or not finite(crop.get('bytes'),100,12000000) or not finite(crop.get('time_ms'),track['first_ms'],track['last_ms']):raise ValueError('invalid_crop_proof')
   box=crop.get('source_box_pixels')
   if not isinstance(box,list) or len(box)!=4 or any(type(x) is not int for x in box) or not (0<=box[0]<box[2]<=3840 and 0<=box[1]<box[3]<=2160):raise ValueError('invalid_native_crop_box')
   if crop.get('width')!=box[2]-box[0] or crop.get('height')!=box[3]-box[1] or crop.get('resized') is not False:raise ValueError('crop_resolution_mismatch')
 return meta
def source_rows():
 import s9_sd_proxy_extension as proxy
 import s9_archive_delete_v1 as deletion
 gone=deletion.deleted()
 return {k:v for k,v in proxy.rows().items() if k not in gone}
def index():
 try:
  path=ROOT/'catalog.json'
  if path.stat().st_size>24000000:raise ValueError('catalog_too_large')
  return json.loads(path.read_text())
 except (OSError,ValueError):return {'items':{},'updated_at':None}
def publish_queue():
 """Send only current human-verified file references; never media or embeddings."""
 approved=archive_verifications()['clips']
 clips=[{'name':name,'bytes':row['bytes'],'human_verified':True} for name,row in sorted(approved.items(),reverse=True)
        if CLIP.fullmatch(name) and row.get('label') in ('person','people')][:128]
 payload={'version':'owner_verified_4k_review_v37','issued_ms':int(time.time()*1000),'clips':clips}
 path=ROOT/'phone-work-queue.json';atomic(path,payload)
 destination=SD+'/visual-review-queue-v37.json'
 subprocess.run(['adb','-s',PHONE,'push',str(path),destination+'.stage'],capture_output=True,check=True,timeout=20)
 subprocess.run(['adb','-s',PHONE,'shell','mv',destination+'.stage',destination],capture_output=True,check=True,timeout=10)
 return len(clips)

def sync():
 """Pull bounded JSON only. Decoding and visual inference remain on S9+."""
 old=index();items=old.get('items',{});rows=source_rows();errors=0;added=0
 queued=publish_queue()
 result=subprocess.run(['adb','-s',PHONE,'shell','sha256sum',SD+'/*.visual-v36.json'],capture_output=True,text=True,timeout=20)
 if result.returncode and not 'No such file' in result.stderr:raise OSError('phone_unavailable')
 paths={}
 for line in result.stdout.splitlines():
  pieces=line.split(None,1)
  if len(pieces)!=2 or not re.fullmatch('[a-f0-9]{64}',pieces[0]):continue
  name=pieces[1].strip().removeprefix(SD+'/').removesuffix('.visual-v36.json')
  if CLIP.fullmatch(name) and name in rows:paths[name]=pieces[0]
 approved=archive_verifications()['clips']
 for name in sorted(paths,key=lambda name:(approved.get(name,{}).get('label') in ('person','people'),name),reverse=True):
  if name in items and items[name].get('bytes')==rows[name].get('size') and items[name].get('_sidecar_sha256')==paths[name]:continue
  if added>=8:break
  try:
   raw=subprocess.run(['adb','-s',PHONE,'exec-out','cat',SD+'/'+name+'.visual-v36.json'],capture_output=True,timeout=20,check=True).stdout
   if len(raw)>500000:raise ValueError('sidecar_too_large')
   if hashlib.sha256(raw).hexdigest()!=paths[name]:raise ValueError('sidecar_changed_during_read')
   meta=validate(json.loads(raw))
   if meta['bytes']!=rows[name].get('size'):raise ValueError('source_size_mismatch')
   meta['_sidecar_sha256']=paths[name];items[name]=meta;added+=1
  except (ValueError,KeyError,TypeError,subprocess.SubprocessError):errors+=1
 items={k:v for k,v in items.items() if k in rows and rows[k].get('size')==v.get('bytes')}
 atomic(ROOT/'catalog.json',{'version':VERSION,'updated_at':now(),'items':items,'last_sync_errors':errors})
 return {'ok':True,'indexed_clips':len(items),'new_clips':added,'errors':errors,'queued_verified_clips':queued,'tracks':sum(len(x['tracks']) for x in items.values())}
def archive_verifications():
 """Use current file-bound owner decisions, never model labels or old snapshots."""
 import s9_archive_review_v32 as archive
 store=archive.read_store()
 if store is None:raise OSError('archive_verification_unavailable')
 # The LAN relay and archive service run in separate processes. The archive
 # module's handler callback is initialized only in the latter; read the shared
 # registry against current source rows instead of relying on that callback.
 clips={}
 for name,row in source_rows().items():
  if not archive.SD_NAME.fullmatch(name) or row.get('sd_verified') is not True:continue
  if type(row.get('size')) is not int or row['size']<=10000:continue
  decision=store['labels'].get('sd:'+name,{})
  valid=decision.get('human_confirmed') is True and decision.get('revision')==archive.revision('sd',name,row)
  clips[name]={'label':decision.get('label') if valid else None,'bytes':row['size']}
 return {'ok':True,'clips':clips}

def observations():
 rows=source_rows();result={};approved=archive_verifications().get('clips',{})
 for name,meta in index().get('items',{}).items():
  if name not in rows or rows[name].get('size')!=meta.get('bytes'):continue
  decision=approved.get(name,{})
  if decision.get('label') not in ('person','people') or decision.get('bytes')!=meta.get('bytes'):continue
  try:validate(meta)
  except (ValueError,KeyError,TypeError):continue
  for track in meta['tracks']:
   identity=name+':'+meta['sha256']+':'+str(track['track_id'])
   key='V'+hashlib.sha256(identity.encode()).hexdigest()[:24]
   signature=hashlib.sha256(json.dumps([track['first_ms'],track['last_ms'],track['full_crop']['source_box_pixels']],separators=(',',':')).encode()).hexdigest()
   result[key]={**track,'observation':key,'signature':signature,'clip':name,'source_sha256':meta['sha256'],'recorded_ms':int(name[7:20]),'duration_ms':meta['duration_ms'],
    'source_resolution':'3840×2160','decoder':meta['decoder'],'repeated_simultaneous':meta['repeated_simultaneous'],'peak_simultaneous':meta['peak_simultaneous'],
    'tracklet_count':meta['tracklet_count'],'archive_label':decision['label'],'video_path':'/new/saved/clip/'+name}
 return result
def count_metrics(name,row):
 """Overlay sampled count evidence without editing independent human labels."""
 meta=index().get('items',{}).get(name)
 if not meta or meta.get('bytes')!=row.get('size'):return {}
 try:validate(meta)
 except (ValueError,TypeError,KeyError):return {}
 repeated,peak=meta['repeated_simultaneous'],meta['peak_simultaneous']
 if type(repeated) is not int or type(peak) is not int or not 0<=repeated<=peak<=10:return {}
 repeated=min(repeated,sum(temporally_supported(track) for track in meta['tracks']))
 category='multiple_people' if repeated>=2 else 'one_person' if repeated else 'unreviewed' if peak else 'motion_other'
 return {'person_count':repeated,'person_peak_simultaneous':peak,'person_repeated_simultaneous':repeated,
  'person_count_version':meta['count_version'],'person_count_is_unique_identities':False,
  'scene_category':category,'person_status':category,'person_event_category':'multiple_people_candidate' if repeated>=2 else 'single_person_repeated_candidate' if repeated else 'possible_group_needs_frame_review' if peak>=2 else 'single_frame_person_candidate' if peak else 'no_person_model_detection'}

def temporally_supported(track):
 samples=track.get('samples',0);first=track.get('first_ms');last=track.get('last_ms')
 return type(samples) is int and samples>=2 and finite(first,0,125000) and finite(last,0,125000) and last-first>=500
def bhattacharyya(a,b):return max(0,min(1,1-sum(math.sqrt(x*y) for x,y in zip(a,b))))
def report(query):
 permitted={'color','direction','entry_zone','exit_zone','from','to','folder','sort','reference','offset','limit','presence','support','clip'}
 if set(query)-permitted or any(len(v)!=1 or len(v[0])>100 for v in query.values()):raise ValueError('invalid_filters')
 q={k:v[0] for k,v in query.items()};all_items=observations();items=list(all_items.values())
 with contextlib.closing(db()) as connection:
  revision=connection.execute('SELECT value FROM revision').fetchone()[0]
  folders=[dict(r) for r in connection.execute('SELECT * FROM folders ORDER BY created,id')]
  reviews={r['observation']:dict(r) for r in connection.execute('SELECT * FROM reviews')}
 stale=0
 for item in items:
  review=reviews.get(item['observation']);valid=review and review['signature']==item['signature'];stale+=bool(review and not valid)
  item['review']=review if valid else None;item['review_changed']=bool(review and not valid)
  item['previous_review']=review if review and not valid else None
  item['verified_group_id']=review['folder'] if valid else None
  item['presence']=review['presence'] if valid else 'pending'
  item['temporal_support']=temporally_supported(item)
  item['evidence_status']='temporally_supported_candidate' if item['temporal_support'] else 'single_frame_candidate' if item.get('samples',0)<2 else 'short_span_candidate'
 for f in folders:
  assigned=[r for r in items if r['verified_group_id']==f['id'] and r['presence']=='person']
  f['views']=len(assigned);f['clips']=len({r['clip'] for r in assigned})
 confirmed=sum(r['presence']=='person' for r in items);pending=sum(r['presence']=='pending' for r in items)
 support=q.get('support','supported')
 if support not in ('supported','weak','all'):raise ValueError('invalid_support_filter')
 weak=sum(not r['temporal_support'] and r['presence']!='person' for r in items)
 if support!='all':items=[r for r in items if (r['temporal_support'] or r['presence']=='person')==(support=='supported')]
 if q.get('clip'):
  if not CLIP.fullmatch(q['clip']):raise ValueError('invalid_clip_filter')
  items=[r for r in items if r['clip']==q['clip']]
 presence=q.get('presence','active')
 if presence not in ('active','pending','person','no_person','all'):raise ValueError('invalid_presence_filter')
 items=[r for r in items if (r['presence']!='no_person' if presence=='active' else True if presence=='all' else r['presence']==presence)]
 for field in ('direction','entry_zone','exit_zone'):
  if q.get(field):items=[r for r in items if r.get(field)==q[field]]
 if q.get('color'):items=[r for r in items if any(p.get('name')==q['color'] for field in ('upper_palette','lower_palette') for p in r.get(field,[]))]
 if q.get('folder'):items=[r for r in items if (r['verified_group_id'] or 'unreviewed')==q['folder']]
 for field,sign in (('from',1),('to',-1)):
  if q.get(field):
   boundary=int(q[field]);items=[r for r in items if sign*(r['recorded_ms']-boundary)>=0]
 if q.get('reference'):
  reference=all_items.get(q['reference'])
  if reference is None:raise ValueError('reference_not_available')
  for item in items:item['colour_distance']=round(sum(bhattacharyya(reference[f],item[f]) for f in ('upper_hsv32','lower_hsv32'))/2,5)
  items.sort(key=lambda r:(r['colour_distance'],-r['recorded_ms'],r['observation']))
 elif q.get('sort')=='oldest':items.sort(key=lambda r:(r['recorded_ms'],r['track_id']))
 elif q.get('sort')=='sharpest':items.sort(key=lambda r:(-r['full_crop']['quality'],-r['recorded_ms']))
 elif q.get('sort')=='pinned':items.sort(key=lambda r:(-bool((r.get('review') or {}).get('pinned')),-r['recorded_ms']))
 else:items.sort(key=lambda r:(-r['recorded_ms'],r['track_id']))
 offset=int(q.get('offset',0));limit=int(q.get('limit',100))
 if not 0<=offset<=100000 or not 1<=limit<=200:raise ValueError('invalid_page')
 return {'ok':True,'version':VERSION,'revision':revision,'folders':folders,'total':len(items),'items':items[offset:offset+limit],
  'indexed_clips':len(index().get('items',{})),'eligible_clips':len({r['clip'] for r in all_items.values()}),
  'verification_gate':'current_archive_person_or_people','updated_at':index().get('updated_at'),'changed_reviews':stale,
  'weak_views_held':weak,'candidate_views':len(all_items),'confirmed_views':confirmed,'pending_views':pending,
  'organization':'manual_only','sorting':'clothing_colour_distance_not_identity' if q.get('reference') else 'metadata','identity_matching':False}
def edit(data):
 if not isinstance(data,dict) or set(data)-{'action','revision','human_confirmed','folder','label','note','pinned','observations','presence'}:return 400,{'ok':False,'error':'invalid_fields'}
 if data.get('human_confirmed') is not True or type(data.get('revision')) is not int:return 400,{'ok':False,'error':'explicit_manual_review_required'}
 action=data.get('action');label=data.get('label','');note=data.get('note','');keys=data.get('observations',[]);folder=data.get('folder')
 if action not in ('create_folder','edit_folder','assign','unassign','annotate','presence'):return 400,{'ok':False,'error':'invalid_action'}
 if action=='presence' and data.get('presence') not in ('pending','person','no_person'):return 400,{'ok':False,'error':'invalid_presence'}
 if not isinstance(label,str) or len(label)>100 or not isinstance(note,str) or len(note)>2000 or type(data.get('pinned',False)) is not bool:return 400,{'ok':False,'error':'invalid_review_text'}
 if not isinstance(keys,list) or len(keys)>100 or len(set(keys))!=len(keys) or any(not isinstance(k,str) for k in keys):return 400,{'ok':False,'error':'invalid_selection'}
 current=observations()
 if action in ('assign','unassign','annotate','presence') and (not keys or any(k not in current for k in keys)):return 404,{'ok':False,'error':'selected_track_unavailable'}
 with contextlib.closing(db()) as connection:
  try:
   connection.execute('BEGIN IMMEDIATE')
   if data['revision']!=connection.execute('SELECT value FROM revision').fetchone()[0]:return 409,{'ok':False,'error':'review_changed_refresh_then_retry'}
   if action=='create_folder':
    if not label.strip():return 400,{'ok':False,'error':'folder_name_required'}
    folder='G'+os.urandom(10).hex();connection.execute('INSERT INTO folders VALUES(?,?,?,?)',(folder,label.strip(),note,now()))
   elif action=='edit_folder':
    if not label.strip() or not connection.execute('SELECT 1 FROM folders WHERE id=?',(folder,)).fetchone():return 404,{'ok':False,'error':'folder_unavailable'}
    connection.execute('UPDATE folders SET label=?,note=? WHERE id=?',(label.strip(),note,folder))
   else:
    if action=='assign' and not connection.execute('SELECT 1 FROM folders WHERE id=?',(folder,)).fetchone():return 404,{'ok':False,'error':'folder_unavailable'}
    if action=='assign':
     for key in keys:
      saved=connection.execute('SELECT signature,presence FROM reviews WHERE observation=?',(key,)).fetchone()
      if not saved or saved['signature']!=current[key]['signature'] or saved['presence']!='person':return 409,{'ok':False,'error':'confirm_person_visible_before_assigning'}
    for key in keys:
     connection.execute('INSERT OR IGNORE INTO reviews(observation,signature) VALUES(?,?)',(key,current[key]['signature']))
     connection.execute("UPDATE reviews SET presence='pending' WHERE observation=? AND signature!=?",(key,current[key]['signature']))
     if action=='presence':connection.execute('UPDATE reviews SET signature=?,presence=? WHERE observation=?',(current[key]['signature'],data['presence'],key))
     elif action in ('assign','unassign'):connection.execute('UPDATE reviews SET signature=?,folder=? WHERE observation=?',(current[key]['signature'],folder if action=='assign' else None,key))
     else:connection.execute('UPDATE reviews SET signature=?,label=?,note=?,pinned=? WHERE observation=?',(current[key]['signature'],label,note,int(data.get('pinned',False)),key))
   connection.execute('INSERT INTO audit(at,action,payload) VALUES(?,?,?)',(now(),action,json.dumps(data,sort_keys=True)))
   connection.execute('UPDATE revision SET value=value+1');connection.commit()
  except (sqlite3.Error,OSError):connection.rollback();return 503,{'ok':False,'error':'review_not_saved'}
 return 200,{'ok':True,'folder':folder,'revision':data['revision']+1}
def crop_bytes(name):
 if not CROP.fullmatch(name):raise ValueError('invalid_crop')
 evidence=None
 for item in observations().values():
  for field in ('full_crop','upper_crop'):
   if item[field]['name']==name:evidence=item[field]
 if evidence is None:raise FileNotFoundError('crop_not_in_current_catalog')
 CACHE.mkdir(parents=True,exist_ok=True,mode=0o700);path=CACHE/evidence['sha256']
 if path.is_file():raw=path.read_bytes()
 else:
  if not CROP_READS.acquire(timeout=20):raise OSError('crop_queue_busy')
  try:raw=subprocess.run(['adb','-s',PHONE,'exec-out','cat',SD+'/VisualCrops/'+name],capture_output=True,check=True,timeout=18).stdout
  finally:CROP_READS.release()
 if len(raw)!=evidence['bytes'] or hashlib.sha256(raw).hexdigest()!=evidence['sha256'] or not raw.startswith(b'\xff\xd8\xff'):raise OSError('crop_integrity_or_phone_unavailable')
 if not path.exists():
  cached=sorted((p for p in CACHE.iterdir() if re.fullmatch('[a-f0-9]{64}',p.name) and p.is_file()),key=lambda p:p.stat().st_mtime)
  total=sum(p.stat().st_size for p in cached)
  while cached and (len(cached)>=100 or total+len(raw)>50*1024*1024):
   old=cached.pop(0);total-=old.stat().st_size;old.unlink()
  path.write_bytes(raw);os.chmod(path,0o600)
 return raw
def install(handler,external=False):
 previous_get,previous_post=handler.go,handler.do_POST
 def permitted(self):return self.authorized() if external else self.client_address[0] in ('127.0.0.1','::1')
 def reply(self,code,data):
  raw=json.dumps(data,allow_nan=False).encode();self.send_response(code)
  if external:self.cors()
  self.send_header('Content-Type','application/json');self.send_header('Cache-Control','private,no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers()
  if self.command!='HEAD':self.wfile.write(raw)
 def get(self,*args,**kwargs):
  url=urlsplit(self.path)
  if url.path!='/new/api/visual-review' and not url.path.startswith('/new/api/visual-review/crop/'):return previous_get(self,*args,**kwargs)
  if not permitted(self):return reply(self,401,{'ok':False,'error':'authentication_required'})
  try:
   if url.path=='/new/api/visual-review':return reply(self,200,report(parse_qs(url.query,keep_blank_values=True)))
   raw=crop_bytes(url.path.rsplit('/',1)[-1]);self.send_response(200)
   if external:self.cors()
   self.send_header('Content-Type','image/jpeg');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','private,no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers()
   if self.command!='HEAD':self.wfile.write(raw)
  except FileNotFoundError:return reply(self,404,{'ok':False,'error':'crop_not_available'})
  except (ValueError,KeyError,TypeError):return reply(self,400,{'ok':False,'error':'invalid_query_or_metadata'})
  except (OSError,sqlite3.Error,subprocess.SubprocessError):return reply(self,503,{'ok':False,'error':'visual_catalog_or_phone_unavailable'})
 def post(self,*args,**kwargs):
  if urlsplit(self.path).path!='/new/api/visual-review/review':return previous_post(self,*args,**kwargs)
  if not permitted(self):return reply(self,401,{'ok':False,'error':'authentication_required'})
  if self.headers.get('Origin') not in ORIGINS or self.headers.get('X-S9-Visual-Review-Intent')!=INTENT:return reply(self,403,{'ok':False,'error':'explicit_manual_review_required'})
  try:
   size=int(self.headers.get('Content-Length',0))
   if not 2<=size<=64000 or 'application/json' not in self.headers.get('Content-Type',''):raise ValueError('invalid_body')
   code,result=edit(json.loads(self.rfile.read(size)));return reply(self,code,result)
  except (ValueError,TypeError,KeyError):return reply(self,400,{'ok':False,'error':'invalid_review_request'})
  except (OSError,sqlite3.Error):return reply(self,503,{'ok':False,'error':'review_store_unavailable'})
 handler.go=get;handler.do_POST=post
if __name__=='__main__':print(json.dumps(sync()))
