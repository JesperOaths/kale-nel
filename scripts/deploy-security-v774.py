#!/usr/bin/env python3
from pathlib import Path

# Worker source is checked out from the direct-origin v772 branch by the workflow;
# Security UI is checked out from the controls v772 branch. This script only
# patches those certified baselines.
w = Path('cloudflare/workers/admin-gate/src/worker.js')
s = w.read_text()
old = "const ADMIN_BUILD = 'v772-security-direct-origin-controls';"
if old not in s:
    raise SystemExit('direct-origin v772 worker marker missing')
s = s.replace(old, "const ADMIN_BUILD = 'v774-security-storage-presets';", 1)
w.write_text(s)

p = Path('security/index.html')
s = p.read_text()

css_marker = "    .clips{display:grid;"
extra_css = """    .storage-line{display:flex;gap:8px;flex-wrap:wrap;padding:0 14px 11px;color:var(--muted);font-size:12px}.storage-line strong{color:var(--text)}\n    .preset-row{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 11px}.preset-row .button{font-size:12px;padding:7px 9px}.preset-row .button[data-preset=\"torch\"]{border-color:#69562e}\n"""
if css_marker not in s:
    raise SystemExit('CSS marker missing')
s = s.replace(css_marker, extra_css + css_marker, 1)

old_new = '<div class="live-meta"><span>New IP camera</span><span id="newLast">Last motion: —</span></div><div class="remote-live-actions">'
new_new = '<div class="live-meta"><span>New IP camera</span><span id="newLast">Last motion: —</span></div><div id="newStorage" class="storage-line"><span>Storage: —</span></div><div class="remote-live-actions">'
old_s3 = '<div class="live-meta"><span>Existing S3 camera</span><span id="s3Last">Last motion: —</span></div><div class="remote-live-actions">'
new_s3 = '<div class="live-meta"><span>Existing S3 camera</span><span id="s3Last">Last motion: —</span></div><div id="s3Storage" class="storage-line"><span>Storage: —</span></div><div class="remote-live-actions">'
if old_new not in s or old_s3 not in s:
    raise SystemExit('live card storage marker missing')
s = s.replace(old_new, new_new, 1).replace(old_s3, new_s3, 1)

old = '<section class="controls"><article class="control-card"><h2>New camera controls</h2><div id="newControls" class="control-grid"></div>'
new = '<section class="controls"><article class="control-card"><h2>New camera controls</h2><div class="preset-row"><button class="button" type="button" data-camera="new" data-preset="auto">Auto</button><button class="button" type="button" data-camera="new" data-preset="day">Day</button><button class="button" type="button" data-camera="new" data-preset="night">Night</button><button class="button" type="button" data-camera="new" data-preset="maxnight">Max night</button><button class="button" type="button" data-camera="new" data-preset="hdr">HDR</button><button class="button" type="button" data-camera="new" data-preset="torch">Torch</button></div><div id="newControls" class="control-grid"></div>'
if old not in s:
    raise SystemExit('new controls marker missing')
s = s.replace(old, new, 1)
old = '<article class="control-card"><h2>S3 camera controls</h2><div id="s3Controls" class="control-grid"></div>'
new = '<article class="control-card"><h2>S3 camera controls</h2><div class="preset-row"><button class="button" type="button" data-camera="s3" data-preset="auto">Auto</button><button class="button" type="button" data-camera="s3" data-preset="day">Day</button><button class="button" type="button" data-camera="s3" data-preset="night">Night</button><button class="button" type="button" data-camera="s3" data-preset="maxnight">Max night</button><button class="button" type="button" data-camera="s3" data-preset="hdr">HDR</button><button class="button" type="button" data-camera="s3" data-preset="torch">Torch</button></div><div id="s3Controls" class="control-grid"></div>'
if old not in s:
    raise SystemExit('s3 controls marker missing')
s = s.replace(old, new, 1)

old = "const state={unlocked:false,events:[],retries:{new:null,s3:null},liveTimers:{new:null,s3:null},sourceOnline:{new:false,s3:false},statusTimer:null},$=id=>document.getElementById(id),enc=encodeURIComponent;"
new = "const state={unlocked:false,events:[],retries:{new:null,s3:null},liveTimers:{new:null,s3:null},sourceOnline:{new:false,s3:false},controlCaps:{new:{},s3:{}},statusTimer:null},$=id=>document.getElementById(id),enc=encodeURIComponent;"
if old not in s:
    raise SystemExit('state marker missing')
s = s.replace(old, new, 1)

