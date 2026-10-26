import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const html=readFileSync(new URL("../music/index.html",import.meta.url),"utf8");
const raw=readFileSync(new URL("../music/app.js",import.meta.url),"utf8");
const source=raw.split('$("create").addEventListener')[0];

for(const id of ["audius-check","audius-play-hint","audius-replay-hint","genre-options","decade-options"])
 assert.ok(html.includes('id="'+id+'"'),"Missing Audius control: "+id);
for(const id of ["youtube-host","youtube-setup","deezer-host","deezer-source-option","local-music-files","source-select"])
 assert.ok(!html.includes('id="'+id+'"'),"Retired source still exposed: "+id);
for(const name of ["youtubeWaitCancelled","deezerPlayer","localTracks","importLocalFiles","ensureYoutubePlayer"])
 assert.ok(!raw.includes(name),"Retired source function still present: "+name);

function fixture(){
 const elements=new Map(),timers=new Map();let sequence=0;
 const element=id=>{
  if(!elements.has(id))elements.set(id,{
   hidden:false,textContent:"",disabled:false,readyState:4,error:null,paused:false,
   setAttribute(){},pause(){this.paused=true},play:async()=>{this.paused=false},querySelector(){return null}
  });
  return elements.get(id);
 };
 const sandbox={URL,TextEncoder,Uint8Array,AbortController,console,
  crypto:{subtle:{digest:async()=>new Uint8Array(32).buffer}},
  location:{origin:"https://kalenel.nl"},window:{innerHeight:900},
  document:{hidden:false,getElementById:element},
  setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id},
  clearTimeout(id){timers.delete(id)}};
 const context=vm.createContext(sandbox);
 vm.runInContext(source+'\nrender=()=>{};room={code:"ABCDEF",role:"host",round:1,step:-1,phase:"paused",mode:"local",audio:{source:"local:20000001",cueMs:13000},clipMs:500,players:[]};localCurrentIndex=20000001;localAudioUrl="https://api.audius.co/v1/tracks/abcdef/stream";audiusActive=true;',context);
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
{
 const f=fixture();
 await assert.rejects(f.run('startAudio({source:"youtube:dQw4w9WgXcQ"})'),/Only Audius/);
}
console.log("TUNE_RUSH_AUDIUS_ONLY_PLAYBACK_PASS: no obsolete providers; seek clock; buffering; host controls");
