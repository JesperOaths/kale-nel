from pathlib import Path
import json,re,shutil,datetime,subprocess

W=Path('/opt/homeassistant/config/www')
P=W/'c720p-google-photos-inner-security.html'
R=W/'c720p-photo-framing-v103.json'
OLD=Path('/home/jespern/c720p-backups/photo-auto-sync-20261007_062835/c720p-google-photos-inner-security.html.before')
B=Path('/home/jespern/c720p-backups')/('photo-new-zoom-v105-'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'))
B.mkdir(parents=True,exist_ok=True)
shutil.copy2(P,B/(P.name+'.before'))

s=P.read_text()
cur=json.loads(R.read_text())
om=re.search(r'const SMART_FRAMING_V103=(\\{.*?\\});',OLD.read_text(),re.S)
old=json.loads(om.group(1))
new=sorted(set(cur)-set(old))
if len(new)!=15: raise SystemExit(f'expected 15 new, got {len(new)}')

def choose(v):
    sy=float(v.get('spreadY',.28))
    aspect=float(v.get('sourceWidth',1))/max(1,float(v.get('sourceHeight',1)))
    if sy < .24: z=1.07
    elif sy < .255: z=1.06
    elif sy < .27: z=1.05
    elif sy < .285: z=1.04
    else: z=1.03
    if aspect < .55: z=min(z,1.06)
    elif aspect < .72: z=min(z,1.07)
    return round(z,2)

for n in new:
    v=cur[n]
    z=choose(v)
    v['fit']='contain'
    v['zoom']=z
    v['zoomPct']=round(z*100)
    v['zoomReason']='saliency_spread_v105'
    v['reason']='deep_saliency_spread'
    cur[n]=v

zs=sorted({cur[n]['zoomPct'] for n in new})
if len(zs)<3: raise SystemExit('insufficient zoom variation '+repr(zs))

sm=re.search(r'const SMART_FRAMING_V103=(\\{.*?\\});',s,re.S)
if not sm: raise SystemExit('live V103 map missing')
s=s[:sm.start()]+'const SMART_FRAMING_V105='+json.dumps(cur,separators=(',',':'))+';'+s[sm.end():]
for a,b in [('SMART_FRAMING_V103[','SMART_FRAMING_V105['),('data-framing-v103','data-framing-v105'),('framingV103','framingV105'),('--photo-zoom-v103','--photo-zoom-v105'),('C720P_PHOTO_PIXEL_FOCUS_V103','C720P_PHOTO_PIXEL_FOCUS_V105'),('.photo[data-framing-v103="1"]','.photo[data-framing-v105="1"]'),('var(--photo-zoom-v103,1)','var(--photo-zoom-v105,1)')]:
    s=s.replace(a,b)
P.write_text(s)
(W/'c720p-photo-framing-v105.json').write_text(json.dumps(cur,indent=2,sort_keys=True))

# Make future auto-sync use the same spread-based zoom buckets.
sync=Path('/home/jespern/c720p-home-hub/bin/google-photos-shared-album-sync.py')
shutil.copy2(sync,B/(sync.name+'.before'))
ss=sync.read_text()
ss=ss.replace("else if(aspect<.80){fit='contain';zoom=spreadY<.15?1.08:1.04;reason='portrait_preserve'}",
"""else if(aspect<.80){fit='contain';zoom=spreadY<.24?1.07:spreadY<.255?1.06:spreadY<.27?1.05:spreadY<.285?1.04:1.03;reason='portrait_saliency_spread'}""")
ss=ss.replace("else{fit='contain';zoom=spreadY<.16?1.07:1.04;reason='scene_preserve'}",
"""else{fit='contain';zoom=spreadY<.24?1.08:spreadY<.255?1.07:spreadY<.27?1.06:spreadY<.285?1.04:1.03;reason='scene_saliency_spread'}""")
sync.write_text(ss)

home=W/'c720p-release/home-live-primary-v2.html'
shutil.copy2(home,B/(home.name+'.before'))
try: home.chmod(0o644)
except: pass
hs=home.read_text()
hs=re.sub(r'/local/c720p-google-photos-inner-security\\.html\\?v=[^"]+','/local/c720p-google-photos-inner-security.html?v=PHOTO_V105_'+datetime.datetime.now().strftime('%H%M%S'),hs)
home.write_text(hs)
try: home.chmod(0o444)
except: pass

subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],check=False,timeout=20)
print('NEW_COUNT',len(new))
print('NEW_ZOOMS',zs)
for n in new: print(n,cur[n]['zoomPct'],cur[n]['x'],cur[n]['y'],cur[n]['spreadY'])
print('TOTAL',len(cur))
print('BACKUP',B)
print('V105_OK')
