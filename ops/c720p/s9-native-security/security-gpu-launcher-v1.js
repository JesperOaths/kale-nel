/* S9+ C720P opt-in WebGL performance player, protected by existing Security relay.
 * No external network. Native originals remain the default and rollback.
 */
(()=>{
'use strict';
if(window.__S9GpuLauncherV1)return;
window.__S9GpuLauncherV1=true;
const MATCH=/(motion_[0-9]{13}[.]mp4|rec_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}[.]mp4)/;
const FILE=/^(?:motion_[0-9]{13}|rec_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2})[.]mp4$/;
const restored=new Map();
let layer=null;
function lookup(video){
 const url=String(video.currentSrc||video.src||'');
 const found=url.match(MATCH);
 if(found&&FILE.test(found[1]))return found[1];
 const parent=video.closest('.detail,article,.clip-card,.recording-card');
 const text=parent?.textContent||'';
 const m=text.match(MATCH);
 return m&&FILE.test(m[1])?m[1]:'';
}
function hide(){
 if(!layer)return;
 const old=layer;layer=null;
 old.remove();
 for(const [el,previous] of restored){
  if(el.isConnected){
   el.style.visibility=previous.visibility;
   if(previous.aria===null)el.removeAttribute('aria-hidden');
   else el.setAttribute('aria-hidden',previous.aria);
  }
 }
 restored.clear();
}
function open(video){
 const clip=lookup(video);
 if(!clip)return;
 hide();
 for(const v of document.querySelectorAll('video'))v.pause();
 const parent=document.body;
 layer=document.createElement('section');
 layer.id='s9-gpu-performance-layer';
 layer.style.cssText='position:fixed;inset:0;z-index:2147483450;background:#0a1119;display:block;';
 layer.setAttribute('role','dialog');
 layer.setAttribute('aria-label','GPU-accelerated Security playback');
 const iframe=document.createElement('iframe');
 iframe.title='25 FPS performance player for '+clip;
 iframe.style.cssText='height:100%;width:100%;border:0;display:block;background:#0a1119';
 iframe.allow='fullscreen';
 iframe.src='/local/frontyard-security-new/gpu-performance-player-v1.html?clip='+encodeURIComponent(clip);
 layer.append(iframe);
 for(const child of [...parent.children]){
  if(child===layer||child.tagName==='SCRIPT'||child.tagName==='STYLE')continue;
  restored.set(child,{visibility:child.style.visibility,aria:child.getAttribute('aria-hidden')});
  child.style.visibility='hidden';child.setAttribute('aria-hidden','true');
 }
 parent.append(layer);
}
function add(video){
 if(video.dataset.s9GpuLauncher)return;
 video.dataset.s9GpuLauncher='true';
 const b=document.createElement('button');
 b.type='button';
 b.className='s9-gpu-launch';
 b.style.cssText='display:inline-flex;align-items:center;gap:6px;margin:8px 0 10px;border:1px solid #4a8793;background:#16423d;color:#e1ffed;padding:8px 11px;border-radius:8px;font:600 12px system-ui;cursor:pointer';
 b.textContent='GPU performance · target 25 FPS';
 b.title='Open a lightweight 320×180 GPU playback copy; original 4K remains available here';
 b.onclick=()=>{if(!lookup(video)){b.textContent='Open a saved recording first';return}open(video)};
 try{video.insertAdjacentElement('afterend',b)}catch(_){}
}
const watch=new MutationObserver(()=>document.querySelectorAll('video').forEach(add));
watch.observe(document.documentElement,{childList:true,subtree:true});
document.querySelectorAll('video').forEach(add);
window.addEventListener('message',event=>{
 if(event.origin!==location.origin)return;
 if(event.data?.kind==='s9-gpu-performance-close-v1')hide();
});
window.addEventListener('pagehide',()=>{watch.disconnect();hide()});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&layer){hide();event.preventDefault()}});
try{
 window.top.document.addEventListener('click',event=>{
  if(event.target.closest?.('#s9v5-nav button[data-view]')&&layer)hide();
 });
}catch(_){}
})();
