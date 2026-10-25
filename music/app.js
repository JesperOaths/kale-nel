"use strict";
// Kalenel Tune Rush v001. Public page, guest-only rooms; no Spotify use.
const ENDPOINT="https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/musicquiz_v1";
const PUBLISHABLE_KEY="sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA";
const ROOM_ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomSecret(){const a=new Uint8Array(32);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,"0")).join("")}
function randomRoom(){const a=new Uint8Array(6);crypto.getRandomValues(a);return [...a].map(x=>ROOM_ALPHABET[x%ROOM_ALPHABET.length]).join("")}
async function capabilityHash(token){
 const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
 return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
const STORE="kalenel_tunerush_room_v001";
const $=id=>document.getElementById(id);
const playerAudio=$("licensed-player");
let access=null,room=null,loading=false,pollBusy=false,toastTimer=null;
let clipTimer=null,nextTimer=null,voices=[],ctx=null,startedClip=false;
let lastBlockKey="",answeredFocusKey="",prevRound=0,prevPhase="";
let genresDirty=false,genresSaveTimer=null;
let ytPlayer=null,ytPlayerVideoId='',ytReadyPromise=null,ytPlayingResolve=null,ytPlayingReject=null,ytPlayingTimer=null;
let ytError=null,ytLoadGeneration=0,clipGeneration=0,mutationVersion=0;
let failedClue="";
let deezerPlayer=null,deezerPreparedRound="",deezerAuthorized=false;
const DEEZER_RESOLVER="https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/tune-rush-deezer-preview";
async function refreshDeezerApproval(){
 try{
  const r=await fetch("https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/musicquiz_deezer_enabled_v1",{
   method:"POST",headers:{"Content-Type":"application/json","apikey":PUBLISHABLE_KEY},cache:"no-store",body:"{}"
  });
  deezerAuthorized=r.ok&&(await r.json())===true;
 }catch{deezerAuthorized=false}
 const choice=$("deezer-source-option");
 const radio=choice.querySelector('input[name="music-source"]');
 choice.hidden=false;
 radio.disabled=!deezerAuthorized;
 choice.classList.toggle("is-unavailable",!deezerAuthorized);
 $("deezer-provider-note").classList.toggle("approved",deezerAuthorized);
 choice.setAttribute("aria-disabled",String(!deezerAuthorized));
 setText("deezer-badge",deezerAuthorized?"AUTHORIZED":"PENDING");
 const foot=$("deezer-card-foot");
 foot.firstChild.textContent=deezerAuthorized?"SELECT DEEZER ":"NOT YET AVAILABLE ";
 setText("deezer-license-status",deezerAuthorized?"Deezer preview authorization confirmed":"Deezer integration ready · Playback not authorized");
 setText("deezer-note-detail",deezerAuthorized?
  "The provider authorization flag is enabled. Preview playback still depends on the authorized host resolver and available tracks.":
  "We built the connection, but Deezer has not approved using previews in the public game.");
 if(!deezerAuthorized&&chosenSource()==="deezer"){
  document.querySelector('input[name="music-source"][value="demo"]').checked=true;
  updateAudioChoice();
 }
}
function deezerStatus(msg){setText("deezer-status",msg)}
async function ensureDeezerPreview(){
 if(!deezerAuthorized||!isHost()||room?.mode!=="deezer"||!access?.token)
  throw Error("Deezer playback has not been authorized for this game.");
 if(!/^deezer:[1-9][0-9]*$/.test(room.audio?.source||""))
  throw Error("The Deezer track is not available to this room.");
 const identity=room.code+":"+room.round+":"+room.audio.source;
 if(deezerPreparedRound===identity&&deezerPlayer)return;
 deezerStatus("Verifying licensed Deezer preview…");
 const hostHash=await capabilityHash(access.token);
 const response=await fetch(DEEZER_RESOLVER,{
  method:"POST",headers:{"Content-Type":"application/json","apikey":PUBLISHABLE_KEY},
  cache:"no-store",body:JSON.stringify({code:room.code,hash:hostHash})
 });
 const track=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(track.error||"Deezer preview is unavailable.");
 if(String(track.trackId)!==room.audio.source.slice(7)||!Number.isInteger(track.cueMs)||
    track.cueMs<0||track.cueMs>9000||track.round!==room.round)
   throw Error("The preview does not match the current game round.");
 const {DeezerPreviewPlayer}=await import("./deezer-preview.js");
 const old=deezerPlayer;if(old)old.dispose();
 const candidate=new DeezerPreviewPlayer(playerAudio);
 candidate.prepare(track.previewUrl,30,()=>0);
 candidate.cue=track.cueMs/1000;
 deezerPlayer=candidate;deezerPreparedRound=identity;
 deezerStatus("Deezer preview ready · "+String(track.attribution||"Deezer"));
}

const ERROR_TEXT={
 room_not_found:"That room does not exist.",room_expired:"Room expired. Create a new lobby.",
 unauthorized:"Your lobby session is no longer valid.",name_taken:"This name is already taken.",
 game_already_started:"This game already started.",no_players:"Wait for at least one player.",
 no_licensed_songs_for_genres:"There are no playable licensed songs in those genres yet. Select Demo melodies.",steal_closed:"Steal time is not open yet.",steal_requires_remaining_answers:"Complete every unknown field to submit a steal.",answer_time_expired:"Your answer window expired.",resume_unavailable:"Waiting for another answer, or there are no clues left.",room_capacity_reached:"Too many open rooms. Please try later.",
 buzz_closed:"Someone has already buzzed, or buzzing is not open.",
 already_tried_this_clip:"You've already guessed during this snippet. Wait for the next one.",
 not_your_turn:"Another player buzzed first.",not_ready_for_clip:"The music is paused for an answer.",
 replay_unavailable:"A clue can only be replayed before anyone answers it.",stale_clue:"The round has moved on. Use the current playback controls.",
 all_hints_used:"All snippets have played. The host can skip the song.",
 temporary_failure:"Connection interrupted. Wait for the room to update, then try again.",request_failed:"The request could not be completed.",invalid_music_source:"Choose Demo or YouTube.",invalid_youtube_video:"Enter a valid YouTube Music song link.",provide_song_and_artist:"Enter both song title and artist.",invalid_cue:"Start time must be between 0 and 600 seconds.",no_videos_for_filters:"No videos match these genres and decades. Choose more genres or remove a decade.",invalid_video_duration:"Video duration unavailable.",video_too_short_for_clues:"This video is too short for the full hints.",cue_not_available:"Random cue is only available before the first hint."
};
function message(s) {
 const el=$("toast");el.textContent=ERROR_TEXT[s]||String(s||"");el.hidden=false;
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true},3300);
}
function setText(id,value){$(id).textContent=String(value??"")}
function setLoading(value){
 loading=value;
 for(const id of ["start","youtube-play-hint","youtube-replay-hint","next-round","continue-hints","skip-round"]){$(id).disabled=value}
 const submit=$("youtube-next-form").querySelector('button[type="submit"]');if(submit)submit.disabled=value;
 $("room").setAttribute("aria-busy",String(value));
}
function safeStore(){try{if(access)localStorage.setItem(STORE,JSON.stringify(access));else localStorage.removeItem(STORE)}catch{}}
async function rpc(action,extra={},attempt=0) {
 if(action!=="state")mutationVersion++;
 const creating=action==="create",joining=action==="join";
 const token=creating||joining?randomSecret():access?.token;
 const code=creating?randomRoom():String(extra.code||access?.code||"").toUpperCase();
 if(!token||!/^[A-HJ-NP-Z2-9]{6}$/.test(code))throw Error("invalid_code");
 const p_data={
  name:String(extra.name||"").slice(0,20),
  song:String(extra.song||"").slice(0,100),
  artist:String(extra.artist||"").slice(0,100),
  genres:Array.isArray(extra.genres)?extra.genres.slice(0,12):[],
  decades:Array.isArray(extra.decades)?extra.decades.slice(0,8):[],
  durationMs:Number.isInteger(extra.durationMs)?extra.durationMs:0,
  mode:String(extra.mode||"demo"),
  videoId:String(extra.videoId||""),
  cueMs:Number.isInteger(extra.cueMs)?extra.cueMs:0,
  expectedRound:Number.isInteger(extra.expectedRound)?extra.expectedRound:0,
  expectedStep:Number.isInteger(extra.expectedStep)?extra.expectedStep:-1
 };
 const body={p_action:action,p_code:code,p_hash:await capabilityHash(token),p_data};
 let res,data;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
 try {
  res=await fetch(ENDPOINT,{
   method:"POST",
   headers:{"Content-Type":"application/json","apikey":PUBLISHABLE_KEY},
   cache:"no-store",body:JSON.stringify(body),signal:controller.signal
  });
  data=await res.json();
 }catch{throw Error("temporary_failure")}
 finally{clearTimeout(timeout)}
 if(!res.ok){
  const known=String(data?.message||"").split("\\n")[0];
  if(data?.code==="23505"&&creating&&attempt<3)return rpc(action,extra,attempt+1);
  throw Error(known||"request_failed");
 }
 if(!data?.role||data?.code!==code)throw Error("request_failed");
 return {state:data,...((creating||joining)?{token}:{})};
}



