from pathlib import Path
import datetime, shutil, subprocess, time, json

HOME=Path('/home/jespern')
WWW=Path('/opt/homeassistant/config/www')
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=HOME/'c720p-backups'/f'home-v88-{STAMP}'
BACK.mkdir(parents=True,exist_ok=True)

for name in ['c720p-drive-saved.html','c720p-weather-compact.html','c720p-extra-row-v85.html']:
    p=WWW/name
    if p.exists(): shutil.copy2(p,BACK/(name+'.before'))

# Saved clips: fixed visual cards + lazy representative snapshots.
p=WWW/'c720p-drive-saved.html'
s=p.read_text(encoding='utf-8')
css='''<style id="C720P_SAVED_VISUAL_CARDS_V88">
.list{grid-template-columns:repeat(3,minmax(0,1fr))!important;grid-auto-rows:238px!important;gap:11px!important;align-content:start!important}
.clip{height:238px!important;display:grid!important;grid-template-rows:150px minmax(0,1fr)!important;overflow:hidden!important;background:linear-gradient(180deg,#0c1822,#081119)!important}
.thumbWrap{position:relative;width:100%;height:150px;overflow:hidden;background:linear-gradient(110deg,#0d1821 20%,#142432 40%,#0d1821 60%);background-size:200% 100%;animation:c720pThumbPulse 1.5s ease-in-out infinite}
@keyframes c720pThumbPulse{0%,100%{background-position:100% 0}50%{background-position:0 0}}
.thumbWrap.loaded{animation:none;background:#03070a}
.thumb{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;aspect-ratio:auto!important;object-fit:cover!important;background:#000!important;display:block!important}
.thumbShade{position:absolute;inset:auto 0 0 0;height:48%;background:linear-gradient(transparent,rgba(0,0,0,.78));pointer-events:none}
.thumbBadges{position:absolute;left:7px;right:7px;bottom:7px;display:flex;gap:5px;align-items:center;z-index:3;pointer-events:none}
.thumbBadge{padding:4px 7px;border-radius:999px;background:rgba(3,9,14,.82);border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(5px);font-size:9px;line-height:1;font-weight:950;color:#eefaff;white-space:nowrap}
.thumbBadge.person{color:#aaf7c3;border-color:rgba(91,235,137,.38)}.thumbBadge.motion{color:#ffd28b;border-color:rgba(255,184,72,.36)}
.thumbUnavailable{position:absolute;inset:0;display:grid;place-items:center;color:#8da0b1;font-size:11px;font-weight:900;text-align:center;padding:12px}
.clipBody{min-height:0!important;padding:8px 9px 9px!important;display:grid!important;grid-template-rows:auto auto auto!important;align-content:start!important}
.clipTitle{font-size:12px!important;line-height:14px!important}.clipMeta{font-size:9px!important;line-height:1.25!important;margin-top:3px!important}
.actions{margin-top:5px!important}.actions button{padding:5px!important}
@media(max-width:1200px){.list{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
</style>'''
s=s.replace('</head>',css+'\n</head>',1)
start=s.index('<script>const $=')
end=s.index('</script></body></html>',start)
js=r'''<script>
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const q=new URLSearchParams(location.search),requested=String(q.get('camera')||'camera').toLowerCase(),backend=['camera','s9','primary','new'].includes(requested)?'new':'new';
let events=[];
function size(n){n=Number(n)||0;return n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(0,Math.round(n/1024))+' KB'}
async function u(p){return await C720PSecureRelay.url(p)}
function cleanReason(v){return String(v||'').replace(/^New camera\b/i,'Camera')}
function pct(v){const n=Number(v);return Number.isFinite(n)?Math.round(n*100):null}
function badges(e){const p=pct(e.person_confidence),h=pct(e.highlight_score);let a=[];if(p!=null)a.push('<span class="thumbBadge person">Person '+p+'%</span>');else a.push('<span class="thumbBadge motion">Motion</span>');if(h!=null)a.push('<span class="thumbBadge">Highlight '+h+'%</span>');return a.join('')}
async function selectClip(e){const v$=$('player');v$.src=await u('/'+backend+'/saved/clip/'+encodeURIComponent(e.remote_name));v$.poster=e.snapshot_name?await u('/'+backend+'/saved/snap/'+encodeURIComponent(e.snapshot_name)):'';$('playerTitle').textContent='Camera clip #'+String(e.clip_no??'');const bits=[e.timestamp,e.person_confidence!=null?Math.round(Number(e.person_confidence)*100)+'% person':null,e.highlight_score!=null?Math.round(Number(e.highlight_score)*100)+'% highlight':null,size(e.size)].filter(Boolean);$('playerMeta').textContent=bits.join(' · ')+(e.reason?' — '+cleanReason(e.reason):'');try{v$.load()}catch(_){}}
async function removeClip(e,b){if(!confirm('Delete this saved clip?'))return;b.disabled=true;b.textContent='Deleting…';try{const r=await C720PSecureRelay.fetch('/'+backend+'/api/saved/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:e.remote_name})});const d=await r.json().catch(()=>({}));if(!r.ok||d.ok===false)throw new Error(d.error||'delete failed');await load()}catch(err){b.disabled=false;b.textContent='Delete';alert('Could not delete saved clip: '+err.message)}}
function makeCard(e){
 const el=document.createElement('article');el.className='clip';
 el.innerHTML='<div class="thumbWrap"><div class="thumbUnavailable">Loading representative frame…</div><div class="thumbShade"></div><div class="thumbBadges">'+badges(e)+'</div></div>'+
 '<div class="clipBody"><div class="clipTitle">Camera clip #'+esc(e.clip_no)+'</div><div class="clipMeta">'+esc(e.timestamp||'')+' · '+esc(size(e.size))+(e.person_strong_frames!=null?' · '+esc(e.person_strong_frames)+' strong frames':'')+'</div><div class="actions"><button class="play">Play</button><button class="delete">Delete</button></div></div>';
 el.querySelector('.play').onclick=x=>{x.stopPropagation();selectClip(e)};
 el.querySelector('.delete').onclick=x=>{x.stopPropagation();removeClip(e,x.currentTarget)};
 el.onclick=()=>selectClip(e);
 return el
}
async function loadThumb(el,e){
 const wrap=el.querySelector('.thumbWrap');if(!wrap||wrap.dataset.loaded)return;wrap.dataset.loaded='1';
 if(!e.snapshot_name){wrap.querySelector('.thumbUnavailable').textContent='No representative frame';return}
 try{
   const src=await u('/'+backend+'/saved/snap/'+encodeURIComponent(e.snapshot_name));
   const img=new Image();img.className='thumb';img.alt='Representative frame for camera clip '+String(e.clip_no||'');img.decoding='async';
   img.onload=()=>{wrap.classList.add('loaded');const m=wrap.querySelector('.thumbUnavailable');if(m)m.remove()};
   img.onerror=()=>{const m=wrap.querySelector('.thumbUnavailable');if(m)m.textContent='Preview unavailable'};
   img.src=src;wrap.prepend(img);
 }catch(_){const m=wrap.querySelector('.thumbUnavailable');if(m)m.textContent='Preview unavailable'}
}
let observer=null;
function setupLazy(cards){
 if(observer)observer.disconnect();
 observer=new IntersectionObserver(entries=>{for(const en of entries){if(en.isIntersecting){const el=en.target;const idx=Number(el.dataset.idx);loadThumb(el,events[idx]);observer.unobserve(el)}}},{root:$('list'),rootMargin:'300px 0px'});
 cards.forEach((el,i)=>{el.dataset.idx=String(i);observer.observe(el)})
}
async function load(){
 $('count').textContent='loading…';
 try{
  const r=await C720PSecureRelay.fetch('/'+backend+'/api/saved?t='+Date.now(),{cache:'no-store'}),d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'archive unavailable');
  events=Array.isArray(d.events)?d.events:[];$('count').textContent=events.length+' saved';
  const list=$('list');list.replaceChildren();
  if(!events.length){list.innerHTML='<div class="empty">No saved camera clips yet.</div>';return}
  const cards=events.map(makeCard);cards.forEach(n=>list.appendChild(n));setupLazy(cards);selectClip(events[0])
 }catch(err){$('count').textContent='unavailable';$('list').innerHTML='<div class="empty">Saved clips could not be loaded.<br>'+esc(err.message)+'</div>'}
}
$('refresh').onclick=load;load();
</script>'''
s=s[:start]+js+s[end+9:]
p.write_text(s,encoding='utf-8')

