from pathlib import Path
import json,re,shutil,datetime,subprocess,time,math

W=Path('/opt/homeassistant/config/www')
PHOTO=W/'c720p-google-photos-inner-security.html'
REPORT=W/'c720p-photo-framing-v100.json'
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=Path('/home/jespern/c720p-backups')/f'photo-focus-v101-{STAMP}'
BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(PHOTO,BACK/(PHOTO.name+'.before'))

r=json.loads(REPORT.read_text())
s=PHOTO.read_text(encoding='utf-8')
try:
    raw=s.split('const FRAMING=',1)[1].split(';\n',1)[0]
    meta=json.loads(raw)
except Exception as e:
    raise SystemExit('could not parse FRAMING: '+repr(e))

def clamp(v,a,b): return max(a,min(b,v))
out={}
for name,v in r.items():
    m=meta.get(name,{})
    faces=int(v.get('faces') or 0)
    bg=float(v.get('backgroundInterest',1))
    spreadY=float(v.get('spreadY',.2))
    salcov=float(v.get('saliencyCoverage',0))
    fit=v.get('fit','contain')
    reason=v.get('reason','')
    src_aspect=float(v.get('sourceWidth',1))/max(1,float(v.get('sourceHeight',1)))
    bbox=m.get('bbox')
    area=0.0; span=0.0; touches=0
    if bbox:
        bw=max(0,bbox[2]-bbox[0]); bh=max(0,bbox[3]-bbox[1])
        area=bw*bh; span=max(bw,bh)
        touches=sum([bbox[0]<.03,bbox[1]<.03,bbox[2]>.97,bbox[3]>.97])

    # Start with the actual V100 pixel-derived focal point.
    zoom=1.0
    zreason='scene_preserve'

    if fit=='contain':
        # Contain remains the safety mode, but it can now zoom *inside* the contained image.
        if reason=='edge_subject_protection':
            zoom=1.02 if faces>=2 else 1.04
            zreason='edge_safe_partial'
        elif faces>=4:
            # Groups get only a little enlargement.
            zoom=1.03 if area<.55 and touches==0 else 1.01
            zreason='group_gentle'
        elif faces==3:
            if area<.28 and bg<.48 and touches==0: zoom=1.08
            elif area<.45 and touches==0: zoom=1.05
            else: zoom=1.02
            zreason='small_group_partial'
        elif faces==2:
            if area<.16 and bg<.50 and touches==0: zoom=1.12
            elif area<.30 and bg<.58 and touches==0: zoom=1.08
            else: zoom=1.04
            zreason='pair_partial'
        elif faces==1:
            if area<.055 and bg<.48 and touches==0: zoom=1.20
            elif area<.12 and bg<.58 and touches==0: zoom=1.15
            elif area<.25 and touches==0: zoom=1.10
            else: zoom=1.05
            zreason='single_subject_partial'
        else:
            # No detected people: use saliency concentration.
            if salcov>.82 and spreadY<.14: zoom=1.13
            elif salcov>.72 and spreadY<.17: zoom=1.09
            elif salcov>.62 and spreadY<.20: zoom=1.06
            else: zoom=1.03
            zreason='saliency_partial'
        # Tall portraits already fill the frame vertically; be more conservative.
        if src_aspect<.72: zoom=min(zoom,1.10 if faces<=1 else 1.06)
        if touches: zoom=min(zoom,1.04 if faces>=2 else 1.06)

    else:  # cover
        # Cover already crops to the panoramic window. Add zoom only when pixels say background is expendable.
        if faces==1:
            if area<.06 and bg<.45 and touches==0: zoom=1.16
            elif area<.14 and bg<.56 and touches==0: zoom=1.11
            else: zoom=1.06
            zreason='single_subject_close'
        elif faces==2:
            zoom=1.10 if area<.18 and bg<.48 and touches==0 else 1.05
            zreason='pair_close'
        elif faces>=3:
            zoom=1.05 if area<.30 and touches==0 else 1.02
            zreason='group_cover'
        else:
            if salcov>.80 and spreadY<.15: zoom=1.12
            elif salcov>.68 and spreadY<.19: zoom=1.08
            else: zoom=1.04
            zreason='saliency_close'
        if touches: zoom=min(zoom,1.04)

    # Keep transforms within a sane range for a wall/dashboard slideshow.
    zoom=round(clamp(zoom,1.0,1.20),3)
    nv=dict(v)
    nv['zoom']=zoom
    nv['zoomPct']=int(round(zoom*100))
    nv['zoomReason']=zreason
    nv['subjectArea']=round(area,4)
    nv['subjectSpan']=round(span,4)
    nv['edgeTouches']=touches
    out[name]=nv

