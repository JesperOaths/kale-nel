from pathlib import Path

worker = Path('cloudflare/workers/admin-gate/src/worker.js')
html = Path('security/index.html')

w = worker.read_text()
w = w.replace("const ADMIN_BUILD = 'v777-security-dedicated-unlock';", "const ADMIN_BUILD = 'v778-security-live-autostart-ui';")
if "v778-security-live-autostart-ui" not in w:
    raise SystemExit('worker build marker not patched')
worker.write_text(w)

s = html.read_text()

old_css = ".live-frame{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#000}"
new_css = ".live-shell{position:relative;aspect-ratio:16/9;background:#000;overflow:hidden}.live-frame{display:block;width:100%;height:100%;object-fit:contain;background:#000}.live-placeholder{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:20px;background:#000;color:#93a5b3;font-weight:800}.live-placeholder.hidden{display:none}"
if old_css not in s:
    raise SystemExit('live frame css marker missing')
s = s.replace(old_css, new_css, 1)

old_new = '<div class="live-head"><span class="cam-name">New camera</span><span id="newState" class="cam-state">waiting…</span></div><img id="newLive" class="live-frame" alt="New camera live stream" decoding="async">'
new_new = '<div class="live-head"><span class="cam-name">New camera</span><span id="newState" class="cam-state">waiting…</span></div><div class="live-shell"><img id="newLive" class="live-frame" alt="New camera live stream" decoding="async"><div id="newLivePlaceholder" class="live-placeholder">Live stopped — click Start live</div></div>'
old_s3 = '<div class="live-head"><span class="cam-name">S3 camera</span><span id="s3State" class="cam-state">waiting…</span></div><img id="s3Live" class="live-frame" alt="S3 camera live stream" decoding="async">'
new_s3 = '<div class="live-head"><span class="cam-name">S3 camera</span><span id="s3State" class="cam-state">waiting…</span></div><div class="live-shell"><img id="s3Live" class="live-frame" alt="S3 camera live stream" decoding="async"><div id="s3LivePlaceholder" class="live-placeholder">Live stopped — click Start live</div></div>'
if old_new not in s or old_s3 not in s:
    raise SystemExit('camera live markup marker missing')
s = s.replace(old_new, new_new, 1).replace(old_s3, new_s3, 1)

old_state = "const state={unlocked:false,events:[],retries:{new:null,s3:null},liveTimers:{new:null,s3:null},liveRequested:{new:false,s3:false},sourceOnline:{new:false,s3:false},statusTimer:null,controlsAt:{new:0,s3:0}}"
new_state = "const state={unlocked:false,events:[],retries:{new:null,s3:null},liveTimers:{new:null,s3:null},liveRequested:{new:false,s3:false},autoStarted:{new:false,s3:false},sourceOnline:{new:false,s3:false},statusTimer:null,controlsAt:{new:0,s3:0}}"
if old_state not in s:
    raise SystemExit('state marker missing')
s = s.replace(old_state, new_state, 1)

old_stop = "function stopLive(camera){state.liveRequested[camera]=false;clearTimeout(state.liveTimers[camera]);state.liveTimers[camera]=null;const img=$(camera+'Live');img.removeAttribute('src');if(state.sourceOnline[camera]&&state.unlocked){$(camera+'State').textContent='online';$(camera+'State').className='cam-state ok'}}function stopAll(){stopLive('new');stopLive('s3')}"
new_stop = "function liveMessage(camera,text,hide=false){const p=$(camera+'LivePlaceholder');if(!p)return;p.textContent=text;p.classList.toggle('hidden',!!hide)}function stopLive(camera){state.liveRequested[camera]=false;clearTimeout(state.liveTimers[camera]);state.liveTimers[camera]=null;const img=$(camera+'Live');img.removeAttribute('src');liveMessage(camera,'Live stopped — click Start live');if(state.sourceOnline[camera]&&state.unlocked){$(camera+'State').textContent='online';$(camera+'State').className='cam-state ok'}}function stopAll(){stopLive('new');stopLive('s3')}"
if old_stop not in s:
    raise SystemExit('stopLive marker missing')
s = s.replace(old_stop, new_stop, 1)

