from pathlib import Path
import json, subprocess, re

W=Path('/opt/homeassistant/config/www')
r=json.loads((W/'c720p-photo-framing-v101.json').read_text())
bad=[]
for k,v in r.items():
    if v.get('edgeTouches',0)>0 and v.get('zoomPct',100)>104:
        bad.append((k,'edge_zoom',v['zoomPct']))
    if v.get('faces',0)>=4 and v.get('zoomPct',100)>105:
        bad.append((k,'group_zoom',v['zoomPct']))
    if v.get('fit')=='cover' and v.get('subjectCoverage',1)<.94:
        bad.append((k,'cover_subject_loss',v['subjectCoverage']))
    if not (5<=v.get('x',50)<=95 and 5<=v.get('y',50)<=95):
        bad.append((k,'focus_bounds',v.get('x'),v.get('y')))

print('COUNT='+str(len(r)))
print('BAD='+json.dumps(bad))
print('UNIQUE_FOCUS='+str(len({(v["x"],v["y"]) for v in r.values()})))
print('ZOOMS='+json.dumps(sorted(set(v['zoomPct'] for v in r.values()))))

src=subprocess.run(
    ['curl','-fsS','--max-time','15','http://127.0.0.1:8123/local/c720p-google-photos-inner-security.html?v=PHOTO_PIXEL_FOCUS_V101_20261007'],
    text=True,capture_output=True,timeout=20
)
if src.returncode!=0: raise SystemExit(src.stderr)
print('MAP_PASS='+str('SMART_FRAMING_V101' in src.stdout))
print('STYLE_PASS='+str('C720P_PHOTO_PIXEL_FOCUS_V101' in src.stdout))

dom=subprocess.run(
    ['chromium','--headless','--disable-gpu','--no-sandbox','--virtual-time-budget=9000','--dump-dom',
     'http://127.0.0.1:8123/local/c720p-google-photos-inner-security.html?v=PHOTO_PIXEL_FOCUS_V101_20261007'],
    text=True,capture_output=True,timeout=40
)
Path('/tmp/photo101-dom.html').write_text(dom.stdout,encoding='utf-8')
print('BROWSER_RC='+str(dom.returncode))
imgs=re.findall(r'<img[^>]*class="[^"]*\bphoto\b[^"]*"[^>]*>',dom.stdout,re.I)
print('PHOTO_NODES='+str(len(imgs)))
for i,t in enumerate(imgs[:4]):
    def attr(n):
        m=re.search(rf'{re.escape(n)}="([^"]*)"',t)
        return m.group(1) if m else ''
    print('IMG%d='%i+json.dumps({
        'src':attr('src'),
        'fit':attr('data-smart-fit'),
        'zoom':attr('data-zoom-pct'),
        'focus_x':attr('data-focus-x'),
        'focus_y':attr('data-focus-y'),
        'v101':attr('data-framing-v101')
    }))
