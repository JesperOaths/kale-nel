#!/usr/bin/env python3
from pathlib import Path
import json,re,shutil,datetime,subprocess,py_compile,os,time

HOME=Path('/home/jespern')
BASE=HOME/'c720p-home-hub'
BIN=BASE/'bin'
WWW=Path('/opt/homeassistant/config/www')
TRIM=BIN/'c720p-archive-quota-trim-v869.py'
RET=BIN/'c720p-drive-value-retention.py'
UP=BIN/'c720p-drive-security-upload.py'
SRV=BIN/'c720p-drive-security-archive.py'
UI=WWW/'c720p-drive-saved.html'
CFG=BASE/'config/elastic-storage-policy.json'
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=HOME/'c720p-backups'/f'security-retention-v106-{stamp}'
BACK.mkdir(parents=True,exist_ok=True)

def backup(p):
    if p.exists(): shutil.copy2(p,BACK/(p.name+'.before'))

for p in (TRIM,RET,UP,SRV,UI,CFG): backup(p)

# 1) Local elastic retention: confirmed people without a verified cloud copy are hard protected.
s=TRIM.read_text()
s=s.replace('# C720P_ELASTIC_STORAGE_V1054','# C720P_ELASTIC_STORAGE_V106_PERSON_PROTECTED',1)
s=s.replace('"policy_version":"v1054-elastic-free-space"','"policy_version":"v106-elastic-person-protected"',1)
old='''    exact_cloud=(clip_name,str(e.get("timestamp") or "")) in cloud_verified
    size=sum(p.stat().st_size for p in files if p.exists())
    rows.append({
        "e":e,"files":files,"age_h":age_h,"status":status,
        "highlight":highlight,"person":person,"exact_cloud":exact_cloud,
        "size":size,
    })'''
new='''    exact_cloud=(clip_name,str(e.get("timestamp") or "")) in cloud_verified
    # Confirmed-person footage in the front garden is not disposable local footage
    # unless the exact clip has already been verified in Drive.
    person_hard_protected=(status=="confirmed_person" and not exact_cloud)
    size=sum(p.stat().st_size for p in files if p.exists())
    rows.append({
        "e":e,"files":files,"age_h":age_h,"status":status,
        "highlight":highlight,"person":person,"exact_cloud":exact_cloud,
        "person_hard_protected":person_hard_protected,
        "size":size,
    })'''
if old not in s: raise SystemExit('trim row anchor missing')
s=s.replace(old,new,1)
old='''if pressure:
    soft=[x for x in rows if x["age_h"]>=SOFT_GRACE_HOURS]
    pool=soft
    if emergency:
        # In a true disk emergency, all unsaved non-newest-six events may be
        # considered, but the value ordering below still sacrifices weakest first.
        pool=rows'''
new='''if pressure:
    # Normal pressure: confirmed people survive unless cloud-verified; likely people
    # receive a much longer 72 h local grace window.
    soft=[x for x in rows
          if not x["person_hard_protected"]
          and x["age_h"]>=SOFT_GRACE_HOURS
          and (x["status"]!="likely_person" or x["exact_cloud"] or x["age_h"]>=72.0)]
    pool=soft
    if emergency:
        # Even below the hard floor, non-cloud confirmed-person footage remains
        # protected. Likely-person footage only becomes eligible after 24 h.
        pool=[x for x in rows
              if not x["person_hard_protected"]
              and (x["status"]!="likely_person" or x["exact_cloud"] or x["age_h"]>=24.0)]'''
if old not in s: raise SystemExit('trim pressure anchor missing')
s=s.replace(old,new,1)
s=s.replace('    "protected_newest":min(MIN_RECENT,len(ordered)),',
'''    "protected_newest":min(MIN_RECENT,len(ordered)),
    "confirmed_person_hard_protected":sum(1 for x in rows if x.get("person_hard_protected")),
    "likely_person_normal_grace_hours":72,''',1)
TRIM.write_text(s)

# policy documentation
policy=json.loads(CFG.read_text()) if CFG.exists() else {}
policy.update({
    "version":"v106",
    "mode":"elastic_shared_free_space_person_protected",
    "confirmed_person_policy":"never local-trim unless exact Drive copy is verified",
    "likely_person_normal_grace_hours":72,
    "likely_person_emergency_grace_hours":24,
    "manual_saved_protected":True,
})
CFG.write_text(json.dumps(policy,indent=2)+"\n")

