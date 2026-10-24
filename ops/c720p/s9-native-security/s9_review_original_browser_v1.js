/* Dormant V324 review-original client: uses signed 8794 relay; no identity matching.
   A browser loadedmetadata event is a scoped observation, not proof of viewing. */
(()=>{'use strict';
const sd=/^motion_[0-9]{13}[.]mp4$/;
const drive=/^[A-Za-z0-9._-]{1,180}[.]mp4$/;
const token=/^[A-Za-z0-9_-]{20,128}$/;
const headers={'Content-Type':'application/json','X-S9-Original-Review-Intent':'explicit-original-open-v1'};
function build(relay,video){
 if(!relay||typeof relay.fetch!=='function'||typeof relay.url!=='function'||!video)
  throw Error('Signed original review unavailable');
 let current=null,generation=0;
 function reset(){
  generation++;current=null;video.pause();video.removeAttribute('src');video.load();
 }
 async function post(path,obj){
  const r=await relay.fetch(path,{method:'POST',headers,body:JSON.stringify(obj),cache:'no-store'});
  const data=await r.json();
  if(!r.ok||data.ok!==true){
   const error=Error(data.error||'Original review unavailable');
   error.status=r.status;
   throw error;
  }
  return data;
 }
 async function open(source,name){
  if(source!=='sd'&&source!=='drive')throw Error('Unknown original source');
  if(!(source==='sd'?sd.test(name):drive.test(name)&&!name.includes('..')))
   throw Error('Unsafe original name');
  const turn=++generation;current=null;
  const start=await post('/new/api/review-original-open',{source,name});
  if(turn!==generation)return;
  if(!token.test(start.open_nonce)||typeof start.playback_path!=='string'||
     !start.playback_path.startsWith('/new/review-original/'+source+'/'))
   throw Error('Original open response invalid');
  const url=await relay.url(start.playback_path);
  if(turn!==generation)return;
  const loaded=new Promise((resolve,reject)=>{
   let timer;
   const cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadedmetadata',ok);video.removeEventListener('error',bad)};
   const ok=()=>{cleanup();resolve()};
   const bad=()=>{cleanup();reject(Error('Original video failed to load'))};
   video.addEventListener('loadedmetadata',ok,{once:true});
   video.addEventListener('error',bad,{once:true});
   timer=setTimeout(()=>{cleanup();reject(Error('Original metadata timeout'))},9000);
  });
  video.src=url;video.load();await loaded;
  if(turn!==generation||video.readyState<1||video.videoWidth<1||video.videoHeight<1||
      !video.currentSrc.includes(encodeURIComponent(start.open_nonce)))
    throw Error('Loaded player URL does not match original review nonce');
  // loadedmetadata can fire before a 4 MiB/Drive Range finishes streaming.
  // Only HTTP 425 means the verified original is still in flight. Never retry
  // a stale/revoked 409 or authentication failure, and never self-approve.
  const loadedPayload={source,name,open_nonce:start.open_nonce,
      observed_open_nonce:start.open_nonce};
  const deadline=Date.now()+12000;
  let done,attempt=0;
  while(turn===generation){
   if(video.readyState<1||!video.currentSrc.includes(encodeURIComponent(start.open_nonce)))
    throw Error('Original player source changed during delivery');
   try{
    done=await post('/new/api/review-original-loaded',loadedPayload);
    break;
   }catch(error){
    if(error.status!==425||Date.now()>=deadline)throw error;
    await new Promise(resolve=>setTimeout(resolve,Math.min(1000,200+150*attempt++)));
   }
  }
  if(turn!==generation)return;
  if(!token.test(done.review_ticket)||done.source!==source||done.name!==name)
    throw Error('Media receipt did not match');
  current={source,name,ticket:done.review_ticket,turn};
 }
 function receipt(source,name){
  return current&&current.source===source&&current.name===name&&current.turn===generation
      ?current.ticket:null;
 }
 video.addEventListener('emptied',()=>{current=null});
 video.addEventListener('error',()=>{current=null});
 return Object.freeze({open,reset,receipt});
}
window.C720POriginalReviewClient=Object.freeze({build});
})();