old_login = "function showInnerLogin(m=''){state.unlocked=false;state.sourceOnline.new=false;state.sourceOnline.s3=false;stopAll();$('innerLogin').classList.remove('hidden');$('securityApp').classList.add('hidden');setConnection(false,'Locked');if(m)showError(m)}"
new_login = "function showInnerLogin(m=''){state.unlocked=false;state.sourceOnline.new=false;state.sourceOnline.s3=false;state.autoStarted.new=false;state.autoStarted.s3=false;stopAll();$('innerLogin').classList.remove('hidden');$('securityApp').classList.add('hidden');setConnection(false,'Locked');if(m)showError(m)}"
if old_login not in s:
    raise SystemExit('showInnerLogin marker missing')
s = s.replace(old_login, new_login, 1)

old_start = "function startLive(camera,force=false){if(!state.unlocked||mode!=='live'||state.sourceOnline[camera]!==true)return;const img=$(camera+'Live');if(!force&&img.getAttribute('src'))return;state.liveRequested[camera]=true;clearTimeout(state.liveTimers[camera]);state.liveTimers[camera]=setTimeout(()=>stopLive(camera),120000);img.src=`/security/${camera}/live.mjpg?t=${Date.now()}`;$(camera+'State').textContent='connecting…';$(camera+'State').className='cam-state'}"
new_start = "function startLive(camera,force=false){if(!state.unlocked||mode!=='live'||state.sourceOnline[camera]!==true)return;const img=$(camera+'Live');if(!force&&img.getAttribute('src'))return;state.liveRequested[camera]=true;liveMessage(camera,'Connecting…');clearTimeout(state.liveTimers[camera]);state.liveTimers[camera]=setTimeout(()=>stopLive(camera),120000);img.src=`/security/${camera}/live.mjpg?t=${Date.now()}`;$(camera+'State').textContent='connecting…';$(camera+'State').className='cam-state'}"
if old_start not in s:
    raise SystemExit('startLive marker missing')
s = s.replace(old_start, new_start, 1)

old_bind = "function bindLive(camera){const img=$(camera+'Live');img.addEventListener('load',()=>{$(camera+'State').textContent='live';$(camera+'State').className='cam-state ok'});img.addEventListener('error',()=>{if(!state.unlocked||mode!=='live'||state.sourceOnline[camera]!==true||!state.liveRequested[camera])return;$(camera+'State').textContent='reconnecting…';$(camera+'State').className='cam-state bad';clearTimeout(state.retries[camera]);state.retries[camera]=setTimeout(()=>startLive(camera,true),2500)})}"
new_bind = "function bindLive(camera){const img=$(camera+'Live');img.addEventListener('load',()=>{liveMessage(camera,'',true);$(camera+'State').textContent='live';$(camera+'State').className='cam-state ok'});img.addEventListener('error',()=>{if(!state.unlocked||mode!=='live'||state.sourceOnline[camera]!==true||!state.liveRequested[camera])return;liveMessage(camera,'Stream reconnecting…');$(camera+'State').textContent='reconnecting…';$(camera+'State').className='cam-state bad';clearTimeout(state.retries[camera]);state.retries[camera]=setTimeout(()=>startLive(camera,true),2500)})}"
if old_bind not in s:
    raise SystemExit('bindLive marker missing')
s = s.replace(old_bind, new_bind, 1)

old_apply = "function applySourceStatus(camera,data){const online=data?.source_online===true;state.sourceOnline[camera]=online;const el=$(camera+'State');if(online){if(!state.liveRequested[camera])el.textContent=data?.recording?'recording':'online';el.className='cam-state ok';loadControls(camera)}else{clearTimeout(state.retries[camera]);state.retries[camera]=null;stopLive(camera);el.textContent='offline';el.className='cam-state bad'}return online}"
new_apply = "function applySourceStatus(camera,data){const online=data?.source_online===true;state.sourceOnline[camera]=online;const el=$(camera+'State');if(online){if(!state.liveRequested[camera])el.textContent=data?.recording?'recording':'online';el.className='cam-state ok';loadControls(camera);if(mode==='live'&&state.unlocked&&!state.autoStarted[camera]){state.autoStarted[camera]=true;startLive(camera,true)}}else{clearTimeout(state.retries[camera]);state.retries[camera]=null;stopLive(camera);liveMessage(camera,'Camera offline');el.textContent='offline';el.className='cam-state bad'}return online}"
if old_apply not in s:
    raise SystemExit('applySourceStatus marker missing')
s = s.replace(old_apply, new_apply, 1)

s = s.replace('v813 - Kalenel Security · remote live on demand', 'v778 - Kalenel Security · protected live auto-start')
if 'v778 - Kalenel Security' not in s:
    raise SystemExit('watermark not patched')
html.write_text(s)
print('V778_PATCH=PASS')