# 2) Drive retention: never auto-delete confirmed people; slow down likely-person thinning.
s=RET.read_text()
s=s.replace('MAX_DELETE=30','MAX_DELETE=15',1)
old="""    # Recency-biased burst thinning among reviewed person-positive automatic clips.
    buckets={}
    for x in auto:
        status=str(x.get('person_status') or '')
        if status not in ('confirmed_person','likely_person'):continue
        age_h=x['_age_h'];ts=parse_ts(x)
        if age_h<24:continue
        if age_h<24*7:window=15*60;keep_n=3
        elif age_h<24*30:window=15*60;keep_n=1
        else:window=60*60;keep_n=1
        key=(window,int(ts//window))
        buckets.setdefault((key,keep_n),[]).append(x)"""
new="""    # V106: confirmed-person front-garden clips are durable evidence and are never
    # automatically thinned. Likely-person clips receive a long grace period and
    # are thinned conservatively only when old enough.
    buckets={}
    for x in auto:
        status=str(x.get('person_status') or '')
        if status=='confirmed_person':
            decisions.append({'remote':x.get('remote_name'),'action':'keep','reason':'confirmed_person_protected'})
            continue
        if status!='likely_person':continue
        age_h=x['_age_h'];ts=parse_ts(x)
        if age_h<24*14:
            decisions.append({'remote':x.get('remote_name'),'action':'keep','reason':'likely_person_under_14d','age_h':round(age_h,1)})
            continue
        if age_h<24*30:window=15*60;keep_n=3
        elif age_h<24*90:window=60*60;keep_n=2
        else:window=2*60*60;keep_n=1
        key=(window,int(ts//window))
        buckets.setdefault((key,keep_n),[]).append(x)"""
if old not in s: raise SystemExit('drive person thinning anchor missing')
s=s.replace(old,new,1)
s=s.replace("'policy':'drive-recency-value-v1'","'policy':'drive-recency-value-v2-person-protected'",1)
s=s.replace("x['delete_reason']='drive-recency-value-v1:'+why","x['delete_reason']='drive-recency-value-v2-person-protected:'+why",1)
RET.write_text(s)

# 3) Uploader: make a representative thumbnail from the actual MP4 before cleanup.
s=UP.read_text()
insert_after="""def archive_derivative(cam,src,reason):
 # SOURCE_1080P_ARCHIVE_V1: retained footage stays at the recorder source
 # resolution. Storage savings come from value/recency retention, not downscale.
 return src,{
  'archive_profile':'source-1080p-original',
  'source_size':src.stat().st_size,
  'archive_transcoded':False,
 }
"""
helper=r'''
def _frame_at(src,t,dst):
    dst.parent.mkdir(parents=True,exist_ok=True)
    cmd=['/usr/bin/ffmpeg','-hide_banner','-loglevel','error','-y','-ss',f'{max(0.0,float(t)):.3f}',
         '-i',str(src),'-frames:v','1','-vf','scale=800:-2:force_original_aspect_ratio=decrease',
         '-q:v','3',str(dst)]
    r=subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=45)
    return r.returncode==0 and dst.is_file() and dst.stat().st_size>2000

def representative_thumb(src,detrow,dst):
    """Pick strongest detected-person sample; otherwise choose the richest sampled frame."""
    try: fps=float(detrow.get('fps') or 0); frames=float(detrow.get('frames') or 0)
    except: fps=frames=0.0
    duration=(frames/fps) if fps>0 and frames>0 else 0.0
    if duration<=0:
        try:
            r=subprocess.run(['/usr/bin/ffprobe','-v','error','-show_entries','format=duration',
                              '-of','default=noprint_wrappers=1:nokey=1',str(src)],
                             text=True,capture_output=True,timeout=20)
            duration=float((r.stdout or '0').strip() or 0)
        except: duration=0.0
    scores=detrow.get('person_frame_scores')
    if isinstance(scores,list) and scores:
        vals=[]
        for x in scores:
            try: vals.append(float(x or 0))
            except: vals.append(0.0)
        peak=max(vals) if vals else 0.0
        if peak>0 and duration>0:
            i=max(range(len(vals)),key=lambda n:vals[n])
            t=((i+0.5)/len(vals))*duration
            if _frame_at(src,t,dst):
                return 'strongest-person-sample',round(t,3),peak
    # No usable person score: sample across the clip and use JPEG information
    # density as a deterministic proxy for the most visually informative moment.
    if duration<=0: duration=10.0
    tmpdir=TRANSCODE/'thumb-candidates';tmpdir.mkdir(parents=True,exist_ok=True)
    candidates=[]
    for i,f in enumerate((.10,.25,.40,.55,.70,.85)):
        t=max(0.0,min(duration-.1,duration*f))
        q=tmpdir/(dst.stem+f'.{i}.jpg')
        if _frame_at(src,t,q):
            try:candidates.append((q.stat().st_size,-abs(f-.5),t,q))
            except:pass
    if candidates:
        candidates.sort(reverse=True);_,_,t,q=candidates[0]
        shutil.copy2(q,dst)
        for _,_,_,x in candidates:
            try:x.unlink()
            except:pass
        return 'visual-detail-sample',round(t,3),0.0
    return 'unavailable',None,0.0
'''
if 'def representative_thumb(' not in s:
    if insert_after not in s: raise SystemExit('uploader derivative anchor missing')
    s=s.replace(insert_after,insert_after+helper,1)