/** Full-length local music: browser File handles stay on the host; no audio uploads. */
let localTracks=[],localPlayed=new Set(),localSourceCache=new Set(),localCurrentIndex=null;
let localAudioUrl=null,localReviewShown=60,localImporting=false,localModulePromise=null;
function localLib(){return localModulePromise||(localModulePromise=import("./local-tracks.js"))}
function localStatus(note){setText("local-playback-status",note)}
function localReadyCount(){
 const filters=chosenFilters();
 return localTracks.filter(t=>t.artist&&t.title&&t.year&&t.genres.some(g=>filters.genres.includes(g))&&
  (!filters.decades.length||filters.decades.includes(String(Math.floor(t.year/10)*10)))).length;
}
function renderLocalTracks(){
 const root=$("local-track-list"),search=$("local-music-search").value.toLowerCase().trim();
 const subset=localTracks.filter(t=>!search||(t.title+" "+t.artist+" "+t.file.name).toLowerCase().includes(search));
 root.replaceChildren();
 for(const t of subset.slice(0,localReviewShown)){
  const row=document.createElement("div");row.className="local-track-row"+(t.needsReview?" needs-review":"");
  for(const [name,label,value] of [["title","Song title",t.title],["artist","Artist",t.artist],
   ["genres","Genres",t.genres.join(", ")],["year","Year",t.year||""]]){
   const l=document.createElement("label");l.textContent=label;
   const inp=document.createElement("input");inp.value=String(value);inp.maxLength=name==="year"?4:100;
   inp.setAttribute("aria-label",label+" for "+t.file.name);
   if(name==="year")inp.inputMode="numeric";
   inp.addEventListener("change",()=>{
    if(name==="year"){const num=Number(inp.value);t.year=Number.isInteger(num)&&num>=1950&&num<=2100?num:null;}
    else if(name==="genres"){t.genres=[...new Set(inp.value.toLowerCase().split(/[,;]/)
     .map(x=>x.trim()).filter(x=>["pop","rock","hiphop","electronic","indie","dutch","disco","rnb","metal","dance"].includes(x)))];}
    else t[name]=inp.value.slice(0,100).trim();
    t.needsReview=!t.title||!t.artist||!t.year||!t.genres.length;
    updateLocalCounts();row.classList.toggle("needs-review",t.needsReview);
   });
   l.append(inp);row.append(l);
  }
  root.append(row);
 }
 show("local-review",localTracks.length>0);
 setText("local-tracks-shown",subset.length?"Showing "+Math.min(subset.length,localReviewShown)+" of "+subset.length+" matches":"No matching songs");
 show("local-show-more",subset.length>localReviewShown);
 setText("local-review-count",localTracks.length+" imported");
}
function updateLocalCounts(){
 const complete=localTracks.filter(t=>!t.needsReview).length;
 const eligible=localReadyCount();
 setText("local-music-count",localImporting?"Reading local song metadata…":
  localTracks.length+" audio files selected · "+complete+" fully tagged · "+eligible+" match the current genre/decade filters.");
}
async function importLocalFiles(list){
 if(room?.phase!=="lobby"||!isHost()||localImporting)return;
 localImporting=true;updateLocalCounts();
 try{
  const lib=await localLib();
  const files=[...list].filter(f=>f.size>0),added=[];
  for(const file of files){
   const key=file.name+"::"+file.size+"::"+file.lastModified;
   if(localSourceCache.has(key))continue;
   const track=await lib.inspectLocalTrack(file,localTracks.length+added.length);
   if(track){added.push(track);localSourceCache.add(key)}
   if(added.length%20===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  localTracks.push(...added);
  if(!added.length)message("No new playable audio files found. Try MP3, M4A or another supported audio file.");
  else message(added.length+" music files added locally. No audio uploaded.");
 }catch(e){message("Could not read the selected music: "+e.message)}
 finally{localImporting=false;updateLocalCounts();renderLocalTracks();}
}
function discardLocalAudio(){
 try{playerAudio.pause();playerAudio.removeAttribute("src");playerAudio.load()}catch{}
 if(localAudioUrl){URL.revokeObjectURL(localAudioUrl);localAudioUrl=null}
 localCurrentIndex=null;
}
async function getLocalDuration(file){
 const url=URL.createObjectURL(file),probe=new Audio();
 try{
  probe.preload="metadata";
  const duration=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{cleanup();reject(Error("Audio metadata timed out"))},9000);
   const cleanup=()=>{clearTimeout(timer);probe.onloadedmetadata=null;probe.onerror=null};
   probe.onloadedmetadata=()=>{cleanup();resolve(probe.duration)};
   probe.onerror=()=>{cleanup();reject(Error("This audio format is not supported by the browser"))};
   probe.src=url;probe.load();
  });
  if(!Number.isFinite(duration)||duration<30||duration>7200)throw Error("Song length is not supported");
  return duration;
 }finally{probe.removeAttribute("src");probe.load();URL.revokeObjectURL(url)}
}
async function selectLocalRound(){
 if(localImporting)throw Error("Music is still importing.");
 const lib=await localLib(),f=chosenFilters();
 if(!f.genres.length)throw Error("Select at least one genre.");
 const attempted=new Set(localPlayed),max=localTracks.length;
 for(let tries=0;tries<max;tries++){
  const track=lib.chooseNextLocalTrack(localTracks,f.genres,f.decades,attempted);
  attempted.add(track.index);
  let duration;
  try{duration=await getLocalDuration(track.file)}catch{continue}
  const cueMs=lib.chooseFullTrackCue(duration);
  const url=URL.createObjectURL(track.file);
  discardLocalAudio();
  localAudioUrl=url;localCurrentIndex=track.index;
  playerAudio.preload="auto";playerAudio.src=url;playerAudio.load();
  localStatus("Track ready. Tap Play next clue to hear the recording.");
  return {mode:"local",song:track.title,artist:track.artist,
   fileIndex:track.index,cueMs,durationMs:Math.floor(duration*1000)};
 }
 throw Error("No matching playable recordings. Check file formats and song metadata.");
}
async function playLocalHint(info){
 const index=Number(String(info.source||"").slice(6));
 if(!Number.isInteger(index)||index!==localCurrentIndex||!localAudioUrl)
  throw Error("The host audio file is not loaded. Reopen the song collection on this tablet.");
 const cue=(info.cueMs||0)/1000;
 if(playerAudio.readyState===0)throw Error("The selected file could not load. Try a supported MP3.");
 playerAudio.currentTime=cue;
 try{await playerAudio.play()}catch(e){throw Error("Your browser blocked audio. Tap the Play clue button again: "+String(e.message||e))}
 localStatus("Playing clue from "+Math.round(cue)+" seconds into the song.");
}

