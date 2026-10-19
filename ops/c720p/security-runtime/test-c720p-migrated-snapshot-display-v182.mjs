#!/usr/bin/env node
// Offline only. Browser DOM/fetch/auth are synthetic; no real media or accounts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const script=fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname),
 'c720p-migrated-snapshot-display-v182.js'),'utf8');
const names=Array.from({length:6},(_,i)=>'motion_'+String(1792000010000+i)+'.mp4');
const filenames=names.map(n=>n.replace(/\.mp4$/,'.jpg'));
const expected={ok:true,schema_version:'c720p_s9_verified_import_v2',
 not_s9_original_recordings:true,not_person_assignments:true,
 total_imported:6,files:names.map(name=>({name,bytes:12000,indexed:true}))};
const events=names.map((n,i)=>({clip:'clips/'+n,snapshot:'snaps/'+filenames[i],
 saved:false,other:'keep'}));
function image(src){
 const handlers={};
 return {src,isConnected:true,dataset:{},handlers,
 getAttribute(n){return n==='src'?this.src:null},
 addEventListener(n,handler){handlers[n]=handler}};
}
async function scenario(opts={}){
 const pics=filenames.map(n=>image('snaps/'+n));
 const calls=[];
 const auth={
  fetch:async(route)=>{calls.push(['auth',route]);return {
   status:200,json:async()=>opts.manifest??expected}},
  url:async(route)=>{calls.push(['url',route]);return 'https://signed.example.invalid'+route}
 };
 const host={C720PSecureRelay:opts.noRelay?undefined:auth};host.parent=host;
 const doc={readyState:'complete',querySelectorAll:()=>pics};
 const ctx={window:host,document:doc,encodeURIComponent,
  fetch:async(route)=>{calls.push(['events',route]);return {
    status:200,json:async()=>opts.events??events}}};
 vm.runInNewContext(script,ctx,{timeout:1000});
 for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));
 return {pics,calls};
}
{
 const {pics,calls}=await scenario();
 assert.equal(pics.filter(x=>x.src.startsWith('https://signed.example.invalid')).length,6);
 assert.equal(calls.filter(x=>x[0]==='url').length,6);
 assert.equal(pics.every(x=>x.dataset.c720pLegacySnapshotSrc?.startsWith('snaps/')),true);
 assert.equal(pics.every(x=>x.dataset.c720pS9Snapshot==='loading'),true);
 assert.equal(events.every(x=>x.saved===false && x.other==='keep'),true);
}
{
 const {pics,calls}=await scenario({noRelay:true});
 assert.equal(pics.every(x=>x.src.startsWith('snaps/')),true);
 assert.equal(calls.length,0);
}
{
 const {pics,calls}=await scenario({manifest:{...expected,total_imported:7}});
 assert.equal(pics.every(x=>x.src.startsWith('snaps/')),true);
 assert.equal(calls.some(x=>x[0]==='url'),false);
}
{
 const {pics}=await scenario({events:events.slice(1)});
 assert.equal(pics.every(x=>x.src.startsWith('snaps/')),true);
}
{
 const {pics}=await scenario({events:[
  {...events[0],snapshot:'snaps/../../private.jpg'},...events.slice(1)]});
 assert.equal(pics.every(x=>x.src.startsWith('snaps/')),true);
}
{
 const {pics}=await scenario();
 const first=pics[0];
 first.handlers.error();
 assert.equal(first.src,'snaps/'+filenames[0]);
 assert.equal(first.dataset.c720pS9Snapshot,'fallback');
}
{
 const {pics}=await scenario();
 pics[0].handlers.load();
 assert.equal(pics[0].dataset.c720pS9Snapshot,'loaded');
}
// Source-exclusion checks are preventive, not an authorization to retire MP4s.
for(const prohibited of ['.remove()', '.unlink(', 'saved=true','saveClip(', 'deleteClip(',
 'innerHTML=', 'localStorage.', 'document.cookie', 'window.open(']){
 assert.equal(script.includes(prohibited),false,prohibited);
}
assert.equal(script.includes('C720P_MIGRATED_S9_SNAPSHOT_DISPLAY_V182'),true);
console.log('C720P_LEGACY_S9_JPEG_BRIDGE_V182_SOURCE_AND_FALLBACK_TESTS_PASSED');