old="""   snap=pathlib.Path(str(e.get('snapshot') or '')).name; local_snap=ROOTS[cam]/'snaps'/snap; archsnap=''
   if snap and local_snap.is_file():
    archsnap=pathlib.Path(remote).stem+'.jpg'; dst=TH/cam/archsnap;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(local_snap,dst)
    # Also upload thumbnail, but destructive cleanup depends only on verified MP4.
    sr=subprocess.run([c['rclone'],'--config',c['rclone_config'],'copyto',str(dst),c['remote']+':'+archsnap,'--drive-root-folder-id',c['folders'][cam]['id'],'--retries','2'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=120)
   item={'camera':cam"""
new="""   snap=pathlib.Path(str(e.get('snapshot') or '')).name; local_snap=ROOTS[cam]/'snaps'/snap
   detrow=(det.get('items') or {}).get(f'{cam}:{src.name}',{})
   archsnap=pathlib.Path(remote).stem+'.jpg'; dst=TH/cam/archsnap;dst.parent.mkdir(parents=True,exist_ok=True)
   thumb_method,thumb_time,thumb_person_score=representative_thumb(src,detrow,dst)
   if (not dst.is_file() or dst.stat().st_size<2000) and snap and local_snap.is_file():
    shutil.copy2(local_snap,dst);thumb_method='recorder-snapshot-fallback';thumb_time=None;thumb_person_score=0.0
   if dst.is_file():
    # Thumbnail is useful UI metadata, but destructive cleanup still depends only on verified MP4.
    subprocess.run([c['rclone'],'--config',c['rclone_config'],'copyto',str(dst),c['remote']+':'+archsnap,'--drive-root-folder-id',c['folders'][cam]['id'],'--retries','2'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=120)
   else:
    archsnap=''
   item={'camera':cam"""
if old not in s: raise SystemExit('uploader snapshot anchor missing')
s=s.replace(old,new,1)
s=s.replace("'selection_reason':reason,**archive_meta,'local_clip_name':src.name",
            "'selection_reason':reason,'thumbnail_method':thumb_method,'thumbnail_time_seconds':thumb_time,'thumbnail_person_score':thumb_person_score,**archive_meta,'local_clip_name':src.name",1)
UP.write_text(s)

# 4) Archive server: immediate Drive reconciliation and delete compatibility.
s=SRV.read_text()
s=s.replace('REMOTE_INV_TTL=300','REMOTE_INV_TTL=60')
s=s.replace('def reconcile_remote(cam):\n names=remote_inventory(cam)',
            'def reconcile_remote(cam,force=False):\n names=remote_inventory(cam,force)',1)
s=s.replace("name=safe(body.get('remote_name'))",
            "name=safe(body.get('remote_name') or body.get('name'))",1)
# Force real Drive inventory for each gallery refresh.
s=s.replace('if ok:reconcile_remote(cam)\n   for x in sorted(items(cam)',
            'if ok:reconcile_remote(cam,True)\n   for x in sorted(items(cam)',1)
s=s.replace("if missing:reconcile_remote(cam)","if missing:reconcile_remote(cam,True)",1)
s=s.replace("'selection_reason')};pc=float",
            "'selection_reason','thumbnail_method','thumbnail_time_seconds','thumbnail_person_score')};pc=float",1)
