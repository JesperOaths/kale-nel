from pathlib import Path

p = Path('security/index.html')
s = p.read_text()


def once(old: str, new: str, label: str) -> None:
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'BLOCKER={label}_COUNT_{count}')
    s = s.replace(old, new, 1)


once(
    "const state={unlocked:false,events:[],retries:{new:null,s3:null}},$=id=>document.getElementById(id),enc=encodeURIComponent;",
    "const state={unlocked:false,events:[],retries:{new:null,s3:null},sourceOnline:{new:false,s3:false},statusTimer:null},$=id=>document.getElementById(id),enc=encodeURIComponent;",
    'STATE',
)

once(
    "function showInnerLogin(m=''){state.unlocked=false;stopAll();$('innerLogin').classList.remove('hidden');$('securityApp').classList.add('hidden');setConnection(false,'Locked');if(m)showError(m)}",
    "function showInnerLogin(m=''){state.unlocked=false;state.sourceOnline.new=false;state.sourceOnline.s3=false;stopAll();$('innerLogin').classList.remove('hidden');$('securityApp').classList.add('hidden');setConnection(false,'Locked');if(m)showError(m)}",
    'LOCK_RESET',
)

once(
    "function startLive(camera,force=false){if(!state.unlocked||mode!=='live')return;const img=$(camera+'Live');if(!force&&img.getAttribute('src'))return;img.src=`/security/${camera}/live.mjpg?t=${Date.now()}`;$(camera+'State').textContent='connecting…';$(camera+'State').className='cam-state'}",
    "function startLive(camera,force=false){if(!state.unlocked||mode!=='live'||state.sourceOnline[camera]!==true)return;const img=$(camera+'Live');if(!force&&img.getAttribute('src'))return;img.src=`/security/${camera}/live.mjpg?t=${Date.now()}`;$(camera+'State').textContent='connecting…';$(camera+'State').className='cam-state'}",
    'START_LIVE_GATE',
)

once(
    "function bindLive(camera){const img=$(camera+'Live');img.addEventListener('load',()=>{$(camera+'State').textContent='live';$(camera+'State').className='cam-state ok'});img.addEventListener('error',()=>{if(!state.unlocked||mode!=='live')return;$(camera+'State').textContent='reconnecting…';$(camera+'State').className='cam-state bad';clearTimeout(state.retries[camera]);state.retries[camera]=setTimeout(()=>startLive(camera,true),2500)})}",
    "function bindLive(camera){const img=$(camera+'Live');img.addEventListener('load',()=>{$(camera+'State').textContent='live';$(camera+'State').className='cam-state ok'});img.addEventListener('error',()=>{if(!state.unlocked||mode!=='live'||state.sourceOnline[camera]!==true)return;$(camera+'State').textContent='reconnecting…';$(camera+'State').className='cam-state bad';clearTimeout(state.retries[camera]);state.retries[camera]=setTimeout(()=>startLive(camera,true),2500)})}",
    'LIVE_ERROR_GATE',
)

old_refresh = "async function refresh(){if(!state.unlocked)return;clearError();try{if(mode==='live'){const [n,s]=await Promise.all([api('new','/api/status'),api('s3','/api/status')]);$('newLast').textContent=`Last motion: ${n.last_event_at||'—'}`;$('s3Last').textContent=`Last motion: ${s.last_event_at||'—'}`;setConnection(true,'Connected');startLive('new');startLive('s3')}else{const data=await api(clipCamera,'/api/events');state.events=Array.isArray(data.events)?data.events:[];render()}}catch(err){if(String(err?.message||'')==='security_unlock_required')return;setConnection(false,'Unavailable');showError(err?.message||'Security service unavailable.')}}"
new_refresh = "function applySourceStatus(camera,data){const online=data?.source_online===true;state.sourceOnline[camera]=online;const el=$(camera+'State');if(online){el.textContent=data?.recording?'recording':'online';el.className='cam-state ok';startLive(camera)}else{clearTimeout(state.retries[camera]);state.retries[camera]=null;stopLive(camera);el.textContent='offline';el.className='cam-state bad'}return online}async function refresh(){if(!state.unlocked)return;clearError();try{if(mode==='live'){const [n,s]=await Promise.all([api('new','/api/status'),api('s3','/api/status')]);$('newLast').textContent=`Last motion: ${n.last_event_at||'—'}`;$('s3Last').textContent=`Last motion: ${s.last_event_at||'—'}`;const online=Number(applySourceStatus('new',n))+Number(applySourceStatus('s3',s));setConnection(online>0,`${online}/2 cameras online`)}else{const data=await api(clipCamera,'/api/events');state.events=Array.isArray(data.events)?data.events:[];render()}}catch(err){if(String(err?.message||'')==='security_unlock_required')return;setConnection(false,'Unavailable');showError(err?.message||'Security service unavailable.')}}"
once(old_refresh, new_refresh, 'REFRESH_SOURCE_STATUS')

once(
    "document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAll();else if(state.unlocked)refresh()});window.addEventListener('beforeunload',()=>{stopAll();for(const k of Object.keys(state.retries))clearTimeout(state.retries[k])});",
    "document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAll();else if(state.unlocked)refresh()});if(mode==='live')state.statusTimer=setInterval(()=>{if(state.unlocked&&!document.hidden)refresh()},15000);window.addEventListener('beforeunload',()=>{stopAll();if(state.statusTimer)clearInterval(state.statusTimer);for(const k of Object.keys(state.retries))clearTimeout(state.retries[k])});",
    'STATUS_TIMER',
)

once(
    '<div class="watermark">Kalenel · security-4 · dual camera</div>',
    '<div class="watermark">Kalenel · security-5 · source-aware dual camera</div>',
    'WATERMARK',
)

p.write_text(s)
print('SECURITY_SOURCE_HEALTH_UI_PATCH=APPLIED')
