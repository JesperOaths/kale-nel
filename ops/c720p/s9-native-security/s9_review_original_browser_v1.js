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
 const DELIVERY_BUDGET_MS=26000; // only after original open+auth finishes
 let current=null,generation=0,active=null,pendingLoadedReject=null,pendingOpenAbort=null;
 function cancelOpen(opened){
  if(!opened)return;
  // Signed, nonce-specific best-effort cleanup; failure never creates consent.
  void post('/new/api/review-original-cancel',
    {source:opened.source,name:opened.name,open_nonce:opened.nonce}).catch(()=>{});
 }
 function reset(){
  generation++;current=null;
  // Abort the browser HTTP request while a synchronous full-original SHA is
  // pending. The broker cancels its server-side operation on disconnect; a
  // later hash result must be discarded rather than publishing a nonce.
  if(pendingOpenAbort){pendingOpenAbort.abort();pendingOpenAbort=null;}
  const previous=active;active=null;
  if(pendingLoadedReject)pendingLoadedReject(Error('Original player cancelled'));
  video.pause();video.removeAttribute('src');video.load();
  cancelOpen(previous);
 }
 async function post(path,obj,signal){
  const r=await relay.fetch(path,{method:'POST',headers,body:JSON.stringify(obj),cache:'no-store',signal});
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
  reset();
  const turn=generation;
  const openingAbort=new AbortController();
  pendingOpenAbort=openingAbort;
  let start;
  try{start=await post('/new/api/review-original-open',{source,name},openingAbort.signal)}
  catch(error){if(turn!==generation)return;reset();throw error}
  finally{if(pendingOpenAbort===openingAbort)pendingOpenAbort=null}
  if(turn!==generation){
   if(token.test(start.open_nonce))cancelOpen({source,name,nonce:start.open_nonce});
   return;
  }
  if(!token.test(start.open_nonce)||typeof start.playback_path!=='string'||
     !start.playback_path.startsWith('/new/review-original/'+source+'/'))
   throw Error('Original open response invalid');
  active={source,name,nonce:start.open_nonce};
  let url;
  try{url=await relay.url(start.playback_path)}
  catch(error){if(turn===generation)reset();throw error}
  if(turn!==generation)return;
  // The 8795 original has a 20s upstream inactivity limit and 8794 allows
  // 24s only for this media route. Metadata+425 retries share ONE deadline.
  const mediaDeadline=Date.now()+DELIVERY_BUDGET_MS;
  const loaded=new Promise((resolve,reject)=>{
   let timer,cancelPending;
   const cleanup=()=>{
    clearTimeout(timer);
    if(pendingLoadedReject===cancelPending)pendingLoadedReject=null;
    video.removeEventListener('loadedmetadata',ok);
    video.removeEventListener('error',bad);
   };
   const ok=()=>{cleanup();resolve()};
   const bad=()=>{cleanup();reject(Error('Original video failed to load'))};
   cancelPending=()=>{cleanup();reject(Error('Original player cancelled'))};
   pendingLoadedReject=cancelPending;
   video.addEventListener('loadedmetadata',ok,{once:true});
   video.addEventListener('error',bad,{once:true});
   timer=setTimeout(()=>{cleanup();reject(Error('Original metadata timeout'))},
     Math.max(1,mediaDeadline-Date.now()));
  });
  video.src=url;video.load();
  try{await loaded}catch(error){
   if(turn!==generation)return;
   reset();throw error;
  }
  if(turn!==generation)return;
  if(video.readyState<1||video.videoWidth<1||video.videoHeight<1||
      !video.currentSrc.includes(encodeURIComponent(start.open_nonce))){
    // A malformed/redirected player URL must invalidate the pending session,
    // not merely throw while its nonce can still be replayed.
    reset();
    throw Error('Loaded player URL does not match original review nonce');
  }
  // loadedmetadata can fire before a 4 MiB/Drive Range finishes streaming.
  // Only HTTP 425 means the verified original is still in flight. Never retry
  // a stale/revoked 409 or authentication failure, and never self-approve.
  const loadedPayload={source,name,open_nonce:start.open_nonce,
      observed_open_nonce:start.open_nonce};
  // Never start a second open/session when only delivery receipt is pending.
  let done,attempt=0;
  while(turn===generation){
   if(Date.now()>=mediaDeadline){
    reset();throw Error('Original delivery exceeded bounded media deadline');
   }
   if(video.readyState<1||!video.currentSrc.includes(encodeURIComponent(start.open_nonce))){
    reset();throw Error('Original player source changed during delivery');
   }
   try{
    done=await post('/new/api/review-original-loaded',loadedPayload);
    break;
   }catch(error){
    if(turn!==generation)return;
    if(error.status!==425||Date.now()>=mediaDeadline){
     reset();throw error;
    }
    const remaining=mediaDeadline-Date.now();
    await new Promise(resolve=>setTimeout(resolve,Math.min(remaining,1000,200+150*attempt++)));
   }
  }
  if(turn!==generation)return;
  if(Date.now()>mediaDeadline||!token.test(done.review_ticket)||done.source!==source||done.name!==name){
   reset();throw Error('Media receipt did not match the bounded original');
  }
  current={source,name,ticket:done.review_ticket,turn};
 }
 function receipt(source,name){
  return current&&current.source===source&&current.name===name&&current.turn===generation
      ?current.ticket:null;
 }
 function invalidateCommittedReceipt(){
  // A post-loaded playback error or external source removal invalidates the
  // review ticket and revokes any issued-but-unreserved server token.
  const issued=active;
  const hadReceipt=!!current;
  current=null;
  if(hadReceipt&&issued){
   active=null;generation++;
   cancelOpen(issued);
  }
 }
 video.addEventListener('emptied',invalidateCommittedReceipt);
 video.addEventListener('error',invalidateCommittedReceipt);
 return Object.freeze({open,reset,receipt});
}
window.C720POriginalReviewClient=Object.freeze({build});
})();
