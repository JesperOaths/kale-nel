#!/usr/bin/env node
// Executes the transformed deployed workflows without any browser or network.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=process.argv[2];assert.ok(root,'pass a staged asset directory');
const read=name=>readFileSync(path.join(root,name),'utf8');
const people=read('security-people-v45.js'),review=read('security-review-v8.html');
new Function(people);
for(const match of review.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new Function(match[1]);
const assignment=people.slice(people.indexOf('function assignmentKey(item){'),people.indexOf('async function fetchLegacySkipped(){'));
const outfit=people.slice(people.indexOf('// SECURITY_OUTFIT_REVIEW_FINALITY_V1'),people.indexOf('const autoId='));
assert.ok(assignment&&outfit);
const ref='motion_1792000000000.mp4',candidate='motion_1792000001000.mp4';
const person={id:'saved-person',label:'A manually saved person'};
const clipPattern=/^motion_[0-9]{13}[.]mp4$/;

async function compare({method='model',entry,legacyDecision,driveEntry}={}){
 const items={['sd:'+ref]:{folder:person.id,folders:[person.id],review_status:'assigned'}};
 if(entry!==undefined)items['sd:'+candidate]=entry;
 if(driveEntry)items['drive:'+candidate]=driveEntry;
 const state={assignedReady:true,extraLinks:{items},archiveEntries:[{source:'sd',clip:ref,name:ref,recorded_ms:1792000000000}],
  legacyAssigned:new Map(),legacySkipped:new Map(),clipEvidence:new Map([[ref,{person_count:1}],[candidate,{person_count:1}]]),
  clothingBusy:false,clothingToken:0,clothingMatches:null};
 if(legacyDecision)state.legacySkipped.set('sd:'+candidate,{decision:legacyDecision});
 const original=JSON.stringify(items);const calls=[];
 const relay=()=>({fetch:async route=>{
  calls.push(route);assert.ok(route.startsWith('/new/api/appearance-'));
  if(route.startsWith('/new/api/appearance-multivector?'))return {ok:true,json:async()=>({ok:true,
   appearance_only:true,verified_same_person:false,identity_probability:false,human_review_required:true,
   automatic_person_assignments:0,reference_source:'s9_sd',reference_clip:ref,
   model_sha256:'ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d',
   results:method==='model'?[{clip_name:candidate,source:'s9_sd',appearance_only:true,
    verified_same_person:false,auto_assignment:false,human_review_required:true,
    method:'visual_75_color_25',similarity_percent:95,similarity:.95}]:[]})};
  return {ok:true,json:async()=>({ok:true,appearance_only:true,results:[{clip_name:candidate,similarity:.96}]})};
 }});
 const context={state,relay,clipName:clipPattern,URLSearchParams,Map,Set,
  num:x=>Number.isFinite(Number(x))&&Number(x)>=0?Number(x):0,
  savedFolders:()=>[person],renderClothing(){}};
 const rendered=people.match(/ const matches=\(state.clothingMatches\|\|\[\]\)\.filter\(match=>outfitReviewEligible\(match.clip\)\);/)?.[0];
 assert.ok(rendered,'cached suggestions are also filtered against the latest review');
 vm.runInNewContext(assignment+'\n'+outfit+'\nthis.search=searchClothingMatches;this.visibleMatches=()=>{'+rendered+'return matches;};',context,{timeout:1000});
 await context.search(true);
 assert.equal(JSON.stringify(items),original,'comparisons never mutate manual decisions');
 return {matches:state.clothingMatches,calls,state,visibleMatches:context.visibleMatches};
}
for(const method of ['model','hsv']){
 for(const status of ['skipped','rejected','assigned','unknown_review_state']){
  const result=await compare({method,entry:{folder:null,folders:[],review_status:status}});
  assert.equal(result.matches.length,0,method+' respects '+status);
 }
 for(const decision of ['skipped','rejected']){
  assert.equal((await compare({method,legacyDecision:decision})).matches.length,0,method+' respects legacy '+decision);
 }
 assert.equal((await compare({method})).matches.length,1,method+' allows an undecided candidate');
 assert.equal((await compare({method,entry:{folder:null,folders:[],review_status:'inbox'}})).matches.length,1,method+' permits explicit reopen');
 assert.equal((await compare({method,entry:{folder:null,folders:['other-person'],review_status:'inbox'}})).matches.length,0,method+' blocks contradictory assigned group');
 assert.equal((await compare({method,driveEntry:{folder:null,folders:[],review_status:'rejected'}})).matches.length,1,method+' keeps source-qualified decisions separate');
 const cached=await compare({method});assert.equal(cached.visibleMatches().length,1);
 cached.state.extraLinks.items['sd:'+candidate]={folder:null,folders:[],review_status:'rejected'};
 assert.equal(cached.visibleMatches().length,0,method+' hides cached results after a later rejection');
 cached.state.extraLinks.items['sd:'+candidate]={folder:null,folders:[],review_status:'inbox'};
 assert.equal(cached.visibleMatches().length,1,method+' shows cached evidence again after explicit reopen');
}

const lifecycle=review.slice(review.indexOf('// SECURITY_REVIEW_ACTIVE_TAB_V1'),review.indexOf('\nfunction personFilingControls('));
const stop=review.match(/function playbackStop\(\)\{[^\n]+\}/)?.[0];assert.ok(stop);
function reviewContext(embedded=true){
 const messages=[],windowEvents={},documentEvents={},intervals=[],calls=[];
 const parent={postMessage:(data,origin)=>messages.push([data,origin])};
 const window={parent,addEventListener:(kind,fn)=>windowEvents[kind]=fn};
 if(!embedded)window.parent=window;
 const document={hidden:false,addEventListener:(kind,fn)=>documentEvents[kind]=fn};
 const state={all:[{}],activeVideo:null};
 const context={window,document,state,location:{origin:'http://hub.invalid:8123'},
  refresh:()=>calls.push('refresh'),setInterval:(fn,ms)=>intervals.push([fn,ms])};
 vm.runInNewContext(stop+'\n'+lifecycle,context,{timeout:1000});
 return {window,document,state,windowEvents,documentEvents,intervals,messages,calls,parent};
}
const ui=reviewContext();assert.equal(ui.messages.length,1);assert.equal(ui.messages[0][0].kind,'security-tab-ready-v37');
assert.equal(ui.messages[0][1],'http://hub.invalid:8123');assert.equal(ui.intervals[0][1],60000);
assert.equal(ui.calls.length,1,'initial load remains available');
ui.intervals[0][0]();assert.equal(ui.calls.length,1,'embedded tab waits for trusted visibility before polling');
const send=(source,origin,kind,active)=>ui.windowEvents.message({source,origin,data:{kind,active}});
send({},'http://hub.invalid:8123','security-tab-visibility-v37',true);
send(ui.parent,'https://foreign.invalid','security-tab-visibility-v37',true);
ui.intervals[0][0]();assert.equal(ui.calls.length,1,'foreign source/origin cannot resume polling');
send(ui.parent,'http://hub.invalid:8123','security-tab-visibility-v37',true);
ui.intervals[0][0]();assert.equal(ui.calls.length,2,'trusted active tab polls');
const stopped=[];ui.state.activeVideo={pause:()=>stopped.push('pause'),removeAttribute:k=>stopped.push(k),load:()=>stopped.push('load')};
send(ui.parent,'http://hub.invalid:8123','security-tab-visibility-v37',false);
assert.deepEqual(stopped,['pause','src','load']);assert.equal(ui.state.activeVideo,null);
ui.intervals[0][0]();assert.equal(ui.calls.length,2,'CSS-hidden iframe no longer polls');
send(ui.parent,'http://hub.invalid:8123','security-tab-refresh-v37');assert.equal(ui.calls.length,3,'outer explicit Refresh remains functional after ready handshake');
send(ui.parent,'http://hub.invalid:8123','security-tab-visibility-v37',true);
ui.document.hidden=true;ui.documentEvents.visibilitychange();ui.intervals[0][0]();assert.equal(ui.calls.length,3,'background document does not poll');
const standalone=reviewContext(false);assert.equal(standalone.messages.length,0);standalone.intervals[0][0]();assert.equal(standalone.calls.length,2,'standalone visible page keeps periodic refresh');

class Element{
 constructor(){this.style={};this.dataset={};this.children=[];this.events={};this.value='';this.hidden=false;}
 setAttribute(){} append(...nodes){this.children.push(...nodes)} appendChild(node){this.children.push(node)}
 addEventListener(kind,fn){this.events[kind]=fn}
}
const night=read('s9-night-visibility-v1.js');new Function(night);
const live=new Element(),section=new Element(),events={},timers=[],requests=[];
section.hidden=true;
const document={hidden:false,getElementById:id=>({cameraLive:live,'panel-live':section}[id]||null),createElement:()=>new Element()};
const window={C720PSecureRelay:{fetch:async(route,options)=>{
 requests.push([route,options]);assert.equal(route,'/new/camera-controls');assert.ok(!options.method||options.method==='GET');
 return {ok:true,json:async()=>({night_active:false})};
}},addEventListener:(kind,fn)=>events[kind]=fn};
let cleared=false;
vm.runInNewContext(night,{window,document,setInterval:(fn,ms)=>{timers.push([fn,ms]);return 1},clearInterval:()=>cleared=true},{timeout:1000});
assert.equal(requests.length,0,'night sensor polling is paused for exact hidden live pane');
section.hidden=false;await timers[0][0]();assert.equal(requests.length,1);
section.hidden=true;await timers[0][0]();assert.equal(requests.length,1);
section.hidden=false;document.hidden=true;await timers[0][0]();assert.equal(requests.length,1);
events.pagehide();document.hidden=false;await timers[0][0]();assert.equal(requests.length,1);assert.ok(cleared);
console.log('SECURITY_REVIEW_LIFECYCLE_RUNTIME_PASS');
