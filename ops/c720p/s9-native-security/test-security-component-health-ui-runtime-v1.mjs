#!/usr/bin/env node
// Execute the production appended IIFE with fake DOM/relay/time, without network.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(process.argv[2],'utf8');new Function(script);
const keys={
 infrastructure:{root_available_bytes:null,root_total_bytes:null,ntp_synchronized:null,external_clock_minus_hub_seconds:null,original_digest_matches:null,original_digest_mismatches:null,original_integrity_coverage_complete:null,originals_indexed:null},
 evidence:{recordings_indexed:null,tracked_observations:null,observations_with_colour:null,observations_with_direction:null,observations_with_measured_posture:null,observations_with_measured_gait_cadence:null,face_supported_candidates:null,unassigned_appearances:null},
 saved_timing:{reported_complete:null,paired_recordings:null,joint_same_recording_required:null,full_frame_decode_verified:null}
};
function data(){return {ok:true,schema_version:'security_component_health_v1',observed_at_utc:'2026-10-20T19:00:00Z',components:Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,{status:'current',age_seconds:10,...v}]))};}
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.style={};this.attributes={};this.hidden=false;this.textContent='';}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}
 setAttribute(key,value){this.attributes[key]=value;}
 querySelector(selector){return this.queries?.[selector]||null;}
 get innerHTML(){throw Error('No HTML interpolation permitted');}set innerHTML(_){throw Error('No HTML interpolation permitted');}
}
const flatten=node=>[node.textContent,...node.children.map(flatten)].flat().join(' ');
const settle=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
function setup({documentHidden=false,liveHidden=false,controlsHidden=true,reply=data(),pending=false,relay=true}={}){
 let clock=1000000,resolve;const requests=[],timers=new Map(),deadlines=new Map(),windowEvents={},documentEvents={},observers=[];
 const live=new Element(),controls=new Element(),liveHost=new Element(),controlHost=new Element();
 live.hidden=liveHidden;controls.hidden=controlsHidden;
 live.queries={'.live-below':liveHost};controls.queries={'.controls':controlHost};
 const byId={'panel-live':live,'panel-controls':controls};
 const document={hidden:documentHidden,getElementById:id=>byId[id]||[...liveHost.children,...controlHost.children].find(x=>x.id===id)||null,createElement:tag=>new Element(tag),addEventListener:(name,fn)=>documentEvents[name]=fn};
 const response=()=>({ok:true,json:async()=>reply});
 const window={addEventListener:(name,fn)=>windowEvents[name]=fn};
 if(relay)window.C720PSecureRelay={fetch:(route,options)=>{
  requests.push([route,options]);assert.equal(route,'/new/api/security-component-health');assert.equal(options.cache,'no-store');assert.equal(options.method,undefined);assert.ok(options.signal instanceof AbortSignal);
  return pending?new Promise(r=>resolve=r):Promise.resolve(response());
 }};
 class Observer{constructor(fn){this.fn=fn;this.connected=false;observers.push(this);}observe(node,options){assert.ok(node===live||node===controls);assert.deepEqual([...options.attributeFilter],['hidden']);this.connected=true;}disconnect(){this.connected=false;}}
 const context={document,window,MutationObserver:Observer,AbortController,performance:{now:()=>clock},Date:class extends Date{static now(){throw Error('Polling budget must use monotonic time');}},setInterval:(fn,ms)=>{assert.equal(ms,15000);const id=timers.size+1;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),setTimeout:(fn,ms)=>{assert.equal(ms,10000);const id=deadlines.size+1;deadlines.set(id,fn);return id;},clearTimeout:id=>deadlines.delete(id)};
 vm.runInNewContext(script,context,{timeout:1000});
 return {document,window,live,controls,liveHost,controlHost,requests,timers,windowEvents,documentEvents,observers,
  advance:n=>clock+=n,tick:async()=>{for(const fn of timers.values())await fn();await settle();},changed:async()=>{for(const o of observers)if(o.connected)await o.fn();await settle();},resolve:async()=>{pending=false;resolve(response());await settle();},unhang:()=>pending=false,expire:async()=>{for(const fn of [...deadlines.values()])fn();await settle();},reply:x=>reply=x,reexecute:()=>vm.runInNewContext(script,context,{timeout:1000}),
  text:()=>flatten(liveHost),both:()=>[flatten(liveHost),flatten(controlHost)]};
}

