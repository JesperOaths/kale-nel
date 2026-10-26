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
   _time:0,listeners:new Map(),style:{setProperty(){}},attrs:new Map(),
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
console.log("TUNE_RUSH_AUDIUS_ONLY_PLAYBACK_PASS: no obsolete providers; seek completion; stale playhead rejection; buffering; stale Play/Pause response fencing; cancellable media metadata; host controls; persistent volume mixer");
