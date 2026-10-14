// S9_COMPLETE_PREPENDED_MP4_V1 — common Security player pre-event-first route.
 // Original 4K recordings remain selectable and unmodified. Do not run for
 // legacy Drive entries or for explicitly selected original footage.
 const motion=/^\/new\/saved\/clip\/(motion_[0-9]{13}[.]mp4)$/.exec(path);
 if(motion&&state.mode!=='original'&&!options.skipPrelude){
   const signedRelay=relay(),originalName=motion[1];
   const complete='/new/saved/complete/'+originalName;
   try{
     const h=await signedRelay.fetch(complete,{method:'HEAD',cache:'no-store',signal:abort.signal});
     if(h.ok&&/video\/mp4/i.test(h.headers.get('content-type')||'')){
       const src=await signedRelay.url(complete);
       if(generation!==state.generation||abort.signal.aborted)return;
       state.pending=false;state.failed=false;state.mode='complete';
       state.message='Pre-motion buffer + complete 4K event · joined MP4 · 720p / 30 fps';
       video.dataset.securityProfile='phone-joined-complete-720p30';
       mediaSrc.set.call(video,src);nativeLoad.call(video);renderState(state);
       if(state.wantPlay)try{await nativePlay.call(video)}catch(_){
         state.message+=' · press Play';renderState(state);
       }
       return;
     }
   }catch(error){if(abort.signal.aborted)return;}
   // During post-capture merging, immediately show the existing pre-event
   // companion. The end event continues once into the event's normal MP4.
   // The guard prevents recursion when entering this second segment.
   const before='/new/saved/preroll/'+originalName;
   try{
     const h=await signedRelay.fetch(before,{method:'HEAD',cache:'no-store',signal:abort.signal});
     if(h.ok&&/video\/mp4/i.test(h.headers.get('content-type')||'')){
       const src=await signedRelay.url(before);
       if(generation!==state.generation||abort.signal.aborted)return;
       state.pending=false;state.failed=false;state.mode='preroll';
       state.message='Buffered pre-motion video · original event follows automatically';
       video.dataset.securityProfile='phone-prebuffer-then-event';
       mediaSrc.set.call(video,src);nativeLoad.call(video);renderState(state);
       video.addEventListener('ended',()=>{
         if(generation!==state.generation||!video.isConnected)return;
         setSource(video,path,{mode:'smooth',play:true,skipPrelude:true});
       },{once:true});
       if(state.wantPlay)try{await nativePlay.call(video)}catch(_){
         state.message+=' · press Play';renderState(state);
       }
       return;
     }
   }catch(error){if(abort.signal.aborted)return;}
 }
