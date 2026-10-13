/* Regression: hidden Security tabs must not resume pending playback or live retries. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'security-video-playback-v30.js'),'utf8');

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function microtasks(){for(let n=0;n<12;n++)await Promise.resolve();}

function browser(relay){
  let timerId=0;const timers=new Map(),intervals=new Map(),stats={nativePlay:0,nativeLoad:0,imageSources:[],mediaSources:[]};
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.isConnected=true;this.style={};this.dataset={};this.attributes=new Map();this.listeners=new Map();this.hidden=false;this.textContent='';}
    append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
    setAttribute(key,value){this.attributes.set(key,String(value));}
    removeAttribute(key){this.attributes.delete(key);if(key==='src')this._src='';}
    addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
    dispatchEvent(event){for(const fn of this.listeners.get(event.type)||[])fn(event);return true;}
    insertAdjacentElement(_position,node){this.parentElement?.append(node);}
    getClientRects(){return this.hidden?[]:[{}];}
    matches(selector){return selector.split(',').includes(this.tagName.toLowerCase());}
    querySelectorAll(selector){const result=[];for(const child of this.children){if(selector==='*'||child.matches(selector))result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
    remove(){this.isConnected=false;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;}
  }
  class Media extends Element{
    constructor(){super('video');this.paused=true;this.readyState=0;this.currentTime=0;}
    get src(){return this._src||'';}
    set src(value){this._src=String(value);stats.mediaSources.push(this._src);}
    pause(){this.paused=true;}
    play(){stats.nativePlay++;this.paused=false;return Promise.resolve();}
    load(){stats.nativeLoad++;}
  }
  class Image extends Element{
    constructor(){super('img');this.naturalWidth=0;this.onload=null;this.onerror=null;}
    get src(){return this._src||'';}
    set src(value){this._src=String(value);stats.imageSources.push(this._src);}
  }
  const root=new Element('html');
  const document={hidden:false,documentElement:root,listeners:new Map(),createElement(tag){return tag==='video'?new Media():tag==='img'?new Image():new Element(tag);},querySelectorAll:s=>root.querySelectorAll(s),addEventListener:Element.prototype.addEventListener,dispatchEvent:Element.prototype.dispatchEvent};
  const window={document,C720PSecureRelay:relay,listeners:new Map(),addEventListener:Element.prototype.addEventListener};window.top=window;window.parent=window;
  window.getComputedStyle=el=>({display:el.hidden?'none':'block',visibility:'visible',position:'static'});
  const context={window,document,Element,HTMLMediaElement:Media,HTMLImageElement:Image,URL,location:{href:'http://homeassistant.local:8123/local/security.html'},AbortController,DOMException,CustomEvent:class{constructor(type,init){this.type=type;Object.assign(this,init);}},MutationObserver:class{observe(){}},performance:{now:()=>0},Date,console,
    getComputedStyle:el=>({display:el.hidden?'none':'block',visibility:'visible',position:'static'}),
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
    setInterval:(fn,delay)=>{const id=++timerId;intervals.set(id,{fn,delay});return id;},clearInterval:id=>intervals.delete(id)};
  vm.runInNewContext(source,context,{filename:'security-video-playback-v30.js'});
  const mount=node=>{root.append(node);return node;};
  const tickScan=()=>{for(const timer of [...intervals.values()])if(timer.delay===1000)timer.fn();};
  const runTimeouts=()=>{for(const [id,timer]of [...timers]){timers.delete(id);timer.fn();}};
  return {api:window.C720PSecurityVideo,stats,document,root,timers,intervals,mount,video:()=>mount(new Media()),image:()=>mount(new Image()),tickScan,runTimeouts};
}

async function testDelayedReadyCannotAutoplayAfterSuspend(){
  const reply=deferred();let requestSignal,urlCalls=0;
  const b=browser({fetch(_path,options){requestSignal=options.signal;return reply.promise;},url(){urlCalls++;return Promise.resolve('http://relay.test/video');}});
  const video=b.video();const pending=b.api.setSource(video,'/new/saved/clip/motion_1791600000000.mp4',{play:true});
  assert.equal(requestSignal.aborted,false);
  b.api.suspendPlayer(video);video.hidden=true;
  assert.equal(requestSignal.aborted,true,'suspension aborts the outstanding prepare request');
  // A response can race cancellation, so resolve even though its signal is aborted.
  reply.resolve({ok:true,json:async()=>({ok:true,state:'ready',source_fps:30})});
  await pending;b.tickScan();b.runTimeouts();await microtasks();
  assert.equal(b.stats.nativePlay,0,'stale ready response cannot invoke the native decoder');
  assert.equal(urlCalls,0,'stale ready response cannot acquire a new video URL');
  assert.equal(video.paused,true);
  const feedback=b.root.children.find(n=>n.className==='security-video-controls');
  assert.match(feedback.children[1].textContent,/Playback paused/);
  assert.equal(feedback.children[2].hidden,false,'returning to the tab offers deliberate retry');
}

async function testQueuedPreparationStopsPollingAndRetryRemainsDeliberate(){
  let prepareCalls=0;
  const b=browser({fetch(){prepareCalls++;return Promise.resolve({ok:true,json:async()=>({ok:true,state:'queued'})});},url:async()=>{throw Error('unexpected URL');}});
  const video=b.video();const pending=b.api.setSource(video,'/new/saved/clip/motion_1791600000000.mp4');
  await video.play(); // Mirrors a timed-observation click while preparation is pending.
  await microtasks();
  assert.equal(prepareCalls,1);assert.equal(b.timers.size,1,'queued playback has one preparation delay');
  b.api.suspendPlayer(video);video.hidden=true;
  await pending;b.runTimeouts();b.tickScan();await microtasks();
  assert.equal(prepareCalls,1,'suspension cancels the delay and prevents background polling');
  assert.equal(b.stats.nativePlay,0,'a queued play request is cleared on suspension');
  video.hidden=false;b.tickScan();await microtasks();
  assert.equal(prepareCalls,1,'making the tab visible does not automatically retry');
}

async function testReadyVideoIsPausedWithoutDiscardingItsSource(){
  const b=browser({fetch:async()=>({ok:true,json:async()=>({ok:true,state:'ready',source_fps:30})}),url:async()=> 'http://relay.test/ready.mp4'});
  const video=b.video();await b.api.setSource(video,'/new/saved/clip/motion_1791600000000.mp4',{play:true});
  assert.equal(b.stats.nativePlay,1);const readySource=video.src;
  b.api.suspendPlayer(video);video.hidden=true;b.tickScan();
  assert.equal(video.paused,true);assert.equal(video.src,readySource,'already-ready source is retained for manual playback on return');
  assert.equal(b.stats.nativePlay,1);
}

async function testStoppedLiveRetryCannotRestartWhenScanned(){
  let signedCalls=0;
  const b=browser({fetch:async()=>{throw Error('MJPEG must not start a prepare fetch');},url:async()=>{signedCalls++;return 'http://relay.test/new/live.mjpg';}});
  const img=b.image();const status=b.document.createElement('span');
  b.api.startLive(img,{status});await microtasks();
  assert.equal(signedCalls,1);assert.equal(typeof img.onerror,'function');
  img.onerror();assert.equal(b.timers.size,1,'interrupted live image has one bounded retry');
  img.hidden=true;b.api.stopLive(img);assert.equal(b.timers.size,0,'explicit stop removes retry timer');
  b.runTimeouts();b.tickScan();await microtasks();
  assert.equal(signedCalls,1,'hidden stopped live image cannot acquire a new signed stream');
  img.hidden=false;b.tickScan();await microtasks();
  assert.equal(signedCalls,1,'a stopped stream stays stopped when visible again');
  assert.equal(b.stats.nativePlay,0,'MJPEG stop/retry does not spawn a video decoder');
}

(async()=>{for(const test of [testDelayedReadyCannotAutoplayAfterSuspend,testQueuedPreparationStopsPollingAndRetryRemainsDeliberate,testReadyVideoIsPausedWithoutDiscardingItsSource,testStoppedLiveRetryCannotRestartWhenScanned])await test();console.log('SECURITY_PLAYER_SUSPEND_V30_PASS: 4 lifecycle regressions');})().catch(error=>{console.error(error);process.exitCode=1;});