function chosenSource(){return document.querySelector('input[name="music-source"]:checked')?.value||"demo"}
function updateAudioChoice(){
 const mode=chosenSource();
 show("youtube-setup",mode==="youtube");
 show("demo-settings",mode==="demo");
 show("catalog-settings",mode==="catalog"||mode==="deezer"||mode==="local");
 show("local-settings",mode==="local");
 if(mode==="local")updateLocalCounts();
}
function parseYoutubeVideo(link){
 const u=new URL(String(link||"").trim());
 if(u.protocol!=="https:")throw Error("invalid_youtube_video");
 let id="";
 if(["music.youtube.com","www.youtube.com","youtube.com","m.youtube.com"].includes(u.hostname)){
  if(u.pathname==="/watch")id=u.searchParams.get("v")||"";
  else if(u.pathname.startsWith("/shorts/"))id=u.pathname.split("/")[2]||"";
 }else if(u.hostname==="youtu.be")id=u.pathname.split("/")[1]||"";
 if(!/^[A-Za-z0-9_-]{11}$/.test(id))throw Error("invalid_youtube_video");
 return id;
}
function youtubeRound(prefix){
 let id;
 try{id=parseYoutubeVideo($(prefix+"-link").value)}catch{throw Error("invalid_youtube_video")}
 const song=$(prefix+"-song").value.trim(),artist=$(prefix+"-artist").value.trim();
 const raw=$(prefix+"-cue").value.trim(),sec=Number(raw);
 if(!song||!artist)throw Error("provide_song_and_artist");
 if(!/^\d{1,3}$/.test(raw)||sec>600)throw Error("invalid_cue");
 return {mode:"youtube",videoId:id,song,artist,cueMs:sec*1000};
}
function youtubeWaitCancelled(reason="YouTube playback was interrupted"){
 if(ytPlayingTimer)clearTimeout(ytPlayingTimer);
 ytPlayingTimer=null;
 if(ytPlayingReject){
  const fail=ytPlayingReject;ytPlayingReject=null;ytPlayingResolve=null;
  fail(Error(reason));
 }
}
function youtubeStatus(text){
 const el=$("youtube-status");el.textContent=text;el.hidden=!text;
}
function youtubeErrorText(code){
 if(code===101||code===150)return "This video’s owner blocks embedded playback. Use Skip / Reveal song to choose another video.";
 if(code===100)return "This video is private or no longer available. Skip it or choose another link.";
 if(code===153)return "YouTube could not identify this website. Open the game in Safari or Chrome and allow the player to load.";
 if(code===2)return "This YouTube video link is invalid. Choose another link.";
 return "YouTube could not play this video (error "+code+"). Try another video or browser.";
}
async function ensureYoutubePlayer(id,cueMs=0){
 if(!isHost()||!/^[A-Za-z0-9_-]{11}$/.test(id))throw Error("invalid_youtube_video");
 if(ytError?.id===id)throw Error(ytError.message);
 if(!ytReadyPromise){
  const loadGeneration=++ytLoadGeneration;
  youtubeStatus("Loading the official YouTube player…");
  ytReadyPromise=new Promise((resolve,reject)=>{
   let ready=false;
   const timer=setTimeout(()=>fail("YouTube player did not load. Check your connection and tap Play next clue to retry."),15000);
   const fail=msg=>{if(loadGeneration!==ytLoadGeneration)return;ytLoadGeneration++;clearTimeout(timer);ytReadyPromise=null;youtubeStatus(msg);reject(Error(msg))};
   const create=()=>{
    if(loadGeneration!==ytLoadGeneration)return;
    if(!window.YT?.Player){fail("YouTube player unavailable");return}
    // The API replaces this element with an iframe. Restore it after a failed load.
    if(ytPlayer){try{ytPlayer.destroy()}catch{}ytPlayer=null}
    if(!$("youtube-player")){
     const mount=document.createElement("div");mount.id="youtube-player";mount.className="youtube-frame";
     $("youtube-status").before(mount);
    }
    ytError=null;
    ytPlayer=new YT.Player("youtube-player",{
     width:"560",height:"315",videoId:id,
     playerVars:{playsinline:1,controls:1,origin:location.origin},
     events:{
      onReady:()=>{if(loadGeneration!==ytLoadGeneration)return;ready=true;clearTimeout(timer);youtubeStatus("Ready. Keep the video visible and tap Play next clue.");resolve()},
      onStateChange:e=>{
       if(loadGeneration!==ytLoadGeneration)return;
       if(e.data===window.YT.PlayerState.PLAYING&&(!isHost()||room?.phase!=="playing")){
        try{ytPlayer.pauseVideo()}catch{}return;
       }
       if(e.data===window.YT.PlayerState.PLAYING&&ytPlayingResolve){
        const done=ytPlayingResolve;clearTimeout(ytPlayingTimer);
        ytPlayingTimer=null;ytPlayingResolve=null;ytPlayingReject=null;done();
        youtubeStatus("Playing clue…");
       }
      },
      onError:e=>{
       if(loadGeneration!==ytLoadGeneration)return;
       const reason=youtubeErrorText(e.data);
       ytError={id:ytPlayerVideoId,message:reason};youtubeStatus(reason);
       youtubeWaitCancelled(reason);if(!ready)fail(reason);
      },
      onAutoplayBlocked:()=>{if(loadGeneration===ytLoadGeneration)youtubeStatus("Your browser needs a tap on Play inside the YouTube video. Then the clue can begin.")}
     }
    });
    ytPlayerVideoId=id;
   };
   if(window.YT?.Player){create();return}
   window.onYouTubeIframeAPIReady=create;
   const script=document.createElement("script");
   script.src="https://www.youtube.com/iframe_api";script.async=true;
   script.onerror=()=>fail("YouTube player failed to load");
   document.head.append(script);
  });
 }
 await ytReadyPromise;
 if(ytPlayerVideoId!==id){
  ytError=null;youtubeStatus("Preparing the next video…");
  ytPlayer.cueVideoById({videoId:id,startSeconds:cueMs/1000});
  ytPlayerVideoId=id;
 }
 if(ytError?.id===id)throw Error(ytError.message);
}
function youtubeVideoIsVisible(){
 const player=$("youtube-player");
 if(!player||player.closest("[hidden]")||document.hidden)return false;
 const el=player.querySelector("iframe")||player;
 const r=el.getBoundingClientRect();
 if(r.height<200||r.width<200)return false;
 const visible=Math.max(0,Math.min(r.bottom,window.innerHeight)-Math.max(r.top,0));
 return visible>=r.height*0.5;
}
async function playYoutubeHint(info){
 await ensureYoutubePlayer(info.source.slice(8),info.cueMs||0);
 if(!room||!isHost()||room.phase!=="playing")throw Error("YouTube clue cancelled");
 if(!youtubeVideoIsVisible())throw Error("Scroll to the official YouTube player; more than half of it must be visible before starting a clue.");
 youtubeStatus("Starting clue… If asked, tap Play inside the YouTube video.");
 await new Promise((resolve,reject)=>{
  ytPlayingResolve=resolve;ytPlayingReject=reject;
  ytPlayingTimer=setTimeout(()=>youtubeWaitCancelled("Tap Play on the YouTube player and try this clue again."),10000);
  try{ytPlayer.seekTo((info.cueMs||0)/1000,true);ytPlayer.playVideo()}
  catch{youtubeWaitCancelled("YouTube could not start this video")}
 });
 if(!room||room.phase!=="playing")throw Error("Clue interrupted");
}

