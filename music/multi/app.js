"use strict";
/* Tune Rush multiplayer: S21 is the sole game/score/music authority.
   The public browser holds player capabilities, renders public state and
   plays only the current bounded MP3 fragment as the host's output.
   Supabase and C720P transport messages; neither chooses or scores tracks. */
const RPC="https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/";
const PUBLISHABLE_KEY="sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA";
// On the same trusted Wi-Fi the S21 serves this app on port 8798. Its
// direct same-origin transport stays playable if Supabase PostgREST is down.
const LOCAL_DIRECT=location.protocol==="http:"&&location.port==="8798";
const GENRES=[["pop","Pop"],["rock","Rock"],["hiphop","Hip-Hop"],["indie","Indie"],["rnb","R&B"],["dance","Dance"],["electronic","Electronic"],["disco","Disco"],["metal","Metal"],["dutch","Dutch"]];
const DECADES=["1970","1980","1990","2000","2010","2020"];
const DURATIONS=[500,1500,3000,5000,8000,12000,20000];
const PARAMS=new URLSearchParams(location.search);
const EMBEDDED=window.self!==window.top&&PARAMS.get("tablet")==="1";
const JOIN_CODE=(PARAMS.get("room")||"").toUpperCase();
const STORAGE=EMBEDDED?sessionStorage:localStorage;
const STORE=EMBEDDED?"tune-rush-s21-multi-tablet-"+JOIN_CODE:"tune-rush-s21-multi-access-v1";
const VOLUME_STORE="tune-rush-host-output-v1";
const $=id=>document.getElementById(id);
let access=null,state=null,mutation=false,polling=false,disconnected=false,timer=null;
let panelCode="",clipData="",clipKey="",audioContext=null,analyser=null,frameId=null;
// Local lobby filter draft must survive remote S21 state polls.
let draftRoom="",draftGenres=null,draftDecades=null,draftDirty=false;
let volume=100,muted=false,noticeTimer=null;
const audio=$("clip-audio");
const hex=(n=32)=>[...crypto.getRandomValues(new Uint8Array(n))].map(v=>v.toString(16).padStart(2,"0")).join("");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const num=n=>Number.isFinite(Number(n))?Number(n):0;
const validCode=code=>/^[A-HJ-NP-Z2-9]{6}$/.test(code||"");
const validCred=key=>/^[a-f0-9]{64}$/.test(key||"");
function fmt(ms){return ms<1000?ms+"ms":(ms/1000).toFixed(Number.isInteger(ms/1000)?0:1)+"s"}
function alertUser(text,bad=false){
 const notice=$("notice");notice.textContent=text;notice.hidden=false;
 notice.style.borderColor=bad?"#cb7676":"#6eab55";
 clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{notice.hidden=true},7000);
}
function message(error){
 const v=typeof error==="string"?error:error?.message||"Unknown game error";
 const map={
  unauthorized:"This room's player credential is no longer valid.",
  room_not_found:"This room expired or no longer exists.",
  room_expired:"This room expired. Create another game.",
  name_taken:"That name is taken. Choose another nickname.",
  game_already_started:"This party has already started.",
  no_players:"Wait for at least one player to join.",
  cached_tracks_unavailable:"Not enough cached songs match these filters. Choose more genres or All eras.",
  cached_library_unavailable:"The S21 permanent music library is unavailable.",
  not_ready_for_clip:"Finish this player's turn before starting another clue.",
  buzz_closed:"Another player buzzed first or the clue is no longer available.",
  already_tried_this_clip:"You already guessed at this clue. Wait for another clue.",
  not_your_turn:"Another player currently owns the buzzer.",
  invalid_music_source:"The game did not accept its music source.",
  The_network_request_timed_out:"The S21 game connection timed out. State may have changed; refresh the room before retrying."
 };
 return map[v]||v.replaceAll("_"," ").replace(/^./,s=>s.toUpperCase());
}
function setNetwork(online,detail){
 disconnected=!online;
 const element=$("status");element.classList.toggle("online",online);element.classList.toggle("offline",!online);
 element.lastChild.textContent=" "+(online?"S21 connected":detail||"S21 unavailable");
}
function save(){try{if(access)STORAGE.setItem(STORE,JSON.stringify(access));else STORAGE.removeItem(STORE)}catch{}}
function restore(){
 try{const a=JSON.parse(STORAGE.getItem(STORE)||"null");
  if(validCode(a?.code)&&validCred(a?.hash))access={code:a.code,hash:a.hash,name:a.name||""};
 }catch{}
}
async function post(name,body,limitMs=13000){
 const controller=new AbortController(),abort=setTimeout(()=>controller.abort(),limitMs);
 try{
  const response=await fetch(RPC+name,{method:"POST",mode:"cors",cache:"no-store",
   headers:{"Content-Type":"application/json","apikey":PUBLISHABLE_KEY},
   body:JSON.stringify(body),signal:controller.signal});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result?.message||"Game gateway HTTP "+response.status);
  return result;
 }catch(error){
  if(error?.name==="AbortError")throw Error("The_network_request_timed_out");
  throw error;
 }finally{clearTimeout(abort)}
}
async function transact(action,data={},selectedAccess=access){
 if(!selectedAccess||!validCode(selectedAccess.code)||!validCred(selectedAccess.hash))
  throw Error("Missing room credentials");
 if(LOCAL_DIRECT){
  // Auth stays in the same browser-scoped capability; never send answers,
  // tokens, or MP3s to a third-party player or unauthenticated URL.
  const aborter=new AbortController();
  const timer=setTimeout(()=>aborter.abort(),18000);
  try{
   const response=await fetch("/api/multiplayer",{
    method:"POST",cache:"no-store",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action,code:selectedAccess.code,hash:selectedAccess.hash,data}),
    signal:aborter.signal});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||!result.state)throw Error(result.error||"S21 game request failed");
   if(result.state.code!==selectedAccess.code)throw Error("Unexpected S21 room response");
   return result.state;
  }catch(error){
   if(error?.name==="AbortError")throw Error("The_network_request_timed_out");
   throw error;
  }finally{clearTimeout(timer)}
 }
 const pollHash=hex(),created=await post("tunerush_s21_mp_submit_v1",{
  p_action:action,p_code:selectedAccess.code,p_hash:selectedAccess.hash,
  p_data:data,p_poll_hash:pollHash});
 if(!/^[a-f0-9-]{36}$/.test(created?.id||""))throw Error("Invalid S21 request receipt");
 const started=Date.now();
 while(Date.now()-started<55000){
  await sleep(400);
  const check=await post("tunerush_s21_status_v1",{
   p_id:created.id,p_poll_hash:pollHash},13000);
  if(check.status==="done"){
   if(!check.result?.ok)throw Error(check.result?.error||"S21 could not complete this request");
   const next=check.result?.body?.state;
   if(!next||next.code!==selectedAccess.code)throw Error("S21 returned an unrelated room");
   return next;
  }
  if(check.status==="missing")throw Error("Game response expired. Refresh the room safely.");
  await sleep(300);
 }
 throw Error("The_network_request_timed_out");
}
async function mutate(action,data={}){
 if(mutation)return;
 mutation=true;renderButtons();
 try{
  const next=await transact(action,data);
  setNetwork(true);
  accept(next);
  return next;
 }catch(error){
  setNetwork(false,"Connection interrupted");
  alertUser(message(error),true);
 }finally{mutation=false;renderButtons()}
}
async function createRoom(){
 if(mutation)return;mutation=true;renderButtons();
 try{
  const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let next;
  for(let attempt=0;attempt<3;attempt++){
   const code=[...crypto.getRandomValues(new Uint8Array(6))].map(x=>alphabet[x%alphabet.length]).join("");
   const candidate={code,hash:hex(),name:"Host"};
   try{
    next=await transact("create",{},candidate);
    access=candidate;save();break;
   }catch(error){if(!/room_code_taken/.test(String(error))||attempt===2)throw error;}
  }
  setNetwork(true);accept(next);alertUser("Room created. Share its code with your phone.");
 }catch(error){setNetwork(false,"Cannot create room");alertUser(message(error),true)}
 finally{mutation=false;renderButtons()}
}
async function joinRoom(code,name){
 if(mutation)return;mutation=true;renderButtons();
 try{
  if(!validCode(code))throw Error("Enter a valid six-character room code.");
  if(!/^[\p{L}\p{N}_ .-]{1,20}$/u.test(name))throw Error("Enter a nickname, up to 20 characters.");
  const candidate={code,hash:hex(),name};
  const next=await transact("join",{name},candidate);
  access=candidate;save();setNetwork(true);accept(next);
 }catch(error){setNetwork(false,"Join failed");alertUser(message(error),true)}
 finally{mutation=false;renderButtons()}
}
function closePanel(discard=false){
 const box=$("tablet-panel");box.hidden=true;
 $("tablet-toggle").textContent="Open Tablet Player";
 if(discard){
  $("tablet-frame").removeAttribute("src");
  panelCode="";
 }
}
function openTablet(){
 if(state?.role!=="host")return;
 const box=$("tablet-panel");
 if(!box.hidden){closePanel();return;}
 if(panelCode!==state.code){
  const url=new URL("./",location.href);
  url.search="";
  url.searchParams.set("tablet","1");
  url.searchParams.set("room",state.code);
  $("tablet-frame").src=url.href;
  panelCode=state.code;
 }
 box.hidden=false;$("tablet-toggle").textContent="Hide Tablet Player";
}
function reset(){
 access=null;state=null;save();stopAudio();
 closePanel(true);$("code-input").value="";
 render();
}
function invite(){
 const url=new URL("./",location.href);
 url.search="";url.searchParams.set("room",state.code);
 return url.href;
}
async function copyInvite(){
 try{await navigator.clipboard.writeText(invite());alertUser("Phone invite link copied.")}
 catch{alertUser("Share this room code: "+state.code)}
}
function renderChips(){
 const allowed=state?.role==="host"&&state.phase==="lobby";
 if(state?.code!==draftRoom){
  draftRoom=state?.code||"";
  draftGenres=null;draftDecades=null;draftDirty=false;
 }
 if(!draftDirty){
  draftGenres=[...(state?.genres||["rock","pop"])];
  draftDecades=[...(state?.decades||[])];
 }
 const genres=draftGenres||[],decades=draftDecades||[];
 const mount=(node,items,active)=>{node.replaceChildren();
  for(const [value,label] of items){
   const button=document.createElement("button");
   button.className="chip"+(active.includes(value)?" selected":"");
   button.type="button";button.textContent=label;button.dataset.value=value;
   button.disabled=!allowed;button.setAttribute("aria-pressed",String(active.includes(value)));
   button.addEventListener("click",()=>{
    const chosen=button.classList.toggle("selected");
    button.setAttribute("aria-pressed",String(chosen));
    const target=node.id==="genres"?draftGenres:draftDecades;
    if(chosen){if(!target.includes(value))target.push(value)}
    else{const i=target.indexOf(value);if(i>=0)target.splice(i,1)}
    draftDirty=true;
   });
   node.append(button);
  }};
 mount($("genres"),GENRES,genres);
 mount($("decades"),DECADES.map(d=>[d,d+"s"]),decades);
}
function selected(id){return [...$(id).querySelectorAll("button.selected")].map(b=>b.dataset.value)}
async function saveSettings(){
 if(state?.role!=="host")return;
 const genres=[...(draftGenres||[])],decades=[...(draftDecades||[])];
 if(!genres.length){alertUser("Choose at least one genre.",true);return;}
 const next=await mutate("settings",{genres,decades});
 if(next){
  draftDirty=false;
  draftGenres=[...next.genres];draftDecades=[...next.decades];
  renderChips();
  alertUser("Music mix saved on the S21.");
 }
}
function renderRoster(){
 const roster=$("roster");roster.replaceChildren();
 const players=state?.players||[];
 if(!players.length){
  const p=document.createElement("p");p.className="empty-roster";p.textContent="No players yet. Invite your phone or add a tablet player.";roster.append(p);
 }else{
  players.forEach((player,i)=>{
   const row=document.createElement("div");row.className="roster-entry";
   const avatar=document.createElement("span");avatar.className="avatar";avatar.textContent=player.name?.[0]?.toUpperCase()||"♪";
   const name=document.createElement("span");name.className="player-name";name.textContent=player.name+(player.id===state.me?" · You":"");
   const pts=document.createElement("span");pts.className="points";pts.textContent=Number(player.score).toFixed(1);
   row.append(avatar,name,pts);roster.append(row);
  });
 }
 $("roster-subtitle").textContent=players.length+" player"+(players.length===1?"":"s")+" in this room";
 $("game-player-count").textContent=players.length;
}
function renderLevels(){
 const node=$("clue-levels");node.replaceChildren();
 DURATIONS.forEach((ms,i)=>{
  const span=document.createElement("span");span.textContent=fmt(ms);
  if(state?.step===i)span.classList.add("current");
  else if(state?.step>i)span.classList.add("past");
  node.append(span);
 });
}
function renderButtons(){
 const host=state?.role==="host",phase=state?.phase||"lobby";
 const updated=phase==="lobby";
 $("create").disabled=mutation;
 $("join-form").querySelector("button").disabled=mutation;
 $("start").disabled=mutation||!host||!updated||!(state?.players?.length);
 $("save-settings").disabled=mutation||!host||!updated;
 $("play").disabled=mutation||!host||phase!=="paused";
 $("repeat").disabled=mutation||!host||phase!=="playing"||state?.firstAnswered;
 $("pause").disabled=mutation||!host||phase!=="playing";
 $("resume").disabled=mutation||!host||phase!=="holding"||state?.step>=6;
 $("skip").disabled=mutation||!host||!["paused","playing","holding"].includes(phase);
 $("next").disabled=mutation||!host||phase!=="solved";
 $("finish").disabled=mutation||!host||phase==="finished";
 $("buzz").disabled=mutation||state?.role!=="player"||!["playing","paused"].includes(phase)||
  state?.step<0||state?.firstAnswered||state?.myBlockedStep===state.step;
 $("steal").disabled=mutation||state?.role!=="player"||phase!=="holding"||
  !state?.firstAnswered||state?.myBlockedStep===state.step;
 $("answer-form").querySelector("button").disabled=mutation||phase!=="answering"||
   state?.lockedPlayer!==state?.me;
 $("forfeit").disabled=mutation||phase!=="answering"||state?.lockedPlayer!==state?.me;
}
function phaseLabel(phase){
 return {lobby:"Preparing party",paused:"Ready for next clue",playing:"Clue playing",
 answering:"Player is answering",holding:"Steal or next clue",solved:"Song revealed",
 finished:"Game finished"}[phase]||phase;
}
function refreshAnswerClock(){
 if(!state||state.phase!=="answering")return;
 const deadline=Number(state.answerExpiresAt);
 const seconds=Number.isFinite(deadline)&&deadline>0?
  Math.max(0,Math.ceil(deadline-Date.now()/1000)):25;
 const clock=$("answer-countdown");
 if(clock)clock.textContent=String(seconds);
 $("phase-pill").textContent="Player answering · "+seconds+"s";
 // Only the S21 is allowed to expire the buzzer lock. The regular room
 // poll will observe and persist that transition, even if a guest quit.
}
function render(){
 const present=!!state;
 $("welcome").hidden=present;$("room").hidden=!present;
 $("mixer").hidden=!present||state.role!=="host";
 if(!present){document.title="Tune Rush • Multiplayer";renderButtons();return}
 const isHost=state.role==="host",lobby=state.phase==="lobby",finished=state.phase==="finished";
 $("role").textContent=isHost?"HOST / YOUR PARTY STUDIO":"PLAYER / YOUR BUZZER";
 $("room-code").textContent=state.code;
 $("room-heading").textContent=lobby?"Waiting room":finished?"Game results":"Music battle";
 document.title="Tune Rush • "+state.code;
 $("lobby-view").hidden=!lobby;$("game-view").hidden=lobby||finished;$("finished-view").hidden=!finished;
 $("host-options").hidden=!isHost;$("host-game-controls").hidden=!isHost;
 $("guest-controls").hidden=isHost;
 $("share-invite").disabled=!isHost;
 $("tablet-toggle").disabled=!isHost;
 $("lobby-readiness").textContent=state.players.length?
  state.players.length+" player"+(state.players.length===1?"":"s")+" ready to compete":
  "Waiting for your first player";
 $("round-number").textContent=String(state.round).padStart(2,"0");
 $("phase-pill").textContent=phaseLabel(state.phase);
 $("scope-length").textContent=fmt(DURATIONS[Math.max(0,state.step)]||500);
 const publicTitle=state.title||"Mystery track";
 const publicArtist=state.artist||"Listen closely — how fast can you name it?";
 $("song-title").textContent=publicTitle;$("song-artist").textContent=publicArtist;
 $("repeat").hidden=!isHost||state.phase!=="playing";
 $("pause").hidden=!isHost||state.phase!=="playing";
 $("resume").hidden=!isHost||state.phase!=="holding";
 $("next").hidden=!isHost||state.phase!=="solved";
 $("play").hidden=!isHost||state.phase!=="paused";
 $("skip").hidden=!isHost||!["paused","playing","holding"].includes(state.phase);
 $("buzz").hidden=state.phase==="holding";
 $("steal").hidden=state.phase!=="holding";
 const answering=state.phase==="answering"&&state.lockedPlayer===state.me;
 $("answer-form-panel").hidden=!answering;
 $("guest-hint").textContent=answering?"It's your turn. You have 25 seconds.":state.phase==="answering"?
  "Someone else buzzed first. Watch the scoreboard.":
  state.phase==="holding"?"Use Steal if you know the remaining answer.":
  state.myBlockedStep===state.step?"Your attempt is used for this clue. Wait for the next.":
  "Listen to the tablet and buzz when you recognize it.";
 if(finished){
  const ranked=[...state.players].sort((a,b)=>num(b.score)-num(a.score));
  const winners=ranked.filter(p=>num(p.score)===num(ranked[0]?.score));
  $("winner-line").textContent=winners.length>1?
   "It's a tie at "+num(winners[0].score).toFixed(1)+" points":
   (winners[0]?.name||"Everybody")+" wins with "+num(winners[0]?.score||0).toFixed(1)+" points!";
 }
 if(state.code!==panelCode&&panelCode)closePanel(true);
 renderChips();renderRoster();renderLevels();renderButtons();
 refreshAnswerClock();
}
function accept(next){
 if(!next||!validCode(next.code))throw Error("Invalid authoritative state");
 const previous=state;
 const before=previous?.phase;
 if(previous?.code&&previous.code!==next.code){stopAudio();closePanel(true);}
 state=next;
 // Each browser can only output music as host. Never play audio on phones.
 if(state.role==="host"){
  if(typeof next.clipAudio==="string"&&next.clipAudio.startsWith("data:audio/mpeg;base64,")){
   clipData=next.clipAudio;
   clipKey=next.code+":"+next.round+":"+next.step;
   startAudio(clipData);
  }else if(before==="playing"&&next.phase!=="playing")stopAudio(false);
 }else stopAudio();
 render();
}
async function pollState(){
 if(!access||mutation||polling)return;
 polling=true;
 try{
  const next=await transact("state");
  setNetwork(true);
  accept(next);
 }catch(error){
  setNetwork(false,"Reconnecting");
  if(/unauthorized|room_not_found|room_expired/.test(String(error)))alertUser(message(error),true);
 }finally{polling=false}
}
function startPolling(){
 if(timer)clearTimeout(timer);
 const cycle=async()=>{await pollState();timer=setTimeout(cycle,1800)};
 timer=setTimeout(cycle,350);
}
async function doAction(action,data={}){
 const next=await mutate(action,data);
 if(action==="play"&&!next?.clipAudio)alertUser("Could not retrieve the clue. Use Replay clue to recover.",true);
}
function loadOutput(){
 try{const saved=JSON.parse(localStorage.getItem(VOLUME_STORE)||"null");
  if(Number.isInteger(saved?.level)&&saved.level>=0&&saved.level<=100)volume=saved.level;
  if(typeof saved?.muted==="boolean")muted=saved.muted;
 }catch{}
}
function applyOutput(){
 audio.volume=volume/100;audio.muted=muted;
 $("volume").value=String(volume);
 $("volume-value").textContent=muted?"Muted":volume+"%";
 $("mute").textContent=muted||!volume?"🔇":"🔊";
 $("mute").setAttribute("aria-pressed",String(muted));
}
function saveOutput(){try{localStorage.setItem(VOLUME_STORE,JSON.stringify({level:volume,muted}))}catch{}}
function initOutput(){
 loadOutput();applyOutput();
 $("volume").addEventListener("input",e=>{
  volume=Math.max(0,Math.min(100,Number(e.target.value)));if(volume>0)muted=false;
  applyOutput();saveOutput();
 });
 $("mute").addEventListener("click",()=>{
  muted=!muted;if(!muted&&!volume)volume=50;applyOutput();saveOutput();
 });
}
function audioVisualizer(){
 const canvas=$("waveform"),ctx=canvas.getContext("2d");
 if(!ctx)return;
 const frame=()=>{
  const W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H);
  const middle=H/2;
  ctx.strokeStyle="#627853";ctx.globalAlpha=.65;ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(0,middle);ctx.lineTo(W,middle);ctx.stroke();ctx.globalAlpha=1;
  if(analyser&&!audio.paused){
   const values=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(values);
   const bars=72,gap=4,barWidth=(W-(bars-1)*gap)/bars;
   for(let i=0;i<bars;i++){
    const v=values[Math.floor(i*values.length/bars)]/255;
    const height=Math.max(2,v*H*.83);
    ctx.fillStyle=i%5===0?"#e2ffb0":"#c6f56b";
    ctx.fillRect(i*(barWidth+gap),middle-height/2,barWidth,height);
   }
  }
  frameId=requestAnimationFrame(frame);
 };
 frame();
}
function ensureAnalyser(){
 if(analyser)return;
 try{
  audioContext=new (window.AudioContext||window.webkitAudioContext)();
  const source=audioContext.createMediaElementSource(audio);
  analyser=audioContext.createAnalyser();
  analyser.fftSize=256;analyser.smoothingTimeConstant=.7;
  source.connect(analyser);analyser.connect(audioContext.destination);
 }catch{analyser=null}
}
async function startAudio(source){
 if(state?.role!=="host"||!source)return;
 try{
  audio.pause();audio.src=source;audio.currentTime=0;
  ensureAnalyser();
  if(audioContext?.state==="suspended")await audioContext.resume();
  await audio.play();
  $("audio-feedback").textContent="Playing real S21 cached MP3 clue";
 }catch{
  $("audio-feedback").textContent="Playback needs a tap — press Replay clue.";
 }
}
function stopAudio(clear=true){
 try{audio.pause();audio.currentTime=0;}catch{}
 if(clear){
  clipData="";clipKey="";
  try{audio.removeAttribute("src");audio.load()}catch{}
 }
}
async function replay(){
 if(state?.phase==="playing"&&clipData&&clipKey===state.code+":"+state.round+":"+state.step){
  await startAudio(clipData);return;
 }
 await doAction("replay",{expectedRound:state.round,expectedStep:state.step});
}
function finish(){
 if(!state)return;
 if(!confirm("End this party and show the final scores?"))return;
 doAction("finish");
}
function wire(){
 $("create").addEventListener("click",createRoom);
 $("join-form").addEventListener("submit",e=>{
  e.preventDefault();joinRoom($("code-input").value.trim().toUpperCase(),$("name-input").value.trim());
 });
 $("exit").addEventListener("click",()=>{
  if(!confirm("Leave this room on this device? Existing players keep their scores."))return;
  reset();
 });
 $("copy-invite").addEventListener("click",copyInvite);
 $("share-invite").addEventListener("click",copyInvite);
 $("tablet-toggle").addEventListener("click",openTablet);
 $("tablet-close").addEventListener("click",()=>closePanel());
 $("save-settings").addEventListener("click",saveSettings);
 $("start").addEventListener("click",()=>doAction("start",{mode:"persistent-library"}));
 $("play").addEventListener("click",()=>doAction("play"));
 $("repeat").addEventListener("click",replay);
 $("pause").addEventListener("click",()=>doAction("pause"));
 $("resume").addEventListener("click",()=>doAction("resume"));
 $("skip").addEventListener("click",()=>doAction("skip"));
 $("next").addEventListener("click",()=>doAction("next",{mode:"persistent-library"}));
 $("finish").addEventListener("click",finish);
 $("buzz").addEventListener("click",()=>doAction("buzz"));
 $("steal").addEventListener("click",()=>doAction("steal"));
 $("forfeit").addEventListener("click",()=>doAction("forfeit"));
 $("answer-form").addEventListener("submit",e=>{
  e.preventDefault();
  const song=$("guess-title").value.trim(),artist=$("guess-artist").value.trim();
  if(!song&&!artist){alertUser("Enter the song title or artist.",true);return}
  $("guess-title").value="";$("guess-artist").value="";
  doAction("answer",{song,artist});
 });
 $("again").addEventListener("click",reset);
 audio.addEventListener("ended",()=>{$("audio-feedback").textContent="Clue finished. Listen for a buzz or advance the clue."});
 document.addEventListener("visibilitychange",()=>{if(!document.hidden&&access&&!mutation)pollState()});
}
async function boot(){
 wire();initOutput();audioVisualizer();restore();
 window.setInterval(refreshAnswerClock,1000);
 if(validCode(JOIN_CODE))$("code-input").value=JOIN_CODE;
 if(EMBEDDED&&!access&&validCode(JOIN_CODE)){
  $("name-input").value="Tablet Player";
  await joinRoom(JOIN_CODE,"Tablet Player");
 }
 if(access){
  render();await pollState();
 }else render();
 startPolling();
 // Health is deliberately derived from actual state/room requests, not a
 // fabricated green badge or availability claim.
 if(!access)setNetwork(false,"Create or join to connect");
}
boot().catch(error=>{setNetwork(false,"Not connected");alertUser(message(error),true)});
