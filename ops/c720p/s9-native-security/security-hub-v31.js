/* s9-people-v45-real-route */
/* s9-real-people-faces-v43 · real Home Assistant People & Faces route */
/* SECURITY_HUB_V30: unified navigation and camera controls. */
(()=>{'use strict';
const $=id=>document.getElementById(id),asset='/local/frontyard-security-new/',version='v=component-health-20261020-v1';
const tabs=[['live','Live camera','◉'],['saved','Recordings','▣','security-review-v8.html?mode=today&v=security-original-segments-v61-20261019&'],['faces','People & faces','◎','security-people-v50.html?v=people-faces-sorting-v320c-20261021&'],['tracks','Tracks & movement','◇','security-tracks-v50.html?v=security-visible-route-v58-20261018&'],['evidence','Evidence & analytics','▤','security-review-v8.html?mode=evidence&v=security-original-segments-v61-20261019&'],['archive','Archive','▤','security-archive-v7.html?v=security-archive-grid-v52-20261018&'],['camera','Camera controls','⚙']];
let current='live',liveData=null,healthBusy=false,controlsBusy=false,controlGeneration=0;
const create=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n};
const api=()=>window.C720PSecureRelay;
const embeddedTabs=new WeakSet();
const paneFor=id=>$(id==='camera'?'panel-controls':'panel-'+id);
function stopMedia(pane){if(!pane)return;try{const doc=pane.querySelector('iframe')?.contentDocument;doc?.querySelectorAll('video').forEach(v=>{doc.defaultView?.C720PSecurityVideo?.suspendPlayer(v);v.pause()});doc?.querySelectorAll('dialog[open]').forEach(d=>d.close());doc?.defaultView?.postMessage({kind:'s9-gpu-performance-close-v1'},location.origin)}catch(_){} }
function live(on){const image=$('cameraLive'),video=window.C720PSecurityVideo;if(!video)return;on?video.startLive(image,{status:$('cameraStatus')}):video.stopLive(image)}
function show(id){if(!tabs.some(t=>t[0]===id))return;current=id;$('s9v5-shell').dataset.view=id;
 for(const t of tabs){const selected=t[0]===id,pane=paneFor(t[0]);pane.hidden=!selected;pane.classList.toggle('s9v5-active',selected);if(!selected)stopMedia(pane);const b=$('s9v5-nav').querySelector('[data-view="'+t[0]+'"]');b.setAttribute('aria-current',selected?'page':'false')}
 $('s9v5-title').textContent=tabs.find(t=>t[0]===id)[1];const frame=paneFor(id).querySelector('iframe');if(frame&&!frame.getAttribute('src'))frame.src=frame.dataset.src;
 for(const [key] of tabs){const f=paneFor(key).querySelector('iframe');if(f?.contentWindow)f.contentWindow.postMessage({kind:'security-tab-visibility-v37',active:key===id},location.origin)}
 live(id==='live'&&!document.hidden);if(id==='camera'){loadControls();diagnostics()}
}
// SECURITY_UI_NATIVE_CAPTURE_CONTINUITY_V1: preference and readiness are separate.
function nativeCaptureDiagnostics(d){
 const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
 return [
  ['Native recording',d.native_4k_enabled===true?'4K enabled':d.native_4k_enabled===false?'4K disabled':'Not reported'],
  ['4K capture readiness',d.continuous_4k_ready===true?'Ready':d.continuous_4k_ready===false?'Not ready':'Not reported'],
  ['4K buffer',finite(d.continuous_4k_buffered_ms)?(d.continuous_4k_buffered_ms/1000).toFixed(1)+' seconds':'Not reported'],
  ['Dropped 4K output frames',finite(d.continuous_4k_dropped_output_frames)&&Number.isSafeInteger(d.continuous_4k_dropped_output_frames)?String(d.continuous_4k_dropped_output_frames):'Not reported']
 ];
}
function diagnostics(){const d=liveData||{},s=d.camera_sensor||{},root=$('diagnostics');root.replaceChildren();const rows=[['Recorder',d.camera_mode||'Not available'],...nativeCaptureDiagnostics(d),['Person detector',d.person_inference_ready===true?'Active on S9+':d.person_inference_ready===false?'Not ready':'Not reported'],['Sensor cadence',Number(s.fps)>0?Number(s.fps).toFixed(1)+' fps':'Not measured'],['Exposure',s.exposure_ms!=null?Number(s.exposure_ms).toFixed(1)+' ms':'Not measured'],['Battery temperature',d.camera_temperature_c!=null?Number(d.camera_temperature_c).toFixed(1)+' °C':'Not reported'],['Sample age',d.last_sample_age_ms!=null?Math.round(Number(d.last_sample_age_ms)/1000)+' seconds':'Not reported']];
 for(const target of [root,$('liveDiagnostics')]){target.replaceChildren();for(const [label,value]of rows)target.append(create('dt','',label),create('dd','',value));}}
async function refreshHealth(){if(healthBusy||document.hidden)return;healthBusy=true;const el=$('cameraHealth');try{if(!api()?.fetch)throw Error('connection');const r=await api().fetch('/new/api/live-person-watch',{cache:'no-store'});if(!r.ok)throw Error('status');const d=await r.json();const age=Number(d.last_sample_age_ms);if(!d.ok||!['watching','recording'].includes(d.camera_mode)||(d.last_sample_age_ms!=null&&(!Number.isFinite(age)||age>45000||age<0)))throw Error('stale');liveData=d;el.textContent=d.camera_mode==='recording'?'S9+ recording':'S9+ watching';el.dataset.state='ok';if(current==='camera'||current==='live')diagnostics()}
 catch(_){liveData=null;el.textContent='Camera status unavailable';el.dataset.state='error';if(current==='camera'||current==='live')diagnostics()}
 finally{healthBusy=false}}
const labels={night_mode:['Sensor night mode','Native camera night policy'],zoom:['Zoom','Camera magnification'],exposure_ev:['Exposure compensation','Brightness adjustment in EV'],focus:['Focus','Automatic focus mode'],torch:['Camera light','Phone torch']};
function display(key,value){if(key==='night_mode')return ({auto:'Automatic',on:'On',off:'Off'})[value]||String(value);if(key==='zoom')return value+'×';if(key==='exposure_ev')return (Number(value)>0?'+':'')+value+' EV';if(key==='torch')return value==='on'?'On':'Off';if(key==='focus')return value==='continuous'?'Continuous autofocus':'Autofocus';return String(value)}
async function loadControls(){if(controlsBusy)return;controlsBusy=true;const generation=++controlGeneration,box=$('cameraControls'),msg=$('cameraControlMsg');msg.textContent='Reading camera settings…';try{const r=await api()?.fetch('/new/camera-controls',{cache:'no-store'});if(!r?.ok)throw Error('Camera connection unavailable');const d=await r.json();if(!d.ok)throw Error('Camera settings unavailable');if(generation!==controlGeneration)return;const locked=d.mode==='recording'&&!d.can_change_while_recording;box.replaceChildren();
 for(const [key,c]of Object.entries(d.controls||{})){if(!labels[key])continue;const row=create('label','ctl',labels[key][0]),sel=create('select');sel.setAttribute('aria-label',labels[key][0]);const values=Array.isArray(c.available)?c.available:[];
 for(const value of values){const op=create('option','',display(key,String(value)));op.value=String(value);op.selected=String(value)===String(c.value);sel.append(op)}
 if(!values.length){const op=create('option','',c.value??'Unavailable');op.value=String(c.value??'');sel.append(op)}sel.disabled=locked||!values.length;row.append(sel,create('small','',labels[key][1]));box.append(row);
 sel.addEventListener('change',async()=>{box.querySelectorAll('select').forEach(s=>s.disabled=true);msg.textContent='Applying '+labels[key][0].toLowerCase()+'…';try{const result=await api().fetch('/new/camera-control',{method:'POST',headers:{'content-type':'application/json','X-S9-Camera-Control-Intent':'explicit-user-selection-v1'},body:JSON.stringify({key,value:sel.value})});const x=await result.json();if(!result.ok||!x.ok)throw Error(x.error||'Camera rejected the setting');await loadControls();msg.textContent=labels[key][0]+' set to '+display(key,String(x.value??sel.value))}
 catch(e){await loadControls();msg.textContent='Setting not applied: '+String(e.message)} });}
 if(!box.children.length)throw Error('Camera reported no supported settings');msg.textContent=locked?'Recording in progress. Settings will be available when it finishes.':'Current settings read from the S9+.';
 }catch(e){box.replaceChildren();msg.textContent=String(e.message||'Camera settings unavailable')+'. Use Reload settings to try again.'}
 finally{controlsBusy=false}}
for(const [id,label,icon,file]of tabs){const b=create('button');b.type='button';b.dataset.view=id;b.title=label;b.setAttribute('aria-controls',id==='camera'?'panel-controls':'panel-'+id);b.append(create('span','nav-icon',icon),create('span','',label));b.addEventListener('click',()=>show(id));$('s9v5-nav').append(b);if(file){const pane=create('section','pane');pane.id='panel-'+id;pane.hidden=true;const f=create('iframe');f.title=label;f.dataset.src=asset+file+version;pane.append(f);$('s9v5-stage').append(pane)}}
$('home').addEventListener('click',()=>{const target='/c720p-hub/home';try{if(window.top===window)location.assign(target);else{window.top.history.pushState(null,'',target);window.top.dispatchEvent(new window.top.Event('location-changed'))}}catch(_){location.assign(target)}});
$('retryControls').addEventListener('click',loadControls);$('refresh').addEventListener('click',()=>{refreshHealth();if(current==='camera')loadControls();else if(current==='live'){live(false);live(true)}else{const f=paneFor(current).querySelector('iframe');if(f){if(embeddedTabs.has(f))f.contentWindow.postMessage({kind:'security-tab-refresh-v37'},location.origin);else f.src=f.dataset.src}}});
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.kind==='archive-review-open-v32'&&event.source===paneFor('faces').querySelector('iframe')?.contentWindow)show('archive')});
document.addEventListener('visibilitychange',()=>{live(current==='live'&&!document.hidden);if(document.hidden)stopMedia(paneFor(current));else refreshHealth()});window.addEventListener('pagehide',()=>live(false));
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.data?.kind!=='security-tab-ready-v37')return;for(const [key] of tabs){const f=paneFor(key).querySelector('iframe');if(f?.contentWindow===event.source){embeddedTabs.add(f);event.source.postMessage({kind:'security-tab-visibility-v37',active:key===current},location.origin)}}});
$('panel-live').tabIndex=0;$('liveRecordings').onclick=()=>show('saved');$('liveSettings').onclick=()=>show('camera');
show('live');refreshHealth();setInterval(refreshHealth,15000);setInterval(()=>{if(current==='camera'&&!document.hidden&&!controlsBusy&&!$('cameraControls').contains(document.activeElement))loadControls()},15000);
})();

