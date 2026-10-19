/* C720P_MIGRATED_S9_SNAPSHOT_DISPLAY_V182
 * Additive legacy JPEG display: prefer authenticated, proof-linked S9+ copy.
 * A missing relay, unverified event, signed-ticket error or image failure
 * leaves the original local thumbnail intact. No Save/Delete/MP4 mutations.
 * Source-only until the private JPEG relay and six-JPEG browser proof pass.
 */
(()=>{
 'use strict';
 const MP4=/^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.mp4$/;
 const JPG=/^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.jpg$/;
 const endpoint='/new/api/c720p-migrated-clips';
 function relay(){
  if(window.C720PSecureRelay)return window.C720PSecureRelay;
  try{return window.parent!==window?window.parent.C720PSecureRelay:null}
  catch(_){return null}
 }
 function nameFromSrc(s){
  if(typeof s!=='string')return null;
  const prefixes=['snaps/','/local/frontyard-security-new/snaps/'];
  const prefix=prefixes.find(p=>s.startsWith(p));
  if(!prefix)return null;
  const name=s.slice(prefix.length);
  return JPG.test(name)&&!name.includes('..')?name:null;
 }
 async function apply(){
  const photos=Array.from(document.querySelectorAll('img[src]')).filter(
    image=>nameFromSrc(image.getAttribute('src')));
  if(!photos.length)return;
  const auth=relay();
  if(typeof auth?.fetch!=='function'||typeof auth?.url!=='function')return;
  let known=new Set(),proven=new Set();
  try{
   const response=await auth.fetch(endpoint,{cache:'no-store'});
   if(response.status!==200)return;
   const manifest=await response.json();
   if(manifest?.ok!==true||manifest.schema_version!=='c720p_s9_verified_import_v2'||
      manifest.not_s9_original_recordings!==true||
      manifest.not_person_assignments!==true||
      !Number.isSafeInteger(manifest.total_imported)||
      manifest.total_imported<1||manifest.total_imported>5000||
      !Array.isArray(manifest.files)||
      manifest.files.length!==manifest.total_imported)return;
   for(const file of manifest.files){
    const n=file?.name;
    if(typeof n!=='string'||!MP4.test(n)||n.includes('..')||known.has(n)||
       !Number.isSafeInteger(file.bytes)||file.bytes<10000||
       file.bytes>943718400||file.indexed!==true)return;
    known.add(n);
   }
   const eventsResponse=await fetch('/local/frontyard-security-new/events.json',{
     cache:'no-store'});
   if(eventsResponse.status!==200)return;
   let events=await eventsResponse.json();
   if(!Array.isArray(events))events=events?.events||events?.items||events?.clips;
   if(!Array.isArray(events)||events.length>10000)return;
   const clipRefs=new Set();
   for(const event of events){
    if(!event||typeof event.clip!=='string')continue;
    const parts=event.clip.split('/');
    if(parts.length!==2||parts[0]!=='clips'||!MP4.test(parts[1])||
       parts[1].includes('..'))continue;
    if(!known.has(parts[1]))continue;
    const snapshot=nameFromSrc(event.snapshot);
    if(!snapshot||clipRefs.has(parts[1])||proven.has(snapshot))return;
    clipRefs.add(parts[1]);proven.add(snapshot);
   }
   if(proven.size!==known.size)return;
  }catch(_){return}
  for(const image of photos){
   const original=image.getAttribute('src')||'';
   const snapshot=nameFromSrc(original);
   if(!snapshot||!proven.has(snapshot)||!image.isConnected)continue;
   const route='/new/saved/c720p-migrated/snap/'+encodeURIComponent(snapshot);
   try{
    const url=await auth.url(route);
    if(typeof url!=='string'||url.length<8||
       !image.isConnected||image.getAttribute('src')!==original)continue;
    // Reversible only: a failed S9 image returns to the identical local URL.
    image.dataset.c720pLegacySnapshotSrc=original;
    image.dataset.c720pS9Snapshot='loading';
    image.addEventListener('load',()=>{
      if(image.dataset.c720pS9Snapshot==='loading')
       image.dataset.c720pS9Snapshot='loaded';
    },{once:true});
    image.addEventListener('error',()=>{
      if(image.dataset.c720pS9Snapshot==='fallback')return;
      image.dataset.c720pS9Snapshot='fallback';
      image.src=original;
    },{once:true});
    image.src=url;
   }catch(_){/* original local JPEG continues to work */}
  }
 }
 // Camera Clips renders its <img> elements after DOMContentLoaded.
 // Observe only child additions containing images; never poll or modify Save.
 let active=false,rerun=false;
 async function refresh(){
  if(active){rerun=true;return}
  active=true;
  try{await apply()}
  finally{
   active=false;
   if(rerun){rerun=false;Promise.resolve().then(()=>{void refresh()})}
  }
 }
 function containsPhoto(node){
  return node?.nodeType===1 &&
   (node.tagName==='IMG'||typeof node.querySelector==='function' &&
    !!node.querySelector('img[src]'));
 }
 function start(){
  void refresh();
  if(typeof MutationObserver!=='function'||!document.body)return;
  const watcher=new MutationObserver(changes=>{
   if(changes.some(c=>Array.from(c.addedNodes||[]).some(containsPhoto)))
    void refresh();
  });
  watcher.observe(document.body,{childList:true,subtree:true});
 }
 if(document.readyState==='loading')
  document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
})();