const complete=data();Object.assign(complete.components.infrastructure,{root_available_bytes:846*1048576,root_total_bytes:20*1073741824,ntp_synchronized:false,external_clock_minus_hub_seconds:93.5,original_digest_matches:223,original_digest_mismatches:1,original_integrity_coverage_complete:false,originals_indexed:224});
Object.assign(complete.components.evidence,{recordings_indexed:224,tracked_observations:53,observations_with_colour:40,observations_with_direction:20,observations_with_measured_posture:0,observations_with_measured_gait_cadence:0,face_supported_candidates:21,unassigned_appearances:5});
Object.assign(complete.components.saved_timing,{reported_complete:true,paired_recordings:3,joint_same_recording_required:true,full_frame_decode_verified:true});
const ui=setup({reply:complete});await settle();assert.equal(ui.requests.length,1);assert.equal(ui.liveHost.children.length,1);assert.equal(ui.controlHost.children.length,1);assert.equal(ui.both()[0],ui.both()[1]);
for(const text of ['Storage space is low','Clock is not synchronized','Clock offset exceeds 30 seconds','Original integrity mismatch requires review','846 MiB','93.5 seconds','Mismatches: 1','Measured posture: 0','Measured gait cadence: 0','Supported face candidates: 21','Paired recordings: 3','Same-recording pairing required: Yes'])assert.ok(ui.text().includes(text),text);
assert.ok(!ui.text().includes('verified identities'));
ui.reexecute();await settle();assert.equal(ui.requests.length,1);assert.equal(ui.liveHost.children.length,1);assert.equal(ui.timers.size,1,'re-execution cannot create a duplicate timer or panel');
await ui.tick();await ui.changed();ui.windowEvents.pageshow();await settle();assert.equal(ui.requests.length,1,'initial callbacks share a one-minute budget');
ui.advance(59999);await ui.tick();assert.equal(ui.requests.length,1);ui.advance(1);await ui.tick();assert.equal(ui.requests.length,2);
ui.live.hidden=true;ui.controls.hidden=true;ui.advance(60000);await ui.tick();await ui.changed();assert.equal(ui.requests.length,2,'other navigation panes cannot poll');
ui.controls.hidden=false;await ui.changed();assert.equal(ui.requests.length,3,'visible Controls resumes the shared fetch');
ui.document.hidden=true;ui.advance(60000);await ui.tick();ui.documentEvents.visibilitychange();await settle();assert.equal(ui.requests.length,3,'background document cannot poll');
ui.document.hidden=false;ui.documentEvents.visibilitychange();await settle();assert.equal(ui.requests.length,4);
ui.windowEvents.pagehide();ui.advance(60000);await ui.tick();await ui.changed();assert.equal(ui.requests.length,4);assert.equal(ui.timers.size,0);
ui.windowEvents.pageshow();await settle();assert.equal(ui.requests.length,5,'back-forward-cache restore resumes a visible page');assert.equal(ui.timers.size,1);

const flight=setup({pending:true});flight.advance(120000);await flight.tick();await flight.changed();assert.equal(flight.requests.length,1,'a slow request cannot overlap even after the minute expires');await flight.resolve();await flight.tick();assert.equal(flight.requests.length,2);
const hung=setup({pending:true});await hung.expire();assert.equal(hung.requests[0][1].signal.aborted,true);assert.ok(hung.text().includes('System reports unavailable'),'a hung relay is bounded even if it ignores abort');hung.advance(59999);await hung.tick();assert.equal(hung.requests.length,1,'timeout cannot cause a retry within one minute');hung.advance(1);hung.unhang();await hung.tick();assert.equal(hung.requests.length,2);assert.ok(hung.text().includes('Independent reports loaded'),'deadline releases busy state for the next minute');
for(const options of [{documentHidden:true},{liveHidden:true,controlsHidden:true},{relay:false}]){const hidden=setup(options);await settle();assert.equal(hidden.requests.length,0);}

const stale=data();stale.components.evidence.status='stale';stale.components.evidence.age_seconds=7200;stale.components.saved_timing.status='unavailable';stale.components.saved_timing.age_seconds=null;
const old=setup({reply:stale});await settle();assert.ok(old.text().includes('Stale · 2 hours old'));assert.ok(old.text().includes('Unavailable · age unknown'));assert.ok(old.text().includes('Measured posture: Not reported'));assert.ok(old.text().includes('Reported complete: Not reported'));assert.ok(!old.text().includes('Measured posture: 0'),'unknown measurement is never fabricated as zero');
const structural=data();Object.assign(structural.components.saved_timing,{reported_complete:true,paired_recordings:3,joint_same_recording_required:true,full_frame_decode_verified:false});const structureUi=setup({reply:structural});await settle();assert.ok(!structureUi.text().includes('Saved timing checks require review'),'unperformed rendered-playback verification does not negate completed structural timing proof');assert.ok(structureUi.text().includes('Full-frame decoding verified: No'));

for(const mutate of [x=>x.ok=false,x=>x.schema_version='other',x=>x.observed_at_utc='2026-10-20',x=>x.components.evidence.status='healthy',x=>x.components.evidence.age_seconds=-1,x=>x.components.evidence.face_supported_candidates='21',x=>x.components.saved_timing.reported_complete='true',x=>x.components.infrastructure.original_digest_matches=1.5]){
 const bad=data();mutate(bad);const invalid=setup({reply:bad});await settle();assert.ok(invalid.text().includes('System reports unavailable'));assert.ok(!invalid.text().includes('Digest matches: 0'));
}
const malicious=data();malicious.components.evidence['<img src=x onerror=evil()>']='<script>evil()</script>';malicious.components.evidence.face_supported_candidates='<img src=x onerror=evil()>';
const safe=setup({reply:malicious});await settle();assert.ok(!safe.text().includes('<img'));assert.ok(safe.text().includes('unavailable'));
const network=setup();await settle();network.advance(60000);network.window.C720PSecureRelay.fetch=async()=>{throw Error('private path /secret/report.json');};await network.tick();assert.ok(network.text().includes('System reports unavailable'));assert.ok(!network.text().includes('/secret'));
console.log('SECURITY_COMPONENT_HEALTH_UI_RUNTIME_PASS');
