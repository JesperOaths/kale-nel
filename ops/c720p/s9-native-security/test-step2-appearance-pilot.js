#!/usr/bin/env node
'use strict';
// Exercise the real UI script with a tiny DOM/secure-relay harness. No media
// fetched from the S9+; mock results deliberately contain one invalid match.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('ops/c720p/s9-native-security/security-face-folders-v22.html','utf8');
const scripts=[...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g)];
const body=scripts.find(x=>x[1].includes("function runAppearanceSearch(){"))?.[1];
assert(body,'Step2 pilot script missing');
assert(!html.includes('innerHTML='),'No raw HTML injection');
for(const s of scripts)if(s[1].trim())new vm.Script(s[1]);
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.handlers={};this.dataset={};this.attributes={};this.hidden=false;this.value='';this.textContent='';this.src='';this.disabled=false;}
 get options(){return this.children;}
 append(...x){this.children.push(...x);}
 replaceChildren(...x){this.children=[...x];}
 addEventListener(type,callback){this.handlers[type]=callback;}
 setAttribute(key,val){this.attributes[key]=val;}
 getAttribute(key){return this.attributes[key]??null;}
 scrollIntoView(){}
 remove(){}
}
const ids=new Map();
const byId=id=>{if(!ids.has(id))ids.set(id,new Element('div'));return ids.get(id);}
const document={
 getElementById:byId,createElement:tag=>new Element(tag),
 addEventListener() {},hidden:false
};
const clipA='motion_1792200000000.mp4',clipB='motion_1792200060000.mp4';
const clips=[clipA,clipB].map((clip_no,i)=>({
 clip_no,person_count:1,face_snapshots_saved:0,
 face_candidates:[],snapshot_name:null,
 anonymous_tracks:[{upper_clothing_colour:'blue',image_movement_direction:'image_left',id:'clip_t1'}],
 anonymous_track_count:1
}));
let appearanceCalls=0;
const relay={
 fetch:async(path)=>{
  if(path==='/new/api/saved')return {ok:true,json:async()=>({archive_mode:'S9-microSD-only',events:clips})};
  if(path==='/new/api/drive-saved')return {ok:true,json:async()=>({events:[]})};
  if(path==='/new/api/drive-person-review')return {ok:true,json:async()=>({clips:[]})};
  if(path.startsWith('/new/api/appearance-search?')){
   appearanceCalls++;
   const params=new URLSearchParams(path.slice(path.indexOf('?')+1));
   assert.equal(params.get('clip'),clipA);
   assert.equal(params.get('category'),'upper_clothing');
   assert.equal(params.get('method'),'bhattacharyya');
   return {ok:true,json:async()=>({
    ok:true,appearance_only:true,verified_same_person:false,
    reference_clip:clipA,
    results:[
     {clip_name:clipB,similarity:.87,zone:'front_garden',appearance_only:true,verified_same_person:false},
     {clip_name:clipA,similarity:1,appearance_only:true,verified_same_person:false},
     {clip_name:clipB,similarity:.99,appearance_only:true,verified_same_person:true}
    ]
   })};
  }
  return {ok:false,status:404,json:async()=>({})};
 },
 url:async(path)=>'https://example.invalid/'+encodeURIComponent(path)
};
const window={C720PSecureRelay:relay};window.parent=window;
const context={window,document,console,URLSearchParams,Date,Promise,Number,String,
  Array,Map,Set,Math,Object,RegExp,Boolean,Error,JSON};
vm.createContext(context);
vm.runInContext(body,context);
function flush(){return new Promise(resolve=>setImmediate(resolve));}
(async()=>{
 await flush();await flush();
 assert.equal(byId('facesCount').textContent,'0');
 // Coarse colour evidence works with ZERO usable face embeddings.
 assert(byId('folders').children.some(e=>e.children.some(c=>c.textContent==='Upper clothing · blue')),
  'Blue clothing evidence folder should exist without any face match');
 byId('appearanceTab').handlers.click();
 assert.equal(byId('appearanceSection').hidden,false);
 byId('appearanceReference').value=clipA;
 await byId('appearanceGo').handlers.click();
 assert.equal(appearanceCalls,1);
 assert.equal(byId('appearanceResults').children.length,1,
  'Must ignore self results and all identity-claiming records');
 assert.match(byId('appearanceStatus').textContent,/NOT identity confidence/);
 byId('foldersTab').handlers.click();
 assert.equal(byId('appearanceSection').hidden,true);
 console.log('S9_STEP2_PROVISIONAL_APPEARANCE_PILOT_TEST_PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
