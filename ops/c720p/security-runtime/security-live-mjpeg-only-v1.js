/* SECURITY_LIVE_MJPEG_ONLY_V1: no 30-fps transcoding, no HTMLMediaElement interception.
   The existing authenticated relay signs both the S9+ live MJPEG feed and original MP4s.
   Original 4K clips and all manual review decisions are unchanged. */
(()=>{
'use strict';
if(window.C720PSecurityLiveOnly?.version===1)return;
const image=HTMLImageElement.prototype;
const imageSrc=Object.getOwnPropertyDescriptor(image,'src');
const originalSet=Element.prototype.setAttribute;
const originalRemove=Element.prototype.removeAttribute;
if(!imageSrc?.set||!originalSet||!originalRemove)throw Error('unsupported_browser_media_descriptors');
const active=new Set(),byImage=new WeakMap();
const playbackMetrics=window.C720PSecurityPlaybackMetrics={version:2,players:{},mode:'original-only'};
function relay(){
 for(const context of [window,window.parent,window.top]){
  try{if(context.C720PSecureRelay?.url)return context.C720PSecureRelay}catch(_){}
 }
 throw Error('Authenticated S9+ media relay unavailable');
}
function livePath(value){
 try{const u=new URL(String(value),location.href);return u.pathname==='/new/live.mjpg'}catch(_){return false}
}
function sourcePath(value){
 try{
  const path=decodeURIComponent(new URL(String(value),location.href).pathname);
  const match=/^\/(new|s3)\/saved\/clip\/([A-Za-z0-9_.-]+\.mp4)$/.exec(path);
  return match?'/'+match[1]+'/saved/clip/'+encodeURIComponent(match[2]):null;
 }catch(_){return null}
}
function visible(img){
 if(!img?.isConnected)return false;
 try{
  let current=img,context=window;
  for(let depth=0;depth<12;depth++){
   if(context.document.hidden)return false;
   for(let node=current;node;node=node.parentElement){
    const style=context.getComputedStyle(node);
    if(style.display==='none'||style.visibility==='hidden')return false;
   }
   if(!current.getClientRects().length)return false;
   if(context===context.parent)break;
   current=context.frameElement;
   if(!current)return true;
   context=context.parent;
  }
  return true;
 }catch(_){return !document.hidden}
}
function status(state,message){
 state.img.dataset.securityLiveStatus=message;
 if(state.status)state.status.textContent=message;
}
function clear(state){
 state.generation++;
 state.abort?.abort();state.abort=null;
 if(state.retryTimer){clearTimeout(state.retryTimer);state.retryTimer=null}
 if(state.watchdog){clearInterval(state.watchdog);state.watchdog=null}
 state.img.onload=null;state.img.onerror=null;
 originalRemove.call(state.img,'src');
 state.running=false;
}
function stopLive(img){
 const state=byImage.get(img);
 if(!state)return;
 state.wanted=false;clear(state);active.delete(state);
}
async function connect(state){
 if(state.running||state.retryTimer||!state.wanted||!visible(state.img))return;
 clear(state);
 state.running=true;
 const generation=state.generation,controller=new AbortController();
 state.abort=controller;
 const current=()=>state.wanted&&generation===state.generation&&!controller.signal.aborted;
 let retried=false;
 function retry(){
  if(retried||!current())return;
  retried=true;clear(state);
  state.delay=Math.min(30000,Math.max(6000,Math.ceil((state.delay||4000)*1.5)));
  status(state,'Live reconnecting');
  const expected=state.generation;
  state.retryTimer=setTimeout(()=>{
   state.retryTimer=null;
   if(state.generation===expected&&state.wanted&&visible(state.img))connect(state);
  },state.delay);
 }
 status(state,'Connecting live camera…');
 try{
  const signed=await relay().url('/new/live.mjpg');
  if(!current())return;
  const img=state.img;
  img.dataset.securityProfile='live-mjpeg-native';
  img.onload=()=>{if(current()){state.delay=0;status(state,'LIVE · S9+ native camera')}};
  img.onerror=retry;
  imageSrc.set.call(img,signed);
  const begin=Date.now();
  state.watchdog=setInterval(()=>{
   if(!current())return;
   if(img.naturalWidth>0){state.delay=0;status(state,'LIVE · S9+ native camera');clearInterval(state.watchdog);state.watchdog=null}
   else if(Date.now()-begin>16000)retry();
  },3000);
 }catch(_){if(current())retry()}
}
function startLive(img,options={}){
 let state=byImage.get(img);
 if(!state){
  state={img,generation:0,wanted:false,running:false,retryTimer:null,watchdog:null,
   abort:null,delay:0,status:options.status||null};
  byImage.set(img,state);active.add(state);
 }
 if(options.status)state.status=options.status;
 // A previously stopped IMG keeps its WeakMap entry. Re-register it so
 // visibility scanning and reconnect resume when the same node is reused.
 active.add(state);
 state.wanted=true;connect(state);return state;
}
Object.defineProperty(image,'src',{...imageSrc,set(value){
 if(livePath(value)){startLive(this);return}
 if(byImage.has(this))stopLive(this);
 imageSrc.set.call(this,value);
}});
Element.prototype.setAttribute=function(name,value){
 if(this.tagName==='IMG'&&String(name).toLowerCase()==='src'){
  if(livePath(value)){startLive(this);return}
  if(byImage.has(this))stopLive(this);
 }
 return originalSet.call(this,name,value);
};
Element.prototype.removeAttribute=function(name){
 if(this.tagName==='IMG'&&String(name).toLowerCase()==='src'&&byImage.has(this))stopLive(this);
 return originalRemove.call(this,name);
};
// Compatibility for old explicit player calls. Never touches HTMLMediaElement
// setters, does not prepare a copy, and always requests the authenticated original.
async function setSource(video,path,options={}){
 const actual=sourcePath(path);
 if(!actual||video?.tagName!=='VIDEO')throw Error('invalid_original_recording');
 const signed=await relay().url(actual);
 video.src=signed;
 if(options.play){await video.play()}
 return signed;
}
function pauseOthers(chosen){
 for(const node of document.querySelectorAll('video')){
  if(node!==chosen&&!node.paused)node.pause();
 }
}
function suspendPlayer(video){video?.pause?.()}
function scan(){
 for(const state of [...active]){
  if(!state.img.isConnected){stopLive(state.img);continue}
  if(!visible(state.img)){
   if(state.running||state.retryTimer)clear(state);
  }else if(state.wanted&&!state.running&&!state.retryTimer)connect(state);
 }
}
const sweep=setInterval(scan,2000);
document.addEventListener('visibilitychange',scan);
window.addEventListener('pagehide',()=>{clearInterval(sweep);for(const state of [...active])stopLive(state.img)});
window.C720PSecurityLiveOnly={version:1,startLive,stopLive};
window.C720PSecurityVideo={startLive,stopLive,setSource,suspendPlayer,pauseOthers,
 metrics:playbackMetrics,sourcePath};
})();
