'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'security-live-mjpeg-only-v1.js'),'utf8');
for(const forbidden of ['playback=prepare','playback=hub','30 fps','ffmpeg','MediaSource','HTMLMediaElement.prototype','sourceLowFps']){
 assert(!script.includes(forbidden),'legacy smooth playback has returned: '+forbidden);
}
const calls=[];
class Element {
 constructor(tag){this.tagName=tag;this.isConnected=true;this.style={};this.dataset={};this.parentElement=null;this.naturalWidth=0;this.paused=true;}
 setAttribute(key,value){this['_'+key]=value}
 removeAttribute(key){delete this['_'+key]}
 getClientRects(){return [{}]}
 pause(){this.paused=true}
 async play(){this.paused=false;calls.push('play')}
}
class Image extends Element{constructor(){super('IMG')}}
class Video extends Element{constructor(){super('VIDEO')}}
Object.defineProperty(Image.prototype,'src',{configurable:true,set(value){calls.push('image:'+value);this._src=value},get(){return this._src}});
Object.defineProperty(Video.prototype,'src',{configurable:true,set(value){calls.push('video:'+value);this._src=value},get(){return this._src}});
const originalVideoSrc=Object.getOwnPropertyDescriptor(Video.prototype,'src').set;
const doc={hidden:false,addEventListener(){},querySelectorAll(){return []}};
const win={document:doc,addEventListener(){},getComputedStyle(){return {display:'block',visibility:'visible'}},
 C720PSecureRelay:{async url(resource){calls.push('sign:'+resource);return 'https://secure.test/'+resource.replace(/^\//,'')}}};
win.parent=win;win.top=win;
const timers=[];
const ctx={window:win,document:doc,Element,HTMLImageElement:{prototype:Image.prototype},location:{href:'http://hub.test/'},
 URL,AbortController,Date,console,setInterval(fn){timers.push(fn);return timers.length},
 clearInterval(){},setTimeout(fn){timers.push(fn);return timers.length},clearTimeout(){}};
vm.runInNewContext(script,ctx,{filename:'security-live-mjpeg-only-v1.js'});
async function run(){
 assert.equal(Object.getOwnPropertyDescriptor(Video.prototype,'src').set,originalVideoSrc);
 assert.equal(win.C720PSecurityLiveOnly.version,1);
 const img=new Image();
 img.src='/new/live.mjpg';
 for(let i=0;i<8&&!calls.some(x=>x.startsWith('image:https://secure.test/'));i++)await new Promise(resolve=>setImmediate(resolve));
 assert(calls.includes('sign:/new/live.mjpg'),'live stream must be signed');
 assert.equal(img._src,'https://secure.test/new/live.mjpg');
 assert.equal(img.dataset.securityProfile,'live-mjpeg-native');
 img.onload();
 assert.equal(img.dataset.securityLiveStatus,'LIVE · S9+ native camera');
 img.src='/local/still.jpg';
 assert.equal(img._src,'/local/still.jpg');
 const vid=new Video();
 vid.src='/new/saved/clip/motion_1792000000000.mp4';
 assert.equal(vid._src,'/new/saved/clip/motion_1792000000000.mp4','native VIDEO.src untouched');
 await win.C720PSecurityVideo.setSource(vid,'/new/saved/clip/motion_1792000000000.mp4',{play:true});
 assert(calls.includes('sign:/new/saved/clip/motion_1792000000000.mp4'));
 assert.equal(vid._src,'https://secure.test/new/saved/clip/motion_1792000000000.mp4');
 assert(calls.includes('play'));
 await assert.rejects(()=>win.C720PSecurityVideo.setSource(vid,'https://evil.test/x.mp4'),/invalid_original_recording/);
 assert.equal(win.C720PSecurityPlaybackMetrics.mode,'original-only');
 console.log('S9_MJPEG_ONLY_NO_SMOOTH_INTERCEPTION_PASS');
}
run().catch(e=>{console.error(e);process.exitCode=1});