# Weather: give each highlighted panel enough internal height for its labels/values.
p=WWW/'c720p-weather-compact.html'
s=p.read_text(encoding='utf-8')
wcss='''<style id="C720P_WEATHER_FIT_V88">
.cityPanel{height:47px!important;padding:4px 12px 5px!important;grid-template-rows:20px 14px!important;row-gap:1px!important;align-content:center!important}
.cityName{font-size:17px!important;line-height:19px!important}
.todayRange{font-size:9.5px!important;line-height:13px!important}
.windBand{top:95px!important;height:35px!important;padding:2px 10px!important;font-size:16px!important;line-height:18px!important}
.side{top:43px!important;bottom:64px!important;width:140px!important;grid-template-rows:repeat(3,minmax(0,1fr))!important;gap:4px!important}
.metric{padding:3px 7px!important;display:grid!important;grid-template-rows:9px minmax(0,1fr)!important;align-items:center!important;align-content:center!important;overflow:hidden!important}
.metric .label{font-size:7.5px!important;line-height:9px!important;margin:0!important}
.metric .value{font-size:15px!important;line-height:16px!important;min-height:16px!important;display:block!important;overflow:visible!important;text-overflow:clip!important}
</style>'''
s=s.replace('</head>',wcss+'\n</head>',1)
p.write_text(s,encoding='utf-8')

