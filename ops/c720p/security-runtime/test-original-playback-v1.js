'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'security-original-playback-v1.js'),'utf8');
function setup(){
 class Element{
  constructor(tag){Object.assign(this,{tagName:tag,dataset:{},style:{},isConnected:true,listeners:{},_src:''})}
  addEventListener(name,fn){this.listeners[name]=fn}
  dispatchEvent(event){this.listeners[event.type]?.(event)}
  getClientRects(){return [{}]}
  setAttribute(name,value){this[name==='src'?'_src':name]=value}
  removeAttribute(name){if(name==='src')this._src=''}
 }
 class Media extends Element{
  constructor(){super('VIDEO');this.paused=true;this.loads=0;this.plays=0}
  get src(){return this._src}set src(x){this._src=x}
  load(){this.loads++}play(){this.plays++;this.paused=false;return Promise.resolve()}pause(){this.paused=true}
 }
 class Image extends Element{
  constructor(){super('IMG');this.naturalWidth=640}
  get src(){return this._src}set src(x){this._src=x}
 }
 const calls=[];
 const document={hidden:false,documentElement:{},querySelectorAll:()=>[],addEventListener(){}};
 const window={document,addEventListener(){},getComputedStyle:()=>({display:'block',visibility:'visible'}),C720PSecureRelay:{
  url:async p=>{calls.push(p);return 'https://relay.invalid'+p},
  fetch:()=>{throw Error('Must not poll or prepare derived playback')}
 }};window.top=window.parent=window;
 const location={href:'http://127.0.0.1:8123/local/security.html'};
 const context={window,document,location,Element,HTMLMediaElement:Media,HTMLImageElement:Image,
  URL,AbortController,performance:{now:()=>Date.now()},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}},
  MutationObserver:class{observe(){}},setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout};
 vm.runInNewContext(code,context);return {window,calls,Media,Image,api:window.C720PSecurityVideo};
}
(async()=>{
 const s=setup(),video=new s.Media(),clip='/new/saved/clip/motion_1792000000000.mp4';
 await s.api.setSource(video,clip,{play:true});
 assert.deepEqual(s.calls,[clip]);assert.equal(video.src,'https://relay.invalid'+clip);
 assert.equal(video.plays,1);assert.equal(video.dataset.securityProfile,'original-native');
 s.api.suspendPlayer(video);assert.equal(video.paused,true);
 const viaSetter=new s.Media();viaSetter.src=clip;await new Promise(setImmediate);
 assert.equal(viaSetter.src,'https://relay.invalid'+clip);assert.equal(s.calls.length,2);
 const img=new s.Image();s.api.startLive(img);await new Promise(setImmediate);
 assert.equal(img.src,'https://relay.invalid/new/live.mjpg');assert.equal(s.calls.at(-1),'/new/live.mjpg');
 s.api.stopLive(img);assert.equal(img.src,'');
 assert.equal(s.api.sourcePath(clip+'?playback=hub'),clip);
 console.log('Original-only playback, src interception and native live compatibility passed');
})().catch(error=>{console.error(error);process.exitCode=1});
