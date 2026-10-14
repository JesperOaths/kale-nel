/* C720P_SECURITY_SMOOTH_VIDEO_V1. Shared by all Security players and Home live. */
(()=>{
'use strict';
if(window.C720PSecurityVideo)return;
const media=HTMLMediaElement.prototype,image=HTMLImageElement.prototype;
const mediaSrc=Object.getOwnPropertyDescriptor(media,'src');
const imageSrc=Object.getOwnPropertyDescriptor(image,'src');
const nativeLoad=media.load,nativePlay=media.play;
const nativeSet=Element.prototype.setAttribute,nativeRemove=Element.prototype.removeAttribute;
const players=new Map(),lives=new Map();
const sleep=(ms,signal)=>new Promise((resolve,reject)=>{
 const timer=setTimeout(done,ms);function done(){signal?.removeEventListener('abort',abort);resolve()}
 function abort(){clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'))}
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
});
function relay(){
 for(const w of [window,window.parent,window.top])try{if(w.C720PSecureRelay?.fetch)return w.C720PSecureRelay}catch(_){}
 throw Error('Authenticated camera relay unavailable');
}
function sourcePath(value){
 try{
  const u=new URL(String(value),location.href),path=decodeURIComponent(u.pathname);
  if(/[?&]playback=hub(?:&|$)/.test(u.search))return null;
  const signed=/^\/(new|s3)\/saved\/clip\/([A-Za-z0-9_.-]+\.mp4)$/.exec(path);
  if(signed)return '/'+signed[1]+'/saved/clip/'+encodeURIComponent(signed[2]);
  const local=/\/frontyard-security-new\/clips\/([A-Za-z0-9_.-]+\.mp4)$/.exec(path);
  if(local)return '/new/saved/clip/'+encodeURIComponent(local[1]);
 }catch(_){}
 return null;
}
function livePath(value){try{return new URL(String(value),location.href).pathname==='/new/live.mjpg'}catch(_){return false}}
function originalLocal(value){try{const u=new URL(String(value),location.href);return /\/frontyard-security-new\/clips\/[A-Za-z0-9_.-]+\.mp4$/.test(u.pathname)?u.href:''}catch(_){return ''}}
function visible(node){
 if(!node?.isConnected)return false;
 try{
  let current=node,w=window;
  for(let depth=0;depth<15;depth++){
   if(w.document.hidden)return false;
   for(let el=current;el;el=el.parentElement){const css=w.getComputedStyle(el);if(css.display==='none'||css.visibility==='hidden')return false}
   if(!current.getClientRects().length)return false;
   if(w===w.parent)break;
   current=w.frameElement;if(!current)return true;w=w.parent;
  }
  return true;
 }catch(_){return !document.hidden}
}
function pauseOthers(chosen){
 for(const state of lives.values())if(state.video&&state.video!==chosen)stopLive(state.img);
 function visit(root){
  for(const el of root.querySelectorAll('*')){
   if(el.tagName==='VIDEO'&&el!==chosen&&!el.paused)el.pause();
   if(el.shadowRoot)visit(el.shadowRoot);
   if(el.tagName==='IFRAME')try{if(el.contentDocument)visit(el.contentDocument)}catch(_){}
  }
 }
 try{visit(window.top.document)}catch(_){visit(document)}
}
const measurements=window.C720PSecurityPlaybackMetrics={version:1,players:{}};
let nextId=0;
function monitor(video){
 if(video.dataset.securityMonitor)return;
 const id=video.dataset.securityMonitor='security-video-'+(++nextId);
 let started=0,count=0,lastPresented=null,baseline=null,previousTime=null,lastPublish=0;
 const reset=()=>{started=performance.now();count=0;lastPresented=null;previousTime=null;lastPublish=0;baseline=video.getVideoPlaybackQuality?.()||null};
 function publish(){
  const now=performance.now(),elapsed=(now-started)/1000;if(!started||elapsed<1||video.paused||now-lastPublish<1000)return;lastPublish=now;
  const quality=video.getVideoPlaybackQuality?.()||{};
  const total=Math.max(0,(quality.totalVideoFrames||0)-(baseline?.totalVideoFrames||0));
  const drops=Math.max(0,(quality.droppedVideoFrames||0)-(baseline?.droppedVideoFrames||0));
  const fps=count/elapsed;
  const record={fps:Math.round(fps*100)/100,droppedFrames:drops,totalFrames:total,seconds:Math.round(elapsed*100)/100,
   profile:video.dataset.securityProfile||'source',sourceFps:Number(video.dataset.securitySourceFps)||null,
   readyState:video.readyState,width:video.videoWidth,height:video.videoHeight,paused:video.paused};
  measurements.players[id]=record;video.dataset.securityActualFps=String(record.fps);video.dataset.securityDroppedFrames=String(drops);
  const state=players.get(video);
  if(state?.text&&!state.pending&&!state.failed)state.text.textContent=state.message+' · measured '+record.fps.toFixed(1)+' fps'+(drops?' · '+drops+' dropped':'');
  const live=[...lives.values()].find(x=>x.video===video);
  if(live)liveStatus(live,'LIVE · measured '+record.fps.toFixed(1)+' fps'+(record.fps<24&&elapsed>=5?' · below 24 fps':''));
  video.dispatchEvent(new CustomEvent('security-playback-metrics',{detail:record}));
 }
 function frame(now,info){
  if(!video.paused){if(!started)reset();if(lastPresented!=null)count+=Math.max(0,info.presentedFrames-lastPresented);lastPresented=info.presentedFrames;publish()}
  if(video.isConnected)video.requestVideoFrameCallback(frame);
 }
 if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(frame);
 else video.addEventListener('timeupdate',()=>{if(previousTime!=null&&video.currentTime>previousTime){const q=video.getVideoPlaybackQuality?.();count=Math.max(0,(q?.totalVideoFrames||0)-(baseline?.totalVideoFrames||0)-(q?.droppedVideoFrames||0)+(baseline?.droppedVideoFrames||0))}previousTime=video.currentTime;publish()});
 video.addEventListener('playing',()=>{pauseOthers(video);reset()});video.addEventListener('emptied',reset);
 video.addEventListener('pause',()=>{if(measurements.players[id])measurements.players[id].paused=true});
}
function controls(video,state){
 if(state.box?.isConnected)return;
 if(!video.parentElement)return;
 const box=document.createElement('div');box.className='security-video-controls';
 box.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:#d8ecf6;font:12px sans-serif;padding:6px;position:relative;z-index:5;background:#102330';
 if(getComputedStyle(video).position==='absolute')box.style.cssText+=';position:absolute;left:0;right:0;bottom:48px;background:#102330dd';
 const select=document.createElement('select');select.setAttribute('aria-label','Video playback quality');
 for(const [value,label]of [['smooth','Smooth · 360p / 30 fps'],['original','Original recording']]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o)}
 select.value=state.mode;select.style.cssText='font:inherit;color:inherit;background:#19394a;padding:5px;border:1px solid #527c95;border-radius:5px';
 const text=document.createElement('span');text.setAttribute('role','status');text.setAttribute('aria-live','polite');
 const retry=document.createElement('button');retry.textContent='Retry';retry.hidden=true;retry.style.cssText='font:inherit;padding:5px';
 select.onchange=()=>setSource(video,state.path,{mode:select.value,play:!video.paused||state.wantPlay});
 retry.onclick=()=>setSource(video,state.path,{mode:'smooth',play:state.wantPlay});
 box.append(select,text,retry);video.insertAdjacentElement('afterend',box);
 Object.assign(state,{box,select,text,retry});renderState(state);
}
function renderState(state){
 if(state.select)state.select.value=state.mode;
 if(state.text)state.text.textContent=state.message||'';
 if(state.retry)state.retry.hidden=!state.failed||state.sourceLowFps;
}
function stopPlayer(video){
 const state=players.get(video);if(!state)return;
 state.generation++;state.abort?.abort();state.pending=false;state.wantPlay=false;
}
function suspendPlayer(video){
 const state=players.get(video),pending=state?.pending;
 stopPlayer(video);video.pause();
 if(pending){state.failed=true;state.message='Playback paused · use Retry to prepare this recording';renderState(state)}
}
async function setSource(video,path,options={}){
 let state=players.get(video);
 if(!state){state={generation:0,mode:'smooth',pending:false};players.set(video,state);monitor(video)}
 state.generation++;state.abort?.abort();
 const generation=state.generation,abort=new AbortController();
 const originalUrl=options.originalUrl||(state.path===path?state.originalUrl:'')||'';
 Object.assign(state,{abort,path,originalUrl,mode:options.mode||'smooth',wantPlay:!!options.play,pending:true,failed:false,sourceLowFps:false,message:'Preparing smooth playback…'});
 video.pause();nativeRemove.call(video,'src');nativeLoad.call(video);
 controls(video,state);renderState(state);
 try{
  const client=relay();let prepare=null;
  if(state.mode!=='original'){
   const deadline=Date.now()+660000;
   while(generation===state.generation){
    const response=await client.fetch(path+'?playback=prepare',{signal:abort.signal,cache:'no-store'});
    prepare=await response.json();
    if(generation!==state.generation)return;
    state.sourceLowFps=prepare.error==='source_below_24fps';
    if(!response.ok||prepare.state==='failed'||prepare.ok===false)throw Error(prepare.error==='source_below_24fps'?
     (Number(prepare.source_fps)>0?'This older recording contains only '+Number(prepare.source_fps).toFixed(1)+' captured frames per second':'Original recording contains fewer than 24 frames per second'):(prepare.error||'Smooth playback preparation failed'));
    if(prepare.state==='ready')break;
    if(!['preparing','queued'].includes(prepare.state))throw Error('Unexpected playback preparation state');
    if(Date.now()>deadline)throw Error('Smooth playback is still preparing; use Retry');
    state.message='Preparing smooth playback'+(prepare.elapsed_seconds?' · '+Math.round(prepare.elapsed_seconds)+' s':'')+'…';renderState(state);
    await sleep(1500,abort.signal);
   }
  }
  const url=state.mode==='original'&&state.originalUrl?state.originalUrl:await client.url(path+(state.mode==='original'?'':'?playback=hub'));
  if(generation!==state.generation||abort.signal.aborted)return;
  state.pending=false;state.failed=false;
  video.dataset.securityProfile=state.mode==='original'?'original':'360p30';
  if(prepare?.source_fps)video.dataset.securitySourceFps=String(prepare.source_fps);else delete video.dataset.securitySourceFps;
  state.message=state.mode==='original'?'Original preserved · playback depends on device':
   (Number(prepare?.source_fps)>0&&Number(prepare.source_fps)<24?'30 fps playback · original source '+Number(prepare.source_fps).toFixed(1)+' fps':'Smooth playback · 360p / 30 fps');
  renderState(state);mediaSrc.set.call(video,url);nativeLoad.call(video);
  if(state.wantPlay)try{await nativePlay.call(video)}catch(_){state.message+=' · press Play';renderState(state)}
 }catch(error){
  if(generation!==state.generation||abort.signal.aborted)return;
  state.pending=false;state.failed=true;state.message=String(error.message||error).slice(0,150)+(state.sourceLowFps?' · choose Original':' · Retry or choose Original');renderState(state);
 }
}
Object.defineProperty(media,'src',{...mediaSrc,set(value){const path=sourcePath(value);if(this.tagName==='VIDEO'&&path){setSource(this,path,{originalUrl:originalLocal(value)});return}stopPlayer(this);mediaSrc.set.call(this,value)}});
media.load=function(){if(players.get(this)?.pending)return;return nativeLoad.call(this)};
media.play=function(){const state=players.get(this);if(state?.pending){state.wantPlay=true;return Promise.resolve()}return nativePlay.call(this)};
function cleanupLive(state){
 state.generation++;state.abort?.abort();state.abort=null;
 clearTimeout(state.retryTimer);clearInterval(state.watchdog);state.retryTimer=null;state.watchdog=null;
 if(state.video){state.video.pause();nativeRemove.call(state.video,'src');nativeLoad.call(state.video);state.video.remove();state.video=null}
 if(state.objectURL){URL.revokeObjectURL(state.objectURL);state.objectURL=''}
 state.img.onload=null;state.img.onerror=null;nativeRemove.call(state.img,'src');state.img.style.display=state.previousDisplay||'';state.running=false;
}
function liveStatus(state,text){
 state.message=text;state.img.dataset.securityLiveStatus=text;
 if(state.status)state.status.textContent=text;
}
function stopLive(img){const state=lives.get(img);if(state){state.wanted=false;cleanupLive(state)}}
/* C720P_SECURITY_NATIVE_MJPEG_STABLE_V2:
 * An MP4 MediaSource playback timeline is not a reliable wall-clock live view on
 * this low-power hub. Use the existing authenticated, continuously produced
 * native phone MJPEG stream instead. No extra capture, GPU processing or media
 * transcoding on the C720P. Saved MP4 player stays unchanged.
 */
async function liveSession(state){
 if(state.running||state.retryTimer||!state.wanted||!visible(state.img))return;
 cleanupLive(state);
 state.running=true;
 const generation=state.generation,controller=new AbortController();
 state.abort=controller;
 const current=()=>state.wanted&&state.generation===generation&&!controller.signal.aborted;
 const img=state.img;
 let finished=false;
 function retry(reason){
  if(finished||!current())return;
  finished=true;
  cleanupLive(state);
  // Single bounded retry timer; prevents an image/load/error restart storm.
  liveStatus(state,'Live reconnecting · '+reason);
  state.mjpegRetryDelay=Math.min(30000,Math.max(6000,(state.mjpegRetryDelay||6000)*1.5));
  const expected=state.generation;
  state.retryTimer=setTimeout(()=>{
   state.retryTimer=null;
   if(state.generation===expected&&state.wanted&&visible(state.img))liveSession(state);
  },state.mjpegRetryDelay);
 }
 liveStatus(state,'Connecting live camera…');
 try{
  const client=relay();
  if(typeof client.url!=='function')throw Error('Signed camera relay unavailable');
  const signed=await client.url('/new/live.mjpg');
  if(!current())return;
  // Bypass the shared HTMLImageElement.src interception that normally sends
  // all /new/live.mjpg images back into the looping MP4 player.
  img.dataset.securityProfile='live-mjpeg-native';
  img.onload=()=>{
   if(!current())return;
   state.mjpegRetryDelay=0;
   liveStatus(state,'LIVE · S9+ native camera');
  };
  img.onerror=()=>retry('camera stream interrupted');
  imageSrc.set.call(img,signed);
  const start=Date.now();
  state.watchdog=setInterval(()=>{
   if(!current())return;
   if(img.naturalWidth>0){
    state.mjpegRetryDelay=0;
    liveStatus(state,'LIVE · S9+ native camera');
    clearInterval(state.watchdog);state.watchdog=null;
   }else if(Date.now()-start>16000){
    retry('waiting for first frame');
   }
  },3000);
 }catch(e){
  if(current())retry('temporary connection issue');
 }
}
function startLive(img,options={}){
 let state=lives.get(img);
 if(!state){state={img,generation:0,running:false,wanted:false,previousDisplay:img.style.display,status:options.status||
   (img.nextElementSibling?.tagName==='P'?img.nextElementSibling:null)};lives.set(img,state)}
 if(options.status)state.status=options.status;
 state.wanted=true;liveSession(state);return state;
}
Object.defineProperty(image,'src',{...imageSrc,set(value){if(livePath(value)){startLive(this);return}if(lives.has(this))stopLive(this);imageSrc.set.call(this,value)}});
Element.prototype.setAttribute=function(name,value){
 if(String(name).toLowerCase()==='src'){
  if(this.tagName==='VIDEO'&&sourcePath(value)){setSource(this,sourcePath(value),{originalUrl:originalLocal(value)});return}
  if(this.tagName==='IMG'&&livePath(value)){startLive(this);return}
  if(this.tagName==='VIDEO')stopPlayer(this);
  if(this.tagName==='IMG'&&lives.has(this))stopLive(this);
 }
 return nativeSet.call(this,name,value);
};
Element.prototype.removeAttribute=function(name){if(String(name).toLowerCase()==='src'){if(this.tagName==='VIDEO')stopPlayer(this);if(this.tagName==='IMG')stopLive(this)}return nativeRemove.call(this,name)};
function scan(){
 for(const video of document.querySelectorAll('video')){monitor(video);const state=players.get(video);if(state)controls(video,state);if(!visible(video)&&!video.paused)video.pause()}
 for(const [video,state]of players){if(!video.isConnected){stopPlayer(video);state.box?.remove();players.delete(video);delete measurements.players[video.dataset.securityMonitor]}}
 for(const [img,state]of lives){
  if(!img.isConnected){cleanupLive(state);lives.delete(img);continue}
  const target=state.video||img;
  if(state.wanted&&!visible(target)){if(state.running||state.retryTimer)cleanupLive(state)}
  else if(state.wanted&&!state.running&&!state.retryTimer)liveSession(state);
 }
}
setInterval(scan,1000);
let scanQueued=false;
new MutationObserver(records=>{
 if(scanQueued||!records.some(r=>[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches?.('video,img,iframe')||n.querySelector?.('video,img,iframe')))))return;
 scanQueued=true;setTimeout(()=>{scanQueued=false;scan()},0);
}).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('visibilitychange',scan);
window.addEventListener('pagehide',()=>{for(const img of lives.keys())stopLive(img);for(const video of players.keys())stopPlayer(video)});
window.C720PSecurityVideo={setSource,suspendPlayer,startLive,stopLive,pauseOthers,metrics:measurements,sourcePath};
})();
