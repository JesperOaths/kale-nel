from pathlib import Path


def patch_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"BLOCKER={label}_COUNT_{count}")
    return text.replace(old, new, 1)


worker_path = Path("cloudflare/workers/admin-gate/src/worker.js")
worker = worker_path.read_text()
worker = patch_once(worker, "const ADMIN_BUILD = 'v780-security-login-resilience';", "const ADMIN_BUILD = 'v782-security-drive-saved';", "WORKER_BUILD")
worker = patch_once(
    worker,
    "  if (url.pathname === '/security/new-clips') return canonicalRedirect('/security/new-clips/');\n  if (url.pathname === '/security/s3-clips') return canonicalRedirect('/security/s3-clips/');\n  if (url.pathname === '/security/' || url.pathname === '/security/unlock/' || url.pathname === '/security/new-clips/' || url.pathname === '/security/s3-clips/') {",
    "  if (url.pathname === '/security/new-clips') return canonicalRedirect('/security/new-clips/');\n  if (url.pathname === '/security/s3-clips') return canonicalRedirect('/security/s3-clips/');\n  if (url.pathname === '/security/new-saved') return canonicalRedirect('/security/new-saved/');\n  if (url.pathname === '/security/s3-saved') return canonicalRedirect('/security/s3-saved/');\n  if (url.pathname === '/security/' || url.pathname === '/security/unlock/' || url.pathname === '/security/new-clips/' || url.pathname === '/security/s3-clips/' || url.pathname === '/security/new-saved/' || url.pathname === '/security/s3-saved/') {",
    "WORKER_SAVED_PAGES",
)
worker = patch_once(
    worker,
    "  if (path === '/security/new-clips' || path === '/security/new-clips/') return '/security/new-clips/';\n  if (path === '/security/s3-clips' || path === '/security/s3-clips/') return '/security/s3-clips/';\n  return '/security/';",
    "  if (path === '/security/new-clips' || path === '/security/new-clips/') return '/security/new-clips/';\n  if (path === '/security/s3-clips' || path === '/security/s3-clips/') return '/security/s3-clips/';\n  if (path === '/security/new-saved' || path === '/security/new-saved/') return '/security/new-saved/';\n  if (path === '/security/s3-saved' || path === '/security/s3-saved/') return '/security/s3-saved/';\n  return '/security/';",
    "WORKER_RETURN_TO_PAGE",
)
worker = patch_once(
    worker,
    "    path === '/security/new-clips' || path === '/security/new-clips/' ||\n    path === '/security/s3-clips' || path === '/security/s3-clips/';",
    "    path === '/security/new-clips' || path === '/security/new-clips/' ||\n    path === '/security/s3-clips' || path === '/security/s3-clips/' ||\n    path === '/security/new-saved' || path === '/security/new-saved/' ||\n    path === '/security/s3-saved' || path === '/security/s3-saved/';",
    "WORKER_SECURITY_RETURN_TO",
)
worker = patch_once(
    worker,
    "    if (pathname === `${prefix}/api/events`) return `/${camera}/api/events`;\n    if (pathname === `${prefix}/api/status`) return `/${camera}/api/status`;",
    "    if (pathname === `${prefix}/api/events`) return `/${camera}/api/events`;\n    if (pathname === `${prefix}/api/saved`) return `/${camera}/api/saved`;\n    if (pathname === `${prefix}/api/status`) return `/${camera}/api/status`;",
    "WORKER_SAVED_API",
)
worker = patch_once(
    worker,
    "    if (pathname.startsWith(`${prefix}/clip/`)) {\n      const name = cleanSecurityFilename(pathname.slice(`${prefix}/clip/`.length), '.mp4');\n      return name ? `/${camera}/clip/${encodeURIComponent(name)}` : '';\n    }",
    "    if (pathname.startsWith(`${prefix}/clip/`)) {\n      const name = cleanSecurityFilename(pathname.slice(`${prefix}/clip/`.length), '.mp4');\n      return name ? `/${camera}/clip/${encodeURIComponent(name)}` : '';\n    }\n    if (pathname.startsWith(`${prefix}/saved/snap/`)) {\n      const name = cleanSecurityFilename(pathname.slice(`${prefix}/saved/snap/`.length), '.jpg');\n      return name ? `/${camera}/saved/snap/${encodeURIComponent(name)}` : '';\n    }\n    if (pathname.startsWith(`${prefix}/saved/clip/`)) {\n      const name = cleanSecurityFilename(pathname.slice(`${prefix}/saved/clip/`.length), '.mp4');\n      return name ? `/${camera}/saved/clip/${encodeURIComponent(name)}` : '';\n    }",
    "WORKER_SAVED_MEDIA_PATHS",
)
worker = patch_once(
    worker,
    "  if (!/^\\/(?:new|s3)\\/(?:api\\/(?:status|events|controls|control)|live\\.mjpg|snap\\/[A-Za-z0-9._%-]+|clip\\/[A-Za-z0-9._%-]+)$/.test(String(upstreamPath || ''))) return '';",
    "  if (!/^\\/(?:new|s3)\\/(?:api\\/(?:status|events|saved|controls|control)|live\\.mjpg|snap\\/[A-Za-z0-9._%-]+|clip\\/[A-Za-z0-9._%-]+|saved\\/(?:snap|clip)\\/[A-Za-z0-9._%-]+)$/.test(String(upstreamPath || ''))) return '';",
    "WORKER_DIRECT_ALLOWLIST",
)
worker = patch_once(
    worker,
    "  let m = s.match(/^\\/(new|s3)\\/api\\/(status|events|controls|control)$/);",
    "  let m = s.match(/^\\/(new|s3)\\/api\\/(status|events|saved|controls|control)$/);",
    "WORKER_RELAY_SAVED_API",
)
worker = patch_once(
    worker,
    "  if (!m && (m=s.match(/^\\/(new|s3)\\/clip\\/([A-Za-z0-9._%-]+)$/))) { camera=m[1]; kind='clip'; try{name=decodeURIComponent(m[2])}catch{return '';} }\n  if (!camera || !kind) return '';",
    "  if (!m && (m=s.match(/^\\/(new|s3)\\/clip\\/([A-Za-z0-9._%-]+)$/))) { camera=m[1]; kind='clip'; try{name=decodeURIComponent(m[2])}catch{return '';} }\n  if (!m && (m=s.match(/^\\/(new|s3)\\/saved\\/snap\\/([A-Za-z0-9._%-]+)$/))) { camera=m[1]; kind='savedsnap'; try{name=decodeURIComponent(m[2])}catch{return '';} }\n  if (!m && (m=s.match(/^\\/(new|s3)\\/saved\\/clip\\/([A-Za-z0-9._%-]+)$/))) { camera=m[1]; kind='savedclip'; try{name=decodeURIComponent(m[2])}catch{return '';} }\n  if (!camera || !kind) return '';",
    "WORKER_RELAY_SAVED_MEDIA",
)
worker_path.write_text(worker)