# Radiator: percentage remains white/outlined, battery body/border retains status color.
p=WWW/'c720p-extra-row-v85.html'
s=p.read_text(encoding='utf-8')
bcss='''<style id="C720P_BATTERY_TEXT_CONTRAST_V88">
.sensorBatt,.sensorBatt.warn,.sensorBatt.low{
 color:#fff!important;
 border-color:var(--battery-color)!important;
 -webkit-text-stroke:.45px rgba(0,0,0,.95)!important;
 text-shadow:0 1px 2px #000,0 0 2px #000!important;
 font-weight:1000!important;
}
.sensorBatt::after{background:var(--battery-color)!important}
</style>'''
s=s.replace('</head>',bcss+'\n</head>',1)
p.write_text(s,encoding='utf-8')

# Only the short Office/Voice column needs more height. Keep the already-correct others unchanged.
py=r'''import json,pathlib,shutil,time
p=pathlib.Path("/config/.storage/lovelace.c720p_hub");b=pathlib.Path("/config/.storage/lovelace.c720p_hub.before-v88-"+time.strftime("%Y%m%d_%H%M%S"));shutil.copy2(p,b)
d=json.loads(p.read_text());views=d["data"]["config"]["views"];home=next(x for x in views if x.get("path")=="home");sec=next(x for x in views if x.get("path")=="front-yard-security")
root=home["cards"][0];cols=root["cards"][0]["cards"]
voice=cols[1]["cards"][2];voice["aspect_ratio"]="35%";voice["url"]="/local/c720p-voice-banner.html?c720p_build=HOME_FILL_V88_20261007"
root["cards"][1]["url"]="/local/c720p-weather-row.html?v=WEATHER_FIT_V88_20261007"
root["cards"][2]["url"]="/local/c720p-extra-row-v85.html?v=BATTERY_CONTRAST_V88_20261007"
sec["cards"][0]["url"]="/local/c720p-surveillance.html?v=CAMERA_SAVED_V88_20261007"
tmp=p.with_suffix(".tmp-v88");tmp.write_text(json.dumps(d,separators=(",",":")));tmp.replace(p)
print("VOICE_ASPECT="+voice["aspect_ratio"]);print("BACKUP="+str(b))'''
r=subprocess.run(['docker','exec','homeassistant','python3','-c',py],text=True,capture_output=True,timeout=30)
if r.returncode!=0: raise SystemExit(r.stdout+r.stderr)
print(r.stdout.strip())

# Cache bump and HA reload.
rr=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if rr.returncode!=0: raise SystemExit('HA restart failed: '+rr.stdout+rr.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}: break
    time.sleep(1)
else: raise SystemExit('HA did not return')
print('BACKUP_DIR='+str(BACK))
print('RESULT=HOME_V88_APPLIED')