function clearAudio(){
 clipGeneration++;
 clearTimeout(clipTimer);clipTimer=null;
 voices.forEach(o=>{try{o.stop()}catch{}});
 voices=[];try{deezerPlayer?.stop()}catch{}playerAudio.pause();
 youtubeWaitCancelled();
 try{ytPlayer?.pauseVideo()}catch{}
 startedClip=false;
}
function cancelNext(){clearTimeout(nextTimer);nextTimer=null}
function isHost(){return room?.role==="host"}
async function soundUnlock(){
 try{
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC)throw Error("This browser does not support audio.");
  if(!ctx)ctx=new AC();
  await ctx.resume();
  message("Tablet audio enabled");
  if(isHost()&&room?.phase==="paused")scheduleNext(500);
 }catch(e){message(e.message||"Tap to enable sound on your tablet")}
}
function notesFor(source) {
 const tunes={
 twinkle:["C4","C4","G4","G4","A4","A4","G4","_","F4","F4","E4","E4","D4","D4","C4","_",
 "G4","G4","F4","F4","E4","E4","D4","_","G4","G4","F4","F4","E4","E4","D4","_"],
 ode:["E4","E4","F4","G4","G4","F4","E4","D4","C4","C4","D4","E4","E4","D4","D4","_",
 "E4","E4","F4","G4","G4","F4","E4","D4","C4","C4","D4","E4","D4","C4","C4","_"],
 jacques:["C4","D4","E4","C4","C4","D4","E4","C4","E4","F4","G4","_","E4","F4","G4","_",
 "G4","A4","G4","F4","E4","C4","G4","A4","G4","F4","E4","C4"],
 elise:["E5","D#5","E5","D#5","E5","B4","D5","C5","A4","_","C4","E4","A4","B4","_",
 "E4","G#4","B4","C5","_","E4","E5","D#5","E5","D#5","E5","B4","D5","C5","A4"],
 greensleeves:["A4","C5","D5","E5","F5","E5","D5","B4","G4","A4","B4","C5",
 "A4","A4","G#4","A4","B4","G#4","E4","F4","G#4","A4","A4"]
 };
 return tunes[source.slice(5)]||tunes.twinkle;
}
function freq(note){
 const m=/^([A-G])(#?)([0-8])$/.exec(note);
 if(!m)return 0;
 const base={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]];
 const midi=12*(Number(m[3])+1)+base+(m[2]?1:0);
 return 440*Math.pow(2,(midi-69)/12);
}
async function startAudio(info,ms) {
 if(!info?.source)throw Error("No recording assigned");
 if(info.source.startsWith("deezer:")){
  if(!deezerPlayer||deezerPreparedRound!==room.code+":"+room.round+":"+info.source)
   throw Error("Deezer preview has not been prepared for this track.");
  await deezerPlayer.play(ms);
 } else if(info.source.startsWith("youtube:")){
  await playYoutubeHint(info);
 } else if(info.source.startsWith("demo:")){
  await soundResumeSilently();
  const sequence=notesFor(info.source);
  const step=0.33, t0=ctx.currentTime+0.03,duration=ms/1000;
  // Each repeat starts at the same cue, so hints reveal progressively more music.
  for(let k=0;k<Math.ceil(duration/step);k++){
   const frequency=freq(sequence[k%sequence.length]);
   if(!frequency)continue;
   const start=t0+k*step,end=t0+Math.min(duration,(k+1)*step-0.025);
   if(end<=start)continue;
   const osc=ctx.createOscillator(),gain=ctx.createGain();
   osc.type="triangle";osc.frequency.value=frequency;
   gain.gain.setValueAtTime(0.001,start);
   gain.gain.exponentialRampToValueAtTime(0.095,start+0.02);
   gain.gain.setValueAtTime(0.095,Math.max(start+0.02,end-0.025));
   gain.gain.exponentialRampToValueAtTime(0.001,end);
   osc.connect(gain).connect(ctx.destination);
   osc.start(start);osc.stop(end+0.01);voices.push(osc);
  }
 } else {
  // Only serve recordings explicitly installed in the site's licensed-audio folder.
  const url=new URL(info.source,location.origin);
  if(url.origin!==location.origin||!url.pathname.startsWith("/music/audio/"))
   throw Error("This recording is not hosted in the licensed audio folder");
  if(playerAudio.src!==url.href)playerAudio.src=url.href;
  if(playerAudio.readyState<1){
   playerAudio.load();
   await new Promise((resolve,reject)=>{
    const done=()=>{playerAudio.removeEventListener("loadedmetadata",done);playerAudio.removeEventListener("error",bad);resolve()};
    const bad=()=>{playerAudio.removeEventListener("loadedmetadata",done);playerAudio.removeEventListener("error",bad);reject(Error("Audio failed to load"))};
    playerAudio.addEventListener("loadedmetadata",done,{once:true});
    playerAudio.addEventListener("error",bad,{once:true});
   });
  }
  playerAudio.currentTime=(info.cueMs||0)/1000;
  await playerAudio.play();
 }
 startedClip=true;
}
async function soundResumeSilently(){
 const AC=window.AudioContext||window.webkitAudioContext;
 if(!AC)throw Error("Audio is not supported on this device");
 if(!ctx)ctx=new AC();
 await ctx.resume();
 if(ctx.state!=="running")throw Error("Please tap Enable tablet audio");
}
function scheduleNext(delay){
 if(!isHost()||!room||room.phase!=="paused"||room.step>=6||nextTimer||room.mode==="youtube"||room.mode==="catalog"||room.mode==="deezer")return;
 const round=room.round,step=room.step;
 nextTimer=setTimeout(async()=>{
  nextTimer=null;
  if(!room||room.round!==round||room.step!==step||room.phase!=="paused")return;
  if(loading)return scheduleNext(400);
  try{await startClip()}catch(e){message(e.message); }
 },delay);
}
async function startClip(replay=false){
 replay=replay||failedClue===room?.round+":"+room?.step;
 if(!room||!isHost()||loading||(!replay&&room.phase!=="paused")||
  (replay&&(!["paused","playing"].includes(room.phase)||room.step<0||room.firstAnswered)))return;
 cancelNext();
 const generation=++clipGeneration,round=room.round,initialStep=room.step;
 try{
  setLoading(true);
  if(room.mode==="deezer"){
   await ensureDeezerPreview();
   if(generation!==clipGeneration)return;
  }
  if(room.mode==="youtube"||room.mode==="catalog"){
   // Fail before consuming a hint when the player is unavailable or off screen.
   await ensureYoutubePlayer(room.audio?.source?.slice(8),room.audio?.cueMs||0);
   if(generation!==clipGeneration)return;
   if(!youtubeVideoIsVisible())throw Error("Scroll to the official YouTube player; more than half of it must be visible before starting a clue.");
  }
  if(room.mode==="catalog"&&room.step===-1){
   const id=room.audio?.source?.startsWith("youtube:")?room.audio.source.slice(8):"";
   await ensureYoutubePlayer(id,0);
   let durationMs=0;
   for(let attempt=0;attempt<16;attempt++){
    // cueVideoById is asynchronous; never use the previous song's duration.
    let loadedId="";try{loadedId=parseYoutubeVideo(ytPlayer?.getVideoUrl?.()||"")}catch{}
    durationMs=loadedId===id?Math.floor((ytPlayer?.getDuration?.()||0)*1000):0;
    if(durationMs>=45000)break;
    if(attempt===0){try{ytPlayer?.cueVideoById?.({videoId:id,startSeconds:0})}catch{}}
    await new Promise(resolve=>setTimeout(resolve,300));
   }
   if(durationMs<45000)throw Error("YouTube did not report the full video duration. Tap the official video once, or skip this song.");
   if(generation!==clipGeneration||!room||room.phase!=="paused"||room.round!==round)return;
   const cue=await rpc("random_cue",{durationMs});
   applyState(cue.state);
  }
  if(generation!==clipGeneration||!room||room.round!==round||room.step!==initialStep||
   (replay?!["paused","playing"].includes(room.phase):room.phase!=="paused"))return;
  const body=await rpc(replay?"replay":"play",replay?{expectedRound:round,expectedStep:initialStep}:{});applyState(body.state);
  if(room.phase!=="playing")return;
  await startAudio(room.audio,room.clipMs);
  if(generation!==clipGeneration||!room||room.phase!=="playing")return;
  failedClue="";
  const expected=room.round,step=room.step;
  clipTimer=setTimeout(async()=>{
   if(!room||room.phase!=="playing"||room.round!==expected||room.step!==step)return;
   clearAudio();
   if(room.mode==="youtube"||room.mode==="catalog")youtubeStatus("Clue finished. Players can buzz, or you can play the next clue.");
   try{
    const b=await rpc("pause");applyState(b.state);
    if(room.phase==="paused")scheduleNext(1000);
   }catch(e){message(e.message)}
  },room.clipMs);
 }catch(e){
  if(generation!==clipGeneration)return;
  if(room?.phase==="playing")failedClue=room.round+":"+room.step;
  clearAudio();message(e.message||"Playback failed");
  if(room?.mode==="youtube"||room?.mode==="catalog")youtubeStatus(e.message||"Playback failed. Choose another video.");
  if(room?.mode==="deezer")deezerStatus(e.message||"Deezer preview could not play; skip this track.");
  if(room?.phase==="playing")try{const b=await rpc("pause");applyState(b.state)}catch{}
 }
 finally{setLoading(false)}
}
function applyState(s){
 const oldPhase=room?.phase||"",oldRound=room?.round||0;
 room=s;
 if(s.firstAnswered||s.phase==="answering")failedClue="";
 const newRound=s.round;
 if(oldRound!==newRound){
  lastBlockKey="";answeredFocusKey="";failedClue="";cancelNext();clearAudio();
  deezerPreparedRound="";try{deezerPlayer?.dispose()}catch{}deezerPlayer=null;
 }
 if(isHost()){
  if(s.phase==="answering"||s.phase==="holding"||s.phase==="solved"||s.phase==="finished"){clearAudio();cancelNext();}
  if(s.phase==="paused"){
   if(oldPhase==="lobby"||oldPhase==="solved"||oldPhase==="holding"||!oldPhase)scheduleNext(850);
   else if(oldPhase==="playing"){clearAudio();scheduleNext(1000);}
  }
 }else{cancelNext();clearAudio()}
 render();
}
function show(id,visible){$(id).hidden=!visible}
function makePlayer(name){
 const span=document.createElement("span");span.textContent=name;return span;
}
function renderScores(target){
 const root=$(target);root.replaceChildren();
 (room.players||[]).forEach((p,i)=>{
  const row=document.createElement("div");row.className="score-entry";
  const name=document.createElement("span");name.textContent=(i===0?"♛ ":"")+p.name;
  const score=document.createElement("strong");score.textContent=Number(p.score).toFixed(1);
  const bar=document.createElement("div");bar.className="score-progress";
  const progress=document.createElement("i");progress.style.width=(Math.max(0,Math.min(20,Number(p.score)))/20*100)+"%";
  bar.append(progress);row.append(name,score,bar);root.append(row);
 });
}
function render(){
 if(!room){show("welcome",true);show("room",false);$("room").classList.remove("host-mode");return;}
 show("welcome",false);show("room",true);
 const host=isHost(),phase=room.phase,playing=phase!=="lobby";
 $("room").classList.toggle("host-mode",host);
 $("room").dataset.phase=phase;
 show("host-fullscreen",host);
 if(host){
  const source=room.mode==="deezer"?"DEEZER PREVIEW":room.mode==="catalog"?"AUTO MIX":room.mode==="youtube"?"YOUTUBE VIDEO":"DEMO MELODIES";
  const filters=(room.mode==="catalog"||room.mode==="deezer")?[
   ...(room.genres||[]).filter(x=>x!=="demo").map(x=>({hiphop:"HIP-HOP",rnb:"R&B",dutch:"DUTCH",electronic:"ELECTRONIC"}[x]||x.toUpperCase())),
   ...(room.decades||[]).map(x=>x+"s")
  ]:[];
  setText("host-track-context",source+(filters.length?"  ·  "+filters.join(" / "):"  ·  MYSTERY TRACK"));
  setText("host-player-count",room.players.length+" PLAYER"+(room.players.length===1?"":"S")+" CONNECTED");
  const ed=$("playing").querySelector(".disc-art-edition");
  if(ed)ed.textContent="MYSTERY "+String(Math.max(1,room.round||1)).padStart(2,"0");
 }
 setText("role-indicator",host?"HOST / TABLET":"PLAYER / PHONE");
 setText("room-title",playing?"Name that tune":"Game lobby");
 setText("room-code",room.code);
 show("lobby",phase==="lobby");show("playing",phase!=="lobby");
 show("host-settings",host);show("guest-wait",!host);
 if(host&&phase==="lobby")updateAudioChoice();
 $("lobby-players").replaceChildren(...room.players.map(x=>makePlayer(x.name)));
 setText("lobby-player-count",room.players.length+" player"+(room.players.length===1?"":"s")+" joined");
 if(phase==="lobby"&&!genresDirty&&room.genres.some(g=>g!=="demo")){
  document.querySelectorAll("#genre-options input").forEach(input=>{
   input.checked=room.genres.includes(input.value);
   input.disabled=!host;
  });
  document.querySelectorAll("#decade-options input").forEach(input=>{
   input.checked=(room.decades||[]).includes(input.value);
   input.disabled=!host;
  });
 }
 if(phase!=="lobby"){
  setText("round-label","ROUND "+room.round);
  setText("hint-label",room.step<0?"READY":(room.clipMs/1000)+" SEC CLUE");
  setText("host-hint-progress",room.step<0?"7 chances to recognise it":"CLUE "+Math.min(7,room.step+1)+" / 7");
  const buzzerOwner=room.players.find(p=>p.id===room.lockedPlayer);
  const statuses={
   paused:["Music paused","Buzz now, or wait for the next hint."],
   holding:["STEAL WINDOW OPEN","Another player can risk points for the answer, or the host can continue."],
   playing:["Listen carefully","Buzz as soon as you know it!"],
   answering:[room.stealTurn?"STEAL IN PROGRESS":"BUZZER CLAIMED",buzzerOwner?buzzerOwner.name+(room.stealTurn?" is stealing!":" is answering."):"Waiting for an answer."],
   solved:["Song identified!","Host can move to the next round."],
   finished:["We have a winner!","First player to 20 points wins."]
  };
  const status=statuses[phase]||["Get ready","The host is preparing audio."];
  setText("master-message",phase==="holding"?"HIGH-STAKES STEAL ROUND":phase==="answering"?(buzzerOwner?.name||"A player")+" is locked in":phase==="solved"?"TRACK IDENTIFIED — ADVANCE WHEN READY":phase==="playing"?"LISTEN NOW":phase==="finished"?"WINNER DECLARED":"WAITING FOR A BUZZ");
  show("host-ticker",host);
  const clips=[0.5,1.5,3,5,8,12,20],timeline=$("clip-timeline");
  timeline.replaceChildren(...clips.map((seconds,i)=>{
   const mark=document.createElement("span");mark.textContent=seconds+"s";mark.className=i<room.step?"heard":i===room.step?"now":"upcoming";return mark;
  }));
  setText("stage-status",status[0]);setText("stage-subtitle",status[1]);
  $("playing").querySelector(".stage").classList.toggle("is-playing",phase==="playing");
  $("playing").querySelector(".stage").classList.toggle("is-answering",phase==="answering");
  show("answer-reveal",room.titleDone||room.artistDone||phase==="solved"||phase==="finished");
  setText("revealed-title",room.titleDone||phase==="solved"||phase==="finished"?room.title:"Song title: ???");
  setText("revealed-artist",room.artistDone||phase==="solved"||phase==="finished"?room.artist:"Artist: ???");
  show("host-controls",host);show("player-controls",!host);
  show("host-demo-play",host&&room.mode==="demo"&&phase==="paused"&&room.step<6);
  const youtubeMode=room.mode==="youtube"||room.mode==="catalog";
  show("youtube-host",host&&youtubeMode);
  if(host&&youtubeMode&&room.audio?.source?.startsWith("youtube:")){
   ensureYoutubePlayer(room.audio.source.slice(8),room.audio.cueMs||0).catch(e=>youtubeStatus(e.message));
  }
  show("youtube-play-hint",host&&youtubeMode&&phase==="paused"&&room.step<6);
  setText("youtube-play-hint",failedClue===room.round+":"+room.step?"↻ Retry this clue":"▶ Play next clue");
  show("youtube-replay-hint",host&&youtubeMode&&room.step>=0&&!room.firstAnswered&&
   (phase==="paused"||(phase==="playing"&&!startedClip)));
  show("youtube-next-form",host&&room.mode==="youtube"&&phase==="solved");
  const deezerMode=room.mode==="deezer";
  show("deezer-host",host&&deezerMode);
  show("deezer-play-hint",host&&deezerMode&&phase==="paused"&&room.step<6);
  show("deezer-replay-hint",host&&deezerMode&&room.step>=0&&!room.firstAnswered&&
   (phase==="paused"||(phase==="playing"&&!startedClip)));

  show("next-round",host&&phase==="solved"&&room.mode!=="youtube");show("continue-hints",host&&phase==="holding"&&room.step<6);show("skip-round",host&&(room.step===6||youtubeMode||deezerMode)&&(phase==="paused"||phase==="playing"||phase==="holding"));
  show("enable-sound",host&&!youtubeMode&&!deezerMode&&phase!=="finished"&&(!ctx||ctx.state!=="running"));
  if(!host){
   const iAmAnswering=phase==="answering"&&room.lockedPlayer===room.me;
   const guessKey=room.round+":"+room.step;
   const blocked=lastBlockKey===guessKey||room.myBlockedStep===room.step;
   const allowRegular=(phase==="playing"||phase==="paused")&&!room.firstAnswered&&room.step>=0&&!blocked;
   const allowSteal=phase==="holding"&&room.firstAnswered&&room.step>=0&&!blocked;
   $("buzz").disabled=!allowRegular;
   $("steal").disabled=!allowSteal;
   show("buzz",!iAmAnswering&&phase!=="holding");
   show("steal",!iAmAnswering&&phase==="holding");
   show("answer-overlay",iAmAnswering);
   if(iAmAnswering){
    setText("answer-kicker",room.stealTurn?"⚡ STEAL CHALLENGE":"🎤 YOUR BUZZ WON");
    setText("answer-title",room.stealTurn?"Risk it for the steal":"Name that tune");
    setText("answer-mode-text",room.stealTurn?"+0.5 for each correct field, −1 for each wrong field. Complete both unknown fields. Your score cannot go below zero.":"Earn +0.5 for each correct field or lose 0.5 for each wrong field. Leave unknown fields blank. Minor typos are accepted.");
    setText("song-guess-label",room.stealTurn?"Song title (+0.5 / −1)":"Song title (+0.5 / −0.5)");
    setText("artist-guess-label",room.stealTurn?"Artist (+0.5 / −1)":"Artist (+0.5 / −0.5)");
    const left=Math.max(0,Math.ceil((new Date(room.answerExpiresAt).getTime()-Date.now())/1000));
    setText("answer-countdown",left+"s to answer");
    $("song-guess").required=room.stealTurn&&!room.titleDone;
    $("artist-guess").required=room.stealTurn&&!room.artistDone;
   }
   $("song-guess").disabled=room.titleDone;
   $("artist-guess").disabled=room.artistDone;
   $("song-guess").placeholder=room.titleDone?"Already identified":"Enter title";
   $("artist-guess").placeholder=room.artistDone?"Already identified":"Enter artist";
   if(iAmAnswering&&answeredFocusKey!==guessKey){
    answeredFocusKey=guessKey;$("song-guess").value="";$("artist-guess").value="";
    setTimeout(()=>{(room?.titleDone?$("artist-guess"):$("song-guess")).focus()},30);
   }
  }
  renderScores("scores");
  const me=room.players.find(p=>p.id===room.me);
  show("my-score",!!me);if(me)$("my-score").querySelector("strong").textContent=Number(me.score).toFixed(1);
  show("finish",phase==="finished");
  if(phase==="finished"){
   const champion=room.players.find(p=>p.id===room.winner);
   setText("winner-name",champion?.name||"Winner");
   const final=$("final-scores");final.replaceChildren();
   room.players.forEach(p=>final.append(makePlayer(p.name+" • "+Number(p.score).toFixed(1)+" points")));
  }
 }
}
async function call(action,extra={},quiet=false){
 if(loading)return;
 setLoading(true);
 try{const b=await rpc(action,extra);applyState(b.state);return b;}
 catch(e){if(!quiet)message(e.message);throw e}
 finally{setLoading(false)}
}
async function refresh(){
 if(!access||pollBusy||(loading&&!ytPlayingResolve))return;
 pollBusy=true;
 const version=mutationVersion;
 try{
  const b=await rpc("state");
  if(version!==mutationVersion)return;
  if(b.state.phase==="answering"&&b.state.answerExpiresAt&&Date.now()>=new Date(b.state.answerExpiresAt).getTime()){
   try{const expired=await rpc("expire");applyState(expired.state);return;}catch{}
  }
  applyState(b.state);
 }
 catch(e){if(e.message==="unauthorized"||e.message==="room_expired"){reset();message(e.message)}}
 finally{pollBusy=false}
}
function reset(){
 cancelNext();clearAudio();failedClue="";deezerPreparedRound="";try{deezerPlayer?.dispose()}catch{}deezerPlayer=null;room=null;access=null;safeStore();render();
}
async function create(){
 if(loading)return;
 setLoading(true);
 try{
  const b=await rpc("create"); // Create endpoint ignores the absent local room/token.
  access={code:b.state.code,token:b.token};safeStore();applyState(b.state);
 }catch(e){message(e.message)}finally{setLoading(false)}
}
async function join(e){
 e.preventDefault();if(loading)return;
 const code=$("join-code").value.trim().toUpperCase();
 const name=$("nickname").value.trim();
 if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code)||!name){message("Enter a valid code and nickname");return}
 setLoading(true);
 try{
  const b=await rpc("join",{code,name});
  access={code:b.state.code,token:b.token};safeStore();applyState(b.state);
 }catch(e){message(e.message)}finally{setLoading(false)}
}
function inviteUrl(){
 const u=new URL(location.href);u.search="";u.searchParams.set("room",room?.code||"");
 return u.href;
}
async function share(){
 const url=inviteUrl();
 try{await navigator.clipboard.writeText(url);message("Invite link copied")}
 catch{prompt("Copy the lobby link",url)}
}
async function requestBuzz(){
 if(!room)return;
 const k=room.round+":"+room.step;
 try{await call("buzz");}
 catch(e){if(e.message==="already_tried_this_clip")lastBlockKey=k;}
}
async function submitGuess(e){
 e?.preventDefault();
 if(!room)return;
 const song=$("song-guess").disabled?"":$("song-guess").value;
 const artist=$("artist-guess").disabled?"":$("artist-guess").value;
 try{
  lastBlockKey=room.round+":"+room.step;
  await call("answer",{song,artist});
  message("Answer recorded");
 }catch{}
}
function chosenFilters(){
 return {
  genres:[...document.querySelectorAll("#genre-options input:checked")].map(x=>x.value),
  decades:[...document.querySelectorAll("#decade-options input:checked")].map(x=>x.value)
 };
}
async function saveGenres(){
 if(!room||!isHost()||room.phase!=="lobby"||!["catalog","deezer"].includes(chosenSource()))return;
 const filters=chosenFilters();
 if(!filters.genres.length){message("Select at least one genre");return}
 genresDirty=true;
 try{await call("settings",filters)}catch{}
 finally{genresDirty=false}
}
$("create").addEventListener("click",create);
$("join-form").addEventListener("submit",join);
$("copy-invite").addEventListener("click",share);
$("leave").addEventListener("click",()=>{if(confirm("Leave this game on this device?"))reset()});
$("enable-sound").addEventListener("click",soundUnlock);
$("host-demo-play").addEventListener("click",()=>startClip());
$("host-fullscreen").addEventListener("click",async()=>{
 const el=$("room");
 try {
  if(document.fullscreenElement){await document.exitFullscreen();return;}
  if(!el.requestFullscreen)throw Error("Your browser doesn't support fullscreen mode. Add Tune Rush to your home screen for an immersive view.");
  await el.requestFullscreen();
 }catch(e){message(e.message||"Fullscreen could not be enabled on this device.");}
});
document.addEventListener("fullscreenchange",()=>{
 $("host-fullscreen").innerHTML=document.fullscreenElement?'<span aria-hidden="true">⛶</span> Exit full screen':'<span aria-hidden="true">⛶</span> Full screen';
});
$("source-select").addEventListener("change",updateAudioChoice);
$("start").addEventListener("click",async()=>{
 try{
  clearTimeout(genresSaveTimer);
  const mode=chosenSource();
  if(mode==="catalog"||mode==="deezer"){
   if(mode==="deezer"&&!deezerAuthorized)throw Error("Deezer is awaiting authorization.");
   const filters=chosenFilters();
   if(!filters.genres.length)throw Error("Select at least one genre");
   await call("settings",filters);
  }else if(mode==="demo"){
   await call("settings",{genres:["demo"],decades:[]});
   await soundUnlock();
  }
  const data=mode==="youtube"?youtubeRound("youtube"):{mode};
  await call("start",data);
 }catch(e){message(e.message)}
});
$("deezer-play-hint").addEventListener("click",()=>startClip());
$("deezer-replay-hint").addEventListener("click",()=>startClip(true));
$("youtube-play-hint").addEventListener("click",()=>startClip());
$("youtube-replay-hint").addEventListener("click",()=>startClip(true));
$("youtube-next-form").addEventListener("submit",async e=>{
 e.preventDefault();
 try{const data=youtubeRound("next-youtube");await call("next",data)}
 catch(e){message(e.message)}
});
$("next-round").addEventListener("click",async()=>{try{await call("next")}catch{}});
$("continue-hints").addEventListener("click",async()=>{try{await call("resume")}catch{}});
$("skip-round").addEventListener("click",async()=>{try{await call("skip")}catch{}});
$("buzz").addEventListener("click",requestBuzz);
$("steal").addEventListener("click",async()=>{try{await call("steal")}catch{}});
$("pass").addEventListener("click",async()=>{try{await call("forfeit")}catch{}});
$("answer-form").addEventListener("submit",submitGuess);
$("genre-options").addEventListener("change",()=>{clearTimeout(genresSaveTimer);genresSaveTimer=setTimeout(saveGenres,250)});
$("decade-options").addEventListener("change",()=>{clearTimeout(genresSaveTimer);genresSaveTimer=setTimeout(saveGenres,250)});
document.addEventListener("visibilitychange",()=>{
 if(!document.hidden&&access)refresh();
 if(document.hidden&&isHost()){
  cancelNext();
  if(room?.mode==="youtube"||room?.mode==="catalog"||room?.mode==="deezer"){
   clearAudio();
   if(room?.phase==="playing")rpc("pause").then(b=>applyState(b.state)).catch(()=>{});
  }
 }
 if(!document.hidden&&isHost()&&room?.phase==="paused")scheduleNext(500);
});
window.addEventListener("pagehide",()=>{clearAudio();cancelNext()});
const fromUrl=new URLSearchParams(location.search).get("room");
if(fromUrl&&/^[A-HJ-NP-Z2-9]{6}$/i.test(fromUrl))$("join-code").value=fromUrl.toUpperCase();
try{
 const stored=JSON.parse(localStorage.getItem(STORE)||"null");
 if(stored&&/^[A-HJ-NP-Z2-9]{6}$/.test(stored.code)&&/^[0-9a-f]{64}$/.test(stored.token)){
  access=stored;refresh();
 }
}catch{}
render();
refreshDeezerApproval();
setInterval(()=>{if(access&&!document.hidden)refresh()},550);