SRV.write_text(s)

# 5) UI: clearer protection/status badges + automatic reconciliation refresh.
s=UI.read_text()
s=s.replace(".thumbBadge.person{color:#aaf7c3;border-color:rgba(91,235,137,.38)}",
""".thumbBadge.person{color:#aaf7c3;border-color:rgba(91,235,137,.38)}
.thumbBadge.protected{color:#d8ffd9;border-color:rgba(92,245,126,.55);background:rgba(24,95,47,.88)}
.thumbBadge.likely{color:#c9e7ff;border-color:rgba(92,180,245,.45)}""",1)
old="function badges(e){const p=pct(e.person_confidence),h=pct(e.highlight_score);let a=[];if(p!=null)a.push('<span class=\"thumbBadge person\">Person '+p+'%</span>');else a.push('<span class=\"thumbBadge motion\">Motion</span>');if(h!=null)a.push('<span class=\"thumbBadge\">Highlight '+h+'%</span>');return a.join('')}"
new="""function badges(e){const p=pct(e.person_confidence),h=pct(e.highlight_score),st=String(e.person_status||'unknown');let a=[];
if(st==='confirmed_person')a.push('<span class="thumbBadge protected">Confirmed Person · Protected</span>');
else if(st==='likely_person')a.push('<span class="thumbBadge likely">Likely Person</span>');
else if(p!=null)a.push('<span class="thumbBadge person">Person '+p+'%</span>');
else a.push('<span class="thumbBadge motion">Motion</span>');
if(h!=null)a.push('<span class="thumbBadge">Highlight '+h+'%</span>');return a.join('')}"""
if old not in s: raise SystemExit('UI badges anchor missing')
s=s.replace(old,new,1)
s=s.replace("e.person_strong_frames!=null?' · '+esc(e.person_strong_frames)+' strong frames':'')",
"""e.person_strong_frames!=null?' · '+esc(e.person_strong_frames)+' strong frames':'')+
(e.thumbnail_method?' · '+esc(String(e.thumbnail_method).replaceAll('-',' ')):'')""",1)
s=s.replace("$('refresh').onclick=load;load();",
"""$('refresh').onclick=load;load();
setInterval(()=>{if(!document.hidden)load()},60000);""",1)
# Cache marker
if 'C720P_SAVED_RETENTION_V106' not in s:
    s=s.replace('</head>','<meta name="c720p-build" content="C720P_SAVED_RETENTION_V106"></head>',1)
UI.write_text(s)

for p in (TRIM,RET,UP,SRV):
    py_compile.compile(str(p),doraise=True)

# Restart only affected services and run safe previews/reconciliation.
subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service'],check=True,timeout=30)
subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],check=False,timeout=20)

preview=subprocess.run(['python3',str(RET)],text=True,capture_output=True,timeout=90)
if preview.returncode not in (0,): raise SystemExit('retention preview failed: '+preview.stderr[-1000:])
# Do not apply retention here; this verifies candidate policy without deleting Drive files.

# Call saved API once: this now forces inventory reconciliation.
api=subprocess.run(['curl','-fsS','--max-time','100','http://127.0.0.1:8795/new/api/saved'],text=True,capture_output=True,timeout=110)
if api.returncode: raise SystemExit('saved API failed: '+api.stderr)
apid=json.loads(api.stdout)
events=apid.get('events',[])

confirmed_candidates=[]
try:
    rp=json.loads((BASE/'state/drive-value-retention-last.json').read_text())
    confirmed_candidates=[x for x in rp.get('preview',[]) if x.get('person_status')=='confirmed_person']
except: pass

print('PATCH=V106_APPLIED')
print('BACKUP='+str(BACK))
print('SAVED_API_COUNT='+str(len(events)))
print('CONFIRMED_PERSON_RETENTION_CANDIDATES='+str(len(confirmed_candidates)))
print('RETENTION_PREVIEW='+preview.stdout.splitlines()[0] if preview.stdout else 'none')
print('DELETE_BODY_COMPAT='+str("body.get('remote_name') or body.get('name')" in SRV.read_text()))
print('FORCE_RECONCILE='+str('reconcile_remote(cam,True)' in SRV.read_text()))
print('THUMB_GENERATOR='+str('def representative_thumb(' in UP.read_text()))
print('UI_V106='+str('C720P_SAVED_RETENTION_V106' in UI.read_text()))
