/* S9_NIGHT_VISIBILITY_V1
 * Browser-only low-light display enhancement for S9+ live MJPEG.
 * Source 4K MP4s, original sensor JPEGs, person tracking and exposure
 * remain untouched. Never sends control commands or accesses video pixels.
 */
(()=>{
  'use strict';
  if(document.getElementById('s9-night-visibility-v1'))return;
  const live=document.getElementById('cameraLive');
  const section=document.getElementById('panel-live');
  if(!live||!section)return;

  const ui=document.createElement('div');
  ui.id='s9-night-visibility-v1';
  ui.setAttribute('role','group');
  ui.setAttribute('aria-label','Nighttime live picture visibility');
  ui.style.cssText='display:flex;align-items:center;flex-wrap:wrap;gap:9px;padding:10px 13px;margin:10px 0;border:1px solid #416071;border-radius:11px;background:#152633;color:#f0fbff;font:12px/1.45 system-ui,sans-serif';

  const label=document.createElement('label');
  label.htmlFor='s9-night-visibility-mode';
  label.textContent='Night visibility · screen only';
  label.style.cssText='font-weight:700;white-space:nowrap';
  const mode=document.createElement('select');
  mode.id='s9-night-visibility-mode';
  mode.setAttribute('aria-label','Night visibility mode');
  mode.style.cssText='padding:7px 8px;border-radius:7px;border:1px solid #587381;background:#0c1d28;color:#e8f8ff';
  for(const [value,name] of [['auto','Auto'],['enhanced','Enhanced'],['original','Original']]){
    const option=document.createElement('option');
    option.value=value;option.textContent=name;mode.appendChild(option);
  }

  const gainLabel=document.createElement('label');
  gainLabel.htmlFor='s9-night-visibility-strength';
  gainLabel.textContent='Screen gain';
  gainLabel.style.cssText='white-space:nowrap';
  const gain=document.createElement('input');
  gain.id='s9-night-visibility-strength';
  gain.type='range';gain.min='1.4';gain.max='3.6';gain.step='0.1';gain.value='2.7';
  gain.style.cssText='width:105px;accent-color:#76dcec';
  const gainValue=document.createElement('span');
  gainValue.style.minWidth='33px';
  const state=document.createElement('span');
  state.id='s9-night-visibility-status';
  state.setAttribute('aria-live','polite');
  state.style.cssText='color:#afcbd2;margin-left:auto;min-width:150px';

  ui.append(label,mode,gainLabel,gain,gainValue,state);
  const anchor=document.getElementById('liveDiagnostics');
  if(anchor&&anchor.parentNode===section) section.insertBefore(ui,anchor);
  else section.appendChild(ui);

  let nightActive=null;
  let inflight=false;
  let ended=false;
  const apply=()=>{
    const enhanced=mode.value==='enhanced'||(mode.value==='auto'&&nightActive===true);
    const value=Math.max(1.4,Math.min(3.6,Number(gain.value)||2.7));
    live.style.filter=enhanced?'brightness('+value.toFixed(1)+') saturate(.88)':'';
    live.dataset.nightVisibility=enhanced?'enhanced':'original';
    gain.disabled=!enhanced;gainLabel.style.opacity=enhanced?'1':'.5';
    gainValue.textContent=value.toFixed(1)+'×';
    state.textContent=nightActive===null?
      (enhanced?'Enhanced display · sensor state unavailable':'Raw image · sensor state unavailable'):
      ((nightActive?'Sensor night active':'Sensor night inactive')+
       ' · '+(enhanced?'enhanced display':'original display'));
  };
  mode.addEventListener('change',apply);
  gain.addEventListener('input',apply);
  apply();

  const refresh=async()=>{
    if(ended||inflight||document.hidden)return;
    const relay=window.C720PSecureRelay;
    if(!relay||typeof relay.fetch!=='function')return;
    inflight=true;
    try{
      const response=await relay.fetch('/new/camera-controls',{cache:'no-store'});
      if(!response.ok)return;
      const result=await response.json();
      const active=result&&result.night_active;
      if(typeof active==='boolean'){nightActive=active;apply();}
    }catch(_){
      /* Existing stream stays untouched if control telemetry is unavailable. */
    }finally{inflight=false;}
  };
  refresh();
  const refreshTimer=setInterval(refresh,16000);
  window.addEventListener('pagehide',()=>{
    ended=true;clearInterval(refreshTimer);live.style.filter='';
  },{once:true});
})();
