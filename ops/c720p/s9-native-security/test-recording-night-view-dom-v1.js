#!/usr/bin/env node
'use strict';
const vm=require('node:vm');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'s9-recording-night-view-v1.js'),'utf8');
const make=(tag,id='')=>{
 const x={tagName:tag,id,children:[],style:{},dataset:{},value:'',open:false};
 x.setAttribute=()=>{};
 x.appendChild=function(y){this.children.push(y);if(tag==='select'&&!this.value)this.value=y.value;return y;};
 x.append=function(...nodes){for(const n of nodes)this.appendChild(n);};
 x.addEventListener=function(type,fn){(this.listeners??={})[type]=fn;};
 return x;
};
const stage=make('main','stage');
const player=make('video','player');
player.closest=selector=>selector==='main.stage'?stage:null;
stage.appendChild(player);
const deployedScript=make('script','s9-recording-night-script-v1');
const roots=[stage,deployedScript];
const find=(id)=>{
 const search=(node)=>{
  if(node.id===id)return node;
  for(const n of node.children){const match=search(n);if(match)return match;}
  return null;
 };
 for(const n of roots){const match=search(n);if(match)return match;}
 return null;
};
const window={addEventListener(type,fn){this.listeners??={};this.listeners[type]=fn;}};
const context=vm.createContext({
 document:{getElementById:find,createElement:make},
 window
});
vm.runInContext(source,context);
const panel=find('s9-recording-night-controls-v1');
assert.ok(panel,'recorded night panel inserted independently from script element');
assert.notEqual(panel,deployedScript);
assert.equal(panel.open,false);
assert.equal(player.style.filter,'','initial MP4 playback remains original');
const mode=find('s9-recording-night-mode-v1');
mode.value='enhanced';mode.listeners.change();
assert.match(player.style.filter,/brightness\(2\.7\)/);
const gain=find('s9-recording-night-gain-v1');
gain.value='3.3';gain.listeners.input();
assert.match(player.style.filter,/brightness\(3\.3\)/);
player.listeners.loadedmetadata();
assert.equal(mode.value,'original','new clip must default to untouched evidence');
assert.equal(player.style.filter,'');
mode.value='enhanced';mode.listeners.change();
assert.match(player.style.filter,/brightness/);
window.listeners.pagehide();
assert.equal(player.style.filter,'');
vm.runInContext(source,context);
assert.equal(stage.children.filter(x=>x.id==='s9-recording-night-controls-v1').length,1);
console.log('S9_RECORDED_NIGHT_DOM_BEHAVIOR_PASS');
