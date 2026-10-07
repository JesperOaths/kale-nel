from pathlib import Path
import re,json,shutil,datetime,math
W=Path('/opt/homeassistant/config/www'); p=W/'c720p-google-photos-inner-security.html'
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S'); B=Path('/home/jespern/c720p-backups')/f'photo-v94-{stamp}'; B.mkdir(parents=True,exist_ok=True); shutil.copy2(p,B/(p.name+'.before'))
s=p.read_text(encoding='utf-8')
m=re.search(r'const FRAMING=(\{.*?\});',s,re.S)
if not m: raise SystemExit('FRAMING map not found')
fr=json.loads(m.group(1))
smart={}
def clamp(v,a,b): return max(a,min(b,v))
for name,f in fr.items():
    x=float(f.get('x',50)); y=float(f.get('y',50)); faces=int(f.get('faces') or 0); conf=float(f.get('confidence') or 0)
    w=float(f.get('width') or 1); h=float(f.get('height') or 1); ratio=w/max(1,h); bbox=f.get('bbox'); prior=f.get('fit','cover')
    fit='cover'; zoom=1.0; reason='saliency'
    if bbox:
        x1,y1,x2,y2=[float(v) for v in bbox]; bw=max(.01,x2-x1); bh=max(.01,y2-y1); area=bw*bh; span=max(bw,bh)
        touches=sum([x1<.025,y1<.025,x2>.975,y2>.975])
        # Broad groups / subjects that already span most of the picture should stay fully visible.
        broad=(faces>=4 or bw>.78 or bh>.84 or area>.52)
        tall_group=(ratio<.72 and faces>=2 and bh>.55)
        if prior=='contain' or broad or tall_group:
            fit='contain'; zoom=1.0; reason='group_or_wide_subject'
        else:
            fit='cover'
            if faces<=1:
                target=.52
                z=target/max(span,.22)
                zoom=clamp(z,1.06,1.30)
                reason='single_subject'
            elif faces==2:
                target=.64
                z=target/max(span,.34)
                zoom=clamp(z,1.04,1.20)
                reason='two_subjects'
            else:
                target=.72
                z=target/max(span,.48)
                zoom=clamp(z,1.02,1.12)
                reason='small_group'
            if touches>=2: zoom=min(zoom,1.06)
            elif touches==1: zoom=min(zoom,1.12)
            # Very off-edge subjects need breathing room rather than an aggressive zoom.
            if x<12 or x>88 or y<10 or y>90: zoom=min(zoom,1.08)
    else:
        # No face box: use the image-processing saliency point with conservative zoom.
        fit='cover'
        zoom=1.06 if ratio>=.78 else 1.02
        reason='saliency'
    # Avoid empty edge framing while retaining the measured focal point.
    fx=round(clamp(x,7,93),1); fy=round(clamp(y,7,93),1)
    smart[name]={'x':fx,'y':fy,'zoomPct':int(round(zoom*100)),'zoom':round(zoom,3),'fit':fit,'faces':faces,'confidence':round(conf,3),'method':f.get('method'),'reason':reason}
if len(smart)!=60: print('WARNING_FRAMING_COUNT='+str(len(smart)))
report=W/'c720p-photo-framing-v94.json'; report.write_text(json.dumps(smart,indent=2,sort_keys=True),encoding='utf-8')
js=json.dumps(smart,separators=(',',':'))
insert=f'''const SMART_FRAMING_V94={js};
  function c720pApplyAnalyzedFrame(img,url,legacy){{
    const key=String(url||"").split("/").pop().split("?")[0],f=SMART_FRAMING_V94[key]||{{x:50,y:50,zoom:1,zoomPct:100,fit:"contain"}};
    img.dataset.framingV94="1";
    img.dataset.smartFit=f.fit;
    img.dataset.zoomPct=String(f.zoomPct);
    img.style.objectFit=f.fit;
    img.style.objectPosition=f.x+"% "+f.y+"%";
    img.style.transformOrigin=f.x+"% "+f.y+"%";
    img.style.setProperty("--photo-zoom-v94",String(f.zoom));
  }}
'''
# Insert immediately after FRAMING so the map is local to the existing slideshow IIFE.
pos=m.end()
if 'const SMART_FRAMING_V94=' not in s:s=s[:pos]+'\n  '+insert+s[pos:]
s=s.replace('c720pScheduleSmartFrame(hidden,frame);','c720pApplyAnalyzedFrame(hidden,url,frame);')
css='''<style id="C720P_PHOTO_ANALYZED_V94">
.photo[data-framing-v94="1"]{
 object-position:inherit;
 transform:scale(var(--photo-zoom-v94,1))!important;
 transition:opacity .7s ease,transform .45s ease!important;
}
.photo[data-framing-v94="1"][data-smart-fit="contain"]{object-fit:contain!important}
.photo[data-framing-v94="1"][data-smart-fit="cover"]{object-fit:cover!important}
</style>'''
if 'C720P_PHOTO_ANALYZED_V94' not in s:s=s.replace('</head>',css+'\n</head>',1)
p.write_text(s,encoding='utf-8')
# Summary for verification.
zs=[v['zoomPct'] for v in smart.values()]
print('FRAMING_COUNT='+str(len(smart)))
print('ZOOM_MIN='+str(min(zs)))
print('ZOOM_MAX='+str(max(zs)))
print('ZOOM_DIST='+json.dumps({str(z):zs.count(z) for z in sorted(set(zs))}))
print('CONTAIN_COUNT='+str(sum(v['fit']=='contain' for v in smart.values())))
print('COVER_COUNT='+str(sum(v['fit']=='cover' for v in smart.values())))
print('REPORT='+str(report))
print('BACKUP='+str(B))
