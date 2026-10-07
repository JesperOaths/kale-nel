from pathlib import Path
import re,json,shutil,subprocess,time,datetime

W=Path('/opt/homeassistant/config/www')

# Bump nested TV cache.
p=W/'c720p-weather-row.html'
s=p.read_text(encoding='utf-8')
s=re.sub(r'/local/c720p-tv-surround-v21\.html\?v=[^"]+','/local/c720p-tv-surround-v21.html?v=TV_SURROUND_V93_20261007',s)
p.write_text(s,encoding='utf-8')

# Bump nested smart-photo cache.
p=W/'c720p-release/home-live-primary-v2.html'
try:p.chmod(0o644)
except Exception:pass
s=p.read_text(encoding='utf-8')
s=re.sub(r'/local/c720p-google-photos-inner-security\.html\?v=[^"]+','/local/c720p-google-photos-inner-security.html?v=PHOTO_SMART_V93_20261007',s)
p.write_text(s,encoding='utf-8')
try:p.chmod(0o444)
except Exception:pass

# Cache-bust active Lovelace URLs while preserving sizes.
py=r'''import json,pathlib,shutil,time
p=pathlib.Path("/config/.storage/lovelace.c720p_hub")
b=pathlib.Path("/config/.storage/lovelace.c720p_hub.before-v93-"+time.strftime("%Y%m%d_%H%M%S"))
shutil.copy2(p,b)
d=json.loads(p.read_text())
views=d["data"]["config"]["views"]
home=next(x for x in views if x.get("path")=="home")
sec=next(x for x in views if x.get("path")=="front-yard-security")
root=home["cards"][0];cols=root["cards"][0]["cards"]
voice=cols[1]["cards"][2];spotify=cols[0]["cards"][1]
va=voice.get("aspect_ratio");sa=spotify.get("aspect_ratio")
voice["url"]="/local/c720p-voice-banner.html?c720p_build=VOICE_SPACE_V93_20261007"
spotify["url"]="/local/c720p-spotify-compact-v1.html?v=SPOTIFY_CONTROLS_V93_20261007"
root["cards"][2]["url"]="/local/c720p-extra-row-v85.html?v=PHOTO_SMART_V93_20261007"
sec["cards"][0]["url"]="/local/c720p-surveillance.html?v=SAVED_GALLERY_V93_20261007"
tmp=p.with_suffix(".tmp-v93");tmp.write_text(json.dumps(d,separators=(",",":")));tmp.replace(p)
print("VOICE_ASPECT_PRESERVED="+str(va))
print("SPOTIFY_ASPECT_PRESERVED="+str(sa))
print("BACKUP="+str(b))'''
r=subprocess.run(['docker','exec','homeassistant','python3','-c',py],text=True,capture_output=True,timeout=30)
if r.returncode!=0:raise SystemExit(r.stdout+r.stderr)
print(r.stdout.strip())

rr=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if rr.returncode!=0:raise SystemExit(rr.stdout+rr.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}:break
    time.sleep(1)
else:raise SystemExit('Home Assistant did not return')
print('V93_CACHE_RELOAD=OK')
