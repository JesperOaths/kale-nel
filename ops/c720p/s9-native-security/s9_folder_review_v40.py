"""Human-approved clip folders; optional clothing-colour catalog search only.

No identity estimates, biometric features, automatic folder assignments, or
identity training. Approvals pin a source-bound review image and recording.
"""
import contextlib,hashlib,json,os,sqlite3

WORKFLOW='clip_folders_v40'
ACTIONS={'seed_folder','approve_clip','reject_clip','restore_clip','skip_clip','restore_inbox_clip'}

def connection(b,items):
 c=b.db()
 c.executescript('''CREATE TABLE IF NOT EXISTS folder_clips_v40(
 folder TEXT NOT NULL REFERENCES folders(id),clip TEXT NOT NULL,source_sha256 TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),snapshot TEXT NOT NULL,
 updated TEXT NOT NULL,PRIMARY KEY(folder,clip,source_sha256));
 CREATE TABLE IF NOT EXISTS inbox_skips_v40(
 clip TEXT NOT NULL,source_sha256 TEXT NOT NULL,snapshot TEXT NOT NULL,updated TEXT NOT NULL,
 PRIMARY KEY(clip,source_sha256));
 CREATE TABLE IF NOT EXISTS folder_migrations_v40(version TEXT PRIMARY KEY);''')
 try:
  c.execute('BEGIN IMMEDIATE')
  if not c.execute('SELECT 1 FROM folder_migrations_v40 WHERE version=?',(WORKFLOW,)).fetchone():
   # Import only existing explicit human crop approvals/assignments. A model
   # detection, colour set or unconfirmed legacy label never seeds a folder.
   for item in items:
    if item['presence']=='person' and item['verified_group_id']:
     c.execute('INSERT OR IGNORE INTO folder_clips_v40 VALUES(?,?,?,?,?,?)',
      (item['verified_group_id'],item['clip'],item['source_sha256'],'approved',snapshot(item),b.now()))
   c.execute('INSERT INTO folder_migrations_v40 VALUES(?)',(WORKFLOW,))
  c.commit();return c
 except BaseException:c.rollback();c.close();raise

def snapshot(item):
 result={k:v for k,v in item.items() if k not in ('review','previous_review','review_changed','verified_group_id','alternatives','memberships','decision','colour_distance')}
 raw=json.dumps(result,allow_nan=False,separators=(',',':'))
 if len(raw.encode())>64000:raise ValueError('review_snapshot_too_large')
 return raw

def eligible_snapshot(raw,b,scope,catalog):
 try:
  if len(raw)>64000:return None
  item=json.loads(raw);name=item['clip'];meta=catalog.get(name,{})
  if scope.get(name,{}).get('label') not in ('person','people'):return None
  if scope[name]['bytes']!=item['source_bytes']:return None
  proof=scope[name].get('source_sha256')
  if proof and proof!=item['source_sha256']:return None
  if meta:
   if meta.get('bytes')!=item['source_bytes'] or meta.get('sha256')!=item['source_sha256']:return None
  elif proof!=item['source_sha256']:return None
  b.validate({'version':b.VERSION,'name':name,'bytes':item['source_bytes'],'sha256':item['source_sha256'],
   'width':3840,'height':2160,'duration_ms':item['duration_ms'],'identity_matching':False,'tracks':[item]})
  if not isinstance(item['signature'],str) or len(item['signature'])!=64:return None
  return item
 except (ValueError,TypeError,KeyError):return None

def state(b):
 all_items,items,revision,folders,stale=b.review_context()
 with contextlib.closing(connection(b,items)) as c:
  ledger=[dict(r) for r in c.execute('SELECT * FROM folder_clips_v40')]
  skips=[dict(r) for r in c.execute('SELECT * FROM inbox_skips_v40')]
 scope=b.archive_verifications()['clips'];catalog=b.index().get('items',{})
 for record in ledger+skips:record['item']=eligible_snapshot(record['snapshot'],b,scope,catalog)
 return all_items,items,revision,folders,ledger,skips,scope,catalog

def colour_distance(item,examples,b):
 # Only normalized clothing-region HSV histograms. Never face, body shape,
 # gait, height, pose, location-derived identity, or identity probabilities.
 return min(sum(b.bhattacharyya(item[f],example[f]) for f in ('upper_hsv32','lower_hsv32'))/2 for example in examples)

