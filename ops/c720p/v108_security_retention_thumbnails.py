from pathlib import Path
import re, shutil, datetime, json, subprocess, time, os

HOME=Path('/home/jespern')
BASE=HOME/'c720p-home-hub'
WWW=Path('/opt/homeassistant/config/www')
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=HOME/'c720p-backups'/f'security-v108-{STAMP}'
BACK.mkdir(parents=True,exist_ok=True)

DR=BASE/'bin/c720p-drive-value-retention.py'
LT=BASE/'bin/c720p-archive-quota-trim-v869.py'
RV=BASE/'bin/c720p-drive-person-revalidate.py'
TH107=BASE/'bin/c720p-saved-thumbnailer-v107.py'
TH108=BASE/'bin/c720p-saved-thumbnailer-v108.py'
SU=HOME/'.config/systemd/user/c720p-saved-thumbnailer-v106.service'
TU=HOME/'.config/systemd/user/c720p-saved-thumbnailer-v106.timer'
RU=HOME/'.config/systemd/user/c720p-drive-person-revalidate.service'
UI=WWW/'c720p-drive-saved.html'
SURV=WWW/'c720p-surveillance.html'
CFG=Path('/opt/homeassistant/config/.storage/lovelace.c720p_hub')

for p in [DR,LT,RV,TH107,SU,TU,RU,UI,SURV,CFG]:
    if p.exists(): shutil.copy2(p,BACK/(p.name+'.before'))

# 1) Drive retention: evidence-first, storage-pressure-only deletion.
s=DR.read_text()
s=s.replace('"v106-person-protected-drive"','"v108-evidence-first-drive"')
s=s.replace("'v106-person-protected-drive'","'v108-evidence-first-drive'")
start=s.find('newest={id(x) for x in ordered[:30]}')
end=s.find('cands.sort(key=lambda z:',start)
if start<0 or end<0: raise SystemExit('drive retention candidate block not found')
sort_end=s.find('\n',end)
new_block='''newest={id(x) for x in ordered[:50]}
now=time.time()
cands=[]
protected={"manual":0,"confirmed_person":0,"newest":0,"unreviewed":0,"likely_person":0,"uncertain_recent":0,"no_person_recent":0}
for x in ordered:
    name=safe(x.get("remote_name"));local=safe(x.get("local_clip_name") or "")
    di=ditems.get("new:"+local,{}) if isinstance(ditems,dict) else {}
    raw_status=di.get("person_status") or x.get("person_status")
    st=str(raw_status or "unknown")
    age=(now-parse_ts(x.get("timestamp")))/86400 if parse_ts(x.get("timestamp")) else 99999
    is_manual=local in manual or bool(x.get("manual_saved")) or str(x.get("selection_reason") or "").startswith("manual")
    if is_manual:
        protected["manual"]+=1;continue
    if st=="confirmed_person":
        protected["confirmed_person"]+=1;continue
    if id(x) in newest:
        protected["newest"]+=1;continue
    # Anything that has never received a meaningful person classification stays
    # protected until the background revalidator has reviewed it.
    if not raw_status or st in ("unknown",""):
        protected["unreviewed"]+=1;continue
    # Likely people are retained for six months before they can even become a
    # pressure candidate. They still rank behind every no-person class.
    if st=="likely_person":
        if age<180:
            protected["likely_person"]+=1;continue
    elif st=="uncertain":
        if age<30:
            protected["uncertain_recent"]+=1;continue
    elif st in ("confirmed_no_person","no_person_sampled"):
        if age<14:
            protected["no_person_recent"]+=1;continue
    else:
        # Unknown/new classifier states are safer to keep than to guess about.
        protected["unreviewed"]+=1;continue
    try:pc=float(di.get("person_confidence") or x.get("person_confidence") or 0)
    except:pc=0
    try:hs=float(di.get("highlight_score") or x.get("highlight_score") or 0)
    except:hs=0
    rank={"confirmed_no_person":0,"no_person_sampled":1,"uncertain":3,"likely_person":8}.get(st,9)
    cands.append({"row":x,"name":name,"status":st,"age_days":age,"rank":rank,"person":pc,"highlight":hs,"size":int(x.get("size") or 0)})

cands.sort(key=lambda z:(z["rank"],-z["age_days"],z["highlight"],z["person"],-z["size"]))'''
s=s[:start]+new_block+s[sort_end:]
s=s.replace('"v106_drive_retention_"+c["status"]','"v108_evidence_first_"+c["status"]')
s=s.replace('"v106_drive_retention":REPORT','"v108_drive_retention":REPORT')
s=s.replace('"confirmed_person_auto_delete":False,"manual_saved_auto_delete":False',
            '"confirmed_person_auto_delete":False,"manual_saved_auto_delete":False,"unreviewed_auto_delete":False,"likely_person_min_days":180')
