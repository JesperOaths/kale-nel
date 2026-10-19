#!/usr/bin/env node
// Executes transformed deployed functions and the recovery workflow in a fake
// DOM. No browser, network request, image decode, review or camera operation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=process.argv[2];
assert.ok(root,'pass a patched UI fixture or stage directory');
const read=name=>readFileSync(path.join(root,name),'utf8');
for(const file of ['security-people-v45.js','security-hub-v30.js'])new Function(read(file));
for(const file of ['security-archive-v7.html','security-review-v8.html']){
 for(const match of read(file).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new Function(match[1]);
}

const people=read('security-people-v45.js');
const filterStart=people.indexOf(' const clips=folderApprovedSDClips(state.folder);',people.indexOf('function renderFolder(){'));
const filterEnd=people.indexOf(' facePanel.hidden=',filterStart);
assert.ok(filterStart>0&&filterEnd>filterStart);
const filter=new Function('state','folderApprovedSDClips','faceName',people.slice(filterStart,filterEnd)+'\nreturn faceMatches;');
const clip='motion_1792137550788.mp4';
const valid={clip,face:{snapshot_name:'motion_1792137550788__person1__1000_0.jpg',snapshot_sha256:'a'.repeat(64)}};
const other={clip,face:{snapshot_name:'motion_1792137550788__person1__2000_0.jpg',snapshot_sha256:'b'.repeat(64)}};
const facePattern=/^motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg$/;
const state={folder:'reviewed-person',faceList:[valid,{...valid},other,
 {...valid,clip:'motion_1792137550999.mp4'},
 {clip,face:{...valid.face,snapshot_name:'unindexed.jpg'}},
 {clip,face:{...valid.face,snapshot_on_s9:false}}]};
for(let render=0;render<2;render++){
 const result=filter(state,()=>new Set([clip]),facePattern);
 assert.deepEqual(result,[valid,other],'each render uses a fresh deduplicator and source-qualified evidence');
}

const archive=read('security-archive-v7.html');
const categoryBlock=archive.match(/const category=r=>\{[\s\S]*?return g==='no_person_model_detection'\?'Motion · person unconfirmed':'Motion'\};/);
assert.ok(categoryBlock,'patched category exists');
const category=new Function(categoryBlock[0]+'return category;')();
assert.equal(category({person_event_category:'no_person_model_detection',person_count:0}),'Motion · person unconfirmed');
assert.equal(category({person_event_category:'no_person_model_detection',person_count:2}),'Motion · person unconfirmed','contradictory counts do not override explicit negative model classification');
assert.equal(category({person_event_category:'no_person_model_detection',content_categories:['vehicle']}),'Vehicle');
assert.equal(category({person_event_category:'single_person_repeated_candidate',person_count:1}),'Person candidate');
assert.equal(category({person_event_category:'possible_group_needs_frame_review'}),'Possible people · review');
assert.equal(category({scene_category:'multiple_people',person_count:2}),'People candidates');
assert.equal(category({person_event_category:'some_new_person_metadata',person_count:0}),'Motion','unknown strings are not classified by a substring');
assert.equal(category({content_categories:['ANIMAL']}),'Animal');

const hub=read('security-hub-v30.js');
const diagnosticBlock=hub.slice(hub.indexOf('function nativeCaptureDiagnostics(d){'),hub.indexOf('function diagnostics(){'));
const nativeDiagnostics=new Function(diagnosticBlock+'return nativeCaptureDiagnostics;')();
const rows=d=>Object.fromEntries(nativeDiagnostics(d));
assert.deepEqual(Object.values(rows({})),Array(4).fill('Not reported'));
const healthy=rows({native_4k_enabled:true,continuous_4k_ready:true,continuous_4k_buffered_ms:2480,continuous_4k_dropped_output_frames:0});
assert.equal(healthy['Native recording'],'4K enabled');
assert.equal(healthy['4K capture readiness'],'Ready');
assert.equal(healthy['4K buffer'],'2.5 seconds');
assert.equal(healthy['Dropped 4K output frames'],'0');
const impaired=rows({native_4k_enabled:true,continuous_4k_ready:false,continuous_4k_buffered_ms:null,continuous_4k_dropped_output_frames:4});
assert.equal(impaired['Native recording'],'4K enabled');
assert.equal(impaired['4K capture readiness'],'Not ready');
const invalid=rows({native_4k_enabled:'true',continuous_4k_ready:1,continuous_4k_buffered_ms:'2000',continuous_4k_dropped_output_frames:NaN});
assert.deepEqual(Object.values(invalid),Array(4).fill('Not reported'),'missing or wrong-type data never turns green');
const displayLine=hub.match(/function display\(key,value\)\{[^\n]+\}/)?.[0];
const display=new Function(displayLine+';return display;')();
assert.equal(display('night_mode','auto'),'Automatic');
assert.equal(display('night_mode','on'),'On');
assert.equal(display('night_mode','off'),'Off');
assert.equal(display('zoom','1.5'),'1.5×');
assert.ok(hub.includes("night_mode:['Sensor night mode','Native camera night policy']"));

class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.events={};this.value='';this.textContent='';this.open=false;this.disabled=false;}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=[...children];}
 addEventListener(event,callback){this.events[event]=callback;}
 pause(){} load(){} remove(){} removeAttribute(){}
}
const recovery=read('security-review-v8.html').split('<script id="s9-aux-recovery-ui">')[1].split('</script>')[0];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const descendants=node=>[node,...node.children.filter(x=>x&&typeof x==='object').flatMap(descendants)];
async function runRecovery(mode){
 const ids=['auxRecovery','auxRecoveryList','auxRecoveryStatus','auxRecoveryCount','auxRecoverySearch','auxRecoveryPage','auxRecoveryPrev','auxRecoveryNext'];
 const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
 const calls=[];
 const api={fetch:async(route,options)=>{
  calls.push(['GET',route]);assert.ok(!options?.method||options.method==='GET');
  return {ok:true,json:async()=>({ok:true,schema_version:'s9_auxiliary_recovery_metadata_v1',not_verified_original_recordings:true,
   not_counted_in_archive_or_person_analytics:true,no_human_identity_approval:true,full_frame_decode_verified:false,structural_candidates:1,
   files:[{name:clip+'.preroll.mp4',role:'preroll',duration_s:2.5,width:640,height:480,bytes:20000}]})};
 },url:async(route)=>{calls.push(['URL',route]);return 'http://example.invalid/never-loaded';}};
 const window={addEventListener(){}};
 if(mode==='own'){window.C720PSecureRelay=api;window.parent=window;}
 else if(mode==='parent'){window.parent={C720PSecureRelay:api};}
 else if(mode==='cross-origin'){
  window.parent={};Object.defineProperty(window.parent,'C720PSecureRelay',{get(){throw new Error('cross-origin blocked');}});
 }else{window.parent=window;}
 const document={getElementById:id=>elements[id]||null,createElement:tag=>new Element(tag)};
 vm.runInNewContext(recovery,{window,document,console},{timeout:1000});
 elements.auxRecovery.open=true;
 elements.auxRecovery.events.toggle();
 await tick();await tick();
 if(mode==='own'||mode==='parent'){
  assert.deepEqual(calls,[['GET','/new/api/s9-auxiliary-recovery']]);
  const preview=descendants(elements.auxRecoveryList).find(n=>n.tagName==='BUTTON'&&n.textContent==='Preview');
  assert.ok(preview,'metadata became a separate preview row');
  await preview.events.click();
  assert.deepEqual(calls[1],['URL','/new/saved/recovery/clip/'+clip+'.preroll.mp4']);
  assert.equal(descendants(elements.auxRecoveryList).filter(n=>n.tagName==='VIDEO').length,1);
 }else{
  assert.equal(calls.length,0,'no relay means no unauthenticated fallback');
  assert.match(elements.auxRecoveryStatus.textContent,/Secure relay unavailable/);
 }
}
for(const mode of ['own','parent','missing','cross-origin'])await runRecovery(mode);
console.log('SECURITY_UI_CONTINUITY_RUNTIME_PASS: face rerender, negative/uncertain labels, explicit readiness, night mode, embedded/standalone recovery, fail-closed auth');
