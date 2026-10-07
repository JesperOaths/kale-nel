from pathlib import Path
import re,json,shutil,datetime,subprocess,time
W=Path('/opt/homeassistant/config/www')
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
b=Path('/home/jespern/c720p-backups')/f'v93-cache-{stamp}'
b.mkdir(parents=True,exist_ok=True)

def save(p):
    if p.exists():shutil.copy2(p,b/(p.name+'.before'))

p=W/'c720p-weather-row.html';save(p)
s=p.read_text(encoding='utf-8')
s=re.sub(r'/local/c720p-tv-surround-v21\.html\?v=[^"]+','/local/c720p-tv-surround-v21.html?v=TV_SURROUND_V93_20261007',s)
p.write_text(s,encoding='utf-8')

p=W/'c720p-release/home-live-primary-v2.html';save(p)
try:p.chmod(0o644)
except Exception:pass
s=p.read_text(encoding='utf-8')
s=re.sub(r'/local/c720p-google-photos-inner-security\.html\?v=[^"]+','/local/c720p-google-photos-inner-security.html?v=PHOTO_SMART_V93_20261007',s)
p.write_text(s,encoding='utf-8')
try:p.chmod(0o444)
except Exception:pass

p=W/'c720p-extra-row-v85.html';save(p)
s=p.read_text(encoding='utf-8')
s=re.sub(r'/local/c720p-release/home-live-primary-v2\.html\?[^"\']*','/local/c720p-release/home-live-primary-v2.html?v=PHOTO_SMART_V93_20261007',s)
p.write_text(s,encoding='utf-8')

py=r'''import json,pathlib,shutil,time
p=pathlib.Path("/config/.storage/lovelace.c720p_hub")
b=pathlib.Path("/config/.storage/lovelace.c720p_hub.before-v93-cache-"+time.strftime("%Y%m%d_%H%M%S"))
shutil.copy2(p,b)
d=json.loads(p.read_text());seen={}
def walk(x):
    if isinstance(x,dict):
        if x.get("type")=="iframe":
            u=str(x.get("url",""));a=x.get("aspect_ratio")
            if "c720p-voice-banner.html" in u: seen["voice"]=a;x["url"]="/local/c720p-voice-banner.html?c720p_build=VOICE_SPACE_V93_20261007"
            elif "c720p-spotify-compact-v1.html" in u: seen["spotify"]=a;x["url"]="/local/c720p-spotify-compact-v1.html?v=SPOTIFY_CONTROLS_V93_20261007"
            elif "c720p-extra-row-v85.html" in u: seen["extra"]=a;x["url"]="/local/c720p-extra-row-v85.html?v=PHOTO_SMART_V93_20261007"
            elif "c720p-surveillance.html" in u: seen["security"]=a;x["url"]="/local/c720p-surveillance.html?v=SAVED_GALLERY_V93_20261007"
        for v in x.values():walk(v)
    elif isinstance(x,list):
        for v in x:walk(v)
walk(d)
tmp=p.with_suffix(".tmp-v93");tmp.write_text(json.dumps(d,separators=(",",":")));tmp.replace(p)
print("PRESERVED_ASPECTS="+json.dumps(seen,sort_keys=True))
print("LOVELACE_BACKUP="+str(b))'''
r=subprocess.run(['docker','exec','homeassistant','python3','-c',py],text=True,capture_output=True,timeout=30)
if r.returncode!=0:raise SystemExit(r.stdout+r.stderr)
print(r.stdout.strip())
r=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if r.returncode!=0:raise SystemExit(r.stdout+r.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}:break
    time.sleep(1)
else:raise SystemExit('HA did not return')
subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],text=True,capture_output=True,timeout=20)
print('CACHE_V93=OK')
print('BACKUP='+str(b))
