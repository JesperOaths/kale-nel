#!/usr/bin/env python3
"""Live feed V3 post-deployment readback; no camera or file mutations."""
import hashlib,json,re,urllib.request,time,shutil,subprocess
from pathlib import Path
WWW=Path('/opt/homeassistant/config/www')
assets={"page":"c720p-surveillance.html","player":"security-video-playback.js"}
result={'assets':{},'camera':{}}
for kind,name in assets.items():
 src=(WWW/name).read_bytes()
 with urllib.request.urlopen('http://127.0.0.1:8123/local/'+name,timeout=9) as response:
  served=response.read(500000)
  result['assets'][kind]={"http":response.status,"bytes":len(served),
   "same_as_disk":src==served,"sha256":hashlib.sha256(src).hexdigest()}
 assert src==served
html=(WWW/assets['page']).read_text()
js=(WWW/assets['player']).read_text()
q='security-video-playback.js?v=C720P_SECURITY_NATIVE_MJPEG_STABLE_V3_20261011'
assert html.count(q)==1 and 's9v7-root-script' in html
a=js.index('async function liveSession(state){');b=js.index('function startLive(img,options={}){',a)
live=js[a:b]
result['player']={
 'signed_mjpeg':"client.url('/new/live.mjpg')" in live,
 'bypasses_mp4_hook':'imageSrc.set.call(img,signed)' in live,
 'retry_backoff_guard':'state.running||state.retryTimer||' in live,
 'no_live_mp4':'/new/live.mp4' not in live,
 'saved_player_preserved':'async function setSource(video,path,options={})' in js,
 'watchdog_ms':16000}
assert all(result['player'][k] for k in ['signed_mjpeg','bypasses_mp4_hook','retry_backoff_guard','no_live_mp4','saved_player_preserved'])
with urllib.request.urlopen('http://127.0.0.1:18808/status',timeout=8) as r:
 st=json.load(r)
result['camera']={'mode':st.get('mode'),'frames':st.get('frames'),'native_4k_enabled':st.get('native_4k_enabled'),'snapshot_ready':st.get('snapshot_ready')}
hashes=[]
for i in range(2):
 with urllib.request.urlopen('http://127.0.0.1:18808/shot.jpg',timeout=8) as r:
  raw=r.read(300000);assert r.status==200 and r.headers.get('Content-Type','').startswith('image/jpeg')
  hashes.append(hashlib.sha256(raw).hexdigest()[:12])
 if i==0:time.sleep(2.2)
result['camera']['preview_changed']=hashes[0]!=hashes[1]
with urllib.request.urlopen('http://127.0.0.1:8795/new/api/saved',timeout=9) as r:
 j=json.load(r)
result['archive']={'mode':j.get('archive_mode'),'clips':len(j.get('events',[]))}
assert result['archive']['mode']=='S9-microSD-only'
print('S9_LIVE_V3_POSTINSTALL',json.dumps(result,sort_keys=True),flush=True)
