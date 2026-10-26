import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const html=readFileSync(new URL("../music/index.html",import.meta.url),"utf8");
const raw=readFileSync(new URL("../music/app.js",import.meta.url),"utf8");
const source=raw.split('$("create").addEventListener')[0];

for(const id of ["audius-check","audius-play-hint","audius-replay-hint","genre-options","decade-options","speaker-check-status","host-volume-lobby","host-volume-player"])
 assert.ok(html.includes('id="'+id+'"'),"Missing Audius control: "+id);
for(const id of ["youtube-host","youtube-setup","deezer-host","deezer-source-option","local-music-files","source-select"])
 assert.ok(!html.includes('id="'+id+'"'),"Retired source still exposed: "+id);
for(const name of ["youtubeWaitCancelled","deezerPlayer","localTracks","importLocalFiles","ensureYoutubePlayer"])
 assert.ok(!raw.includes(name),"Retired source function still present: "+name);

function fixture(){
 const elements=new Map(),timers=new Map(),prefs=new Map();let sequence=0;
 const element=id=>{
  if(!elements.has(id))elements.set(id,{
   hidden:false,textContent:"",disabled:false,readyState:4,error:null,paused:false,seeking:false,
   _time:0,listeners:new Map(),style:{setProperty(){}},dataset:{},attrs:new Map(),
   get currentTime(){return this._time},
   set currentTime(value){this._time=value;this.seeking=false;this.emit("seeked")},
   addEventListener(type,fn){const set=this.listeners.get(type)||new Set();set.add(fn);this.listeners.set(type,set)},
   removeEventListener(type,fn){this.listeners.get(type)?.delete(fn)},
   emit(type){for(const fn of this.listeners.get(type)||[])fn()},
   setAttribute(name,value){this.attrs.set(name,value)},pause(){this.paused=true},load(){this.loadCount=(this.loadCount||0)+1},async play(){this.paused=false},querySelector(){return null},replaceChildren(...children){this.children=children}
  });
  return elements.get(id);
 };
 const groups={
  "[data-host-volume]":[element("host-volume-lobby"),element("host-volume-player")],
  "[data-volume-label]":[element("host-label-lobby"),element("host-label-player")],
  "[data-volume-toggle]":[element("host-mute-lobby"),element("host-mute-player")]
 };
 const sandbox={URL,TextEncoder,Uint8Array,AbortController,console,
  crypto:{subtle:{digest:async()=>new Uint8Array(32).buffer}},
  location:{origin:"https://kalenel.nl"},window:{innerHeight:900},
  localStorage:{getItem:key=>prefs.get(key)??null,
   setItem:(key,value)=>prefs.set(key,String(value)),removeItem:key=>prefs.delete(key)},
  document:{hidden:false,getElementById:element,querySelectorAll:selector=>groups[selector]||[]},
  setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id},
  clearTimeout(id){timers.delete(id)}};
 const context=vm.createContext(sandbox);
 vm.runInContext(source+'\nrender=()=>{};access={code:"ABCDEF",token:"fixture-token"};room={code:"ABCDEF",role:"host",round:1,step:-1,phase:"paused",mode:"local",audio:{source:"local:20000001",cueMs:13000},clipMs:500,players:[]};localCurrentIndex=20000001;localAudioUrl="https://api.audius.co/v1/tracks/abcdef/stream";audiusActive=true;',context);
 return {run:code=>vm.runInContext(code,context),element,timers};
}
async function fireTimer(f,ms){
 for(let i=0;i<14&&![...f.timers.values()].some(t=>t.ms===ms);i++)await Promise.resolve();
 const t=[...f.timers.entries()].find(([,v])=>v.ms===ms);
 assert.ok(t,"Expected "+ms+"ms timer");
 f.timers.delete(t[0]);await t[1].fn();
}
{
 const f=fixture(),a=f.element("licensed-player");a.currentTime=0;
 const pending=f.run('playLocalHint({source:"local:20000001",cueMs:13000})');
 for(let i=0;i<60&&![...f.timers.values()].some(t=>t.ms===75);i++)await Promise.resolve();
 assert.ok([...f.timers.values()].some(t=>t.ms===75),"Buffer wait is required");
 a.currentTime=13.2;await fireTimer(f,75);await pending;
 assert.match(f.element("audius-playback-status").textContent,/Playing clue/);
}
{
 const f=fixture(),a=f.element("licensed-player");a.currentTime=0;
 const pending=f.run('playLocalHint({source:"local:20000001",cueMs:13000})');
 for(let i=0;i<120;i++)await fireTimer(f,75);
 await assert.rejects(pending,/still buffering/,"Stalled playback must fail closed");
}
// The two host volume faders are one preference; toggling mute only changes
// browser output and never changes the active room or media source.
{
 const f=fixture(),audio=f.element("licensed-player");
 f.run("initHostMixer()");
 assert.equal(f.element("host-volume-lobby").value,"100");
 assert.equal(f.element("host-volume-player").value,"100");
 f.run("setHostVolume(35)");
 assert.equal(audio.volume,0.35);
 assert.equal(f.element("host-volume-lobby").value,"35");
 assert.equal(f.element("host-volume-player").value,"35");
 assert.equal(f.element("host-label-lobby").textContent,"35%");
 assert.equal(f.element("host-label-player").textContent,"35%");
 assert.equal(f.run("room.round"),1);
 assert.equal(f.run("room.audio.source"),"local:20000001");
 const beforeUrl=f.run("localAudioUrl");
 f.run("toggleHostMute()");
 assert.equal(audio.muted,true);
 assert.equal(f.element("host-mute-player").attrs.get("aria-pressed"),"true");
 assert.equal(f.element("host-label-lobby").textContent,"MUTED");
 assert.equal(f.run("localAudioUrl"),beforeUrl);
 await f.run("testSpeakers()");
 assert.match(f.element("speaker-check-status").textContent,/Mixer muted/);
 f.run("toggleHostMute()");
 assert.equal(audio.muted,false);
 assert.equal(audio.volume,0.35,"unmute restores volume");
 assert.equal(f.element("host-mute-lobby").attrs.get("aria-pressed"),"false");
 assert.equal(JSON.parse(f.run('localStorage.getItem(HOST_MIXER_STORE)')).level,35);
 assert.equal(JSON.parse(f.run('localStorage.getItem(HOST_MIXER_STORE)')).muted,false);
 f.run('setHostVolume(-2);setHostVolume(101);setHostVolume("bogus")');
 assert.equal(audio.volume,0.35,"invalid volume data cannot change output");
}
{
 const f=fixture(),audio=f.element("licensed-player");
 f.run('localStorage.setItem(HOST_MIXER_STORE,JSON.stringify({level:65,muted:true}));initHostMixer()');
 assert.equal(audio.volume,0.65);
 assert.equal(audio.muted,true);
 assert.equal(f.element("host-volume-player").value,"65");
 f.run("toggleHostMute()");
 assert.equal(audio.muted,false);
 assert.equal(audio.volume,0.65);
}
// A delayed seek must not accept a stale playhead from the previous clip.
{
 const f=fixture(),a=f.element("licensed-player");
 a.currentTime=19;let clock=19,seekRequested=0;
 Object.defineProperty(a,"currentTime",{configurable:true,
  get:()=>clock,set:value=>{seekRequested=value;a.seeking=true}});
 const pending=f.run('playLocalHint({source:"local:20000001",cueMs:13000})');
 for(let i=0;i<60&&!([...f.timers.values()].some(t=>t.ms===75));i++)await Promise.resolve();
 assert.equal(seekRequested,13,"seek must target the original random cue");
 assert.ok([...f.timers.values()].some(t=>t.ms===75),"wait for seek evidence");
 // Reading 19s from the previous clue is not proof that a new clue played.
 await fireTimer(f,75);
 assert.ok([...f.timers.values()].some(t=>t.ms===75),"old playhead must not complete cue");
 clock=13.23;a.seeking=false;a.emit("seeked");
 await fireTimer(f,75);await pending;
 assert.match(f.element("audius-playback-status").textContent,/Playing clue/);
}
// A seek that jumps well past the original half-second clue fails closed.
{
 const f=fixture(),a=f.element("licensed-player");
 a.play=async()=>{a.paused=false;a.currentTime=15};
 await assert.rejects(f.run('playLocalHint({source:"local:20000001",cueMs:13000})'),
  /jumped past the short clue/);
}
{
 const f=fixture(),a=f.element("licensed-player");
 a.play=async()=>{a.paused=false;a.currentTime=13.2};
 const pending=f.run('let operations=[];rpc=async action=>{operations.push(action);return {state:{...room,step:action==="play"?0:room.step,phase:action==="play"?"playing":"paused",clipMs:500}}};startClip()');
 await pending;assert.equal(f.run("room.step"),0);
 a.currentTime=13.22;await fireTimer(f,500);
 assert.equal(f.run("room.phase"),"playing","Elapsed timer must not end a buffered clue");
 a.currentTime=13.62;await fireTimer(f,80);
 assert.equal(f.run("room.phase"),"paused");
 assert.equal(f.run("operations.join(',')"),"play,pause");
}
// A server-started clue with no audible music pauses without consuming a
// hint, changing a score, or revealing the mystery song.
{
 const f=fixture(),audio=f.element("licensed-player");
 audio.paused=false;
 await f.run('room.phase="playing";room.step=0;room.clipMs=500;'+
  'room.players=[{id:"guest1",name:"Guest",score:1}];room.firstAnswered=false;'+
  'startedClip=true;let rescueActions=[];'+
  'rpc=async action=>{rescueActions.push(action);return {state:{...room,'+
  'phase:action==="pause"?"paused":"playing",step:room.step,players:room.players}}};'+
  'pauseSilentClue()');
 assert.equal(audio.paused,true,"rescue must stop the local stream");
 assert.equal(f.run("room.phase"),"paused");
 assert.equal(f.run("room.step"),0,"silence cannot consume a new clue");
 assert.equal(f.run("room.players[0].score"),1,"rescue never changes score");
 assert.equal(f.run("failedClue"),"1:0","next Play must repeat this same step");
 assert.equal(f.run("rescueActions.join(',')"),"pause");
 assert.match(f.run("clueRescueNotice"),/paused without advancing/);
 await f.run('playerAudio.play=async()=>{playerAudio.paused=false;playerAudio.currentTime=13.2};startClip()');
 assert.equal(f.run("room.step"),0);
 assert.equal(f.run("rescueActions.join(',')"),"pause,replay");
 assert.equal(f.run("room.players[0].score"),1);
 f.run("clearAudio()");
}
// Once a player answered, the host cannot rewind an already-scored clue.
{
 const f=fixture();
 f.run('room.phase="playing";room.step=2;room.firstAnswered=true;'+
  'let rescues=0;rpc=async()=>{rescues++}');
 await f.run("pauseSilentClue()");
 assert.equal(f.run("rescues"),0);
 assert.equal(f.run("room.phase"),"playing");
}
// Old pause responses never resurrect the game after Leave.
{
 const f=fixture();
 const pending=f.run('room.phase="playing";room.step=0;room.firstAnswered=false;'+
  'let settleRescue,originalRoom=room;'+
  'rpc=async()=>new Promise(resolve=>{settleRescue=resolve});pauseSilentClue()');
 f.run("reset()");
 f.run('settleRescue({state:{...originalRoom,phase:"paused"}})');
 await pending;
 assert.equal(f.run("room"),null,"late response must not restore departed room");
 assert.equal(f.run("clueRescueBusy"),false);
}
// Winner results can be shared without tokens or unrevealed song data.
{
 const f=fixture();
 f.run('room.phase="finished";room.winner="player2";'+
  'room.players=[{id:"player1",name:"First",score:8.5},'+
  '{id:"player2",name:"Champion",score:20}]');
 const summary=f.run("finalScoreboard(room)");
 assert.match(summary,/Winner: Champion/);
 assert.ok(summary.indexOf("Champion — 20.0 pts")<summary.indexOf("First — 8.5 pts"));
 assert.ok(!summary.includes("fixture-token"),"export must not include host credentials");
 assert.throws(()=>f.run('finalScoreboard({...room,phase:"playing"})'),/not ready/);
}
// One click creates a new lobby, restores host filters, and never reuses
// the old room code or other players' capabilities.
{
 const f=fixture();
 f.run('room.phase="finished";room.genres=["pop","rock"];room.decades=["1990"];'+
  'room.players=[{id:"player1",score:20}];room.winner="player1";'+
  'let newRoomActions=[];rpc=async(action,data)=>{newRoomActions.push(action);'+
  'if(action==="create")return {token:"b".repeat(64),'+
  'state:{code:"BCD234",phase:"lobby",role:"host",round:0,step:-1,'+
  'players:[],genres:["pop"],decades:[]}};'+
  'if(action==="settings")return {state:{...room,genres:data.genres,decades:data.decades}};'+
  'throw Error("unexpected action")};');
 await f.run("newParty()");
 assert.equal(f.run("room.code"),"BCD234");
 assert.equal(f.run("room.phase"),"lobby");
 assert.equal(f.run("room.players.length"),0);
 assert.equal(f.run("room.genres.join(',')"),"pop,rock");
 assert.equal(f.run("room.decades.join(',')"),"1990");
 assert.equal(f.run("newRoomActions.join(',')"),"create,settings");
 assert.equal(f.run("access.code"),"BCD234");
 assert.equal(f.run("loading"),false);
 assert.equal(f.run("newPartyBusy"),false);
}
// If the new room fails, the finished room and score are retained.
{
 const f=fixture();
 f.run('room.phase="finished";room.genres=["pop"];room.players=['+
  '{id:"champ",score:20}];room.winner="champ";'+
  'let failedCreates=0;rpc=async()=>{failedCreates++;throw Error("temporary_failure")}');
 await f.run("newParty()");
 assert.equal(f.run("room.code"),"ABCDEF");
 assert.equal(f.run("room.phase"),"finished");
 assert.equal(f.run("room.players[0].score"),20);
 assert.equal(f.run("failedCreates"),1);
 assert.equal(f.run("loading"),false);
 assert.match(f.element("finish-rematch-status").textContent,/still here/);
}
// Two fast taps cannot create two fresh rooms; a stale result cannot
// switch back after the host leaves or starts another session.
{
 const f=fixture();
 f.run('room.phase="finished";room.genres=["pop"];let releaseCreate,numberOfCreates=0;'+
  'rpc=async(action)=>{numberOfCreates++;return new Promise(r=>{releaseCreate=r})}');
 const one=f.run("newParty()"),two=f.run("newParty()");
 assert.equal(f.run("numberOfCreates"),1);
 assert.equal(f.run("newPartyBusy"),true);
 f.run("reset()");
 f.run('releaseCreate({token:"c".repeat(64),state:{code:"BCD234",phase:"lobby",role:"host",players:[]}})');
 await Promise.all([one,two]);
 assert.equal(f.run("room"),null,"old create response must not resurrect a departed session");
 assert.equal(f.run("numberOfCreates"),1);
}
// Answer countdown is purely a client-side view of the server's deadline.
// Neither reaching zero nor a late invalid deadline changes room scores.
{
 const f=fixture();
 const serverExpires=Date.parse("2026-10-26T19:00:25.000Z");
 const state={phase:"answering",answerExpiresAt:"2026-10-26T19:00:25.000Z"};
 const at=(ms)=>f.run('answerClockSnapshot('+JSON.stringify(state)+','+ms+')');
 let clock=at(serverExpires-25000);
 assert.equal(clock.seconds,25);
 assert.equal(clock.remaining,25);
 assert.equal(clock.warning,false);
 clock=at(serverExpires-9500);
 assert.equal(clock.seconds,10);
 assert.equal(clock.warning,true);
 assert.equal(clock.urgent,false);
 clock=at(serverExpires-4200);
 assert.equal(clock.seconds,5);
 assert.equal(clock.urgent,true);
 clock=at(serverExpires);
 assert.equal(clock.seconds,0);
 assert.equal(clock.expired,true);
 assert.equal(at(serverExpires+15000).remaining,0);
 assert.equal(f.run('answerClockSnapshot({phase:"answering",answerExpiresAt:"garbled"},0)'),null);
 assert.equal(f.run('answerClockSnapshot({phase:"paused",answerExpiresAt:"2026-10-26T19:00:25Z"},0)'),null);
 f.run('room.role="player";room.phase="answering";room.me="player-a";'+
  'room.lockedPlayer="player-a";room.answerExpiresAt="2026-10-26T19:00:25Z";'+
  'room.players=[{id:"player-a",score:5}];let clockMutations=0;'+
  'rpc=async()=>{clockMutations++};');
 f.run("updateAnswerClock("+String(serverExpires-9500)+")");
 assert.equal(f.element("answer-countdown").textContent,"10s");
 assert.equal(f.element("answer-clock").dataset.timing,"warning");
 assert.equal(f.element("answer-clock-meter").attrs.get("aria-valuenow"),"10");
 assert.equal(f.element("answer-clock-fill").style.width,"38%");
 f.run("updateAnswerClock("+String(serverExpires-4200)+")");
 assert.equal(f.element("answer-clock").dataset.timing,"urgent");
 assert.match(f.element("answer-clock-help").textContent,/Last few seconds/);
 f.run("updateAnswerClock("+String(serverExpires+1000)+")");
 assert.equal(f.element("answer-countdown").textContent,"0s");
 assert.equal(f.element("answer-clock").dataset.timing,"expired");
 assert.equal(f.element("answer-clock-meter").attrs.get("aria-valuetext"),"Deadline reached");
 assert.equal(f.run("room.phase"),"answering");
 assert.equal(f.run("room.players[0].score"),5);
 assert.equal(f.run("clockMutations"),0,"local countdown must never expire the server's answer");
 f.run('room.lockedPlayer="someone-else"');
 f.run("updateAnswerClock("+String(serverExpires+2000)+")");
 assert.equal(f.run("clockMutations"),0);
}
// Buzzer status is derived exclusively from authoritative player-room state.
{
 const f=fixture();
 f.run('room={code:"ABCDEF",role:"player",me:"guest1",round:1,step:2,'+
  'phase:"playing",firstAnswered:false,players:[{id:"guest1",name:"One"},'+
  '{id:"guest2",name:"Two"}],myBlockedStep:-99}');
 assert.equal(f.run('playerBuzzerState(room).kind'),"ready");
 assert.equal(f.run('playerBuzzerState({...room,phase:"paused"}).kind'),"ready");
 assert.equal(f.run('playerBuzzerState({...room,phase:"answering",lockedPlayer:"guest1"}).kind'),"won");
 assert.equal(f.run('playerBuzzerState({...room,phase:"answering",lockedPlayer:"guest2"}).kind'),"claimed");
 assert.match(f.run('playerBuzzerState({...room,phase:"answering",lockedPlayer:"guest2"}).hint'),/Two/);
 assert.equal(f.run('playerBuzzerState({...room,phase:"holding",firstAnswered:true}).kind'),"steal");
 assert.equal(f.run('playerBuzzerState({...room,phase:"holding",firstAnswered:true,myBlockedStep:2}).kind'),"blocked");
 assert.equal(f.run('playerBuzzerState({...room,phase:"solved"}).kind'),"solved");
 assert.equal(f.run('playerBuzzerState({...room,phase:"finished"}).kind'),"finished");
 f.run('renderPlayerBuzzerFeedback()');
 assert.equal(f.element("buzzer-status-title").textContent,"Buzzer open — go!");
 assert.equal(f.element("buzzer-status-panel").dataset.state,"ready");
}
// Haptics are explicitly opt-in, fire once per new server-confirmed transition,
// and never fire merely because the state was polled repeatedly.
{
 const f=fixture();
 f.run('globalThis.navigator={vibrate:pattern=>{window.vibes.push(pattern);return true}};'+
  'window.vibes=[];phoneHapticsEnabled=true;room={code:"ABCDEF",role:"player",'+
  'me:"guest1",round:1,step:0,phase:"paused",firstAnswered:false,'+
  'myBlockedStep:-99,players:[{id:"guest1",name:"One"},{id:"guest2",name:"Two"}]}');
 f.run('applyState({...room,phase:"answering",lockedPlayer:"guest1"})');
 assert.equal(f.run('window.vibes.length'),1);
 assert.equal(f.run('window.vibes[0].join(",")'),"70,45,100");
 f.run('applyState({...room})');
 assert.equal(f.run('window.vibes.length'),1,"a repeated backend poll may not re-vibrate");
 f.run('applyState({...room,phase:"holding",firstAnswered:true,lockedPlayer:null})');
 assert.equal(f.run('window.vibes.length'),2);
 assert.equal(f.run('window.vibes[1].join(",")'),"40,45,40");
 f.run('phoneHapticsEnabled=false;applyState({...room,phase:"paused",step:1,firstAnswered:false})');
 f.run('applyState({...room,phase:"answering",lockedPlayer:"guest1"})');
 assert.equal(f.run('window.vibes.length'),2,"disable must silence all alerts");
 f.run('phoneHapticsEnabled=true;room.role="host";applyState({...room,phase:"holding"})');
 assert.equal(f.run('window.vibes.length'),2,"host must never receive guest vibrations");
}
// Another player winning must never trigger the local success vibration.
{
 const f=fixture();
 f.run('globalThis.navigator={vibrate:pattern=>{window.vibes.push(pattern)}};window.vibes=[];'+
  'phoneHapticsEnabled=true;room={code:"ABCDEF",role:"player",me:"guest1",'+
  'round:1,step:0,phase:"paused",players:[{id:"guest2",name:"Two"}]}');
 f.run('applyState({...room,phase:"answering",lockedPlayer:"guest2"})');
 assert.equal(f.run('window.vibes.length'),0);
 assert.equal(f.run('playerBuzzerState(room).kind'),"claimed");
 f.run('globalThis.navigator={};phoneHapticsEnabled=true;'+
  'applyState({...room,phase:"holding",firstAnswered:true})');
 assert.equal(f.run('canVibratePhone()'),false);
}
// Personal answer receipts are based exclusively on confirmed, matching
// server state; no secret answers or unscored optimistic deltas are displayed.
{
 const f=fixture();
 f.run('const beforeAnswer={code:"ABCDEF",role:"player",me:"guest1",round:1,'+
  'step:0,phase:"answering",titleDone:false,artistDone:false,'+
  'players:[{id:"guest1",score:3},{id:"guest2",score:4}]}');
 const receipt=f.run('buildAnswerReceipt(beforeAnswer,{...beforeAnswer,phase:"holding",'+
  'titleDone:true,artistDone:false,players:[{id:"guest1",score:3.5}]},'+
  '{song:"The Title",artist:"wrong artist"})');
 assert.equal(receipt.points,"+0.5 pts");
 assert.equal(receipt.title,"Accepted");
 assert.equal(receipt.artist,"Not accepted");
 assert.equal(receipt.score,3.5);
 assert.equal(receipt.kind,"positive");
 assert.ok(!JSON.stringify(receipt).includes("The Title"),"receipt must not echo hidden guessed text");
 assert.ok(!JSON.stringify(receipt).includes("wrong artist"));
 f.run('room={...beforeAnswer,phase:"holding"};lastAnswerReceipt='+JSON.stringify(receipt));
 f.run("renderAnswerReceipt()");
 assert.equal(f.element("answer-receipt").hidden,false);
 assert.equal(f.element("answer-receipt").dataset.outcome,"positive");
 assert.equal(f.element("answer-receipt-points").textContent,"+0.5 pts");
 assert.match(f.element("answer-receipt-song").textContent,/Accepted/);
 f.run('applyState({...room,round:2,phase:"paused"})');
 assert.equal(f.run("lastAnswerReceipt"),null,"a new song clears old feedback");
 assert.equal(f.element("answer-receipt").hidden,true);
}
// Negative and zero-clamped results must never claim a specific field was
// correct unless the authoritative accepted flags show it.
{
 const f=fixture();
 f.run('const b={code:"ABCDEF",role:"player",me:"guest1",round:1,step:0,'+
  'phase:"answering",titleDone:false,artistDone:false,'+
  'players:[{id:"guest1",score:1}]}');
 const r=f.run('buildAnswerReceipt(b,{...b,phase:"holding",'+
  'players:[{id:"guest1",score:0}]},{song:"bad",artist:"worse"})');
 assert.equal(r.delta,-1);
 assert.equal(r.points,"-1.0 pts");
 assert.equal(r.title,"Not accepted");
 assert.equal(r.artist,"Not accepted");
 const clamp=f.run('buildAnswerReceipt({...b,players:[{id:"guest1",score:0}]},'+
  '{...b,players:[{id:"guest1",score:0}]},{song:"bad",artist:"worse"})');
 assert.equal(clamp.delta,0);
 assert.equal(clamp.kind,"neutral");
 assert.match(clamp.note,/Scores cannot fall below zero/);
 const skip=f.run('buildAnswerReceipt(b,{...b,phase:"holding",'+
  'players:[{id:"guest1",score:1}]},{song:"",artist:""})');
 assert.equal(skip.title,"Not submitted");
 assert.equal(skip.artist,"Not submitted");
 assert.equal(f.run('buildAnswerReceipt(b,{...b,round:2},{song:"hi"})'),null);
 assert.equal(f.run('buildAnswerReceipt(b,{...b,code:"ZZZZZZ"},{song:"hi"})'),null);
 assert.equal(f.run('buildAnswerReceipt(b,{...b,role:"host"},{song:"hi"})'),null);
 assert.equal(f.run('buildAnswerReceipt(b,{...b,me:"guest2"},{song:"hi"})'),null);
}
// Leaving during a long track transition must unlock controls for the
// next room, not leave the Start button stuck disabled.
{
 const f=fixture();
 f.run("roundTransitionBusy=true;setLoading(false)");
 assert.equal(f.element("start").disabled,true);
 f.run("reset()");
 assert.equal(f.element("start").disabled,false,"Leaving during preparation must unlock Start");
 assert.equal(f.run("loading"),false);
 assert.equal(f.run("roundTransitionBusy"),false);
}
// Media metadata from a cancelled selection must never complete a newer
// Audius load or overwrite its stream index.
{
 const f=fixture(),audio=f.element("licensed-player");
 audio.duration=38;
 f.run('audiusLib=async()=>({streamUrl:id=>"https://api.audius.co/v1/tracks/"+id+"/stream"})');
 const first=f.run('prepareAudiusPlayback({id:"first01"})');
 for(let i=0;i<30&&!f.run('audioLoadCancel!==null');i++)await Promise.resolve();
 assert.equal(f.run("localAudioUrl"),"https://api.audius.co/v1/tracks/first01/stream");
 const second=f.run('prepareAudiusPlayback({id:"second02"})');
 for(let i=0;i<30&&f.run('localAudioUrl')!=="https://api.audius.co/v1/tracks/second02/stream";i++)await Promise.resolve();
 await assert.rejects(first,/cancelled/,"replacing the source must cancel its old metadata wait");
 assert.equal(f.run("localAudioUrl"),"https://api.audius.co/v1/tracks/second02/stream");
 audio.emit("loadedmetadata");
 const prepared=await second;
 assert.equal(prepared.index,f.run("localCurrentIndex"));
 assert.equal(prepared.duration,38);
 assert.equal(f.run("audioLoadCancel"),null,"successful metadata load cleans up its listeners");
}
// Leaving the room must immediately cancel metadata loading and its timer.
{
 const f=fixture(),audio=f.element("licensed-player");
 audio.duration=38;
 f.run('audiusLib=async()=>({streamUrl:id=>"https://api.audius.co/v1/tracks/"+id+"/stream"})');
 const pending=f.run('prepareAudiusPlayback({id:"slow123"})');
 for(let i=0;i<30&&!f.run('audioLoadCancel!==null');i++)await Promise.resolve();
 assert.equal(f.run("audioLoadCancel!==null"),true);
 f.run("reset()");
 await assert.rejects(pending,/cancelled/);
 assert.equal(f.run("audioLoadCancel"),null);
 assert.equal(f.run("localAudioUrl"),null);
 assert.equal(audio.listeners.get("loadedmetadata")?.size||0,0,"old metadata listener remains after Leave");
}
// An asynchronous module import resolving after Leave must NOT clear the
// media player of a newly joined room.
{
 const f=fixture();
 const pending=f.run(`let releaseAudiusLibrary;
  audiusLib=()=>new Promise(resolve=>releaseAudiusLibrary=resolve);
  const session=access;
  prepareAudiusPlayback({id:"late000"},null,()=>access===session)`);
 f.run("reset()");
 f.run('access={code:"NEW123",token:"new"};localAudioUrl="new-room-stream";localCurrentIndex=20000088');
 f.run('releaseAudiusLibrary({streamUrl:id=>"https://api.audius.co/v1/tracks/"+id+"/stream"})');
 await assert.rejects(pending,/room changed/);
 assert.equal(f.run("localAudioUrl"),"new-room-stream");
 assert.equal(f.run("localCurrentIndex"),20000088);
}
// An old host-tab restore finishing while Next prepares a candidate must
// not clear the candidate stream or replace its status.
{
 const f=fixture();
 f.run(`clearAudiusStream();audiusActive=false;
  sessionStorage={getItem:()=>JSON.stringify({
   code:"ABCDEF",round:1,source:"local:20000001",id:"abc123",
   title:"Test Track",artist:"Test Artist",permalink:"https://audius.co/tracks/abc123",
   updatedAt:Date.now()})};
  let releaseRestoreLibrary;
  audiusLib=()=>new Promise(resolve=>releaseRestoreLibrary=resolve)`);
 const pending=f.run("restoreAudiusHost(room)");
 assert.equal(f.run("audiusRestoring"),true);
 f.run(`roundTransitionBusy=true;localAudioUrl="new-candidate-stream";
  localCurrentIndex=20000099;audiusTrack={id:"new123"};audiusActive=true`);
 f.run('releaseRestoreLibrary({streamUrl:id=>"https://api.audius.co/v1/tracks/"+id+"/stream"})');
 await pending;
 assert.equal(f.run("localAudioUrl"),"new-candidate-stream");
 assert.equal(f.run("localCurrentIndex"),20000099);
 assert.equal(f.run("audiusTrack.id"),"new123");
 assert.equal(f.run("audiusRestoring"),false);
}
// A debounced settings write from an old lobby must be cancelled on Leave;
 // otherwise it could overwrite filters in a newly created lobby.
{
 const f=fixture();
 f.run("genresSaveTimer=setTimeout(()=>{},250);genresDirty=true");
 assert.equal(f.run("genresDirty"),true);
 assert.ok([...f.timers.values()].some(t=>t.ms===250));
 f.run("reset()");
 assert.equal(f.run("genresDirty"),false);
 assert.equal(f.run("genresSaveTimer"),null);
 assert.ok(![...f.timers.values()].some(t=>t.ms===250),
  "old lobby's pending settings debounce survives Leave");
}
// Auditions use an independent element, not a scored song or history write.
{
 const f=fixture(),demo=f.element("audition-audio");
 const start=f.run(`room.phase="lobby";loading=false;rotationHistory={version:1,games:[]};
  audiusPool=[{id:"first11",title:"First",artist:"Artist"},
   {id:"second22",title:"Second",artist:"Artist"}];
  audiusFiltersKey=JSON.stringify(chosenFilters());
  audiusLib=async()=>({chooseAudiusTrack:pool=>pool[0],
   streamUrl:id=>"https://api.audius.co/v1/tracks/"+id+"/stream"});
  rotation=async()=>({audiusFreshTracks:tracks=>tracks,playedKeys:()=>new Set(),
   audiusIdentity:t=>"id:"+t.id});
  rotationModule={audiusIdentity:t=>"id:"+t.id};renderSoundtrackReserve=()=>{};
  sessionStorage={entries:new Map(),getItem(k){return this.entries.get(k)||null},
    setItem(k,v){this.entries.set(k,v)},removeItem(k){this.entries.delete(k)}};
  pickAudition()`);
 await start;
 assert.equal(f.run("auditionTrack.id"),"first11");
 assert.match(demo.src,/first11/);
 assert.equal(f.run("room.phase"),"lobby");
 assert.equal(f.run("room.round"),1);
 assert.equal(f.run("rotationHistory.games.length"),0,"sampling must not mark a song played");
 await f.run("playAudition()");
 assert.equal(demo.paused,false);
 assert.equal(f.run('auditionHeard.has("id:first11")'),true,
  "a successfully played preview must be ineligible for this room's game");
 assert.equal(f.run('JSON.parse(sessionStorage.getItem(AUDITION_GUARD_SESSION)).heard[0]'),
  "id:first11","anonymous preview identity should survive a same-tab reload");
 assert.equal(f.run("rotationHistory.games.length"),0);
 assert.ok([...f.timers.values()].some(t=>t.ms===8000));
 f.run('stopAudition(false)');
 assert.equal(demo.paused,true);
 await f.run("pickAudition()");
 assert.equal(f.run("auditionTrack.id"),"second22",
  "an auditioned composition must not be offered again after a sample plays");
 assert.equal(f.run("rotationHistory.games.length"),0);
 f.run('auditionHeard.clear();auditionGuardCode="";syncAuditionGuard("ABCDEF")');
 assert.equal(f.run('auditionHeard.has("id:first11")'),true,
  "room-scoped sample memory must restore from the same-tab checkpoint");
 f.run("reset()");
 assert.equal(f.run("auditionTrack"),null);
 assert.equal(f.run("auditionExcluded.size"),0);
 assert.equal(f.run("auditionSeen.size"),0);
 assert.equal(f.run("auditionHeard.size"),0);
 assert.equal(f.run("sessionStorage.getItem(AUDITION_GUARD_SESSION)"),null,
  "leaving should clear the private host preview checkpoint");
 assert.ok(![...f.timers.values()].some(t=>t.ms===8000),
  "Leaving must cancel a sample's pending stop timer");
}
// A server reply to a Play mutation arriving after Leave must never
// recreate the previous room or touch the new host session.
{
 const f=fixture();
 const pending=f.run(`let finishPlay,staleState={...room,step:0,phase:"playing"};
  rpc=async()=>new Promise(resolve=>{finishPlay=resolve});startClip()`);
 assert.equal(f.run("loading"),true);
 f.run("reset()");
 assert.equal(f.run("room"),null);
 f.run("finishPlay({state:staleState})");
 await pending;
 assert.equal(f.run("room"),null,"late play response resurrected a room after Leave");
 assert.equal(f.run("access"),null,"late play response recreated the access token");
 assert.equal(f.run("loading"),false,"stale action left the next room locked");
}
// A delayed Pause response after a real clue must not restore a departed room.
{
 const f=fixture(),a=f.element("licensed-player");
 a.play=async()=>{a.paused=false;a.currentTime=13.23};
 const pending=f.run(`let finishPause,mutations=[];
  rpc=async action=>{
   mutations.push(action);
   if(action==="pause")return new Promise(resolve=>{finishPause=resolve});
   return {state:{...room,phase:"playing",step:0,clipMs:500}};
  };
  startClip()`);
 await pending;
 a.currentTime=13.65;
 const finishing=fireTimer(f,500);
 for(let i=0;i<10&&!f.run("typeof finishPause==='function'");i++)await Promise.resolve();
 assert.equal(f.run("typeof finishPause"),"function");
 const stale=f.run("({...room,phase:'paused'})");
 f.run("reset()");
 f.run("finishPause({state:latePause})".replace("latePause",JSON.stringify(stale)));
 await finishing;
 assert.equal(f.run("room"),null,"late pause response resurrected a room after Leave");
 assert.equal(f.run("loading"),false,"stale pause left the new room locked");
}
{
 const f=fixture();
 await assert.rejects(f.run('startAudio({source:"youtube:dQw4w9WgXcQ"})'),/Only Audius/);
}
console.log("TUNE_RUSH_AUDIUS_ONLY_PLAYBACK_PASS: no obsolete providers; seek completion; stale playhead rejection; buffering; stale Play/Pause response fencing; cancellable media metadata; host controls; persistent volume mixer; isolated stream audition; silent-clue rescue");
