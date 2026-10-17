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
 constructor(tag='div'){this.tagName=tag;this.children=[];this.handlers={};this.dataset={};this.attributes={};this.hidden=false;this.value='';this.textContent='';this.src='';this.disabled=false;this.open=false;this.checked=false;this.isConnected=true;}
 get options(){return this.children;}
 append(...x){this.children.push(...x);}
 replaceChildren(...x){this.children=[...x];}
 addEventListener(type,callback){this.handlers[type]=callback;}
 setAttribute(key,val){this.attributes[key]=val;}
 getAttribute(key){return this.attributes[key]??null;}
 scrollIntoView(){}
 showModal(){this.open=true;}
 close(){this.open=false;}
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
let appearanceCalls=0,simulateUnavailable=false,caseRevision=0,caseNext=1;
const reviewedCases=[];
const relay={
 fetch:async(path,opts={})=>{
  if(path==='/new/api/s9-evidence-cases'){
   if(opts.method==='POST'){
    assert.equal(opts.headers['X-S9-Case-Intent'],'manually-reviewed-evidence-v1');
    const q=JSON.parse(opts.body);
    assert.equal(q.confirmed,true);
    assert.equal(q.revision,caseRevision);
    let id=q.case_id;
    if(q.action==='create'){id='CASE-'+String(caseNext++).padStart(4,'0');
      reviewedCases.push({id,state:'open',clips:[]});}
    const c=reviewedCases.find(x=>x.id===id);
    assert(c,'Case exists for mutation');
    if(q.action==='create'||q.action==='add')
      c.clips.push({clip:q.clip,available:true,added_at:'2026-10-17',manually_reviewed_original:true});
    if(q.action==='remove')c.clips=c.clips.filter(x=>x.clip!==q.clip);
    if(q.action==='close')c.state='closed';
    if(q.action==='reopen')c.state='open';
    caseRevision++;
    return {ok:true,json:async()=>({ok:true,case_id:id,revision:caseRevision,no_identity_inferred:true})};
   }
   return {ok:true,json:async()=>({ok:true,version:1,revision:caseRevision,
    auto_identity:false,manual_collection_only:true,
    linked_available_clips:reviewedCases.flatMap(x=>x.clips).length,
    cases:reviewedCases.map(x=>({...x}))})};
  }
  if(path==='/new/api/saved')return {ok:true,json:async()=>({archive_mode:'S9-microSD-only',events:clips})};
  if(path==='/new/api/drive-saved')return {ok:true,json:async()=>({events:[]})};
  if(path==='/new/api/drive-person-review')return {ok:true,json:async()=>({clips:[]})};
  if(path.startsWith('/new/api/appearance-search?')){
   appearanceCalls++;
   if(simulateUnavailable)return {ok:false,status:503,json:async()=>({})};
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
 const containsText=(node,text)=>node.textContent===text||node.children.some(child=>containsText(child,text));
 assert(byId('folders').children.some(e=>containsText(e,'Upper clothing · blue')),
  'Blue clothing evidence folder should exist without any face match');
 byId('appearanceTab').handlers.click();
 assert.equal(byId('appearanceSection').hidden,false);
 byId('appearanceReference').value=clipA;
 byId('appearanceCategory').value='upper_clothing'; // Browser defaults to first option; fake DOM must emulate it.
 byId('appearanceZone').value='';
 await byId('appearanceGo').handlers.click();
 assert.equal(appearanceCalls,1);
 assert.equal(byId('appearanceResults').children.length,1,
  'Must ignore self results and all identity-claiming records');
 assert.match(byId('appearanceStatus').textContent,/NOT identity confidence/);
 // No completed HSV backfill yet: SAME COARSE LABEL only, not a face score.
 simulateUnavailable=true;
 await byId('appearanceGo').handlers.click();
 assert.equal(appearanceCalls,2);
 assert.equal(byId('appearanceResults').children.length,1);
 assert.match(byId('appearanceStatus').textContent,/coarse-colour metadata/);
 assert.match(byId('appearanceStatus').textContent,/NOT a person match/);
 // No lower-clothing annotation exists in this minimal corpus. Fail closed.
 byId('appearanceCategory').value='lower_clothing';
 await byId('appearanceGo').handlers.click();
 assert.equal(byId('appearanceResults').children.length,0);
 assert.match(byId('appearanceStatus').textContent,/No usable indexed comparison/);
 byId('foldersTab').handlers.click();
 assert.equal(byId('appearanceSection').hidden,true);
 // Original video metadata can now be saved in a private manually reviewed
 // CASE folder, with confirmed intent and a reversible link.
 const findControl=(node,text)=>node.textContent===text&&typeof node.handlers.click==='function'?
   node:node.children.map(child=>findControl(child,text)).find(Boolean);
 const blue=byId('folders').children.find(e=>containsText(e,'Upper clothing · blue'));
 assert(blue,'Expected a recorded coarse-clothing evidence folder');
 blue.handlers.click();
 const save=findControl(byId('records'),'Save to review case');
 assert(save,'Manual case action missing from original clip detail');
 save.handlers.click();
 assert.equal(byId('casePicker').open,true);
 byId('casePickerSave').handlers.click();
 assert.match(byId('casePickerStatus').textContent,/must confirm/);
 assert.equal(reviewedCases.length,0);
 byId('caseConfirmed').checked=true;
 byId('casePickerSave').handlers.click();
 for(let i=0;i<7;i++)await flush();
 assert.equal(reviewedCases.length,1);
 assert.equal(reviewedCases[0].clips.length,1);
 assert.equal(byId('casePicker').open,false);
 byId('casesTab').handlers.click();
 assert.equal(byId('casesSection').hidden,false);
 const saved=byId('caseFolders').children.find(e=>containsText(e,'CASE-0001'));
 assert(saved,'Newly created private case should be listed');
 saved.handlers.click();
 const remove=findControl(byId('caseRecords'),'Remove from case');
 assert(remove,'Case details must provide reversible removal');
 await remove.handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(reviewedCases[0].clips.length,0);
 console.log('S9_STEP2_PROVISIONAL_APPEARANCE_PILOT_TEST_PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
