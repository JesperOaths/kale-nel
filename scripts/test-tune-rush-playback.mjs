import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise startup failures and buzzer races without depending on YouTube's network.
const source=readFileSync(new URL('../music/app.js',import.meta.url),'utf8').split('$("create").addEventListener')[0];
function fixture(){
 const timers=new Map(),elements=new Map();let sequence=0,events;
 const element=id=>{
  if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',pause(){},setAttribute(){},querySelector(){return null},closest(){return null},getBoundingClientRect(){return {width:560,height:315,top:0,bottom:315}},before(){}});
  return elements.get(id);
 };
 const sandbox={URL,TextEncoder,Uint8Array,AbortController,console,crypto:{subtle:{digest:async()=>new Uint8Array(32).buffer}},location:{origin:'https://kalenel.nl'},window:{innerHeight:900},
  document:{hidden:false,getElementById:element,head:{append(){}},createElement(){return {}}},
  setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)}};
 sandbox.window.YT={PlayerState:{PLAYING:1},Player:class{
  constructor(id,options){events=options.events;Promise.resolve().then(()=>events.onReady())}
  cueVideoById(){} seekTo(){} playVideo(){} pauseVideo(){} destroy(){}
 }};
 sandbox.YT=sandbox.window.YT;
 const context=vm.createContext(sandbox);
 vm.runInContext(source+'\nrender=()=>{};room={role:"host",round:1,step:-1,phase:"paused",mode:"youtube",audio:{source:"youtube:dQw4w9WgXcQ",cueMs:0},clipMs:500};',context);
 return {run:code=>vm.runInContext(code,context),element,timers,events:()=>events,context};
}

{
 const f=fixture();
 f.run('room.mode="catalog";scheduleNext(850)');
 assert.equal(f.timers.size,0,'catalog waits for an explicit host tap');
}
{
 const f=fixture();
 f.element('youtube-player').getBoundingClientRect=()=>({width:560,height:315,top:1000,bottom:1315});
 await f.run('let actions=[];rpc=async action=>{actions.push(action)};startClip()');
 assert.equal(f.run('actions.length'),0,'off-screen video must not consume a hint');
 assert.equal(f.run('room.step'),-1);
 assert.match(f.element('youtube-status').textContent,/Scroll/);
}
{
 const f=fixture();await f.run('ensureYoutubePlayer("dQw4w9WgXcQ")');
 const pending=f.run('room.step=6;room.clipMs=20000;let actions=[];rpc=async(action,data)=>{actions.push({action,data});return {state:{...room,phase:"playing"}}};startClip(true)');
 for(let i=0;i<12&&!f.run('!!ytPlayingResolve');i++)await Promise.resolve();
 assert.equal(f.element('youtube-replay-hint').disabled,true,'repeated host taps are disabled while starting');
 f.events().onStateChange({data:1});await pending;
 assert.equal(f.run('actions[0].action'),'replay');
 assert.equal(f.run('actions[0].data.expectedRound'),1);assert.equal(f.run('actions[0].data.expectedStep'),6);
 assert.equal(f.run('room.step'),6);assert.equal(f.element('youtube-replay-hint').disabled,false);
}
{
 const f=fixture();await f.run('ensureYoutubePlayer("dQw4w9WgXcQ")');
 const pending=f.run('let actions=[];rpc=async(action,data)=>{actions.push({action,data});return {state:{...room,phase:["play","replay"].includes(action)?"playing":"paused",step:action==="play"?room.step+1:room.step}}};startClip()');
 for(let i=0;i<12&&!f.run('!!ytPlayingResolve');i++)await Promise.resolve();
 [...f.timers.values()].find(t=>t.ms===10000).fn();await pending;
 assert.equal(f.run('failedClue'),'1:0');assert.equal(f.run('room.phase'),'paused');
 const retry=f.run('startClip()');
 for(let i=0;i<12&&!f.run('!!ytPlayingResolve');i++)await Promise.resolve();
 f.events().onStateChange({data:1});await retry;
 assert.equal(f.run('actions.at(-1).action'),'replay','retrying a failed start must not advance the clue');
 assert.equal(f.run('room.step'),0);assert.equal(f.run('failedClue'),'');
}
{
 const f=fixture();
 f.context.fetch=(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));
 const pending=f.run('access={code:"ABCDEF",token:"a".repeat(64)};rpc("state")');
 for(let i=0;i<12&&![...f.timers.values()].some(t=>t.ms===12000);i++)await Promise.resolve();
 [...f.timers.values()].find(t=>t.ms===12000).fn();
 await assert.rejects(pending,/temporary_failure/,'hung network requests must release their caller');
 assert.equal(f.timers.size,0,'request deadline is cleaned up');
}
{
 const f=fixture();await f.run('ensureYoutubePlayer("dQw4w9WgXcQ")');
 f.events().onError({data:150});
 await f.run('let actions=[];rpc=async action=>{actions.push(action)};startClip()');
 assert.equal(f.run('actions.length'),0,'a known embedding failure must not consume more hints');
 assert.match(f.element('youtube-status').textContent,/owner blocks embedded/);
 await f.run('ensureYoutubePlayer("M7lc1UVf-VE")');
 assert.equal(f.run('ytError'),null,'next video clears the previous error');
}
{
 const f=fixture();await f.run('ensureYoutubePlayer("dQw4w9WgXcQ")');
 const pending=f.run('rpc=async action=>({state:{...room,phase:action==="play"?"playing":"paused",step:0}});startClip()');
 for(let i=0;i<12&&!f.run('!!ytPlayingResolve');i++)await Promise.resolve();
 assert.equal(f.run('!!ytPlayingResolve'),true);
 f.events().onAutoplayBlocked();
 assert.match(f.element('youtube-status').textContent,/tap on Play/);
 f.run('applyState({...room,phase:"answering"})');
 await pending;
 f.events().onStateChange({data:1});
 assert.equal(f.run('room.phase'),'answering','late video events cannot replace the buzz winner');
 assert.equal(f.run('clipTimer'),null,'cancelled playback must not install a late clue timer');
 assert.equal(f.run('loading'),false);
}
{
 const f=fixture();await f.run('ensureYoutubePlayer("dQw4w9WgXcQ")');
 const pending=f.run('let actions=[];rpc=async action=>{actions.push(action);return {state:{...room,phase:action==="play"?"playing":"paused",step:0}}};startClip()');
 for(let i=0;i<12&&!f.run('!!ytPlayingResolve');i++)await Promise.resolve();
 f.events().onStateChange({data:1});await pending;
 assert.equal(f.run('startedClip'),true);
 const clip=[...f.timers.values()].find(t=>t.ms===500);
 assert.ok(clip,'the clue timer starts only after actual PLAYING');
 await clip.fn();
 assert.equal(f.run('room.phase'),'paused');
 assert.equal(f.run('actions.join(",")'),'play,pause');
}
{
 const f=fixture();
 f.run('access={};let finishState;rpc=()=>new Promise(resolve=>{finishState=resolve})');
 const pending=f.run('refresh()');
 f.run('mutationVersion++;room.phase="answering";finishState({state:{...room,phase:"paused"}})');
 await pending;
 assert.equal(f.run('room.phase'),'answering','an old poll must not overwrite a newer action');
}
{
 const f=fixture();await f.run('ensureYoutubePlayer("dQw4w9WgXcQ")');
 f.run('access={};loading=true;ytPlayingResolve=()=>{};let polls=0;rpc=async()=>{polls++;return {state:{...room,phase:"answering"}}}');
 await f.run('refresh()');
 assert.equal(f.run('polls'),1,'buzz polling continues while video start is pending');
 assert.equal(f.run('room.phase'),'answering');
}