old = "async function loadControls(camera){if(mode!=='live'||!state.unlocked)return;const box=$(camera+'Controls'),note=$(camera+'ControlNote');if(!box||!note)return;box.replaceChildren();note.textContent='Loading capabilities…';try{const d=await api(camera,'/api/controls'),controls=d.controls||{};"
new = "async function loadControls(camera){if(mode!=='live'||!state.unlocked)return;const box=$(camera+'Controls'),note=$(camera+'ControlNote');if(!box||!note)return;box.replaceChildren();note.textContent='Loading capabilities…';try{const d=await api(camera,'/api/controls'),controls=d.controls||{};state.controlCaps[camera]=controls;"
if old not in s:
    raise SystemExit('loadControls marker missing')
s = s.replace(old, new, 1)

insert_before = "  function loadAllControls(){loadControls('new');loadControls('s3')}"
addition = r'''  function renderStorage(camera,data){const el=$(camera+'Storage');if(!el)return;const used=Number(data?.archive_used_mb),quota=Number(data?.archive_quota_mb),pct=Number(data?.archive_usage_percent),free=Number(data?.disk_free_mb),mins=Number(data?.estimated_minutes_remaining),hours=Number(data?.retention_unsaved_hours);const bits=[];if(Number.isFinite(used)&&Number.isFinite(quota))bits.push(`<span><strong>${used.toFixed(0)} / ${quota.toFixed(0)} MB</strong>${Number.isFinite(pct)?` · ${pct.toFixed(0)}%`:''}</span>`);if(Number.isFinite(mins))bits.push(`<span>~${Math.max(0,mins).toFixed(0)} min quota capacity left</span>`);if(Number.isFinite(free))bits.push(`<span>C720P free ${free.toFixed(0)} MB</span>`);if(Number.isFinite(hours))bits.push(`<span>unsaved retention ${hours.toFixed(0)} h</span>`);el.innerHTML=bits.length?bits.join(''):'<span>Storage metrics unavailable</span>'}
  function availableValue(camera,key,wanted){const c=state.controlCaps[camera]?.[key];if(!c)return null;const vals=Array.isArray(c.available)?c.available.map(String):[];if(wanted==='__MAX__'&&vals.length)return vals[vals.length-1];if(vals.includes(String(wanted)))return String(wanted);return null}
  async function applyPreset(camera,preset){const note=$(camera+'ControlNote');if(!state.unlocked)return;const specs={auto:[['profile_mode','auto']],day:[['profile_mode','pause_30m'],['torch','off'],['night_vision','off'],['scenemode','auto'],['whitebalance','auto'],['focusmode','continuous-video'],['coloreffect','none'],['zoom','100']],night:[['profile_mode','pause_30m'],['torch','off'],['night_vision','on'],['scenemode','hdr'],['whitebalance','auto'],['focusmode','continuous-video']],maxnight:[['profile_mode','pause_30m'],['torch','off'],['night_vision','on'],['scenemode','hdr'],['whitebalance','auto'],['focusmode','continuous-video'],['night_vision_gain','__MAX__']],hdr:[['profile_mode','pause_30m'],['torch','off'],['scenemode','hdr'],['whitebalance','auto']],torch:[['profile_mode','pause_30m'],['torch','on']]};const plan=specs[preset]||[];let applied=0;note.textContent='Applying '+preset+' preset…';for(const [key,wanted] of plan){const value=availableValue(camera,key,wanted);if(value===null)continue;try{await apiPost(camera,'/api/control',{key,value});applied++}catch(e){if(String(e?.message||'')==='security_unlock_required')return}}note.textContent=applied?`${preset} preset applied (${applied} settings).`:`${preset} preset is not supported by this camera.`;setTimeout(()=>loadControls(camera),700)}
'''
if insert_before not in s:
    raise SystemExit('loadAllControls marker missing')
s = s.replace(insert_before, addition + insert_before, 1)

old = "function applySourceStatus(camera,data){const online=data?.source_online===true;state.sourceOnline[camera]=online;"
new = "function applySourceStatus(camera,data){renderStorage(camera,data);const online=data?.source_online===true;state.sourceOnline[camera]=online;"
if old not in s:
    raise SystemExit('source status marker missing')
s = s.replace(old, new, 1)

old = "document.querySelectorAll('[data-reload-controls]').forEach(b=>b.addEventListener('click',()=>loadControls(b.dataset.reloadControls)));$('refreshBtn')"
new = "document.querySelectorAll('[data-reload-controls]').forEach(b=>b.addEventListener('click',()=>loadControls(b.dataset.reloadControls)));document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>applyPreset(b.dataset.camera,b.dataset.preset)));$('refreshBtn')"
if old not in s:
    raise SystemExit('preset bind marker missing')
s = s.replace(old, new, 1)

s = s.replace('Kalenel · security-5 · source-aware dual camera','Kalenel · security-7 · v774 · storage + presets + auto profile',1)
p.write_text(s)
