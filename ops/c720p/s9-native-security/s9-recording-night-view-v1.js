/* S9_RECORDING_NIGHT_VIEW_V1
 * Optional display-only enhancement for one recorded-video HTML5 player.
 * The original MP4 bytes, video decoder, full-frame playback, screenshots,
 * face/person metadata, events and archive are never modified.
 */
(()=>{
 'use strict';
 const player=document.getElementById('player');
 const stage=player&&player.closest('main.stage');
 if(!player||!stage||document.getElementById('s9-recording-night-controls-v1'))return;
 const make=(tag,style='')=>{
  const n=document.createElement(tag);
  if(style)n.style.cssText=style;
  return n;
 };
 const root=make('details','position:absolute;right:12px;top:66px;z-index:8;max-width:min(288px,calc(100% - 24px));background:rgba(9,24,37,.92);color:#edfaff;border:1px solid #56869a;border-radius:10px;padding:7px 10px;box-shadow:0 3px 15px #0009;font:12px/1.4 system-ui,sans-serif');
 root.id='s9-recording-night-controls-v1';
 root.setAttribute('aria-label','Playback night visibility; original video is unchanged');
 const summary=make('summary','font-weight:700;cursor:pointer;white-space:nowrap');
 summary.textContent='Night playback · Original';
 const content=make('div','display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:9px');
 const select=make('select','border:1px solid #668da0;border-radius:6px;background:#102837;color:#f4fcff;font:inherit;padding:6px');
 select.setAttribute('aria-label','Playback display mode');
 select.id='s9-recording-night-mode-v1';
 for(const [value,title] of [['original','Original'],['enhanced','Enhanced']]){
  const o=document.createElement('option');o.value=value;o.textContent=title;select.appendChild(o);
 }
 const gain=make('input','width:80px;accent-color:#8de1ef');
 gain.type='range';gain.min='1.4';gain.max='3.6';gain.step='0.1';gain.value='2.7';
 gain.id='s9-recording-night-gain-v1';
 gain.setAttribute('aria-label','Playback brightness gain');
 const gainLabel=make('span','min-width:29px;color:#e1f4ff');
 const info=make('div','margin-top:7px;color:#a9c6d0;font-size:10px');
 info.textContent='Screen only · original MP4 and detection unchanged';
 content.append(select,gain,gainLabel);
 root.append(summary,content,info);
 stage.appendChild(root);

 const apply=()=>{
  const on=select.value==='enhanced';
  const value=Math.min(3.6,Math.max(1.4,Number(gain.value)||2.7));
  player.style.filter=on?'brightness('+value.toFixed(1)+') saturate(.88)':'';
  player.dataset.nightPlayback=on?'enhanced':'original';
  gain.disabled=!on;
  gainLabel.textContent=on?value.toFixed(1)+'×':'—';
  summary.textContent='Night playback · '+(on?'Enhanced':'Original');
 };
 const reset=()=>{
  // A new clip is unmodified by default, avoiding misleading daytime playback.
  select.value='original';root.open=false;apply();
 };
 select.addEventListener('change',apply);
 gain.addEventListener('input',apply);
 player.addEventListener('loadedmetadata',reset);
 window.addEventListener('pagehide',()=>{player.style.filter='';},{once:true});
 apply();
})();
