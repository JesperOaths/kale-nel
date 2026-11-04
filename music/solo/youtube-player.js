"use strict";
/* Official YouTube IFrame Player; audiovisual content stays together and visible.
 * No scraping, audio-only extraction, downloads, overlays or background player.
 * The S21 supplies a matched video ID, a randomized starting point and clip length.
 */
window.TuneRushYouTube=(()=>{
 let player=null,ready=null,active=null,timer=null,pendingStartTimer=null,currentVideoId=null;
 const $=id=>document.getElementById(id);
 const idPattern=/^[a-zA-Z0-9_-]{11}$/;
 const YT_URL="https://www.youtube.com/iframe_api";
 function stopTimer(){
  if(timer!==null){clearInterval(timer);timer=null}
  if(pendingStartTimer!==null){clearTimeout(pendingStartTimer);pendingStartTimer=null}
  active=null;
 }
 function pause(){
  stopTimer();
  window.TuneRushScope?.pause();
  try{if(player&&typeof player.pauseVideo==="function")player.pauseVideo()}catch{}
 }
 function report(message){
  const el=$("playback-status");
  if(el)el.textContent=message;
 }
 function startTimer(){
  if(!active||!player)return;
  const operation=active;
  operation.realStart=performance.now();
  if(pendingStartTimer!==null){clearTimeout(pendingStartTimer);pendingStartTimer=null}
  if(timer!==null)clearInterval(timer);
  timer=setInterval(()=>{
   if(!active||active!==operation){clearInterval(timer);timer=null;return}
   const now=performance.now();
   let t;
   try{t=player.getCurrentTime()}catch{return}
   if(!Number.isFinite(t))return;
   const elapsed=Math.max(0,Math.min(operation.duration,t-operation.start));
   window.TuneRushScope?.progress(elapsed,operation.duration,true);
   if(t+0.08>=operation.stopAt||
      (now-operation.realStart>operation.duration*1000+1800 && t>operation.start-1)){
    window.TuneRushScope?.progress(operation.duration,operation.duration,false);
    try{player.pauseVideo()}catch{}
    report("♫ "+operation.duration+"-second clue finished. Choose a longer clue or guess.");
    stopTimer();
   }
  },65);
 }
 function stateChange(event){
  if(!active)return;
  const playing=window.YT?.PlayerState?.PLAYING??1;
  if(event.data===playing){
   report("♫ Playing "+active.duration+" seconds from a YouTube video.");
   startTimer();
  }else if(event.data===0){
   report("Video ended. Choose the next clue or reveal.");
   window.TuneRushScope?.pause();
   stopTimer();
  }else if(event.data===2){
   window.TuneRushScope?.pause();
   if(timer!==null){clearInterval(timer);timer=null}
  }else if(event.data===3){
   window.TuneRushScope?.pause();
   if(timer!==null){clearInterval(timer);timer=null}
  }
 }
 function ensureReady(){
  if(ready)return ready;
  ready=new Promise((resolve,reject)=>{
   let resolved=false;
   const timeout=setTimeout(()=>{
    if(!resolved){resolved=true;reject(new Error("YouTube player initialization timed out."))}
   },18000);
   function init(){
    try{
     player=new window.YT.Player("youtube-player",{
      width:"640",height:"360",
      playerVars:{playsinline:1,controls:1,rel:0,origin:window.location.origin},
      events:{
       onReady:()=>{if(!resolved){resolved=true;clearTimeout(timeout);resolve(player)}},
       onStateChange:stateChange,
       onAutoplayBlocked:()=>{
        if(active)report("Your browser blocked automatic video playback. Click ▶ inside the visible YouTube player; the clue timer will then start.");
       },
       onError:e=>{
        const why=e.data===101||e.data===150?"Video owner disabled embedding":
         e.data===100?"This YouTube video was removed or made private":
         e.data===153?"YouTube needs an origin referrer. Refresh the music page":
         e.data===5?"This browser cannot play the requested video":
         "YouTube playback error ("+e.data+")";
        pause();report(why+". Use Reveal, then Next Song.");
       }
      }
     })
    }catch(err){if(!resolved){resolved=true;clearTimeout(timeout);reject(err)}}
   }
   if(window.YT?.Player){init();return}
   const previous=window.onYouTubeIframeAPIReady;
   window.onYouTubeIframeAPIReady=()=>{
    try{if(typeof previous==="function")previous()}catch{}
    init();
   };
   const script=document.createElement("script");
   script.src=YT_URL;script.async=true;script.onerror=()=>{
    if(!resolved){resolved=true;clearTimeout(timeout);reject(new Error("YouTube is not reachable in this browser."))}
   };
   document.head.appendChild(script);
  });
  return ready;
 }
 async function prepare(){
  // Initialize the visible iframe before the first clue, but do NOT cue a
  // video thumbnail: its title could reveal the answer prematurely.
  const wrapper=$("youtube-video-wrap");
  if(wrapper)wrapper.hidden=false;
  try{await ensureReady();return true}
  catch{return false}
 }
 async function play(videoId,startSeconds,durationSeconds){
  if(!idPattern.test(videoId))throw new Error("S21 supplied an invalid YouTube video ID.");
  if(!Number.isFinite(startSeconds)||!Number.isFinite(durationSeconds)||
     startSeconds<0||durationSeconds<=0||durationSeconds>20)
   throw new Error("S21 supplied an invalid music clue.");
  const wrapper=$("youtube-video-wrap");
  if(wrapper)wrapper.hidden=false;
  report("Opening a verified YouTube music video…");
  const yt=await ensureReady();
  pause();
  const spec={start:startSeconds,duration:durationSeconds,stopAt:startSeconds+durationSeconds,realStart:0};
  window.TuneRushScope?.progress(0,durationSeconds,false);
  active=spec;
  try{
   // The API enforces endSeconds at initial playback. The 65ms timer
   // additionally bounds replay/seek where endSeconds may be invalidated.
   if(currentVideoId===videoId && typeof yt.seekTo==="function"){
     // Reuse the already loaded song when requesting a longer clue: avoid
     // reloading the same iframe/media for each 0.5–20s milestone.
     yt.seekTo(startSeconds,true);
     yt.playVideo();
   }else{
     currentVideoId=videoId;
     yt.loadVideoById({videoId,startSeconds,endSeconds:spec.stopAt});
   }
   report("Preparing a "+durationSeconds+"-second YouTube clue…");
   pendingStartTimer=setTimeout(()=>{
    pendingStartTimer=null;
    if(active===spec&&!spec.realStart){
     report("Ready to listen: click ▶ inside the visible YouTube player if it has not started. The timer starts with the video.");
    }
   },3200);
  }catch(err){
   stopTimer();throw err;
  }
 }
 return {play,pause,prepare,get ready(){return !!player}};
})();
