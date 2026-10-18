/* security-original-playback-v1-20261018 */
/* Original MP4 playback and existing native MJPEG live. No derived copies. */
(()=>{
'use strict';
if(window.C720PSecurityVideo)return;
const media=HTMLMediaElement.prototype,image=HTMLImageElement.prototype;
const mediaSrc=Object.getOwnPropertyDescriptor(media,'src');
const imageSrc=Object.getOwnPropertyDescriptor(image,'src');
const nativeLoad=media.load,nativePlay=media.play;
const nativeSet=Element.prototype.setAttribute,nativeRemove=Element.prototype.removeAttribute;
const players=new Map(),lives=new Map();
function relay(){
 for(const w of [window,window.parent,window.top])try{if(w.C720PSecureRelay?.fetch)return w.C720PSecureRelay}catch(_){}
 throw Error('Authenticated camera relay unavailable');
}
function sourcePath(value){
 try{
  const u=new URL(String(value),location.href),path=decodeURIComponent(u.pathname);
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
function stopPlayer(video){
 const state=players.get(video);if(!state)return;
 state.generation++;state.abort?.abort();state.pending=false;state.wantPlay=false;
}
function suspendPlayer(video){stopPlayer(video);video.pause()}
async function setSource(video,path,options={}){
 let state=players.get(video);
 if(!state){state={generation:0,pending:false};players.set(video,state);monitor(video)}
 state.generation++;state.abort?.abort();
 const generation=state.generation,abort=new AbortController();
 Object.assign(state,{abort,path,wantPlay:!!options.play,pending:true});
 video.pause();nativeRemove.call(video,'src');
 try{
  const url=options.originalUrl||await relay().url(path);
  if(generation!==state.generation||abort.signal.aborted)return;
  video.dataset.securityProfile='original-native';
  mediaSrc.set.call(video,url);nativeLoad.call(video);state.pending=false;
  if(state.wantPlay&&visible(video))await nativePlay.call(video);
 }catch(error){
  if(generation!==state.generation||abort.signal.aborted)return;
  state.pending=false;
  video.dispatchEvent(new CustomEvent('security-playback-error',{detail:{message:'Original recording unavailable'}}));
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
 for(const video of document.querySelectorAll('video')){monitor(video);const state=players.get(video);if(!visible(video)&&!video.paused)video.pause()}
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

