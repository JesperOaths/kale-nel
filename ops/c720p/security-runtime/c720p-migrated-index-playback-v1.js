/* C720P legacy index: use only authenticated, SHA-verified S9+ migrated MP4s.
   Original Save buttons, events, snapshots and native Camera2 are untouched.
   Fallback to local MP4s while cutover is incomplete. */
(()=>{
 'use strict';
 const candidates=Array.from(document.querySelectorAll('video[src^="clips/"]'));
 if(!candidates.length)return;
 const relay=window.C720PSecureRelay||(()=>{
  try{return window.parent!==window?window.parent.C720PSecureRelay:null}
  catch(_){return null}
 })();
 const home='/local/frontyard-security-new/security-review-v8.html';
 function helper(video, text){
  if(!video.parentElement)return;
  let tag=video.parentElement.querySelector('.c720p-s9-migrated-video-hint');
  if(!tag){tag=document.createElement('small');tag.className='c720p-s9-migrated-video-hint';
    tag.style.display='block';tag.style.margin='4px 0';tag.style.color='#a6c8d0';
    video.insertAdjacentElement('afterend',tag)}
  tag.textContent=text;
 }
 const exact=/^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.mp4$/;
 if(!relay?.fetch||!relay?.url){
  for(const video of candidates)helper(video,'The S9+ archive is available in Security → Recordings.');
  return;
 }
 async function switchRecordedClips(){
  try{
   const reply=await relay.fetch('/new/api/c720p-migrated-clips',{cache:'no-store'});
   if(!reply.ok)return;
   const data=await reply.json();
   if(data.ok!==true||data.schema_version!=='c720p_s9_verified_import_v2'||
      data.not_s9_original_recordings!==true||data.not_person_assignments!==true||
      !Number.isSafeInteger(data.total_imported)||!Array.isArray(data.files)||
      data.files.length!==data.total_imported||data.files.length>5000)return;
   const known=new Set();
   for(const f of data.files){
    if(!f||typeof f.name!=='string'||!exact.test(f.name)||f.name.includes('..')||
       !Number.isSafeInteger(f.bytes)||f.bytes<10000||f.bytes>943718400||
       typeof f.indexed!=='boolean')return;
    known.add(f.name);
   }
   for(const video of candidates){
    const old=video.getAttribute('src')||'';
    const n=old.startsWith('clips/')?old.slice(6):'';
    if(!exact.test(n)||!known.has(n))continue;
    const ticket=video.dataset.originalSrc||old;
    video.dataset.originalSrc=ticket;
    try{
     const url=await relay.url('/new/saved/c720p-migrated/clip/'+encodeURIComponent(n));
     if(!video.isConnected||video.dataset.originalSrc!==ticket)continue;
     video.pause();video.src=url;video.preload='metadata';video.load();
     video.dataset.migratedToS9='verified';
     helper(video,'Playing the verified S9+ microSD copy');
     video.addEventListener('error',()=>{
      if(video.dataset.migratedToS9!=='verified')return;
      video.dataset.migratedToS9='fallback';
      video.src=ticket;video.load();
      helper(video,'S9+ playback unavailable; local copy is retained during migration');
     },{once:true});
    }catch(_){helper(video,'S9+ playback unavailable; local copy is retained during migration')}
   }
  }catch(_){/* old local page remains usable if secure bridge is unavailable */}
 }
 switchRecordedClips();
})();