DR.write_text(s)

# 2) Local cache: stronger confirmed-person protection while retaining emergency safety.
s=LT.read_text()
s=s.replace('MIN_RECENT=6;MIN_CONFIRMED_RECENT=30','MIN_RECENT=6;MIN_CONFIRMED_RECENT=60')
s=s.replace('"v107-person-protected-elastic"','"v108-person-evidence-local"')
s=s.replace('age>=30*24;why="confirmed_person_emergency_cloud_copy_30d"',
            'age>=60*24;why="confirmed_person_emergency_cloud_copy_60d"')
LT.write_text(s)

# 3) Dense person revalidation becomes classification-only. No classifier-driven deletion.
s=RV.read_text()
lines=s.splitlines()
disabled=0
for i,line in enumerate(lines):
    stripped=line.strip()
    if stripped.startswith('if ') and 'confirmed_no_person' in stripped and stripped.endswith(':'):
        indent=line[:len(line)-len(line.lstrip())]
        cond=stripped[3:-1]
        lines[i]=indent+'if False and ('+cond+'):  # V108: classification only; retention owns deletion'
        disabled+=1
if disabled<1:
    raise SystemExit('no confirmed_no_person delete branch found in revalidator')
s='\n'.join(lines)+'\n'
RV.write_text(s)
if RU.exists():
    us=RU.read_text()
    us=us.replace('Revalidate S9+ Drive person clips and delete confirmed no-person false positives',
                  'Revalidate S9+ Drive person evidence without deleting clips')
    RU.write_text(us)

# 4) V108 thumbnailer: missing coverage first + much more useful composition.
t=TH107.read_text()
t=t.replace('VERSION="v107"','VERSION="v108"')
t=t.replace('SAMPLE_FRACTIONS=(.06,.14,.22,.30,.38,.46,.54,.62,.70,.78,.86,.94)',
            'SAMPLE_FRACTIONS=(.04,.10,.16,.22,.28,.34,.40,.46,.52,.58,.64,.70,.76,.82,.88,.94)')
