import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise startup failures and buzzer races without depending on YouTube's network.
const source=readFileSync(new URL('../music/app.js',import.meta.url),'utf8').split('$("create").addEventListener')[0];
function fixture(){
 const timers=new Map(),elements=new Map();let sequence=0,events;
 const element=id=>{
  if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',pause(){},querySelector(){return null},closest(){return null},getBoundingClientRect(){return {width:560,height:315,top:0,bottom:315}},before(){}});
  return elements.get(id);
 };
 const sandbox={URL,TextEncoder,Uint8Array,console,location:{origin:'https://kalenel.nl'},window:{innerHeight:900},
  document:{hidden:false,getElementById:element,head:{append(){}},createElement(){return {}}},
  setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)}};
 sandbox.window.YT={PlayerState:{PLAYING:1},Player:class{
  constructor(id,options){events=options.events;Promise.resolve().then(()=>events.onReady())}
  cueVideoById(){} seekTo(){} playVideo(){} pauseVideo(){} destroy(){}
 }};
 sandbox.YT=sandbox.window.YT;
 const context=vm.createContext(sandbox);
 vm.runInContext(source+'\nrender=()=>{};room={role:"host",round:1,step:-1,phase:"paused",mode:"youtube",audio:{source:"youtube:dQw4w9WgXcQ",cueMs:0},clipMs:500};',context);
 return {run:code=>vm.runInContext(code,context),element,timers,events:()=>events};
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
console.log('TUNE_RUSH_PLAYBACK_RECOVERY_PASS: explicit start, preflight, persistent errors, next video, buzzer cancellation, polling');