{
 const f=fixture();
 const audio=f.element('licensed-player');
 Object.assign(audio,{readyState:4,currentTime:0,paused:false,error:null,ended:false,play:async()=>{}});
 const pending=f.run('localCurrentIndex=9;localAudioUrl="https://api.audius.co/v1/tracks/WxM05o/stream";playLocalHint({source:"local:9",cueMs:17000})');
 for(let i=0;i<10&&!f.timers.size;i++)await Promise.resolve();
 assert.equal(audio.currentTime,17);
 assert.ok([...f.timers.values()].some(t=>t.ms===75),'remote seek must wait for actual playback time advancement');
 let done=false;pending.then(()=>{done=true});
 await Promise.resolve();
 assert.equal(done,false,'a resolving play() promise alone must not start the clue');
 audio.currentTime=17.15;
 const t=[...f.timers.entries()].find(([,v])=>v.ms===75);
 f.timers.delete(t[0]);t[1].fn();
 await pending;
 assert.match(f.element('local-playback-status').textContent,/Playing clue/);
}
{
 const f=fixture();
 const audio=f.element('licensed-player');
 Object.assign(audio,{readyState:4,currentTime:0,paused:false,error:null,ended:false,play:async()=>{}});
 const pending=f.run('localCurrentIndex=9;localAudioUrl="https://api.audius.co/v1/tracks/WxM05o/stream";playLocalHint({source:"local:9",cueMs:17000})');
 // Timers are fake; run all 120 probes without waiting nine real seconds.
 for(let i=0;i<120;i++){
  for(let n=0;n<10&&!f.timers.size;n++)await Promise.resolve();
  const t=[...f.timers.entries()].find(([,v])=>v.ms===75);
  assert.ok(t,'each buffering probe must be bounded');
  f.timers.delete(t[0]);t[1].fn();
  await Promise.resolve();
 }
 await assert.rejects(pending,/still buffering/,'a permanently stalled remote stream must fail, not hang');
}
{
 const f=fixture();
 const audio=f.element('licensed-player');
 Object.assign(audio,{readyState:4,currentTime:0,paused:false,error:null,ended:false,
  play:async()=>{audio.currentTime=13.15}});
 const pending=f.run('localCurrentIndex=9;localAudioUrl="https://api.audius.co/v1/tracks/WxM05o/stream";room={role:"host",round:1,step:-1,phase:"paused",mode:"local",audio:{source:"local:9",cueMs:13000},clipMs:500};let calls=[];rpc=async action=>{calls.push(action);return {state:{...room,phase:action==="play"?"playing":"paused",step:action==="play"?0:room.step}}};startClip()');
 await pending;
 const initial=[...f.timers.entries()].find(([,t])=>t.ms===500);
 assert.ok(initial,'local clue must start timer only after playback progressed');
 audio.currentTime=13.2;
 f.timers.delete(initial[0]);await initial[1].fn();
 const buffering=[...f.timers.entries()].find(([,t])=>t.ms===80);
 assert.ok(buffering,'an elapsed timer cannot end a stalled 0.5s clue');
 assert.equal(f.run('room.phase'),'playing');
 audio.currentTime=13.56;
 f.timers.delete(buffering[0]);await buffering[1].fn();
 assert.equal(f.run('room.phase'),'paused');
 assert.equal(f.run('calls.join(",")'),'play,pause');
}
console.log('TUNE_RUSH_PLAYBACK_RECOVERY_PASS: explicit start, preflight, persistent errors, next video, buzzer cancellation, polling');
