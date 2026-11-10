"use strict";
const $=id=>document.getElementById(id),audio=$("music");
let token="",state=null,busy=false,playEpoch=0,revision=0,availability=null,attemptRound="",attempts=new Map();
try{token=localStorage.getItem("tunerush_s21_solo_v1")||"";}catch{}
const set=(id,value)=>{$(id).textContent=String(value??"")},show=(id,visible)=>{$(id).hidden=!visible};
const points=value=>Number(value||0).toFixed(2).replace(/\.?0+$/,"")||"0";
const signed=value=>(value>0?"+":"")+points(value);
const durations=()=>state?.durations||[500,1000,1500,3000,5000,8000,12000,20000];
function note(text){set("toast",text);show("toast",true);clearTimeout(note.timer);note.timer=setTimeout(()=>show("toast",false),4500);}
function stop(){playEpoch++;audio.pause();window.TuneRushScope?.pause();}
function accept(next){
 if(state?.round===next.round&&state?.step===next.step&&!next.clipAudio&&state.clipAudio)next.clipAudio=state.clipAudio;
 state=next;
 const key=token+":"+state.round;
 if(key!==attemptRound){
  attemptRound=key;attempts=new Map();
  try{for(const attempt of JSON.parse(sessionStorage.getItem("tunerush_attempts:"+key)||"[]"))if(Number.isInteger(attempt.sequence)&&attempt.sequence<=state.attemptCount)attempts.set(attempt.sequence,attempt);}catch{}
 }
 for(const attempt of state.attempts||[])attempts.set(attempt.sequence,attempt);
 try{sessionStorage.setItem("tunerush_attempts:"+key,JSON.stringify([...attempts.values()]));}catch{}
 render();
}
function node(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function ledgerRow(label,value,className=""){const row=node("div",className);row.append(node("span","",label),node("b","",value));return row;}
function renderAttempts(){
 const s=state,list=$("attempt-list");list.replaceChildren();
 set("attempt-count",s.attemptCount?(attempts.size<s.attemptCount?"LATEST "+attempts.size+" OF ":"")+s.attemptCount+" ATTEMPT"+(s.attemptCount===1?"":"S"):"NO ATTEMPTS YET");
 if(!attempts.size){list.append(node("li","empty-attempts",s.rulesVersion===2?"Your right answers and near misses will appear here.":"This saved game uses the original rules. Start a new game for the new scoring."));}
 for(const attempt of [...attempts.values()].sort((a,b)=>b.sequence-a.sequence)){
  const item=node("li","attempt-item"),meta=node("div","attempt-meta");
  meta.append(node("span","","#"+attempt.sequence+" · "+attempt.seconds+"s fragment"),node("b",attempt.delta>0?"positive":"",signed(attempt.delta)+" pts"));item.append(meta);
  for(const field of ["title","artist"]){
   const entry=attempt[field];if(!entry?.guess||entry.result==="already-correct")continue;
   const status=entry.result,line=node("div","attempt-guess "+status),value=node("span","guess-value");
   value.append(node("span","guess-kind",field.toUpperCase()),document.createTextNode(entry.guess));
   line.append(node("span","result-icon",status==="correct"?"✓":status==="incorrect"?"×":"↺"),value);item.append(line);
  }list.append(item);
 }
 const b=s.roundPoints||{},ledger=$("round-ledger");ledger.replaceChildren();
 if(s.rulesVersion!==2){ledger.append(ledgerRow("Scoring","Original rules"),ledgerRow("Game score",points(s.score)+" pts","total"));return;}
 ledger.append(ledgerRow("Title + artist",signed((b.title||0)+(b.artist||0)),"positive"),ledgerRow("First-fragment bonus",signed(b.bonus||0),b.bonus?"positive":""),ledgerRow("Clues / wrong entries","−"+points(b.hints||0)+" / −"+points(b.misses||0),"negative"),ledgerRow("This round",points(b.total||0)+" pts","total"));
}
function renderFinish(){
 const s=state,summary=s.summary||{},modern=s.rulesVersion===2;set("final-score",points(s.score));
 const titles=s.history.filter(row=>row.titleCorrect).length,artists=s.history.filter(row=>row.artistCorrect).length,solved=s.history.filter(row=>row.titleCorrect&&row.artistCorrect).length;
 set("finished-summary",solved+" fully solved · "+titles+" title"+(titles===1?"":"s")+" · "+artists+" artist"+(artists===1?"":"s")+" · "+s.history.length+" tracks");
 show("score-summary",modern);
 const tiles=$("score-summary");tiles.replaceChildren();
 for(const [name,value,detail,deduct] of [["Song titles",summary.title,"+5 for each title"],["Artists",summary.artist,"+5 for each artist"],["Speed bonuses",summary.bonus,"Title at 0.5 seconds"],["Extra clues",summary.hints,"−0.25 per step",true],["Wrong entries",summary.misses,"−0.25 per new entry",true]]){
  const tile=node("div","summary-tile"+(deduct?" deduction":""));tile.append(node("span","",name),node("b","",(deduct?"−":"+")+points(value)),node("small","",detail));tiles.append(tile);
 }
 const rows=$("finished-tracks");rows.replaceChildren();
 for(const round of s.history){
  const row=node("tr"),track=node("td"),b=round.breakdown||{},detail=modern?(round.seconds||0)+"s · "+(round.attemptCount||0)+" guesses":round.clues+" fragments";track.append(node("span","track-name",round.title),node("span","track-artist",round.artist+" · "+detail));
  row.append(node("td","",round.round),track,node("td",round.titleCorrect?"positive":"",round.titleCorrect?(modern?"✓ +"+points(b.title):"✓"):"—"),node("td",round.artistCorrect?"positive":"",round.artistCorrect?(modern?"✓ +"+points(b.artist):"✓"):"—"),node("td",b.bonus?"positive":"",b.bonus?"+"+points(b.bonus):"—"),node("td","negative",modern?"−"+points(b.hints):"—"),node("td","negative",modern?"−"+points(b.misses):"—"),node("td","",modern?points(b.total):"—"));rows.append(row);
 }
 if(!modern){set("recap-note","Saved game · original scoring. This earlier game did not store a point breakdown. Your total is "+points(s.score)+" points.");return;}
 set("recap-note",summary.floor?"Zero-point floors restored "+points(summary.floor)+" points across rounds. Rewards − deductions + floor adjustments = "+points(s.score)+" points.":"Every point is accounted for. Title + artist + bonus − hints − misses = "+points(s.score)+" points.");
}
function render(){
 show("welcome",!state);show("game",!!state&&state.phase!=="finished");show("finished",state?.phase==="finished");if(!state)return;
 const s=state,revealed=["revealed","finished"].includes(s.phase),modern=s.rulesVersion===2,ds=durations();
 const canGuess=!revealed&&s.step>=0&&(modern||s.phase==="playing"&&s.guessedStep!==s.step);
 set("round-label",String(s.round).padStart(2,"0")+" / "+s.limit);set("score-label",points(s.score));set("round-points",points(s.roundPoints?.total));
 const dots=$("round-dots");dots.replaceChildren();for(let i=1;i<=s.limit;i++)dots.append(node("i",i<s.round?"done":i===s.round?"current":""));
 set("phase-indicator",revealed?"TRACK REVEALED":"MYSTERY TRACK");set("stage-title",revealed?(s.titleDone&&s.artistDone?"You got it.":s.titleDone||s.artistDone?"Every part counts.":"One for next time."):"Trust your ears.");
 set("stage-sub",modern?"Title, artist, or both. Keep trying.":"Saved game · original scoring rules");
 show("bonus-pill",modern);document.querySelector(".round-score").hidden=!modern;
 const bonus=$("bonus-pill"),earned=s.roundPoints?.bonus>0;bonus.className="bonus-pill"+(earned?" earned":s.step>0?" inactive":"");bonus.textContent=earned?"✓ +2 speed bonus":s.step>0?"Speed bonus ended":"0.5s title = +2 bonus";
 const sec=ds[Math.max(0,s.step)]/1000;window.TuneRushScope?.duration(sec,s.round,s.step);
 if(s.clipAudio&&s.step>=0)void window.TuneRushScope?.load(s.clipAudio,s.cueMs/1000,sec);
 set("clue-label",s.step<0?ds.length+" chances to hear more":"Fragment "+(s.step+1)+" / "+ds.length);
 const clues=$("clues");clues.replaceChildren();clues.style.gridTemplateColumns="repeat("+ds.length+",minmax(0,1fr))";
 ds.forEach((ms,i)=>{const replay=i===s.step&&s.phase==="playing",select=i>s.step&&!revealed;const button=node("button","clue"+(i<s.step?" past":"")+(i===s.step?" current":"")+(select?" selectable":""),ms/1000+"s");button.type="button";button.disabled=busy||!(replay||select);button.setAttribute("aria-label",(replay?"Replay ":"Play ")+ms/1000+"-second fragment");if(i===s.step)button.setAttribute("aria-current","step");button.addEventListener("click",()=>clip(replay,i));clues.append(button);});
 const advance=!revealed&&s.step<ds.length-1;$("play-button").disabled=busy||!advance;show("play-button",!revealed);set("play-button",s.step<0?"▶ Play 0.5 seconds":advance?"▶ Play "+ds[s.step+1]/1000+(ds[s.step+1]===1000?" second":" seconds"):"All fragments unlocked");
 $("replay-button").disabled=busy||s.phase!=="playing";show("replay-button",!revealed);
 for(const field of ["title","artist"]){
  const done=s[field+"Done"],input=$("guess-"+field);$(field+"-field").classList.toggle("field-correct",done);input.disabled=busy||done||!canGuess;
  if(done)input.value=s.solved?.[field]||"Correct answer";
  set(field+"-state",modern?(done?"✓ +5 earned":"+5 points"):(done?"✓ Correct":"Original rules"));
  $("solved-"+field+"-card").classList.toggle("correct",done);set("solved-"+field,done?(s.solved?.[field]||"Correct answer"):"Still a mystery");set("solved-"+field+"-icon",done?"✓":"○");
 }
 $("submit-button").disabled=busy||!canGuess;show("answer-form",!revealed);document.querySelector(".guess-heading").hidden=revealed;
 show("reveal-button",!revealed);$("reveal-button").disabled=busy;show("reveal-card",revealed);
 if(revealed){set("revealed-title",s.reveal?.title);set("revealed-artist",s.reveal?.artist);set("next-button",s.round>=s.limit?"See your recap →":"Next song →");$("next-button").disabled=busy;}
 const feedback=$("feedback");feedback.className="";
 if(s.last){const names={correct:"correct",incorrect:"not quite","already-correct":"already solved","not-entered":"not entered",duplicate:"already checked"};set("feedback","Title: "+(names[s.last.title]||"—")+" · Artist: "+(names[s.last.artist]||"—")+" · "+signed(s.last.delta)+" pts");feedback.classList.toggle("success",s.last.delta>0);}
 else set("feedback",s.step<0?"Play a fragment, then make your first guess.":modern?"You can try again on this fragment, or hear a little more.":"Make your guess.");
 renderAttempts();if(s.phase==="finished")renderFinish();
}
async function mutate(op,data={}){
 if(busy||!state)return false;busy=true;revision++;render();
 try{const result=await api("/api/action","POST",{op,round:state.round,actionId:randomSoloToken().slice(0,32),...data});accept(result.state);return true;}
 catch(error){note(error.message);return false;}finally{busy=false;render();}
}
function waitFor(event,test,timeout=12000){return new Promise((resolve,reject)=>{if(test())return resolve();const end=()=>{clearTimeout(timer);audio.removeEventListener(event,ok);audio.removeEventListener("error",bad)},ok=()=>{end();resolve()},bad=()=>{end();reject(Error("Audio could not be loaded. Try Replay."))},timer=setTimeout(()=>{end();reject(Error("Audio took too long to load."))},timeout);audio.addEventListener(event,ok,{once:true});audio.addEventListener("error",bad,{once:true});});}
async function clip(replay=false,target=null){
 if(!state||busy)return;window.TuneRushScope?.unlock();stop();
 if(!replay&&!await mutate("clue",target===null?{}:{targetStep:target}))return;
 if(state.phase!=="playing")return;
 const snapshot={round:state.round,step:state.step,cue:state.cueMs/1000,seconds:durations()[state.step]/1000},epoch=++playEpoch,src=state.clipAudio;
 if(!src){note("This saved game has no cached fragment. Start a new game to use the updated player.");return;}
 try{
  if(audio.getAttribute("src")!==src){audio.src=src;audio.load();}
  void window.TuneRushScope?.load(src,snapshot.cue,snapshot.seconds);
  await waitFor("loadedmetadata",()=>audio.readyState>=1);if(epoch!==playEpoch)return;
  audio.currentTime=snapshot.cue;if(audio.seeking)await waitFor("seeked",()=>!audio.seeking);if(epoch!==playEpoch)return;
  await audio.play();set("playback-status","Listen. Then trust your first instinct.");
  const deadline=performance.now()+snapshot.seconds*1000+12000;
  const monitor=()=>{
   if(epoch!==playEpoch||state.round!==snapshot.round){audio.pause();return;}
   const elapsed=Math.min(snapshot.seconds,Math.max(0,audio.currentTime-snapshot.cue));window.TuneRushScope?.progress(elapsed,snapshot.seconds,!audio.paused);
   if(elapsed>=snapshot.seconds-.012||audio.ended||performance.now()>deadline){audio.pause();window.TuneRushScope?.progress(snapshot.seconds,snapshot.seconds,false);set("playback-status","Heard it? Take a guess. Replay is free.");return;}
   requestAnimationFrame(monitor);
  };requestAnimationFrame(monitor);
 }catch(error){audio.pause();note(error.message);set("playback-status","Press Replay to try the audio again.");}
}
function updateAvailability(){
 const selected=[...document.querySelectorAll('input[name="genre"]:checked')].map(el=>el.value),era=$("era").value;
 const count=availability?.filter(song=>song[1].some(g=>selected.includes(g))&&(!era||song[2].includes(era))).length;
 const enough=!!selected.length&&(count===undefined||count>=Number($("limit").value));
 set("video-availability",!selected.length?"Choose at least one genre.":count===undefined?"Your music is checked when the game starts.":count+" cached songs in your mix"+(enough?" ✓":" · choose more genres or fewer rounds"));
 $("video-availability").classList.toggle("availability-warning",!enough);$("start-button").disabled=busy||!enough;
}
async function refresh(){
 try{const health=await api("/api/health");set("server-status",health.ready?"Connected":"Unavailable");$("server-status").className="connection "+(health.ready?"online":"offline");
  if(token&&!busy){const previous=token,version=revision;try{const result=await api("/api/state");if(previous===token&&version===revision&&!busy)accept(result.state);}catch(error){if(previous!==token||version!==revision)return;if(/expired/.test(error.message)){token="";try{localStorage.removeItem("tunerush_s21_solo_v1");}catch{}render();}else note(error.message);}}
 }catch(error){set("server-status","Reconnecting");$("server-status").className="connection offline";note(error.message);}
}
$("start-form").addEventListener("submit",async event=>{
 event.preventDefault();if(busy)return;busy=true;revision++;show("start-error",false);set("start-button","Selecting your tracks…");updateAvailability();
 try{const result=await api("/api/session","POST",{source:"persistent-library",rulesVersion:2,genres:[...document.querySelectorAll('input[name="genre"]:checked')].map(el=>el.value),decades:$("era").value?[$("era").value]:[],limit:Number($("limit").value)},false);token=result.token;try{localStorage.setItem("tunerush_s21_solo_v1",token);}catch{}stop();accept(result.state);}
 catch(error){set("start-error",error.message);show("start-error",true);}finally{busy=false;set("start-button","Let's play ↗");updateAvailability();render();}
});
$("answer-form").addEventListener("submit",async event=>{event.preventDefault();if(busy)return;stop();const title=state.titleDone?"":$("guess-title").value,artist=state.artistDone?"":$("guess-artist").value;if(!title.trim()&&!artist.trim()){note("Enter a title, an artist, or both.");return;}if(await mutate("answer",{title,artist})){for(const field of ["title","artist"])if(!state[field+"Done"])$("guess-"+field).value="";if(!state.titleDone)$("guess-title").focus();else if(!state.artistDone)$("guess-artist").focus();}});
$("play-button").addEventListener("click",()=>clip());$("replay-button").addEventListener("click",()=>clip(true));
$("reveal-button").addEventListener("click",async()=>{stop();await mutate("reveal");});
$("next-button").addEventListener("click",async()=>{stop();if(await mutate("next"))for(const field of ["title","artist"])$("guess-"+field).value="";});
$("finish-button").addEventListener("click",async()=>{if(!confirm("Finish this game and see your score recap?"))return;stop();await mutate("finish");});
$("new-game").addEventListener("click",()=>{stop();revision++;token="";state=null;attempts.clear();try{localStorage.removeItem("tunerush_s21_solo_v1");}catch{}render();updateAvailability();});
$("copy-recap").addEventListener("click",async()=>{if(!state)return;const text=["TUNE RUSH · "+points(state.score)+" points",...state.history.map(row=>{const b=row.breakdown||{},prefix=row.round+". "+row.artist+" — "+row.title;if(state.rulesVersion!==2)return prefix+": title "+(row.titleCorrect?"correct":"missed")+", artist "+(row.artistCorrect?"correct":"missed")+" (original scoring)";return prefix+": title +"+points(b.title)+", artist +"+points(b.artist)+", bonus +"+points(b.bonus)+", hints −"+points(b.hints)+", misses −"+points(b.misses)+", zero-floor +"+points(b.floor)+" = "+points(b.total)+" pts";}),"https://kalenel.nl/music/?mode=solo"].join("\n");try{await navigator.clipboard.writeText(text);note("Score recap copied.");}catch{note("Clipboard unavailable. Your full recap is shown on screen.");}});
$("rules-button").addEventListener("click",()=>$("rules-dialog").showModal());$("close-rules").addEventListener("click",()=>$("rules-dialog").close());
for(const el of document.querySelectorAll('input[name="genre"],#era,#limit'))el.addEventListener("change",()=>{show("start-error",false);updateAvailability();});
window.addEventListener("pagehide",stop);window.addEventListener("focus",()=>{if(!busy)void refresh();});
window.addEventListener("message",event=>{if(event.origin===location.origin&&event.data?.type==="tunerush-solo-pause")stop();});
try{availability=JSON.parse($("cached-library-availability-data").textContent).songs;}catch{}
render();updateAvailability();void refresh();