html_path = Path("security/index.html")
html = html_path.read_text()
html = patch_once(
    html,
    '        <a id="navNew" href="/security/new-clips/">New camera clips</a>\n        <a id="navS3" href="/security/s3-clips/">S3 camera clips</a>',
    '        <a id="navNew" href="/security/new-clips/">New camera clips</a>\n        <a id="navS3" href="/security/s3-clips/">S3 camera clips</a>\n        <a id="navNewSaved" href="/security/new-saved/">New camera saved</a>\n        <a id="navS3Saved" href="/security/s3-saved/">S3 camera saved</a>',
    "HTML_SAVED_NAV",
)
html = patch_once(html, '<div class="watermark">v780 - Kalenel Security · resilient protected login</div>', '<div class="watermark">v782 - Kalenel Security · verified Drive saved archive</div>', "HTML_WATERMARK")
html = patch_once(
    html,
    "  const mode=path.includes('/new-clips')?'new':path.includes('/s3-clips')?'s3':'live';\n  const state={unlocked:false,authPending:false,events:[],retries:{new:null,s3:null},liveTimers:{new:null,s3:null},liveRequested:{new:false,s3:false},autoStarted:{new:false,s3:false},sourceOnline:{new:false,s3:false},statusTimer:null,controlsAt:{new:0,s3:0}},$=id=>document.getElementById(id),enc=encodeURIComponent;\n  const clipCamera=mode==='live'?null:mode;",
    "  const mode=path.includes('/new-saved')?'new-saved':path.includes('/s3-saved')?'s3-saved':path.includes('/new-clips')?'new':path.includes('/s3-clips')?'s3':'live';\n  const state={unlocked:false,authPending:false,events:[],driveReady:true,retries:{new:null,s3:null},liveTimers:{new:null,s3:null},liveRequested:{new:false,s3:false},autoStarted:{new:false,s3:false},sourceOnline:{new:false,s3:false},statusTimer:null,controlsAt:{new:0,s3:0}},$=id=>document.getElementById(id),enc=encodeURIComponent;\n  const savedMode=mode==='new-saved'||mode==='s3-saved';\n  const clipCamera=mode==='live'?null:(mode.startsWith('new')?'new':'s3');",
    "HTML_MODE",
)
html = patch_once(
    html,
    "  const copy={live:{eyebrow:'Private',title:'Kalenel Security',sub:'Two live cameras. Motion recordings are kept in separate archives.'},new:{eyebrow:'Private recordings',title:'New camera motion clips',sub:'Motion-activated recordings from the new IP camera.'},s3:{eyebrow:'Private recordings',title:'S3 camera motion clips',sub:'Motion-activated recordings from the existing S3 camera.'}}[mode];",
    "  const copy={live:{eyebrow:'Private',title:'Kalenel Security',sub:'Two live cameras. Motion recordings are kept in separate archives.'},new:{eyebrow:'Private recordings',title:'New camera motion clips',sub:'Motion-activated recordings from the new IP camera.'},s3:{eyebrow:'Private recordings',title:'S3 camera motion clips',sub:'Motion-activated recordings from the existing S3 camera.'},'new-saved':{eyebrow:'Google Drive archive',title:'New camera saved',sub:'Verified saved recordings stored in Google Drive.'},'s3-saved':{eyebrow:'Google Drive archive',title:'S3 camera saved',sub:'Verified saved recordings stored in Google Drive.'}}[mode];",
    "HTML_COPY",
)
html = patch_once(
    html,
    "  $('navLive').classList.toggle('active',mode==='live');$('navNew').classList.toggle('active',mode==='new');$('navS3').classList.toggle('active',mode==='s3');",
    "  $('navLive').classList.toggle('active',mode==='live');$('navNew').classList.toggle('active',mode==='new');$('navS3').classList.toggle('active',mode==='s3');$('navNewSaved').classList.toggle('active',mode==='new-saved');$('navS3Saved').classList.toggle('active',mode==='s3-saved');",
    "HTML_NAV_ACTIVE",
)
html = patch_once(
    html,
    "  function card(e){const a=document.createElement('article');a.className='clip';a.tabIndex=0;a.setAttribute('role','button');const img=document.createElement('img');img.className='thumb';img.loading='lazy';img.alt='Frame with strongest detected motion';if(e.snapshot_name)img.src=`/security/${clipCamera}/snap/${enc(e.snapshot_name)}`;const body=document.createElement('div');body.className='clip-body';const row=document.createElement('div');row.className='clip-row';const t=document.createElement('div');t.className='clip-title';t.textContent=e.timestamp||`Clip #${e.clip_no??'—'}`;row.appendChild(t);if(e.saved){const b=document.createElement('span');b.className='badge';b.textContent='Saved';row.appendChild(b)}const r=document.createElement('div');r.className='clip-reason';r.textContent=e.reason||'Motion event';const d=document.createElement('div');d.className='clip-time';d.textContent=e.duration_target_seconds?`${e.duration_target_seconds}s target`:'Recording';body.append(row,r,d);a.append(img,body);const open=()=>openClip(e);a.addEventListener('click',open);a.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();open()}});return a}\n  function render(){const box=$('clips');box.replaceChildren();const playable=state.events.filter(e=>e&&e.clip_name);$('empty').classList.toggle('hidden',playable.length!==0);for(const e of playable)box.appendChild(card(e));setConnection(true,`${playable.length} recording${playable.length===1?'':'s'}`)}\n  function openClip(e){if(!e.clip_name||!clipCamera)return;const p=$('player');p.src=`/security/${clipCamera}/clip/${enc(e.clip_name)}`;$('viewerTitle').textContent=e.timestamp||`Clip #${e.clip_no??''}`;$('viewerMeta').textContent=[e.reason,e.method,e.duration_target_seconds?`${e.duration_target_seconds}s target`:null].filter(Boolean).join(' · ');$('viewer').showModal()}",
    "  function card(e){const a=document.createElement('article');a.className='clip';a.tabIndex=0;a.setAttribute('role','button');const img=document.createElement('img');img.className='thumb';img.loading='lazy';img.alt=savedMode?'Saved Drive recording preview':'Frame with strongest detected motion';if(e.snapshot_name)img.src=savedMode?`/security/${clipCamera}/saved/snap/${enc(e.snapshot_name)}`:`/security/${clipCamera}/snap/${enc(e.snapshot_name)}`;const body=document.createElement('div');body.className='clip-body';const row=document.createElement('div');row.className='clip-row';const t=document.createElement('div');t.className='clip-title';t.textContent=e.timestamp||`Clip #${e.clip_no??'—'}`;row.appendChild(t);if(savedMode||e.saved){const b=document.createElement('span');b.className='badge';b.textContent=savedMode?'Drive saved':'Saved';row.appendChild(b)}const r=document.createElement('div');r.className='clip-reason';r.textContent=e.reason||e.selection_reason||'Motion event';const d=document.createElement('div');d.className='clip-time';d.textContent=savedMode?(e.selection_reason==='person-highlight'?`Person detected ${Math.round(Number(e.person_confidence||0)*100)}%`:'Manually saved'):(e.duration_target_seconds?`${e.duration_target_seconds}s target`:'Recording');body.append(row,r,d);a.append(img,body);const open=()=>openClip(e);a.addEventListener('click',open);a.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();open()}});return a}\n  function render(){const box=$('clips');box.replaceChildren();const playable=state.events.filter(e=>e&&(savedMode?e.remote_name:e.clip_name));$('empty').classList.toggle('hidden',playable.length!==0);$('empty').textContent=savedMode?(state.driveReady?'No saved Drive recordings are stored for this camera yet.':'Google Drive authorization is not finished yet.'):'No motion recordings are stored for this camera yet.';for(const e of playable)box.appendChild(card(e));setConnection(state.driveReady||!savedMode,savedMode?`${playable.length} saved in Drive`:`${playable.length} recording${playable.length===1?'':'s'}`)}\n  function openClip(e){const name=savedMode?e.remote_name:e.clip_name;if(!name||!clipCamera)return;const p=$('player');p.src=savedMode?`/security/${clipCamera}/saved/clip/${enc(name)}`:`/security/${clipCamera}/clip/${enc(name)}`;$('viewerTitle').textContent=e.timestamp||`Clip #${e.clip_no??''}`;$('viewerMeta').textContent=[e.reason,e.selection_reason,e.method,e.person_confidence?`person ${Math.round(Number(e.person_confidence)*100)}%`:null,e.duration_target_seconds?`${e.duration_target_seconds}s target`:null].filter(Boolean).join(' · ');$('viewer').showModal()}",
    "HTML_SAVED_RENDER",
)
html = patch_once(
    html,
    "}else{const data=await api(clipCamera,'/api/events');state.events=Array.isArray(data.events)?data.events:[];render()}}catch(err)",
    "}else{const data=await api(clipCamera,savedMode?'/api/saved':'/api/events');state.events=Array.isArray(data.events)?data.events:[];state.driveReady=savedMode?data.drive_ready!==false:true;render()}}catch(err)",
    "HTML_REFRESH_SAVED",
)
html_path.write_text(html)
print('PATCH_V782=PASS')
