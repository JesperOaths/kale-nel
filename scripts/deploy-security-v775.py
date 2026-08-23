from pathlib import Path

worker = Path('cloudflare/workers/admin-gate/src/worker.js')
security = Path('security/index.html')

w = worker.read_text()
old_build = "const ADMIN_BUILD = 'v773-security-storage-presets';"
new_build = "const ADMIN_BUILD = 'v775-security-resilient-on-demand';"
if old_build not in w:
    raise SystemExit('expected v773 worker build marker not found')
w = w.replace(old_build, new_build, 1)
worker.write_text(w)

s = security.read_text()

css_old = ".live-frame{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#000}.live-meta{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:11px 14px;color:var(--muted);font-size:13px}"
css_new = css_old + ".remote-live-actions{display:flex;gap:8px;flex-wrap:wrap;padding:0 14px 12px}.remote-live-actions button{width:auto}.bandwidth-note{margin:12px 0 0;padding:10px 12px;border:1px solid #5d4928;background:#1d180f;border-radius:12px;color:#d7c08f;font-size:12px}"
if css_old not in s:
    raise SystemExit('live css anchor not found')
s = s.replace(css_old, css_new, 1)

new_anchor = '<span id="newStorage">Storage: —</span></div><details class="controls" open>'
new_repl = '<span id="newStorage">Storage: —</span></div><div class="remote-live-actions"><button class="button" type="button" data-live="new">Start live</button><button class="button" type="button" data-stop="new">Stop</button></div><details class="controls" open>'
if new_anchor not in s:
    raise SystemExit('new-camera live action anchor not found')
s = s.replace(new_anchor, new_repl, 1)

s3_anchor = '<span id="s3Storage">Storage: —</span></div><details class="controls">'
s3_repl = '<span id="s3Storage">Storage: —</span></div><div class="remote-live-actions"><button class="button" type="button" data-live="s3">Start live</button><button class="button" type="button" data-stop="s3">Stop</button></div><details class="controls">'
if s3_anchor not in s:
    raise SystemExit('S3 live action anchor not found')
s = s.replace(s3_anchor, s3_repl, 1)

livegrid_close = '        </div>\n      </section>\n      <section id="clipsView"'
livegrid_repl = '        </div>\n        <div class="bandwidth-note">Remote live video starts only when requested and automatically stops after 2 minutes. Recording on the C720P is unaffected.</div>\n      </section>\n      <section id="clipsView"'
if livegrid_close not in s:
    raise SystemExit('live-view close anchor not found')
s = s.replace(livegrid_close, livegrid_repl, 1)

state_old = "const state={unlocked:false,events:[],retries:{new:null,s3:null},sourceOnline:{new:false,s3:false},statusTimer:null,controlsAt:{new:0,s3:0}},$=id=>document.getElementById(id),enc=encodeURIComponent;"
state_new = "const state={unlocked:false,events:[],retries:{new:null,s3:null},liveTimers:{new:null,s3:null},liveRequested:{new:false,s3:false},sourceOnline:{new:false,s3:false},statusTimer:null,controlsAt:{new:0,s3:0}},$=id=>document.getElementById(id),enc=encodeURIComponent;"
if state_old not in s:
    raise SystemExit('state anchor not found')
s = s.replace(state_old, state_new, 1)

stop_old = "function stopLive(camera){$(camera+'Live').removeAttribute('src')}function stopAll(){stopLive('new');stopLive('s3')}"
stop_new = "function stopLive(camera){state.liveRequested[camera]=false;clearTimeout(state.liveTimers[camera]);state.liveTimers[camera]=null;const img=$(camera+'Live');img.removeAttribute('src');if(state.sourceOnline[camera]&&state.unlocked){$(camera+'State').textContent='online';$(camera+'State').className='cam-state ok'}}function stopAll(){stopLive('new');stopLive('s3')}"
if stop_old not in s:
    raise SystemExit('stopLive anchor not found')
s = s.replace(stop_old, stop_new, 1)