def group_clips(items,examples,b,weak=True,route=False,distance=1):
 grouped={}
 for item in items:
  if item['presence']=='no_person' or (not weak and not item['temporal_support']):continue
  if route and examples and not any((item.get('entry_zone'),item.get('exit_zone'))==(r.get('entry_zone'),r.get('exit_zone')) for r in examples):continue
  candidate=dict(item)
  if examples:
   candidate['colour_distance']=round(colour_distance(item,examples,b),5)
   if candidate['colour_distance']>distance:continue
  grouped.setdefault((item['clip'],item['source_sha256']),[]).append(candidate)
 result=[]
 for views in grouped.values():
  views.sort(key=lambda r:(r.get('colour_distance',0),not r['temporal_support'],-r['full_crop']['quality'],r['track_id']))
  best=dict(views[0]);best['alternatives']=views;result.append(best)
 result.sort(key=lambda r:(r.get('colour_distance',0),-r['recorded_ms'],r['clip']))
 return result

def report(query,b):
 allowed={'workflow','folder','tab','offset','limit','distance','weak','route','clip'}
 if set(query)-allowed or any(len(v)!=1 or len(v[0])>100 for v in query.values()):raise ValueError('invalid_folder_filters')
 q={k:v[0] for k,v in query.items()};folder=q.get('folder','');tab=q.get('tab','suggestions' if folder else 'inbox')
 if q.get('workflow')!=WORKFLOW or tab not in ('inbox','all','skipped','approved','suggestions','rejected','assign'):raise ValueError('invalid_folder_view')
 if bool(folder)!=(tab in ('approved','suggestions','rejected','assign')):raise ValueError('folder_view_mismatch')
 offset=int(q.get('offset',0));limit=int(q.get('limit',24));distance=float(q.get('distance',.35))
 if not 0<=offset<=100000 or not 1<=limit<=100 or not b.finite(distance,0,1):raise ValueError('invalid_folder_page')
 if q.get('weak','0') not in ('0','1') or q.get('route','0') not in ('0','1'):raise ValueError('invalid_folder_filter')
 all_items,items,revision,folders,ledger,skips,scope,catalog=state(b)
 if folder and not any(f['id']==folder for f in folders):raise ValueError('folder_unavailable')
 approved=[r for r in ledger if r['decision']=='approved' and r['item']]
 occupied={(r['clip'],r['source_sha256']) for r in approved}
 skipped={(r['clip'],r['source_sha256']) for r in skips if r['item']}
 membership={}
 for record in approved:membership.setdefault((record['clip'],record['source_sha256']),[]).append(record['folder'])
 refs=[];suggestions=[];assignments=[]
 for f in folders:
  records=[r for r in ledger if r['folder']==f['id']];examples=[r['item'] for r in records if r['decision']=='approved' and r['item']]
  decided={(r['clip'],r['source_sha256']) for r in records}
  candidates=[r for r in items if (r['clip'],r['source_sha256']) not in decided|occupied|skipped]
  ranked=group_clips(candidates,examples,b,weak=q.get('weak')=='1',route=q.get('route')=='1',distance=distance) if examples else []
  f.update(approved_clips=sum(r['decision']=='approved' for r in records),available_approved_clips=len(examples),suggested_clips=len(ranked),rejected_clips=sum(r['decision']=='rejected' for r in records),
   unavailable_clips=sum(not r['item'] for r in records),previews=[r['full_crop'] for r in examples[:3]])
  if f['id']==folder:
   refs=examples;suggestions=ranked
   if tab=='assign':assignments=group_clips(candidates,[],b)
 if folder:
  if tab=='assign':result=assignments
  elif tab=='suggestions':result=suggestions
  else:result=[dict(r['item'],decision=r['decision']) for r in ledger if r['folder']==folder and r['decision']==('approved' if tab=='approved' else 'rejected') and r['item']]
 else:
  if tab=='skipped':result=[dict(r['item'],decision='skipped') for r in skips if r['item']]
  else:result=group_clips([r for r in items if tab=='all' or (r['clip'],r['source_sha256']) not in occupied|skipped],[],b)
 if q.get('clip'):
  if not b.CLIP.fullmatch(q['clip']):raise ValueError('invalid_clip_filter')
  result=[r for r in result if r['clip']==q['clip']]
 for item in result:item['memberships']=membership.get((item['clip'],item['source_sha256']),[])
 positive=[name for name,row in scope.items() if row['label'] in ('person','people')]
 return {'ok':True,'workflow':WORKFLOW,'revision':revision,'folders':folders,'folder':folder,'tab':tab,'items':result[offset:offset+limit],
  'total':len(result),'reference_examples':refs[:4],'profile_examples':len(refs),'identity_matching':False,'organization':'explicit_human_approval',
  'suggestion_basis':'clothing_hsv_distance_only','auto_assignments':False,'coverage':{'verified_clips':len(positive),'processed_clips':sum(n in catalog for n in positive)},
  'inbox_clips':len(group_clips([r for r in items if (r['clip'],r['source_sha256']) not in occupied|skipped],[],b))}

