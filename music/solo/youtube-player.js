"use strict";
/* Official YouTube IFrame Player; audiovisual content stays together and visible.
 * No scraping, audio-only extraction, downloads, overlays or background player.
 * The S21 supplies a matched video ID, a randomized starting point and clip length.
 */
window.TuneRushYouTube=(()=>{
 let player=null,ready=null,active=null,timer=null;
 const $=id=>document.getElementById(id);
 const idPattern=/^[a-zA-Z0-9_-]{11}$/;
 const YT_URL="https://www.youtube.com/iframe_api";
 function stopTimer(){
  if(timer!==null){clearInterval(timer);timer=null}
  active=null;
 }
 function pause(){
  stopTimer();
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
  if(timer!==null)clearInterval(timer);
  timer=setInterval(()=>{
   if(!active||active!==operation){clearInterval(timer);timer=null;return}
   const now=performance.now();
   let t;
   try{t=player.getCurrentTime()}catch{return}
   if(!Number.isFinite(t))return;
   if(t+0.08>=operation.stopAt||
      (now-operation.realStart>operation.duration*1000+1800 && t>operation.start-1)){
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
   stopTimer();
  }else if(event.data===2 && timer!==null){
   clearInterval(timer);timer=null;
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
       onError:e=>{
        const why=e.data===101||e.data===150?"Video owner disabled embedding":e.data===100?"Video unavailable":"YouTube playback error";
        pause();report(why+". Try Reveal and Next Song.");
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
  active=spec;
  try{
   // The API enforces endSeconds at initial playback. The 65ms timer
   // additionally bounds replay/seek where endSeconds may be invalidated.
   yt.loadVideoById({videoId,startSeconds,endSeconds:spec.stopAt});
   report("Loading "+durationSeconds+"s at a random starting point… If playback is blocked, press Play in the YouTube player.");
  }catch(err){
   stopTimer();throw err;
  }
 }
 return {play,pause,get ready(){return !!player}};
})();