compose_start=t.find('def compose(rows,picks,primary_panel,out,status):')
compose_end=t.find('\ndef generate(e,out):',compose_start)
if compose_start<0 or compose_end<0: raise SystemExit('thumbnail compose block not found')
compose=r'''def _stamp(panel,seconds,x=8,y=None):
    h,w=panel.shape[:2]
    if y is None:y=h-9
    label=f'{int(seconds//60)}:{int(seconds%60):02d}'
    cv2.rectangle(panel,(x-4,y-17),(x+48,y+5),(0,0,0),-1)
    cv2.putText(panel,label,(x,y),cv2.FONT_HERSHEY_SIMPLEX,.44,(245,250,255),1,cv2.LINE_AA)

def compose(rows,picks,primary_panel,out,status):
    # One large evidence frame plus two chronological context frames. This makes
    # a person actually visible in the Security gallery instead of shrinking
    # three equal frames into a very wide strip.
    pr=rows[picks[primary_panel]]
    primary=cover_crop(pr["frame"],570,380,pr["box"] if pr["person"]>=.16 else None)
    _stamp(primary,pr["time"],12,356)
    if status in ("confirmed_person","likely_person"):
        cv2.rectangle(primary,(2,2),(567,377),(90,220,125),3)
        if pr["person"]>0:
            txt=f'person {int(round(pr["person"]*100))}%'
            cv2.rectangle(primary,(10,10),(132,37),(0,0,0),-1)
            cv2.putText(primary,txt,(17,29),cv2.FONT_HERSHEY_SIMPLEX,.48,(180,255,204),1,cv2.LINE_AA)

    context_idx=[i for k,i in enumerate(picks) if k!=primary_panel]
    while len(context_idx)<2:
        context_idx.append(picks[0])
    context_idx=context_idx[:2]
    contexts=[]
    for i in context_idx:
        r=rows[i]
        panel=cover_crop(r["frame"],330,190,r["box"] if r["person"]>=.18 else None)
        _stamp(panel,r["time"],10,169)
        contexts.append(panel)
    right=cv2.vconcat(contexts)
    cv2.line(right,(0,190),(329,190),(210,220,226),2)
    sheet=cv2.hconcat([primary,right])
    cv2.line(sheet,(570,0),(570,379),(220,230,235),2)
    ok=cv2.imwrite(str(out),sheet,[int(cv2.IMWRITE_JPEG_QUALITY),90])

    meta=[]
    for i in picks:
        r=rows[i]
        meta.append({"time":round(r["time"],2),"person":round(r["person"],4),
                     "motion":round(r["motion"],4),"detail":round(r["detail"],4),
                     "score":round(r["score"],4)})
    return bool(ok and out.is_file() and out.stat().st_size>8000),meta
'''
t=t[:compose_start]+compose+t[compose_end+1:]
old_priority='''    # Confirmed people first; newest first inside each evidence class.
    priority=sorted(rows,key=lambda e:str(e.get("timestamp") or ""),reverse=True)
    priority.sort(key=lambda e:0 if str(e.get("person_status"))=="confirmed_person" else 1 if str(e.get("person_status"))=="likely_person" else 2)'''
new_priority='''    # Backfill missing thumbnails before spending time upgrading older thumbnail
    # versions. Confirmed/likely people remain the highest-priority evidence class.
    def coverage_bucket(e):
        n=pathlib.Path(str(e["remote_name"])).name
        key=hashlib.sha1(n.encode()).hexdigest()[:20]+".jpg"
        dst=OUT/key; rec=items.get(n,{})
        if not dst.is_file() or dst.stat().st_size<=8000:return 0
        if rec.get("version")!=VERSION:return 1
        return 2
    def evidence_bucket(e):
        st=str(e.get("person_status") or "")
        return 0 if st=="confirmed_person" else 1 if st=="likely_person" else 2
    priority=sorted(rows,key=lambda e:str(e.get("timestamp") or ""),reverse=True)
    priority.sort(key=lambda e:(evidence_bucket(e),coverage_bucket(e)))'''
if old_priority not in t: raise SystemExit('thumbnail priority block not found')
t=t.replace(old_priority,new_priority)
t=t.replace('MobileNetSSD+motion-v107','MobileNetSSD+motion-v108')
TH108.write_text(t)
TH108.chmod(0o755)

# Point existing unit at V108 and make backfill continuous but low priority.
us=SU.read_text()
us=us.replace('person-aware saved clip thumbnail generator V107','person-aware saved clip thumbnail generator V108')
us=us.replace('c720p-saved-thumbnailer-v107.py','c720p-saved-thumbnailer-v108.py')
SU.write_text(us)
ts=TU.read_text()
ts=ts.replace('progressive person-aware saved thumbnail refresh V107','progressive person-aware saved thumbnail refresh V108')
ts=re.sub(r'OnUnitActiveSec=.*\n','',ts)
if 'OnUnitInactiveSec=' in ts:
    ts=re.sub(r'OnUnitInactiveSec=.*','OnUnitInactiveSec=90s',ts)
else:
    ts=ts.replace('OnBootSec=3min\n','OnBootSec=3min\nOnUnitInactiveSec=90s\n')