// SECURITY_COMPONENT_HEALTH_UI_V1: independent metadata reports, never capture readiness.
(()=>{'use strict';
 const live=document.getElementById('panel-live'),controls=document.getElementById('panel-controls');
 const liveHost=live?.querySelector('.live-below'),controlHost=controls?.querySelector('.controls');
 if(!liveHost||!controlHost||document.getElementById('security-component-health-live'))return;
 const create=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 const panels=[];
 for(const [name,host]of [['live',liveHost],['controls',controlHost]]){
  const panel=create('section');panel.id='security-component-health-'+name;
  panel.setAttribute('aria-label','System status');
  panel.style.cssText='grid-column:1/-1;min-width:0;margin-top:16px;padding:14px;border:1px solid #3d5d6d;border-radius:12px;background:#122733;color:#eef8ff;overflow-wrap:anywhere';
  const title=create('h2','System status');title.style.cssText='font-size:17px;margin:0 0 8px';
  const summary=create('p','Checking independent system reports…');summary.setAttribute('role','status');
  const rows=create('dl');rows.style.cssText='display:grid;grid-template-columns:minmax(100px,auto) 1fr;gap:7px 14px;font-size:12px;line-height:1.5';
  const note=create('p','Read-only reports. Capture status is shown separately. Appearance and pose observations do not confirm a person’s identity.');note.style.cssText='font-size:12px;color:#b4cbd4;margin:10px 0 0';
  panel.append(title,summary,rows,note);host.append(panel);panels.push({summary,rows});
 }
 const nonnegative=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
 const count=x=>nonnegative(x)&&Number.isSafeInteger(x)?x:null;
 const number=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
 const boolean=x=>typeof x==='boolean'?x:null;
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const fields={
  infrastructure:{counts:['root_available_bytes','root_total_bytes','original_digest_matches','original_digest_mismatches','originals_indexed'],numbers:['external_clock_minus_hub_seconds'],booleans:['ntp_synchronized','original_integrity_coverage_complete']},
  evidence:{counts:['recordings_indexed','tracked_observations','observations_with_colour','observations_with_direction','observations_with_measured_posture','observations_with_measured_gait_cadence','face_supported_candidates','unassigned_appearances'],numbers:[],booleans:[]},
  saved_timing:{counts:['paired_recordings'],numbers:[],booleans:['reported_complete','joint_same_recording_required','full_frame_decode_verified']}
 };
 function contract(data){
  if(!object(data)||data.ok!==true||data.schema_version!=='security_component_health_v1'||!object(data.components)||typeof data.observed_at_utc!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(data.observed_at_utc)||!Number.isFinite(Date.parse(data.observed_at_utc)))return null;
  // Treat old aggregate snapshots as history, even when their individual
  // component status said "current" at the original time of publication.
  const ageSeconds=(Date.now()-Date.parse(data.observed_at_utc))/1000;
  if(!Number.isFinite(ageSeconds)||ageSeconds < -180)return null;
  const aggregateStale=ageSeconds>300;
  const result={aggregate_age_seconds:Math.max(0,Math.floor(ageSeconds)),aggregate_stale:aggregateStale};
  for(const [key,types]of Object.entries(fields)){
   const raw=data.components[key];if(!object(raw)||!['current','stale','unavailable'].includes(raw.status)||!(raw.age_seconds===null||nonnegative(raw.age_seconds)))return null;
   const row={status:aggregateStale&&raw.status==='current'?'stale':raw.status,age_seconds:raw.age_seconds};
   for(const [kind,names]of Object.entries(types))for(const name of names){
    const value=raw[name],parsed=kind==='counts'?count(value):kind==='numbers'?number(value):boolean(value);
    if(value!==undefined&&value!==null&&parsed===null)return null;
    row[name]=parsed;
   }
   result[key]=row;
  }
  const p=data.pipeline_summary;
  const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
  const tri=x=>x===null||typeof x==='boolean';
  const ct=x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000;
  if(obj(p)&&p.schema_version==='security_ui_pipeline_summary_v1'&&p.state==='reported'&&
     obj(p.rescan)&&obj(p.s3)&&obj(p.manual_binding)){
    const r=p.rescan,s=p.s3,m=p.manual_binding;
    const counts=['revision','tracked','pending','processing','completed','blocked','rejected','dead_letter'];
    const valid=counts.every(k=>ct(r[k]))&&['reported','current','stale','unavailable'].includes(r.state)&&
      tri(r.worker_activity_verified)&&tri(r.results_current_source_verified)&&
      r.pending+r.processing+r.completed+r.blocked+r.rejected+r.dead_letter<=r.tracked&&
      ['reported','current','stale','unavailable'].includes(s.state)&&
      tri(s.healthy)&&tri(s.motion_analysis_active)&&tri(s.motion_health_verified)&&
      tri(s.privacy_adb_port_closed_recently)&&
      (s.age_seconds===null||ct(s.age_seconds))&&
      ['reported','current','stale','unavailable'].includes(m.state)&&
      ['revision','decisions','reported_bound_at_decision','without_reported_binding'].every(k=>ct(m[k]))&&
      m.reported_bound_at_decision+m.without_reported_binding<=m.decisions&&
      tri(m.current_source_binding_verified)&&tri(m.live_write_binding_verified);
    if(valid)result.pipeline_summary=p;
  }
  return result;
 }
 const known=x=>x===null?'Not reported':String(x);
 const yes=x=>x===true?'Yes':x===false?'No':'Not reported';
 const age=x=>x===null?'age unknown':x<60?Math.floor(x)+' seconds old':x<3600?Math.floor(x/60)+' minutes old':Math.floor(x/3600)+' hours old';
 const report=row=>({current:'Current',stale:'Stale',unavailable:'Unavailable'})[row.status]+' · '+age(row.age_seconds);
 const bytes=x=>x===null?'Not reported':x<1073741824?(x/1048576).toFixed(0)+' MiB':(x/1073741824).toFixed(1)+' GiB';
 function storageAlert(i){
  if(i.root_available_bytes===null||i.root_total_bytes===null||i.root_total_bytes<=0)
   return 'Storage capacity unavailable; capture headroom not verified';
  if(i.root_available_bytes===0)
   return i.status==='current'
    ?'CRITICAL: Root filesystem full (0 MiB available); media work must be deferred'
    :'Last report: root filesystem full (0 MiB available); current status unverified';
  if(i.root_available_bytes<2147483648||i.root_available_bytes/i.root_total_bytes<0.10)
   return i.status==='current'
    ?'Storage headroom is low'
    :'Last report: storage headroom was low; current status unverified';
  return i.status==='current'?null:'Storage headroom from stale report; current status unverified';
 }
 function render(data){
  const rows=[];let summary='System reports unavailable';
  if(data){
   const i=data.infrastructure,e=data.evidence,t=data.saved_timing;
   const storage=storageAlert(i);
   const mismatch=i.original_digest_mismatches!==null&&i.original_digest_mismatches>0;
   const warnings=[];
   if(data.report_transport_error)warnings.push('Private health request failed; showing last known report only');
   if(data.aggregate_stale)warnings.push('Private aggregate report is stale; current recording health is unverified');
   if(storage)warnings.push(storage);
   if(i.ntp_synchronized===false)warnings.push('Clock is not synchronized');
   else if(i.ntp_synchronized===null)warnings.push('Clock synchronization unknown');
   if(i.external_clock_minus_hub_seconds!==null&&Math.abs(i.external_clock_minus_hub_seconds)>30)warnings.push('Clock offset exceeds 30 seconds');
   if(mismatch)warnings.push('Original integrity mismatch requires review');
   else if(i.original_digest_mismatches===null)warnings.push('Original integrity evidence unavailable');
   if(t.reported_complete===false||t.joint_same_recording_required===false)warnings.push('Saved timing checks require review');
   if([i,e,t].some(x=>x.status!=='current'))warnings.push('Some reports are stale or unavailable');
   summary=warnings.length?warnings.join(' · '):'Independent reports loaded';
   rows.push(['Aggregate report',data.aggregate_stale?'Stale · last update '+age(data.aggregate_age_seconds):'Last update '+age(data.aggregate_age_seconds)],
    ['Infrastructure report',report(i)],['Storage',(i.status==='current'?'Current':'Last reported')+' · '+bytes(i.root_available_bytes)+' free of '+bytes(i.root_total_bytes)],
    ['Clock','Synchronized: '+yes(i.ntp_synchronized)+' · External clock offset: '+(i.external_clock_minus_hub_seconds===null?'Not reported':i.external_clock_minus_hub_seconds.toFixed(1)+' seconds')],
    ['Original integrity','Digest matches: '+known(i.original_digest_matches)+' · Mismatches: '+known(i.original_digest_mismatches)+' · Hash coverage complete: '+yes(i.original_integrity_coverage_complete)+' · Originals indexed: '+known(i.originals_indexed)],
    ['Evidence report',report(e)],['Observation coverage','Recordings: '+known(e.recordings_indexed)+' · Tracked observations: '+known(e.tracked_observations)+' · Colour: '+known(e.observations_with_colour)+' · Direction: '+known(e.observations_with_direction)],
    ['Pose coverage','Measured posture: '+known(e.observations_with_measured_posture)+' · Measured gait cadence: '+known(e.observations_with_measured_gait_cadence)],
    ['Review coverage','Supported face candidates: '+known(e.face_supported_candidates)+' · Unassigned appearances: '+known(e.unassigned_appearances)],
    ['Saved timing report',report(t)],['Saved timing checks','Reported complete: '+yes(t.reported_complete)+' · Paired recordings: '+known(t.paired_recordings)+' · Same-recording pairing required: '+yes(t.joint_same_recording_required)+' · Full-frame decoding verified: '+yes(t.full_frame_decode_verified)]);
  }else rows.push(['Reports','Unavailable · no current system report could be read']);
  if(data){
    const p=data.pipeline_summary;
    const flag=x=>data.aggregate_stale?'Unknown (stale report)':x===true?'Verified':x===false?'Not verified':'Unknown';
    if(p){
      const r=p.rescan,s=p.s3,m=p.manual_binding;
      rows.push(['Rescan queue',(data.aggregate_stale?'Last reported: ': '')+r.state+' · '+r.tracked+' tracked · '+r.pending+' pending · '+r.completed+' completed · '+r.blocked+' blocked']);
      rows.push(['Rescan provenance','Worker activity: '+flag(r.worker_activity_verified)+' · Original-source evidence current: '+flag(r.results_current_source_verified)+' · Per-record blocked reasons/revocations unavailable in this aggregate']);
      rows.push(['Bedroom S3 motion',!data.aggregate_stale&&s.motion_health_verified===true?'Verified · camera '+flag(s.healthy)+' · analysis '+flag(s.motion_analysis_active):'UNKNOWN · private motion/heartbeat not independently verified']);
      rows.push(['Manual review media binding',m.without_reported_binding+' historical/unbound of '+m.decisions+' decisions · future writer: '+flag(m.live_write_binding_verified)+' · current original digest: '+flag(m.current_source_binding_verified)]);
      if(r.results_current_source_verified!==true||m.live_write_binding_verified!==true||s.motion_health_verified!==true){
        summary+=' · Rescan, digest binding or S3 evidence unverified';
      }
    }else{
      rows.push(['Rescan, S3 and manual binding','Unavailable · no verified private aggregate']);
      summary+=' · Some processing evidence unavailable';
    }
  }
  for(const panel of panels){panel.summary.textContent=summary;panel.rows.replaceChildren();for(const [label,value]of rows)panel.rows.append(create('dt','',label),create('dd','',value));}
 }
 function degradedSnapshot(last){
  if(!last)return null;
  const downgrade=row=>({...row,status:row.status==='current'?'stale':row.status});
  return {...last,aggregate_stale:true,report_transport_error:true,
   aggregate_age_seconds:Math.max(301,last.aggregate_age_seconds||0),
   infrastructure:downgrade(last.infrastructure),
   evidence:downgrade(last.evidence),
   saved_timing:downgrade(last.saved_timing)};
 }
 let lastGood=null;
 let busy=false,ended=false,lastAttempt=null;
 const visible=()=>!ended&&!document.hidden&&(!live.hidden||!controls.hidden);
 async function refresh(){
  const now=performance.now();if(!visible()||busy||(lastAttempt!==null&&now-lastAttempt<60000))return;
  const relay=window.C720PSecureRelay;if(typeof relay?.fetch!=='function')return;
  busy=true;lastAttempt=now;const controller=new AbortController();let timeout;
  try{
   const deadline=new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(Error('report_timeout'));},10000);});
   const read=async()=>{
    const response=await relay.fetch('/new/api/security-component-health',{cache:'no-store',signal:controller.signal});
    if(!response?.ok)throw Error('report_unavailable');
    const data=contract(await response.json());if(!data)throw Error('report_contract');return data;
   };
   const data=await Promise.race([read(),deadline]);
   if(!ended){lastGood=data;render(data);}
  }catch(_){if(!ended)render(degradedSnapshot(lastGood));}
  finally{clearTimeout(timeout);busy=false;}
 }
 const observer=new MutationObserver(refresh);observer.observe(live,{attributes:true,attributeFilter:['hidden']});observer.observe(controls,{attributes:true,attributeFilter:['hidden']});
 document.addEventListener('visibilitychange',refresh);
 let timer=setInterval(refresh,15000);
 window.addEventListener('pagehide',()=>{ended=true;clearInterval(timer);timer=null;observer.disconnect();});
 window.addEventListener('pageshow',()=>{ended=false;observer.observe(live,{attributes:true,attributeFilter:['hidden']});observer.observe(controls,{attributes:true,attributeFilter:['hidden']});if(timer===null)timer=setInterval(refresh,15000);refresh();});
 refresh();
})();
