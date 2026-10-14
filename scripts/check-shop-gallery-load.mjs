#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('shop/store.js');
const start=source.indexOf('let galleryMediaObserver = null;');
const end=source.indexOf('\nfunction saveCart()',start);
assert.ok(start>=0&&end>start,'gallery controller must be defined');

const imgs=Array.from({length:4},()=>({loading:'lazy',decoding:'auto',fetchPriority:'auto'}));
const slides=imgs.map(img=>({querySelector:sel=>sel==='img'?img:null}));
const clicks=new Map();
const dots=Array.from({length:4},()=>({classList:{toggle(){}},addEventListener(name,fn){if(name==='click')this.click=fn;}}));
const rail={clientWidth:360,scrollLeft:0,moves:[],querySelectorAll(){},scrollTo({left,behavior}){this.moves.push({left,behavior});this.scrollLeft=left;},addEventListener(name,fn){clicks.set(name,fn);}};
const card={
  handlers:new Map(),
  querySelector:sel=>sel==='.mockup-rail'?rail:sel==='[data-gallery-next]'?{addEventListener:(name,fn)=>card.next=fn}:sel==='[data-gallery-prev]'?{addEventListener:(name,fn)=>card.prev=fn}:null,
  querySelectorAll:sel=>sel==='.mockup'?slides:sel==='[data-gallery-dot]'?dots:sel==='.mockup-rail > .mockup:not(:first-child)'?slides.slice(1):[],
  addEventListener(name,fn){this.handlers.set(name,fn);}
};
let io,disconnected=false;
class Observer {
  constructor(cb,opts){io={cb,opts,observed:[],unobserve(target){this.observed=this.observed.filter(x=>x!==target)},disconnect(){disconnected=true}};}
  observe(target){io.observed.push(target)}
  disconnect(){disconnected=true}
}
const ctx={qsa:()=>[card],IntersectionObserver:Observer,window:{IntersectionObserver:Observer,requestAnimationFrame:fn=>fn()},console};
vm.createContext(ctx);
vm.runInContext(source.slice(start,end)+';this.boot=initializeGalleries;',ctx);
ctx.boot();
assert.deepEqual(imgs.map(x=>x.loading),['lazy','lazy','lazy','lazy'],'do not load 200 hidden views at startup');
assert.ok(io.observed.includes(card),'observe gallery when near viewport');
io.cb([{isIntersecting:true,target:card}]);
assert.deepEqual(imgs.map(x=>x.loading),['lazy','eager','eager','eager'],'preload offscreen slides only on visible cards');
assert.equal(io.observed.length,0,'unobserve preloaded product');
dots[3].click();
assert.equal(rail.moves.at(-1).left,1080,'fourth dot scrolls directly to fourth image');
assert.equal(imgs[3].fetchPriority,'high');
const before=rail.moves.length;
clicks.get('scrollend')();
assert.equal(rail.moves.length,before,'scrollend must not reissue scrollTo');
ctx.boot();
assert.ok(disconnected,'rerender cleans up viewport observer');

const transparency=read('shop/mockup-transparency-v832.js');
assert.match(transparency,/viewportPrioritized:true/);
assert.match(transparency,/new IntersectionObserver/);
assert.match(transparency,/if\(!entry\.isIntersecting\)continue/);
const galleryStyle=read('shop/gallery-fixes-v832.js');
assert.match(galleryStyle,/scroll-snap-stop:normal!important/);
const html=read('shop/index.html');
for(const marker of ['gallery=20261014-media-r1','fresh=20261014-gallery-r1']){
  assert.ok(html.includes(marker),'changed gallery assets must be cache-busted: '+marker);
}
assert.doesNotMatch(source,/productSortMode/,'alphabetical sort cannot regress');
console.log('Bruis gallery media load passed: visible-card prefetch, direct fourth slide, viewport processing, A-Z retained');