# We expect actual variation now.
zvals={v['zoomPct'] for v in out.values()}
if len(zvals)<4:
    raise SystemExit('zoom policy still insufficiently varied: '+repr(zvals))

report=W/'c720p-photo-framing-v101.json'
report.write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8')

# Replace V100 map with V101 map, and update names/attributes.
newmap=json.dumps(out,separators=(',',':'))
s2,n=re.subn(r'const SMART_FRAMING_V100=\{.*?\};',
             'const SMART_FRAMING_V101='+newmap+';',s,count=1,flags=re.S)
if n!=1: raise SystemExit('V100 map replacement failed')
s2=s2.replace('SMART_FRAMING_V100[','SMART_FRAMING_V101[')
s2=s2.replace('data-framing-v100','data-framing-v101')
s2=s2.replace('framingV100','framingV101')
s2=s2.replace('--photo-zoom-v100','--photo-zoom-v101')
s2=s2.replace('C720P_PHOTO_PIXEL_FOCUS_V100','C720P_PHOTO_PIXEL_FOCUS_V101')
s2=s2.replace('--photo-zoom-v100,1','--photo-zoom-v101,1')
# Ensure CSS uses the new attribute/variable even if string substitutions had ordering differences.
s2=s2.replace('.photo[data-framing-v100="1"]','.photo[data-framing-v101="1"]')
s2=s2.replace('var(--photo-zoom-v100,1)','var(--photo-zoom-v101,1)')
PHOTO.write_text(s2,encoding='utf-8')

# Cache-bust full chain.
home=W/'c720p-release/home-live-primary-v2.html'
shutil.copy2(home,BACK/(home.name+'.before'))
try:home.chmod(0o644)
except Exception:pass
hs=home.read_text(encoding='utf-8')
hs=re.sub(r'/local/c720p-google-photos-inner-security\.html\?v=[^"]+',
          '/local/c720p-google-photos-inner-security.html?v=PHOTO_PIXEL_FOCUS_V101_20261007',hs)
home.write_text(hs,encoding='utf-8')
try:home.chmod(0o444)
except Exception:pass

extra=W/'c720p-extra-row-v85.html'
shutil.copy2(extra,BACK/(extra.name+'.before'))
es=extra.read_text(encoding='utf-8')
es=re.sub(r'/local/c720p-release/home-live-primary-v2\.html\?[^"\']*',
          '/local/c720p-release/home-live-primary-v2.html?v=PHOTO_PIXEL_FOCUS_V101_20261007',es)
extra.write_text(es,encoding='utf-8')

cfg=Path('/opt/homeassistant/config/.storage/lovelace.c720p_hub')
shutil.copy2(cfg,BACK/'lovelace.c720p_hub.before')
d=json.loads(cfg.read_text()); aspect=None
def walk(x):
    global aspect
    if isinstance(x,dict):
        if x.get('type')=='iframe' and 'c720p-extra-row-v85.html' in str(x.get('url','')):
            aspect=x.get('aspect_ratio')
            x['url']='/local/c720p-extra-row-v85.html?v=PHOTO_PIXEL_FOCUS_V101_20261007'
        for vv in x.values(): walk(vv)
    elif isinstance(x,list):
        for vv in x: walk(vv)
walk(d)
tmp=cfg.with_suffix('.tmp-photo101');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(cfg)

rr=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if rr.returncode!=0: raise SystemExit(rr.stdout+rr.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}: break
    time.sleep(1)
else: raise SystemExit('HA did not return')
subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],text=True,capture_output=True,timeout=20)

fits={}; zooms={}; zreasons={}
for v in out.values():
    fits[v['fit']]=fits.get(v['fit'],0)+1
    zooms[str(v['zoomPct'])]=zooms.get(str(v['zoomPct']),0)+1
    zreasons[v['zoomReason']]=zreasons.get(v['zoomReason'],0)+1
print('PHOTO_COUNT='+str(len(out)))
print('FOCUS_POINTS='+str(len({(v["x"],v["y"]) for v in out.values()})))
print('FITS='+json.dumps(fits,sort_keys=True))
print('ZOOMS='+json.dumps(zooms,sort_keys=True))
print('ZOOM_MIN='+str(min(v['zoomPct'] for v in out.values())))
print('ZOOM_MAX='+str(max(v['zoomPct'] for v in out.values())))
print('ZOOM_REASONS='+json.dumps(zreasons,sort_keys=True))
print('EXTRA_ASPECT_PRESERVED='+str(aspect))
print('REPORT='+str(report))
print('BACKUP='+str(BACK))
print('PHOTO_V101=OK')