start_old = "function startLive(camera,force=false){if(!state.unlocked||mode!=='live'||state.sourceOnline[camera]!==true)return;const img=$(camera+'Live');if(!force&&img.getAttribute('src'))return;img.src=`/security/${camera}/live.mjpg?t=${Date.now()}`;$(camera+'State').textContent='connecting…';$(camera+'State').className='cam-state'}"
start_new = "function startLive(camera,force=false){if(!state.unlocked||mode!=='live'||state.sourceOnline[camera]!==true)return;const img=$(camera+'Live');if(!force&&img.getAttribute('src'))return;state.liveRequested[camera]=true;clearTimeout(state.liveTimers[camera]);state.liveTimers[camera]=setTimeout(()=>stopLive(camera),120000);img.src=`/security/${camera}/live.mjpg?t=${Date.now()}`;$(camera+'State').textContent='connecting…';$(camera+'State').className='cam-state'}"
if start_old not in s:
    raise SystemExit('startLive anchor not found')
s = s.replace(start_old, start_new, 1)

bind_old = "function bindLive(camera){const img=$(camera+'Live');img.addEventListener('load',()=>{$(camera+'State').textContent='live';$(camera+'State').className='cam-state ok'});img.addEventListener('error',()=>{if(!state.unlocked||mode!=='live'||state.sourceOnline[camera]!==true)return;$(camera+'State').textContent='reconnecting…';$(camera+'State').className='cam-state bad';clearTimeout(state.retries[camera]);state.retries[camera]=setTimeout(()=>startLive(camera,true),2500)})}"
bind_new = "function bindLive(camera){const img=$(camera+'Live');img.addEventListener('load',()=>{$(camera+'State').textContent='live';$(camera+'State').className='cam-state ok'});img.addEventListener('error',()=>{if(!state.unlocked||mode!=='live'||state.sourceOnline[camera]!==true||!state.liveRequested[camera])return;$(camera+'State').textContent='reconnecting…';$(camera+'State').className='cam-state bad';clearTimeout(state.retries[camera]);state.retries[camera]=setTimeout(()=>startLive(camera,true),2500)})}"
if bind_old not in s:
    raise SystemExit('bindLive anchor not found')
s = s.replace(bind_old, bind_new, 1)

apply_old = "function applySourceStatus(camera,data){const online=data?.source_online===true;state.sourceOnline[camera]=online;const el=$(camera+'State');if(online){el.textContent=data?.recording?'recording':'online';el.className='cam-state ok';startLive(camera);loadControls(camera)}else{clearTimeout(state.retries[camera]);state.retries[camera]=null;stopLive(camera);el.textContent='offline';el.className='cam-state bad'}return online}"
apply_new = "function applySourceStatus(camera,data){const online=data?.source_online===true;state.sourceOnline[camera]=online;const el=$(camera+'State');if(online){if(!state.liveRequested[camera])el.textContent=data?.recording?'recording':'online';el.className='cam-state ok';loadControls(camera)}else{clearTimeout(state.retries[camera]);state.retries[camera]=null;stopLive(camera);el.textContent='offline';el.className='cam-state bad'}return online}"
if apply_old not in s:
    raise SystemExit('applySourceStatus anchor not found')
s = s.replace(apply_old, apply_new, 1)

binds_old = "bindLive('new');bindLive('s3');$('refreshBtn').addEventListener('click',()=>{state.controlsAt.new=0;state.controlsAt.s3=0;refresh()});"
binds_new = "bindLive('new');bindLive('s3');document.querySelectorAll('[data-live]').forEach(b=>b.addEventListener('click',()=>startLive(b.dataset.live,true)));document.querySelectorAll('[data-stop]').forEach(b=>b.addEventListener('click',()=>stopLive(b.dataset.stop)));$('refreshBtn').addEventListener('click',()=>{state.controlsAt.new=0;state.controlsAt.s3=0;refresh()});"
if binds_old not in s:
    raise SystemExit('event binding anchor not found')
s = s.replace(binds_old, binds_new, 1)

water_old = '<div class="watermark">v813 - Kalenel Security</div>'
water_new = '<div class="watermark">v813 - Kalenel Security · remote live on demand</div>'
if water_old not in s:
    raise SystemExit('watermark anchor not found')
s = s.replace(water_old, water_new, 1)

security.write_text(s)
print('V775_PATCH=PASS')
