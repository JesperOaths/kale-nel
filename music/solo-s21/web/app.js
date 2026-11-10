"use strict";
const $=id=>document.getElementById(id);
const audio=$("music");
let token="",state=null,busy=false,playEpoch=0;
const LABELS=["0.5","1","1.5","3","5","8","12","20"];
let currentClip=null,clipKey="",envelope=[],decodedKey="",waveAudioContext=null;
try{token=localStorage.getItem("tunerush_s21_solo_v1")||""}catch{}
const show=(id,visible)=>$(id).hidden=!visible;
const set=(id,value)=>{$(id).textContent=String(value??"")};
const note=(msg)=>{set("toast",msg);show("toast",true);clearTimeout(note.timer);note.timer=setTimeout(()=>show("toast",false),3800)};
function stop(){playEpoch++;audio.pause();$("record-wrap").classList.remove("spinning");drawWave(0)}
function fmt(s){return String(s??"").replace(/[\u0000-\u001f]/g," ").trim()}
const pts=n=>(Number(n)||0).toFixed(2);
function resetClue(){
 currentClip=null;clipKey="";envelope=[];decodedKey="";
 $("wave-empty").hidden=false;drawWave(0);
}
function drawWave(progress=0){
 const canvas=$("waveform"),context=canvas.getContext("2d");
 const w=canvas.width,h=canvas.height;
 context.clearRect(0,0,w,h);
 if(!envelope.length)return;
 const gap=2,barW=w/envelope.length,mid=h/2;
 for(let i=0;i<envelope.length;i++){
  const magnitude=Math.max(3,envelope[i]*(h*.84));
  context.fillStyle=(i/envelope.length<=progress)?"#f6ce80":"#6bbac0";
  context.fillRect(i*barW+gap/2,mid-magnitude/2,Math.max(1,barW-gap),magnitude);
 }
}
async function measureWaveform(src,key){
 if(decodedKey===key)return;
 // Compute peaks from the same actual MP3 clue that the phone delivered.
 try{
  if(!src.startsWith("data:audio/mpeg;base64,"))return;
  const encoded=src.slice("data:audio/mpeg;base64,".length);
  const raw=atob(encoded),bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  waveAudioContext=waveAudioContext||new (window.AudioContext||window.webkitAudioContext)();
  const decoded=await waveAudioContext.decodeAudioData(bytes.buffer);
  if(clipKey!==key)return;
  const ch=decoded.getChannelData(0),count=112;
  const start=Math.min(ch.length-1,Math.floor(decoded.sampleRate*.23));
  const length=ch.length-start, next=[];
  for(let x=0;x<count;x++){
   const from=start+Math.floor(x*length/count),to=start+Math.floor((x+1)*length/count);
   let peak=0;
   for(let j=from;j<to;j++)peak=Math.max(peak,Math.abs(ch[j]));
   next.push(peak);
  }
  const max=Math.max(...next,.00001);
  envelope=next.map(v=>Math.min(1,v/max));
  decodedKey=key;$("wave-empty").hidden=true;drawWave(0);
 }catch(e){
  // A malformed/unsupported MP3 produces no fake waveform.
  if(clipKey===key){envelope=[];$("wave-empty").hidden=false}
 }
}
function renderCover(s){
 const cover=s.reveal?.cover,src=cover?.url||"";
 const valid=(()=>{try{
  const url=new URL(src);
  return url.protocol==="https:"&&["i.scdn.co","image-cdn-fa.spotifycdn.com",
   "image-cdn.spotifycdn.com","cdn-images.dzcdn.net"].includes(url.hostname);
 }catch{return false}})();
 const frame=$("artwork-cover"),img=$("album-cover");
 if(!valid){frame.hidden=true;img.removeAttribute("src");return}
 if(img.getAttribute("src")!==src)img.src=src;
 img.alt="Album artwork for "+fmt(s.reveal.title)+" by "+fmt(s.reveal.artist);
 img.onerror=()=>{frame.hidden=true};
 frame.hidden=false;
}
function renderPoints(s){
 const b=s.roundPoints||s.history?.find(x=>x.round===s.round)?.breakdown||{};
 set("round-gained","+"+pts(b.total));
 set("score-total",pts(s.score));
 const entries=[
  ["Song title",b.title||0],["Artist",b.artist||0],["0.5s speed bonus",b.bonus||0],
  ["Longer fragments",-(b.hints||0)],["Incorrect answers",-(b.misses||0)]
 ];
 if(b.floor)entries.push(["Score floor adjustment",b.floor]);
 $("score-details").replaceChildren();
 for(const [label,value] of entries){
  const item=document.createElement("div");
  item.className="points-row";
  const name=document.createElement("span"),number=document.createElement("strong");
  name.textContent=label;number.textContent=(value>0?"+":"")+pts(value);
  item.append(name,number);$("score-details").append(item);
 }
}
function renderAttempts(s){
 const panel=$("attempt-strip");panel.replaceChildren();
 const attempts=s.attempts||[];
 panel.hidden=!attempts.length;
 for(const attempt of attempts.slice(-7).reverse()){
  const line=document.createElement("div");line.className="attempt-row";
  const fmtPart=(field)=>{const a=attempt[field]||{};if(!a.guess)return"";
   const symbol=a.result==="correct"?"✓":a.result==="incorrect"?"✕":"·";
   return symbol+" "+field+": "+fmt(a.guess);
  };
  line.textContent=[fmtPart("title"),fmtPart("artist")].filter(Boolean).join("  ·  ")||
   "No new answer";
  panel.append(line);
 }
}
async function api(path,method="GET",data=null,authorized=true){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),path==="/api/session"?40000:18000);
 try{
  const headers={"Accept":"application/json"};
  if(data)headers["Content-Type"]="application/json";
  if(authorized&&token)headers["Authorization"]="Bearer "+token;
  const res=await fetch(path,{method,headers,body:data?JSON.stringify(data):undefined,cache:"no-store",signal:ctrl.signal});
  const out=await res.json();
  if(!res.ok)throw Error(out.error||"S21 request failed ("+res.status+")");
  return out;
 }catch(e){
  if(e.name==="AbortError")throw Error("S21 did not answer in time. Check Wi-Fi and Termux.");
  throw e;
 }finally{clearTimeout(timer)}
}
async function refresh(){
 try{
  const h=await api("/api/health","GET",null,false);
  set("server-status",h.ready?"● S21 ONLINE":"S21 unavailable");
  if(token){
   try{const s=await api("/api/state");state=s.state;render()}catch(e){
    if(/expired/.test(e.message)){token="";localStorage.removeItem("tunerush_s21_solo_v1")}
    else note(e.message);
   }
  }
 }catch(e){set("server-status","● S21 OFFLINE");note(e.message)}
}
function render(){
 const s=state;
 show("welcome",!s);show("game",!!s&&s.phase!=="finished");show("finished",!!s&&s.phase==="finished");
 if(!s){resetClue();return}
 const revealed=["revealed","finished"].includes(s.phase);
 const played=s.step>=0,canGuess=s.phase==="playing"&&!(s.titleDone&&s.artistDone);
 const durations=s.durations||LABELS.map(v=>Number(v)*1000);
 set("round-label",String(s.round).padStart(2,"0")+" / "+s.limit);
 set("score-label",pts(s.score)+" PTS");
 set("clue-label",played?(s.step+1)+" / "+durations.length:"READY");
 set("phase-indicator",s.phase==="ready"?"READY":s.phase==="playing"?"LISTEN / GUESS":revealed?"REVEALED":"WAITING");
 set("stage-title",revealed?"Track revealed":s.phase==="ready"?"Listen closely.":"Know the song?");
 set("stage-sub",revealed?"Album art and points for this track are shown here.":"Listen, try as often as you like, or play a longer clue.");
 $("clues").replaceChildren();
 for(let i=0;i<durations.length;i++){
  const el=document.createElement("span");
  el.className="clue"+(i<=s.step?" heard":"")+(i===s.step?" current":"");
  el.textContent=LABELS[i]+"s";$("clues").append(el);
 }
 show("play-button",!revealed);
 $("play-button").disabled=busy||s.step>=durations.length-1;
 set("play-button",s.step===-1?"▶ Play 0.5s clue":"▶ Play next fragment");
 show("replay-button",s.phase==="playing");$("replay-button").disabled=busy;
 $("submit-button").disabled=busy||!canGuess;
 $("guess-title").disabled=s.titleDone||!canGuess;
 $("guess-artist").disabled=s.artistDone||!canGuess;
 $("guess-title").placeholder=s.titleDone?"✓ Title correct":"Guess the song title";
 $("guess-artist").placeholder=s.artistDone?"✓ Artist correct":"Guess the artist";
 show("reveal-button",!revealed);
 show("reveal-card",revealed);
 if(revealed){
  set("revealed-title",s.reveal?.title||"");
  set("revealed-artist",s.reveal?.artist||"");
  set("next-button",s.round>=s.limit?"Finish challenge ↗":"Next song ↗");
  renderCover(s);renderPoints(s);
 }else{$("artwork-cover").hidden=true;$("album-cover").removeAttribute("src")}
 if(s.last){
  const status=v=>v==="correct"?"✓ CORRECT":v==="incorrect"?"✕ TRY AGAIN":v==="already-correct"?"✓ SOLVED":v==="duplicate"?"REPEAT":"—";
  set("feedback","Title "+status(s.last.title)+" · Artist "+status(s.last.artist)+" · "+
      (s.last.delta>0?"+":"")+pts(s.last.delta)+" pts");
 }else set("feedback",s.phase==="ready"?"Play a clue to begin.":"Both fields score separately; every new answer is checked.");
 renderAttempts(s);
 show("history-panel",s.history.length>0);renderHistory("history-list",s.history);
 if(s.phase==="finished"){
  const summary=s.summary||{};
  set("finished-summary",pts(s.score)+" points · "+(summary.solved||0)+" fully solved · "+s.history.length+" tracks");
  renderHistory("finished-tracks",s.history);
 }
}
function renderHistory(id,items){
 const list=$(id);list.replaceChildren();
 for(const song of items){
  const li=document.createElement("li");
  const head=document.createElement("strong"),detail=document.createElement("span");
  head.textContent=fmt(song.artist)+" — "+fmt(song.title);
  detail.textContent="ROUND "+song.round+" · "+
   (song.breakdown?"+"+pts(song.breakdown.total)+" pts · ":"")+
   song.clues+"/"+(state?.durations?.length||8)+" clues";
  li.append(head,detail);list.append(li);
 }
}
async function mutate(op,other={}){
 if(busy||!state)return;
 busy=true;const startRound=state.round;
 try{
  const actionId=crypto.randomUUID().replace(/-/g,"");
  const result=await api("/api/action","POST",{op,round:startRound,actionId,...other});
  if(!state||state.round!==startRound)return;
  const incoming=result.state;
  if(incoming.clipAudio){currentClip=incoming.clipAudio;clipKey=incoming.round+":"+incoming.step}
  else if(currentClip&&clipKey===incoming.round+":"+incoming.step){incoming.clipAudio=currentClip}
  else if(clipKey!==incoming.round+":"+incoming.step)resetClue();
  state=incoming;render();
  return true;
 }catch(e){note(e.message);return false}
 finally{busy=false;render()}
}
async function startGame(ev){
 ev.preventDefault();if(busy)return;
 const genres=[...document.querySelectorAll('input[name="genre"]:checked')].map(e=>e.value);
 if(!genres.length){note("Choose at least one music genre.");return}
 const era=$("era").value;busy=true;$("start-button").disabled=true;
 set("start-button","Checking cached music on S21…");
 try{
  const result=await api("/api/session","POST",{source:"persistent-library",rulesVersion:2,genres,decades:era?[era]:[],limit:Number($("limit").value)},false);
  token=result.token;localStorage.setItem("tunerush_s21_solo_v1",token);
  state=result.state;stop();resetClue();render();
 }catch(e){note(e.message)}finally{
  busy=false;$("start-button").disabled=false;
  set("start-button","Start solo challenge ↗");
 }
}
function waitFor(event,condition=()=>false,timeout=13000){
 return new Promise((resolve,reject)=>{
  if(condition())return resolve();
  const timer=setTimeout(()=>{done();reject(Error("Audio took too long to load or seek."))},timeout);
  const done=()=>{clearTimeout(timer);audio.removeEventListener(event,on);audio.removeEventListener("error",error)};
  const on=()=>{done();resolve()};
  const error=()=>{done();reject(Error("Music playback failed. Use Replay to try again."))};
  audio.addEventListener(event,on,{once:true});audio.addEventListener("error",error,{once:true});
 });
}
async function clip(playCurrent=false){
 if(!state||busy)return;
 if(!playCurrent){
  if(!["ready","playing"].includes(state.phase))return;
  if(!await mutate("clue"))return;
 }else if(state.phase!=="playing")return;
 const capturedRound=state.round,step=state.step;
 const epoch=++playEpoch;
 const src=state.clipAudio||currentClip;
 if(!src||!src.startsWith("data:audio/mpeg;base64,")){
  note("S21 did not return a playable MP3 fragment.");return
 }
 const key=capturedRound+":"+step;
 currentClip=src;clipKey=key;
 measureWaveform(src,key);
 try{
  const changed=audio.getAttribute("src")!==src;
  if(changed){audio.src=src;audio.load()}
  if(audio.readyState<1)await waitFor("loadedmetadata",()=>audio.readyState>=1);
  if(epoch!==playEpoch)return;
  const cue=Number(state.cueMs||250)/1000;
  audio.currentTime=cue;
  if(audio.seeking||Math.abs(audio.currentTime-cue)>.25)
   await waitFor("seeked",()=>!audio.seeking&&Math.abs(audio.currentTime-cue)<.25);
  if(epoch!==playEpoch)return;
  await audio.play();
  $("record-wrap").classList.add("spinning");
  set("playback-status","♫ Playing "+LABELS[step]+" seconds of your S21 MP3.");
  const stopAt=cue+state.durations[step]/1000;
  const deadline=performance.now()+Math.max(16000,state.durations[step]+9000);
  const monitor=()=>{
   if(epoch!==playEpoch||state?.round!==capturedRound){audio.pause();return}
   const progress=Math.min(1,Math.max(0,(audio.currentTime-cue)/(stopAt-cue)));
   drawWave(progress);
   if(audio.currentTime>=stopAt||performance.now()>deadline){
    audio.pause();$("record-wrap").classList.remove("spinning");
    set("playback-status","Fragment played. Guess again, replay, or hear more.");
    return;
   }
   requestAnimationFrame(monitor);
  };
  requestAnimationFrame(monitor);
 }catch(e){
  audio.pause();$("record-wrap").classList.remove("spinning");
  set("playback-status","Playback unavailable. Retry this fragment.");
  note(e.message);
 }
}
async function submit(ev){
 ev.preventDefault();
 if(state?.phase!=="playing")return;
 stop();
 const title=$("guess-title").value,artist=$("guess-artist").value;
 const changed=await mutate("answer",{title,artist});
 if(changed){
  if(state.titleDone)$("guess-title").value="";
  if(state.artistDone)$("guess-artist").value="";
 }
}
function recap(){
 if(!state)return"";
 return ["TUNE RUSH · SOLO SESSION","Score: "+pts(state.score)+" pts",
  "Songs revealed: "+state.history.length,"",
  ...state.history.map(s=>s.round+". "+fmt(s.artist)+" — "+fmt(s.title)+" ("+pts(s.breakdown?.total)+" pts)"),
  "","Played on S21 · https://kalenel.nl/music/"].join("\n");
}
async function copyRecap(){
 const text=recap();
 try{await navigator.clipboard.writeText(text);note("Recap copied")}
 catch{
  const area=document.createElement("textarea");area.value=text;area.readOnly=true;
  document.body.append(area);area.select();
  try{document.execCommand("copy");note("Recap copied")}
  catch{note("Clipboard unavailable; copy the song list manually.")}
  area.remove();
 }
}
$("start-form").addEventListener("submit",startGame);
$("play-button").addEventListener("click",()=>clip());
$("replay-button").addEventListener("click",()=>clip(true));
$("answer-form").addEventListener("submit",submit);
$("reveal-button").addEventListener("click",async()=>{stop();await mutate("reveal")});
$("next-button").addEventListener("click",async()=>{
 stop();if(await mutate("next")){$("guess-title").value="";$("guess-artist").value="";resetClue();
  set("playback-status","Ready for the next mystery song.");}
});
$("finish-button").addEventListener("click",async()=>{
 if(!window.confirm("Finish this solo session and reveal your current song?"))return;
 stop();await mutate("finish");
});
$("new-game").addEventListener("click",()=>{stop();resetClue();token="";state=null;
 try{localStorage.removeItem("tunerush_s21_solo_v1")}catch{}
 render()});
$("copy-recap").addEventListener("click",copyRecap);
$("copy-history").addEventListener("click",copyRecap);
window.addEventListener("pagehide",stop);
window.addEventListener("focus",()=>{if(token&&!busy)refresh()});
refresh();


