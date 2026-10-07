from pathlib import Path
import json,re,shutil,datetime,subprocess,time

W=Path('/opt/homeassistant/config/www')
PHOTO=W/'c720p-google-photos-inner-security.html'
R=W/'c720p-photo-framing-v101.json'
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
B=Path('/home/jespern/c720p-backups')/f'photo-focus-v102-{STAMP}'
B.mkdir(parents=True,exist_ok=True)
shutil.copy2(PHOTO,B/(PHOTO.name+'.before'))

data=json.loads(R.read_text())
changed=[]
for k,v in data.items():
    if v.get('edgeTouches',0)>0 and v.get('zoomPct',100)>104:
        old=v['zoomPct']
        v['zoom']=1.04
        v['zoomPct']=104
        v['zoomReason']=str(v.get('zoomReason',''))+'_edge_cap'
        changed.append((k,old,104))

report=W/'c720p-photo-framing-v102.json'
report.write_text(json.dumps(data,indent=2,sort_keys=True),encoding='utf-8')

s=PHOTO.read_text(encoding='utf-8')
newmap=json.dumps(data,separators=(',',':'))
s,n=re.subn(r'const SMART_FRAMING_V101=\{.*?\};','const SMART_FRAMING_V102='+newmap+';',s,count=1,flags=re.S)
if n!=1: raise SystemExit('map replacement failed')
s=s.replace('SMART_FRAMING_V101[','SMART_FRAMING_V102[')
s=s.replace('data-framing-v101','data-framing-v102')
s=s.replace('framingV101','framingV102')
s=s.replace('--photo-zoom-v101','--photo-zoom-v102')
s=s.replace('C720P_PHOTO_PIXEL_FOCUS_V101','C720P_PHOTO_PIXEL_FOCUS_V102')
s=s.replace('.photo[data-framing-v101="1"]','.photo[data-framing-v102="1"]')
s=s.replace('var(--photo-zoom-v101,1)','var(--photo-zoom-v102,1)')
PHOTO.write_text(s,encoding='utf-8')

home=W/'c720p-release/home-live-primary-v2.html'
shutil.copy2(home,B/(home.name+'.before'))
try:home.chmod(0o644)
except Exception:pass
hs=home.read_text(encoding='utf-8')
hs=re.sub(r'/local/c720p-google-photos-inner-security\.html\?v=[^"]+','/local/c720p-google-photos-inner-security.html?v=PHOTO_PIXEL_FOCUS_V102_20261007',hs)
home.write_text(hs,encoding='utf-8')
try:home.chmod(0o444)
except Exception:pass

extra=W/'c720p-extra-row-v85.html'
shutil.copy2(extra,B/(extra.name+'.before'))
es=extra.read_text(encoding='utf-8')
es=re.sub(r'/local/c720p-release/home-live-primary-v2\.html\?[^"\']*','/local/c720p-release/home-live-primary-v2.html?v=PHOTO_PIXEL_FOCUS_V102_20261007',es)
extra.write_text(es,encoding='utf-8')

cfg=Path('/opt/homeassistant/config/.storage/lovelace.c720p_hub')
shutil.copy2(cfg,B/'lovelace.c720p_hub.before')
d=json.loads(cfg.read_text()); aspect=None
def walk(x):
    global aspect
    if isinstance(x,dict):
        if x.get('type')=='iframe' and 'c720p-extra-row-v85.html' in str(x.get('url','')):
            aspect=x.get('aspect_ratio')
            x['url']='/local/c720p-extra-row-v85.html?v=PHOTO_PIXEL_FOCUS_V102_20261007'
        for vv in x.values(): walk(vv)
    elif isinstance(x,list):
        for vv in x: walk(vv)
walk(d)
tmp=cfg.with_suffix('.tmp-photo102');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(cfg)

rr=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if rr.returncode!=0: raise SystemExit(rr.stdout+rr.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}: break
    time.sleep(1)
else: raise SystemExit('HA did not return')
subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],text=True,capture_output=True,timeout=20)

bad=[]
for k,v in data.items():
    if v.get('edgeTouches',0)>0 and v.get('zoomPct',100)>104: bad.append(k)
    if v.get('faces',0)>=4 and v.get('zoomPct',100)>105: bad.append(k)
    if v.get('fit')=='cover' and v.get('subjectCoverage',1)<.94: bad.append(k)
print('CHANGED='+json.dumps(changed))
print('BAD='+json.dumps(sorted(set(bad))))
print('ZOOMS='+json.dumps(sorted(set(v["zoomPct"] for v in data.values()))))
print('FOCUS_POINTS='+str(len({(v["x"],v["y"]) for v in data.values()})))
print('ASPECT_PRESERVED='+str(aspect))
print('REPORT='+str(report))
print('PHOTO_V102=OK')
