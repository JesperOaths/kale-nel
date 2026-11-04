"use strict";
const $=id=>document.getElementById(id);
const audio=$("music");
let token="",state=null,busy=false,playEpoch=0;
const LABELS=["0.5","1.5","3","5","8","12","20"];
try{token=localStorage.getItem("tunerush_s21_solo_v1")||""}catch{}
const show=(id,visible)=>$(id).hidden=!visible;
const set=(id,value)=>{$(id).textContent=String(value??"")};
const note=(msg)=>{set("toast",msg);show("toast",true);clearTimeout(note.timer);note.timer=setTimeout(()=>show("toast",false),3800)};
function stop(){playEpoch++;audio.pause();$("record-wrap").classList.remove("spinning")}
function fmt(s){return String(s??"").replace(/[\u0000-\u001f]/g," ").trim()}
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
 if(!s)return;
 const revealed=["revealed","finished"].includes(s.phase);
 const played=s.step>=0,canGuess=s.phase==="playing"&&s.guessedStep!==s.step;
 set("round-label",String(s.round).padStart(2,"0")+" / "+s.limit);
 set("score-label",s.score.toFixed(1)+" PTS");
 set("clue-label",played?(s.step+1)+" / 7":"READY");
 set("phase-indicator",s.phase==="ready"?"READY":s.phase==="playing"?"LISTEN / GUESS":revealed?"REVEALED":"WAITING");
 set("stage-title",revealed?"Mystery solved.":s.phase==="ready"?(played?"Ready for another hint?":"Listen closely."):"Know the song?");
 set("stage-sub",revealed?"The complete answer is now visible.":s.phase==="ready"?"Each hint gets longer. Take your best guess.":"Use your ears, then enter the song title and artist.");
 $("clues").replaceChildren();
 for(let i=0;i<7;i++){
  const el=document.createElement("span");
  el.className="clue"+(i<=s.step?" heard":"")+(i===s.step?" current":"");
  el.textContent=LABELS[i]+"s";$("clues").append(el);
 }
 show("play-button",s.phase==="ready"||s.phase==="playing");
 $("play-button").disabled=busy||(s.phase==="playing")||s.step===6;
 set("play-button",s.step===-1?"▶ Play first clue":s.phase==="ready"?"▶ Play longer clue":"Clue already played");
 show("replay-button",s.phase==="playing");$("replay-button").disabled=busy;
 $("submit-button").disabled=busy||!canGuess;
 $("guess-title").disabled=s.titleDone||!canGuess;
 $("guess-artist").disabled=s.artistDone||!canGuess;
 if(s.titleDone)$("guess-title").placeholder="✓ Already correct";
 if(s.artistDone)$("guess-artist").placeholder="✓ Already correct";
 show("reveal-button",!revealed);
 show("reveal-card",revealed);
 if(revealed){
  set("revealed-title",s.reveal?.title||"");
  set("revealed-artist",s.reveal?.artist||"");
  set("next-button",s.round>=s.limit?"Finish challenge ↗":"Next song ↗");
 }
 if(s.last){
  const status=v=>v==="correct"?"✓ CORRECT":v==="incorrect"?"✕ NOT YET":v==="already-correct"?"✓ ALREADY SOLVED":"— NOT GUESSED";
  set("feedback","Title: "+status(s.last.title)+" · Artist: "+status(s.last.artist)+" · "+(s.last.delta>0?"+":"")+s.last.delta.toFixed(1)+" pts");
 }else set("feedback",s.phase==="ready"?"Play a clue and enter a guess.":"Your guess is checked privately by the S21.");
 show("history-panel",s.history.length>0);renderHistory("history-list",s.history);
 if(s.phase==="finished"){
  set("finished-summary",s.score.toFixed(1)+" points · "+s.history.length+" songs revealed · "+s.limit+"-song challenge");
  renderHistory("finished-tracks",s.history);
 }
}
function renderHistory(id,items){
 const list=$(id);list.replaceChildren();
 for(const song of items){
  const li=document.createElement("li");
  const head=document.createElement("strong"),detail=document.createElement("span");
  head.textContent=fmt(song.artist)+" — "+fmt(song.title);
  detail.textContent="ROUND "+song.round+" · "+song.clues+"/7 clues";
  li.append(head,detail);list.append(li);
 }
}
async function mutate(op,other={}){
 if(busy||!state)return;
 busy=true;const startRound=state.round;
 try{
  const result=await api("/api/action","POST",{op,round:startRound,...other});
  if(!state||state.round!==startRound)return;
  state=result.state;render();
  return true;
 }catch(e){note(e.message);return false}
 finally{busy=false;render()}
}
async function startGame(ev){
 ev.preventDefault();if(busy)return;
 const genres=[...document.querySelectorAll('input[name="genre"]:checked')].map(e=>e.value);
 if(!genres.length){note("Choose at least one music genre.");return}
 const era=$("era").value;busy=true;$("start-button").disabled=true;
 set("start-button","Checking the Audius catalog on S21…");
 try{
  const result=await api("/api/session","POST",{genres,decades:era?[era]:[],limit:Number($("limit").value)},false);
  token=result.token;localStorage.setItem("tunerush_s21_solo_v1",token);
  state=result.state;stop();render();
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
  if(state.phase!=="ready")return;
  if(!await mutate("clue"))return;
 }else if(state.phase!=="playing")return;
 const capturedRound=state.round,step=state.step;
 const epoch=++playEpoch;
 const src=state.clipAudio||state.media;
 if(!src){note("No S21 stream is available.");return}
 try{
  const changed=audio.getAttribute("src")!==src;
  if(changed){audio.src=src;audio.load()}
  if(audio.readyState<1)await waitFor("loadedmetadata",()=>audio.readyState>=1);
  if(epoch!==playEpoch)return;
  const cue=state.cueMs/1000;
  audio.currentTime=cue;
  if(audio.seeking||Math.abs(audio.currentTime-cue)>.25)
   await waitFor("seeked",()=>!audio.seeking&&Math.abs(audio.currentTime-cue)<.25);
  if(epoch!==playEpoch)return;
  await audio.play();
  $("record-wrap").classList.add("spinning");
  set("playback-status","♫ Playing "+LABELS[step]+" seconds from your S21 music stream…");
  const stopAt=cue+state.durations[step]/1000;
  const deadline=performance.now()+Math.max(16000,state.durations[step]+9000);
  const monitor=()=>{
   if(epoch!==playEpoch||state?.round!==capturedRound){audio.pause();return}
   if(audio.currentTime>=stopAt||performance.now()>deadline){
    audio.pause();$("record-wrap").classList.remove("spinning");
    set("playback-status","Clue played. Enter a guess or replay the same clue.");
    return;
   }
   requestAnimationFrame(monitor);
  };
  requestAnimationFrame(monitor);
 }catch(e){
  audio.pause();$("record-wrap").classList.remove("spinning");
  set("playback-status","Playback unavailable. Click Replay this clue to retry.");
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
 return ["TUNE RUSH · SOLO SESSION","Score: "+state.score.toFixed(1)+" pts",
  "Songs revealed: "+state.history.length,"",
  ...state.history.map(s=>s.round+". "+fmt(s.artist)+" — "+fmt(s.title)+" ("+s.clues+"/7 clues)"),
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
 stop();if(await mutate("next")){$("guess-title").value="";$("guess-artist").value="";
  set("playback-status","Ready for the next mystery song.");}
});
$("finish-button").addEventListener("click",async()=>{
 if(!window.confirm("Finish this solo session and reveal your current song?"))return;
 stop();await mutate("finish");
});
$("new-game").addEventListener("click",()=>{stop();token="";state=null;
 try{localStorage.removeItem("tunerush_s21_solo_v1")}catch{}
 render()});
$("copy-recap").addEventListener("click",copyRecap);
$("copy-history").addEventListener("click",copyRecap);
window.addEventListener("pagehide",stop);
window.addEventListener("focus",()=>{if(token&&!busy)refresh()});
refresh();


