#!/usr/bin/env node
'use strict';
// Browser-like regression: the <script> element already exists with the
// deployed script's ID. The night-view control panel must still be created.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'s9-night-visibility-v1.js'),'utf8');

function element(tag,id=''){
  const node={tag,id,children:[],style:{},dataset:{},value:'',disabled:false};
  node.appendChild=function(child){
    this.children.push(child);
    if(tag==='select'&&!this.value)this.value=child.value;
    return child;
  };
  node.append=function(...args){for(const item of args)this.appendChild(item);};
  node.addEventListener=function(event,fn){(this.handlers??={})[event]=fn;};
  node.insertBefore=function(child){this.children.push(child);};
  node.setAttribute=function(){};
  return node;
}
const script=element('script','s9-night-visibility-v1');
const live=element('img','cameraLive');
const section=element('section','panel-live');
const diagnostic=element('dl','liveDiagnostics');
section.children.push(live,diagnostic);
const all=[script,section];
function find(id){
 const visit=(node)=>{
  if(node.id===id)return node;
  for(const child of node.children??[]){const found=visit(child);if(found)return found;}
  return null;
 };
 for(const root of all){const match=visit(root);if(match)return match;}
 return null;
}
let requests=0, intervals=0;
const document={
  getElementById:find,
  createElement:tag=>element(tag),
  hidden:false
};
const window={
  C720PSecureRelay:{
    async fetch(route,options){
      assert.equal(route,'/new/camera-controls');
      assert.equal(options.cache,'no-store');
      requests++;
      return {ok:true,async json(){return {night_active:true};}};
    }
  },
  addEventListener(){}
};
const context=vm.createContext({document,window,setInterval(){intervals++;return 1;},clearInterval(){}});

async function run(){
  vm.runInContext(source,context);
  const panel=find('s9-night-visibility-controls-v1');
  assert.ok(panel,'panel must be built despite a script tag carrying its own ID');
  assert.notEqual(panel,script,'script must never be confused with the visible controls');
  assert.equal(section.children.includes(panel),true);
  assert.equal(find('s9-night-visibility-v1'),script);
  assert.equal(find('s9-night-visibility-mode').value,'auto');
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(requests,1,'one authenticated status request');
  assert.equal(intervals,1);
  assert.equal(live.dataset.nightVisibility,'enhanced');
  assert.match(live.style.filter,/brightness\(2\.7\)/);

  const mode=find('s9-night-visibility-mode');
  mode.value='original';mode.handlers.change();
  assert.equal(live.style.filter,'');
  assert.equal(live.dataset.nightVisibility,'original');
  mode.value='enhanced';mode.handlers.change();
  assert.match(live.style.filter,/brightness\(2\.7\)/);

  const gain=find('s9-night-visibility-strength');
  gain.value='3.1';gain.handlers.input();
  assert.match(live.style.filter,/brightness\(3\.1\)/);

  // Reexecuting the same script must not attach a second panel or timer.
  vm.runInContext(source,context);
  assert.equal(intervals,1);
  assert.equal(section.children.filter(x=>x.id==='s9-night-visibility-controls-v1').length,1);
  assert.ok(!source.includes("getElementById('s9-night-visibility-v1')"));
  assert.ok(!source.includes("ui.id='s9-night-visibility-v1'"));
  console.log('S9_NIGHT_VISIBILITY_DOM_ID_AND_BEHAVIOR_PASS');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