ts=re.sub(r'RandomizedDelaySec=.*','RandomizedDelaySec=20s',ts)
TU.write_text(ts)

# 5) Saved Clips UI: larger useful preview and fast storage reconciliation.
u=UI.read_text()
style='''<style id="C720P_SAVED_V108">
.list{grid-auto-rows:300px!important}
.clip{height:300px!important;min-height:300px!important;grid-template-rows:190px minmax(0,1fr)!important}
.thumbWrap{height:190px!important;min-height:190px!important}
.thumb{width:100%!important;height:100%!important;object-fit:cover!important;object-position:center center!important}
.clip[data-confirmed-person="1"]{border-color:rgba(74,222,128,.42)!important;box-shadow:inset 0 0 0 1px rgba(74,222,128,.10),0 5px 18px rgba(0,0,0,.22)!important}
</style>'''
if 'C720P_SAVED_V108' not in u:u=u.replace('</head>',style+'\n</head>',1)
u=u.replace('Confirmed Person · Protected','Confirmed Person · Protected from Auto-Delete')
# Existing 30-second reconciliation becomes 10-second reconciliation.
u=u.replace("},30000);</script>","},10000);addEventListener('focus',()=>{try{savedThumbManifest=null;load()}catch(_){}});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){try{savedThumbManifest=null;load()}catch(_){}}});</script>")
UI.write_text(u)

# Cache bust Security's nested Saved Clips view.
sv=SURV.read_text()
sv=re.sub(r'/local/c720p-drive-saved\.html\?camera=camera&v=[^"\']+',
          '/local/c720p-drive-saved.html?camera=camera&v=SAVED_V108_20261007',sv)
SURV.write_text(sv)

# Lovelace security iframe cache bump only.
d=json.loads(CFG.read_text())
aspect=None
def walk(x):
    global aspect
    if isinstance(x,dict):
        if x.get('type')=='iframe' and 'c720p-surveillance.html' in str(x.get('url','')):
            aspect=x.get('aspect_ratio')
            x['url']='/local/c720p-surveillance.html?v=SECURITY_RETENTION_V108_20261007'
        for v in x.values():walk(v)
    elif isinstance(x,list):
        for v in x:walk(v)
walk(d)
tmp=CFG.with_suffix('.tmp-sec-v108');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(CFG)

# Validate Python before service changes.
for p in (DR,LT,RV,TH108):
    rr=subprocess.run(['python3','-m','py_compile',str(p)],text=True,capture_output=True)
    if rr.returncode!=0: raise SystemExit(f'py_compile failed {p}: {rr.stderr}')

# Stop old thumbnail process to avoid manifest race, reload units, and start V108 non-blocking.
subprocess.run(['systemctl','--user','stop','c720p-saved-thumbnailer-v106.service'],text=True,capture_output=True,timeout=30)
subprocess.run(['systemctl','--user','daemon-reload'],check=True,timeout=20)
subprocess.run(['systemctl','--user','enable','--now','c720p-saved-thumbnailer-v106.timer'],check=True,timeout=20)
subprocess.run(['systemctl','--user','start','--no-block','c720p-saved-thumbnailer-v106.service'],text=True,capture_output=True,timeout=10)
subprocess.run(['systemctl','--user','enable','--now','c720p-drive-person-revalidate.timer'],text=True,capture_output=True,timeout=20)
subprocess.run(['systemctl','--user','start','--no-block','c720p-drive-person-revalidate.service'],text=True,capture_output=True,timeout=10)

# Restart HA/kiosk only for Lovelace cache bump.
rr=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if rr.returncode!=0: raise SystemExit(rr.stdout+rr.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}: break
    time.sleep(1)
else: raise SystemExit('HA did not return')
subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],text=True,capture_output=True,timeout=20)

print('REVALIDATOR_DELETE_BRANCHES_DISABLED='+str(disabled))
print('SECURITY_ASPECT_PRESERVED='+str(aspect))
print('THUMB_V108_EXISTS='+str(TH108.exists()))
print('BACKUP='+str(BACK))
print('SECURITY_V108=OK')
