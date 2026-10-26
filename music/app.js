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
let clipTimer=null,nextTimer=null,startedClip=false;
let lastBlockKey="",answeredFocusKey="",prevRound=0,prevPhase="";
let genresDirty=false,genresSaveTimer=null;
let clipGeneration=0,mutationVersion=0;
let failedClue="";
const ERROR_TEXT={
 room_not_found:"That room does not exist.",room_expired:"Room expired. Create a new lobby.",
 unauthorized:"Your lobby session is no longer valid.",name_taken:"This name is already taken.",
 game_already_started:"This game already started.",no_players:"Wait for at least one player.",
 no_licensed_songs_for_genres:"No Audius songs match those filters. Expand your selections.",steal_closed:"Steal time is not open yet.",steal_requires_remaining_answers:"Complete every unknown field to submit a steal.",answer_time_expired:"Your answer window expired.",resume_unavailable:"Waiting for another answer, or there are no clues left.",room_capacity_reached:"Too many open rooms. Please try later.",
 buzz_closed:"Someone has already buzzed, or buzzing is not open.",
 already_tried_this_clip:"You've already guessed during this snippet. Wait for the next one.",
 not_your_turn:"Another player buzzed first.",not_ready_for_clip:"The music is paused for an answer.",
 replay_unavailable:"A clue can only be replayed before anyone answers it.",stale_clue:"The round has moved on. Use the current playback controls.",
 all_hints_used:"All snippets have played. The host can skip the song.",
 temporary_failure:"Connection interrupted. Wait for the room to update, then try again.",request_failed:"The request could not be completed.",invalid_music_source:"Only Audius streaming is available.",provide_song_and_artist:"Enter both song title and artist.",cue_not_available:"Unable to select a usable position in this Audius track."
};
function message(s) {
 const el=$("toast");el.textContent=ERROR_TEXT[s]||String(s||"");el.hidden=false;
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true},3300);
}
function setText(id,value){$(id).textContent=String(value??"")}
function setLoading(value){
 loading=value;
 for(const id of ["start","audius-play-hint","audius-replay-hint","next-round","continue-hints","skip-round"]){$(id).disabled=value}
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
  fileIndex:Number.isInteger(extra.fileIndex)?extra.fileIndex:-1,
  mode:String(extra.mode||"local"),
  videoId:String(extra.videoId||""),
  cueMs:Number.isInteger(extra.cueMs)?extra.cueMs:0,
  expectedRound:Number.isInteger(extra.expectedRound)?extra.expectedRound:0,
  expectedStep:Number.isInteger(extra.expectedStep)?extra.expectedStep:-1,
  excludeVideos:Array.isArray(extra.excludeVideos)?extra.excludeVideos.slice(0,1500):[]
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



/** Audius audio streams through the host browser; no files or legacy sources. */

// Keep three games of recent picks in this browser; never store audio bytes or song names.
let rotationModule=null,rotationHistory=null,rotationLoading=null;
async function rotation(){
 if(rotationModule)return rotationModule;
 if(rotationLoading)return rotationLoading;
 rotationLoading=import("./game-rotation.js?v=20261026a").then(mod=>{
  rotationModule=mod;
  let raw=null;try{raw=localStorage.getItem(mod.STORAGE_KEY)}catch{}
  rotationHistory=mod.readRotation(raw);
  return mod;
 });
 return rotationLoading;
}
function saveRotation(){
 if(!rotationModule)return;
 try{localStorage.setItem(rotationModule.STORAGE_KEY,JSON.stringify(rotationHistory))}catch{}
}
async function rememberSelectedSong(state){
 if(!state||state.role!=="host"||state.round<1||state.mode!=="local")return;
 if(!audiusTrack||!audiusActive||!/^local:\d+$/.test(state.audio?.source||""))return;
 if(Number(state.audio.source.slice(6))!==localCurrentIndex)return;
 const mod=await rotation();
 mod.notePlayed(rotationHistory,state.code,"audius",audiusTrack.id);
 saveRotation();
}

// Stream-only provider. Audius audio bytes go straight from HTTPS provider to
// host browser playback; none are copied to hub, S21, USB, or Supabase.
let audiusModule=null,audiusPool=[],audiusFiltersKey="",audiusActive=false;
let audiusTrack=null,audiusIndex=20000000,audiusChecking=false;
const AUDIUS_HOST_SESSION="tune-rush-audius-host-stream-v1";
let audiusRestoring=false;
async function audiusLib(){return audiusModule||(audiusModule=await import("./audius-stream.js?v=20261026a"))}
async function discoverAudius(force=false){
 if(audiusChecking)throw Error("Audius is already checking tracks.");
 const filters=chosenFilters(),key=JSON.stringify(filters);
 if(!filters.genres.length)throw Error("Select at least one genre.");
 if(!force&&key===audiusFiltersKey&&audiusPool.length)return audiusPool;
 audiusChecking=true;
 if(isHost()&&room?.phase==="lobby")$("start").disabled=true;
 $("audius-check").disabled=true;
 $("audius-check").textContent="⌛ Checking…";
 setText("audius-availability","Finding Audius tracks that match your selections…");
 try{
  const mod=await audiusLib();
  const tracks=await mod.discoverAudiusTracks(filters.genres,filters.decades);
  // Reject results for a mix that changed while the network request was pending.
  if(JSON.stringify(chosenFilters())!==key)
   throw Error("The genres or eras changed during the scan. Check tracks again.");
  audiusPool=tracks;audiusFiltersKey=key;
  const rotationTools=await rotation(),used=rotationTools.playedKeys(rotationHistory,"audius");
  const free=tracks.filter(x=>!used.has(x.id));
  setText("audius-availability",tracks.length+" distinct streamable tracks found; "+free.length+
   " not heard in your last three games. "+(free.length>=120?
    "This meets the 120-song planning target.":"Three typical games need about 120; "+Math.max(0,120-free.length)+
    " more would be needed for that target.")+
    (filters.decades.length?" Audius dates reflect provider release metadata; older originals may be absent.":""));
  return tracks;
 }catch(e){
  setText("audius-availability",String(e.message||e));
  throw e;
 }finally{
  audiusChecking=false;
  $("audius-check").disabled=false;
  $("audius-check").textContent="↻ Check tracks";
  $("start").disabled=loading;
 }
}
async function prepareAudiusPlayback(record,restoredIndex=null){
 const lib=await audiusLib(),uri=lib.streamUrl(record.id);
 // Browser audio element streams HTTPS; HTMLMediaElement handles range seeking.
 // Do not use fetch(blob), ArrayBuffer, MediaRecorder, downloads or disk caching.
 clearAudiusStream();
 localAudioUrl=uri;
 if(restoredIndex!==null){
  if(!Number.isSafeInteger(restoredIndex)||restoredIndex<1||restoredIndex>2147483647)
   throw Error("The saved host stream index is invalid.");
  localCurrentIndex=restoredIndex;
  audiusIndex=Math.max(audiusIndex,restoredIndex);
 }else localCurrentIndex=++audiusIndex;
 playerAudio.preload="metadata";
 const ready=new Promise((resolve,reject)=>{
  let timer=null;
  const cleanup=()=>{clearTimeout(timer);playerAudio.removeEventListener("loadedmetadata",loaded);
   playerAudio.removeEventListener("error",bad)};
  const loaded=()=>{cleanup();resolve(playerAudio.duration)};
  const bad=()=>{cleanup();reject(Error("Audius streaming host rejected this track"))};
  playerAudio.addEventListener("loadedmetadata",loaded,{once:true});
  playerAudio.addEventListener("error",bad,{once:true});
  timer=setTimeout(()=>{cleanup();reject(Error("Audius audio loading timed out"))},13000);
 });
 playerAudio.src=uri;playerAudio.load();
 const d=await ready;
 if(!Number.isFinite(d)||d<35||d>7200)throw Error("Audius track duration is unavailable");
 return {duration:d,index:localCurrentIndex,url:uri};
}
async function selectAudiusRound(){
 const lib=await audiusLib(),filters=chosenFilters();
 const tracks=await discoverAudius();
 const history=await rotation();
 if(room?.code){history.openGame(rotationHistory,room.code);saveRotation()}
 const previously=history.playedKeys(rotationHistory,"audius");
 const attempts=new Set(previously);
 const candidateCount=tracks.filter(t=>!attempts.has(t.id)).length;
 for(let i=0;i<Math.min(candidateCount,9);i++){
  const track=lib.chooseAudiusTrack(tracks,attempts);
  attempts.add(track.id);
  try{
   const prepared=await prepareAudiusPlayback(track);
   audiusActive=true;audiusTrack=track;
   const cue=lib.randomizedCueMs(prepared.duration);
   localStatus("Audius stream ready. Press Play next clue to hear the song.");
   return {mode:"local",song:track.title,artist:track.artist,
    fileIndex:prepared.index,cueMs:cue,durationMs:Math.floor(prepared.duration*1000)};
  }catch(e){clearAudiusStream();audiusTrack=null}
 }
 throw Error(candidateCount===0?
  "No unplayed Audius songs match your genres and decades. Expand the filters.":
  "Couldn't load a playable Audius stream. Check your internet connection or change filters.");
}

let localCurrentIndex=null,localAudioUrl=null;
function localStatus(note){setText("audius-playback-status",note)}
// Only the host tab saves the transient Audius track identity. Never save audio bytes,
// a guest capability, or a stream URL; sessionStorage disappears with the tab session.
function checkpointAudiusHost(state){
 if(state?.role!=="host"||state.mode!=="local"||!audiusActive||!audiusTrack)return;
 const source=state.audio?.source;
 if(!/^local:\d+$/.test(source||"")||Number(source.slice(6))!==localCurrentIndex)return;
 const record={code:state.code,round:state.round,source,
  id:audiusTrack.id,title:audiusTrack.title,artist:audiusTrack.artist,
  permalink:audiusTrack.permalink,updatedAt:Date.now()};
 try{sessionStorage.setItem(AUDIUS_HOST_SESSION,JSON.stringify(record))}catch{}
}
async function restoreAudiusHost(state){
 if(audiusRestoring||state?.role!=="host"||state.mode!=="local"||
    !/^local:\d+$/.test(state.audio?.source||"")||state.round<1||
    !["playing","paused","holding","answering","solved"].includes(state.phase))return;
 const wantedIndex=Number(state.audio.source.slice(6));
 if(audiusActive&&localAudioUrl&&localCurrentIndex===wantedIndex)return;
 let saved=null;
 try{saved=JSON.parse(sessionStorage.getItem(AUDIUS_HOST_SESSION)||"null")}catch{}
 // Host RPC deliberately redacts answer fields until reveal, including to
 // the host. Authenticate the checkpoint against private host-issued audio
 // source + room/round, and verify title/artist only when server reveals them.
 const valid=saved&&saved.code===state.code&&saved.round===state.round&&
  saved.source===state.audio.source&&
  (state.title==null||saved.title===state.title)&&
  (state.artist==null||saved.artist===state.artist)&&
  typeof saved.title==="string"&&saved.title.length>0&&saved.title.length<=100&&
  typeof saved.artist==="string"&&saved.artist.length>0&&saved.artist.length<=100&&
  typeof saved.id==="string"&&/^[A-Za-z0-9_-]{3,32}$/.test(saved.id)&&
  typeof saved.updatedAt==="number"&&Date.now()-saved.updatedAt>=0&&
  Date.now()-saved.updatedAt<8*60*60*1000;
 if(!valid){
  localStatus("This host tab has no recoverable stream for this round. Use Skip / Reveal song, then Next song.");
  return;
 }
 audiusRestoring=true;
 localStatus("Restoring this round's Audius stream without changing the song…");
 try{
  await prepareAudiusPlayback(saved,wantedIndex);
  if(!room||!isHost()||room.code!==state.code||room.round!==state.round||
     room.audio?.source!==state.audio.source||!access||access.code!==state.code){
   clearAudiusStream();return;
  }
  audiusActive=true;
  audiusTrack={id:saved.id,title:saved.title,artist:saved.artist,permalink:
   /^https:\/\/audius\.co\/[A-Za-z0-9._~\/-]+$/.test(saved.permalink||"")
   ?saved.permalink:"https://audius.co/tracks/"+encodeURIComponent(saved.id)};
  if(room.phase==="playing"){
   // Browser reload stopped the old audio. Never leave an inaudible clue running.
   const b=await rpc("pause");
   if(room&&room.code===state.code&&room.round===state.round)applyState(b.state);
  }
  localStatus("Stream recovered. Play or replay the current clue when ready.");
 }catch(e){
  clearAudiusStream();audiusActive=false;audiusTrack=null;
  localStatus("Could not restore the stream: "+String(e.message||e)+". Skip this song to continue.");
 }finally{audiusRestoring=false}
}
function clearAudiusStream(){
 try{playerAudio.pause();playerAudio.removeAttribute("src");playerAudio.load()}catch{}
 localAudioUrl=null;
 localCurrentIndex=null;
}
async function playLocalHint(info){
 const index=Number(String(info.source||"").slice(6));
 if(!Number.isInteger(index)||index!==localCurrentIndex||!localAudioUrl)
  throw Error("The host Audius stream is no longer available. Reload the game on the host.");
 const cue=(info.cueMs||0)/1000;
 if(playerAudio.readyState===0)throw Error("The Audius stream is not ready. Please retry.");
 playerAudio.currentTime=cue;
 try{await playerAudio.play()}catch(e){throw Error("Your browser blocked audio. Tap the Play clue button again: "+String(e.message||e))}
 // HTMLMediaElement.play() can resolve while a remote seek is still buffering.
 // Never consume the 0.5-second first clue until the playback clock advances.
 let advanced=false;
 for(let probe=0;probe<120;probe++){
  if(playerAudio.error)throw Error("The stream failed while seeking. Tap Play to retry this clue.");
  if(playerAudio.paused)throw Error("Audio playback stopped before the clue began.");
  if(playerAudio.currentTime>=cue+0.11){advanced=true;break}
  await new Promise(resolve=>setTimeout(resolve,75));
 }
 if(!advanced)throw Error("The stream is still buffering. Tap Play to retry the same clue.");
 localStatus("Playing clue from "+Math.round(cue)+" seconds into the song.");
}

function clearAudio(){
 clipGeneration++;
 clearTimeout(clipTimer);clipTimer=null;
 playerAudio.pause();
 startedClip=false;
}
function cancelNext(){clearTimeout(nextTimer);nextTimer=null}
function isHost(){return room?.role==="host"}
// Audius streams play only after a host gesture.
function scheduleNext(){/* Explicit host playback, no automatic clues. */}
async function startAudio(info){
 if(!/^local:\d+$/.test(info?.source||"")||!audiusActive)throw Error("Only Audius streaming is supported.");
 await playLocalHint(info);
 startedClip=true;
}
async function startClip(replay=false){
 replay=replay||failedClue===room?.round+":"+room?.step;
 if(!room||!isHost()||loading||(!replay&&room.phase!=="paused")||
  (replay&&(!["paused","playing"].includes(room.phase)||room.step<0||room.firstAnswered)))return;
 cancelNext();
 const generation=++clipGeneration,round=room.round,initialStep=room.step;
 try{
  setLoading(true);
  if(room.mode!=="local"||!audiusActive||!localAudioUrl||
    !/^local:\d+$/.test(room.audio?.source||"")||
    Number(room.audio.source.slice(6))!==localCurrentIndex)
    throw Error("The Audius host stream is unavailable. Reload the same host tab to recover, or skip this song.");
  const body=await rpc(replay?"replay":"play",replay?{expectedRound:round,expectedStep:initialStep}:{});applyState(body.state);
  if(room.phase!=="playing")return;
  await startAudio(room.audio);
  if(generation!==clipGeneration||!room||room.phase!=="playing")return;
  failedClue="";
  const expected=room.round,step=room.step;
  let bufferPolls=0;
  const finishClip=async()=>{
   if(!room||room.phase!=="playing"||room.round!==expected||room.step!==step)return;
   if(room.mode==="local"&&localAudioUrl){
    // A timer is not evidence of music: a remote stream can stall mid-clue.
    // Finish only after the playhead covers the actual clue duration.
    const playedMs=(playerAudio.currentTime-(room.audio?.cueMs||0)/1000)*1000;
    if(!playerAudio.error&&!playerAudio.ended&&playedMs<room.clipMs-90&&bufferPolls<150){
     bufferPolls++;
     clipTimer=setTimeout(finishClip,80);
     return;
    }
    if(playerAudio.error||playedMs<room.clipMs-90){
     failedClue=expected+":"+step;
     localStatus("The music stalled. Tap Play next clue to replay this clue.");
    }
   }
   clearAudio();
   try{
    const b=await rpc("pause");applyState(b.state);
    if(room.phase==="paused")scheduleNext(1000);
   }catch(e){message(e.message)}
  };
  clipTimer=setTimeout(finishClip,room.clipMs);
 }catch(e){
  if(generation!==clipGeneration)return;
  if(room?.phase==="playing")failedClue=room.round+":"+room.step;
  clearAudio();message(e.message||"Playback failed");
  localStatus(e.message||"Audius playback failed. Retry this clue.");
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
  const filters=[
   ...(room.genres||[]).map(x=>({hiphop:"HIP-HOP",rnb:"R&B",electronic:"ELECTRONIC"}[x]||x.toUpperCase())),
   ...(room.decades||[]).map(x=>x+"s")
  ];
  setText("host-track-context","AUDIUS RADIO"+(filters.length?"  ·  "+filters.join(" / "):"  ·  ALL ERAS"));
  setText("host-player-count",room.players.length+" PLAYER"+(room.players.length===1?"":"S")+" CONNECTED");
  const ed=$("playing").querySelector(".disc-art-edition");
  if(ed)ed.textContent="MYSTERY "+String(Math.max(1,room.round||1)).padStart(2,"0");
 }
 setText("role-indicator",host?"HOST / TABLET":"PLAYER / PHONE");
 setText("room-title",playing?"Name that tune":"Game lobby");
 setText("room-code",room.code);
 show("lobby",phase==="lobby");show("playing",phase!=="lobby");
 show("host-settings",host);show("guest-wait",!host);

 $("lobby-players").replaceChildren(...room.players.map(x=>makePlayer(x.name)));
 setText("lobby-player-count",room.players.length+" player"+(room.players.length===1?"":"s")+" joined");
 if(host&&phase==="lobby"){
  setText("lobby-launch-status",room.players.length
    ?room.players.length+" PLAYER"+(room.players.length===1?"":"S")+" READY · START WHEN YOU LIKE"
    :"INVITE AT LEAST ONE PLAYER TO START");
 }
 if(phase==="lobby"&&!genresDirty&&(room.genres||[]).some(g=>["pop","rock","hiphop","electronic","dance","disco","indie","rnb","metal"].includes(g))){
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
  const audiusMode=room.mode==="local";
  show("audius-player",host&&audiusMode);
  const attribution=host&&audiusMode&&audiusActive&&!!audiusTrack&&
    (phase==="solved"||phase==="finished"||room.titleDone||room.artistDone);
  show("audius-credit",attribution);
  if(attribution)$("audius-track-link").href=audiusTrack.permalink;
  show("audius-play-hint",host&&audiusMode&&phase==="paused"&&room.step<6);
  show("audius-replay-hint",host&&audiusMode&&room.step>=0&&!room.firstAnswered&&
    (phase==="paused"||(phase==="playing"&&!startedClip)));
  setText("audius-play-hint",failedClue===room.round+":"+room.step?"↻ Retry this clue":"▶ Play next clue");
  show("next-round",host&&phase==="solved");show("continue-hints",host&&phase==="holding"&&room.step<6);show("skip-round",host&&(phase==="paused"||phase==="playing"||phase==="holding"));
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
 try{
  const b=await rpc(action,extra);applyState(b.state);
  if((action==="start"||action==="next")&&b.state?.role==="host"){
   checkpointAudiusHost(b.state);
   try{await rememberSelectedSong(b.state)}catch(e){message("Song history could not be saved on this browser.");}
  }
  return b;
 }
 catch(e){if(!quiet)message(e.message);throw e}
 finally{setLoading(false)}
}
async function refresh(){
 if(!access||pollBusy||loading)return;
 pollBusy=true;
 const version=mutationVersion;
 try{
  const b=await rpc("state");
  if(version!==mutationVersion)return;
  if(b.state.phase==="answering"&&b.state.answerExpiresAt&&Date.now()>=new Date(b.state.answerExpiresAt).getTime()){
   try{const expired=await rpc("expire");applyState(expired.state);return;}catch{}
  }
  applyState(b.state);
  await restoreAudiusHost(b.state);
 }
 catch(e){if(e.message==="unauthorized"||e.message==="room_expired"){reset();message(e.message)}}
 finally{pollBusy=false}
}
function reset(){
 try{sessionStorage.removeItem(AUDIUS_HOST_SESSION)}catch{}
 cancelNext();clearAudio();clearAudiusStream();audiusActive=false;audiusTrack=null;
 audiusPool=[];audiusFiltersKey="";failedClue="";room=null;access=null;
 safeStore();render();
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
 if(!room||!isHost()||room.phase!=="lobby")return;
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
$("start").addEventListener("click",async()=>{
 try{
  clearTimeout(genresSaveTimer);
  if(!room?.players?.length)throw Error("Invite at least one player before starting.");
  const filters=chosenFilters();
  if(!filters.genres.length)throw Error("Select at least one genre");
  await call("settings",filters);
  await call("start",await selectAudiusRound());
 }catch(e){message(e.message)}
});
const AUDIUS_PRESETS={
 party:["pop","dance","disco","electronic"],
 electronic:["electronic","dance","disco"],
 guitar:["rock","indie","metal"],
 all:["pop","rock","hiphop","electronic","dance","disco","indie","rnb","metal"]
};
document.querySelectorAll("[data-audius-preset]").forEach(button=>button.addEventListener("click",()=>{
 if(!room||!isHost()||room.phase!=="lobby")return;
 const genres=AUDIUS_PRESETS[button.dataset.audiusPreset];
 if(!genres)return;
 document.querySelectorAll("#genre-options input").forEach(input=>{
  input.checked=genres.includes(input.value);
 });
 // Quick mix intentionally resets decades so older-genre scarcity cannot silently apply.
 document.querySelectorAll("#decade-options input").forEach(input=>input.checked=false);
 $("genre-options").dispatchEvent(new Event("change",{bubbles:true}));
 message(button.textContent.trim()+" selected · all eras");
}));
$("clear-audius-decades").addEventListener("click",()=>{
 if(!room||!isHost()||room.phase!=="lobby")return;
 document.querySelectorAll("#decade-options input").forEach(input=>input.checked=false);
 $("decade-options").dispatchEvent(new Event("change",{bubbles:true}));
});
$("audius-check").addEventListener("click",()=>discoverAudius(true).catch(e=>message(e.message)));
$("audius-play-hint").addEventListener("click",()=>startClip());
$("audius-replay-hint").addEventListener("click",()=>startClip(true));
$("next-round").addEventListener("click",async()=>{
 try{await call("next",await selectAudiusRound())}catch(e){message(e.message)}
});
$("continue-hints").addEventListener("click",async()=>{try{await call("resume")}catch{}});
$("skip-round").addEventListener("click",async()=>{try{await call("skip")}catch{}});
$("buzz").addEventListener("click",requestBuzz);
$("steal").addEventListener("click",async()=>{try{await call("steal")}catch{}});
$("pass").addEventListener("click",async()=>{try{await call("forfeit")}catch{}});
$("answer-form").addEventListener("submit",submitGuess);
for(const id of ["genre-options","decade-options"])$(id).addEventListener("change",()=>{
 genresDirty=true;
 clearTimeout(genresSaveTimer);genresSaveTimer=setTimeout(saveGenres,250);
 audiusPool=[];audiusFiltersKey="";
 setText("audius-availability","Filters changed. Check tracks to refresh availability.");
});
document.addEventListener("visibilitychange",()=>{
 if(!document.hidden&&access)refresh();
 if(document.hidden&&isHost()){
  cancelNext();
  if(room?.mode==="local"){
   clearAudio();
   if(room?.phase==="playing")rpc("pause").then(b=>applyState(b.state)).catch(()=>{});
  }
 }
 
});
window.addEventListener("pagehide",()=>{clearAudio();cancelNext();clearAudiusStream()});
const fromUrl=new URLSearchParams(location.search).get("room");
if(fromUrl&&/^[A-HJ-NP-Z2-9]{6}$/i.test(fromUrl))$("join-code").value=fromUrl.toUpperCase();
try{
 const stored=JSON.parse(localStorage.getItem(STORE)||"null");
 if(stored&&/^[A-HJ-NP-Z2-9]{6}$/.test(stored.code)&&/^[0-9a-f]{64}$/.test(stored.token)){
  access=stored;refresh();
 }
}catch{}
render();
setInterval(()=>{if(access&&!document.hidden)refresh()},550);