def edit(data,b):
 allowed={'action','revision','human_confirmed','folder','label','note','observation','signature','source_sha256','clip'}
 if set(data)-allowed or data.get('human_confirmed') is not True or type(data.get('revision')) is not int:return 400,{'ok':False,'error':'explicit_manual_review_required'}
 action=data.get('action');folder=data.get('folder','');label=data.get('label','');note=data.get('note','')
 if action not in ACTIONS or not isinstance(folder,str) or len(folder)>100 or not isinstance(label,str) or len(label)>100 or not isinstance(note,str) or len(note)>2000:return 400,{'ok':False,'error':'invalid_folder_review'}
 if any(not isinstance(data.get(k),str) for k in ('observation','signature','source_sha256','clip')):return 400,{'ok':False,'error':'reviewed_view_required'}
 all_items,items,revision,folders,ledger,skips,scope,catalog=state(b)
 def matches(item):return item and all(item[k]==data[k] for k in ('observation','signature','source_sha256','clip'))
 item=all_items.get(data['observation'])
 if not matches(item):item=next((r['item'] for r in ledger+skips if matches(r['item'])),None)
 if not item:return 409,{'ok':False,'error':'reviewed_view_changed_refresh'}
 if action in ('approve_clip','reject_clip','restore_clip') and not any(f['id']==folder for f in folders):return 404,{'ok':False,'error':'folder_unavailable'}
 if action=='seed_folder' and not label.strip():return 400,{'ok':False,'error':'folder_name_required'}
 with contextlib.closing(connection(b,items)) as c:
  try:
   c.execute('BEGIN IMMEDIATE')
   if c.execute('SELECT value FROM revision').fetchone()[0]!=data['revision']:return 409,{'ok':False,'error':'review_changed_refresh_then_retry'}
   if action=='seed_folder':
    folder='G'+os.urandom(10).hex();c.execute('INSERT INTO folders VALUES(?,?,?,?)',(folder,label.strip(),note,b.now()))
   if action in ('seed_folder','approve_clip','reject_clip'):
    decision='rejected' if action=='reject_clip' else 'approved'
    if decision=='approved':c.execute('DELETE FROM inbox_skips_v40 WHERE clip=? AND source_sha256=?',(item['clip'],item['source_sha256']))
    c.execute('INSERT INTO folder_clips_v40 VALUES(?,?,?,?,?,?) ON CONFLICT(folder,clip,source_sha256) DO UPDATE SET decision=excluded.decision,snapshot=excluded.snapshot,updated=excluded.updated',
     (folder,item['clip'],item['source_sha256'],decision,snapshot(item),b.now()))
    current=all_items.get(item['observation'])
    if decision=='approved' and matches(current):
     c.execute('INSERT OR IGNORE INTO reviews(observation,signature) VALUES(?,?)',(item['observation'],item['signature']))
     c.execute("UPDATE reviews SET signature=?,presence='person',folder=? WHERE observation=?",(item['signature'],folder,item['observation']))
    if decision=='rejected':
     for r in items:
      if r['clip']==item['clip']:c.execute('UPDATE reviews SET folder=NULL WHERE observation=? AND folder=?',(r['observation'],folder))
   elif action=='restore_clip':
    c.execute("DELETE FROM folder_clips_v40 WHERE folder=? AND clip=? AND source_sha256=? AND decision='rejected'",(folder,item['clip'],item['source_sha256']))
   elif action=='skip_clip':c.execute('INSERT OR REPLACE INTO inbox_skips_v40 VALUES(?,?,?,?)',(item['clip'],item['source_sha256'],snapshot(item),b.now()))
   elif action=='restore_inbox_clip':c.execute('DELETE FROM inbox_skips_v40 WHERE clip=? AND source_sha256=?',(item['clip'],item['source_sha256']))
   c.execute('INSERT INTO audit(at,action,payload) VALUES(?,?,?)',(b.now(),action,json.dumps(data,sort_keys=True)))
   c.execute('UPDATE revision SET value=value+1');c.commit()
  except (sqlite3.Error,OSError):c.rollback();return 503,{'ok':False,'error':'folder_review_not_saved'}
 return 200,{'ok':True,'folder':folder,'revision':data['revision']+1}

def saved_crops(b):
 # Explicitly approved/rejected historical views stay reviewable if their
 # original recording is still present, unchanged and owner-verified.
 _,_,_,_,ledger,skips,_,_=state(b)
 for record in ledger+skips:
  if record['item']:
   for field in ('full_crop','upper_crop'):yield record['item'][field]
