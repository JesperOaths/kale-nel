#!/usr/bin/env node
"use strict";
/* No external packages, network, tokens or real media. Simulate legacy DOM. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("ops/c720p/security-runtime/c720p-migrated-index-playback-v1.js","utf8");
new vm.Script(source);

function environment({relay,record,filename="motion_1792000010000.mp4"}={}){
  const listeners={};
  const parent={
    appended:[],
    querySelector(){return null}
  };
  const video={
    attrs:{src:"clips/"+filename},dataset:{},parentElement:parent,
    isConnected:true,preload:"",load_count:0,paused:false,
    getAttribute(n){return this.attrs[n]},
    pause(){this.paused=true},
    load(){this.load_count++},
    addEventListener(name,fn){listeners[name]=fn},
    insertAdjacentElement(_position,node){parent.appended.push(node)}
  };
  const doc={
    querySelectorAll(selector){
      assert.equal(selector,'video[src^="clips/"]');return [video]
    },
    createElement(tag){return {tagName:tag,style:{},textContent:"",className:""}}
  };
  const win={C720PSecureRelay:relay};
  win.parent=win;
  const ctx={window:win,document:doc,console};
  return {video,doc,ctx,listeners,parent}
}
const report=(name)=>({
 ok:true,schema_version:"c720p_s9_verified_import_v2",
 not_s9_original_recordings:true,not_person_assignments:true,
 total_imported:1,files:[{name,bytes:123000,indexed:true}]
});
async function settle(){
  for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve))
}
async function run(){
  const name="motion_1792000010000.mp4";
  const route="/new/saved/c720p-migrated/clip/"+name;
  const relay={
    fetch:async(p,opts)=>{
      assert.equal(p,"/new/api/c720p-migrated-clips");
      assert.equal(opts.cache,"no-store");
      return {ok:true,json:async()=>report(name)}
    },
    url:async(p)=>{
      assert.equal(p,route);
      return "https://secured.local/media-ticket"
    }
  };
  let e=environment({relay});
  vm.runInNewContext(source,e.ctx);
  await settle();
  assert.equal(e.video.src,"https://secured.local/media-ticket");
  assert.equal(e.video.dataset.migratedToS9,"verified");
  assert.equal(e.video.dataset.originalSrc,"clips/"+name);
  assert.equal(e.video.load_count,1);
  assert.equal(e.parent.appended[0].textContent,"Playing the verified S9+ microSD copy");

  // Playback error returns to original, never loses access.
  e.listeners.error();
  assert.equal(e.video.src,"clips/"+name);
  assert.equal(e.video.dataset.migratedToS9,"fallback");

  // Unauthenticated/nonembedded legacy page keeps its source.
  e=environment({relay:undefined});
  vm.runInNewContext(source,e.ctx);
  await settle();
  assert.equal(e.video.attrs.src,"clips/"+name);
  assert.equal(e.video.src,undefined);
  assert.match(e.parent.appended[0].textContent,/Security/);

  // Invalid or unrelated records cannot redirect playback.
  e=environment({relay:{...relay,fetch:async()=>({ok:true,json:async()=>({
    ...report(name),not_s9_original_recordings:false
  })})}});
  vm.runInNewContext(source,e.ctx);
  await settle();
  assert.equal(e.video.src,undefined);

  // A signed route for another clip is never accepted.
  e=environment({relay:{...relay,fetch:async()=>({ok:true,json:async()=>report("other.mp4")})}});
  vm.runInNewContext(source,e.ctx);
  await settle();
  assert.equal(e.video.src,undefined);

  console.log("C720P_LEGACY_AUTHENTICATED_BROWSER_RELAY_SIMULATION_PASSED");
}
run().catch(error=>{console.error(error);process.exitCode=1});
