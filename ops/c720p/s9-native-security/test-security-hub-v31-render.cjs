#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'security-hub-v31.js'),'utf8');
const begin = src.indexOf(' const known=x=>');
const end = src.indexOf(' let busy=false,ended=false,lastAttempt=null;',begin);
assert(begin>0 && end>begin,'V31 render segment unexpectedly changed');
const renderer = src.slice(begin,end);
const intro = `const panels=[{summary:{textContent:''},rows:{
 children:[],replaceChildren(){this.children=[]},
 append(...elements){this.children.push(...elements)}
}}];
const create=(tag,cls,txt)=>({tag,textContent:String(txt===undefined?'':txt)});`;
function render(data){
 const result = vm.runInNewContext(intro+'\n'+renderer+'\nrender(payload); ({summary:panels[0].summary.textContent, rows:panels[0].rows.children})',
   {payload:data});
 const fields={};
 for(let i=0;i<result.rows.length;i+=2){
   const x=result.rows[i],y=result.rows[i+1];
   assert.equal(x.tag,'dt');assert.equal(y.tag,'dd');
   fields[x.textContent]=y.textContent;
 }
 return {summary:result.summary,fields};
}
function fixture(){
 const unknown=null;
 return {
  aggregate_stale:false,aggregate_age_seconds:7,
  infrastructure:{status:'current',age_seconds:7,root_available_bytes:0,
   root_total_bytes:21*1073741824,ntp_synchronized:unknown,
   external_clock_minus_hub_seconds:unknown,original_digest_matches:unknown,
   original_digest_mismatches:unknown,original_integrity_coverage_complete:unknown,
   originals_indexed:unknown},
  evidence:{status:'stale',age_seconds:3600,recordings_indexed:unknown,
   tracked_observations:unknown,observations_with_colour:unknown,
   observations_with_direction:unknown,observations_with_measured_posture:unknown,
   observations_with_measured_gait_cadence:unknown,face_supported_candidates:unknown,
   unassigned_appearances:unknown},
  saved_timing:{status:'unavailable',age_seconds:null,paired_recordings:null,
   reported_complete:null,joint_same_recording_required:null,full_frame_decode_verified:null},
  pipeline_summary:null
 };
}
const current=render(fixture());
assert.match(current.summary,/CRITICAL: Root filesystem full/);
assert.match(current.summary,/media work must be deferred/);
assert.match(current.summary,/Clock synchronization unknown/);
assert.match(current.summary,/Original integrity evidence unavailable/);
assert.match(current.summary,/Some reports are stale or unavailable/);
assert.match(current.fields.Storage,/Current · 0 MiB free/);
assert.match(current.fields['Rescan, S3 and manual binding'],/Unavailable/);
assert.doesNotMatch(current.summary,/^Independent reports loaded$/);

const stale=fixture();
stale.infrastructure.status='stale';
const staleUI=render(stale);
assert.match(staleUI.summary,/Last report: root filesystem full/);
assert.match(staleUI.summary,/current status unverified/);
assert.match(staleUI.fields.Storage,/Last reported · 0 MiB/);
assert.doesNotMatch(staleUI.summary,/CRITICAL:/);

const absent=render(null);
assert.equal(absent.summary,'System reports unavailable');
assert.match(absent.fields.Reports,/Unavailable/);
assert(!('Storage' in absent.fields),'No invented storage measurement');

// A stale aggregate cannot certify even formerly verified S3 motion or digest binding.
const old=fixture();
old.aggregate_stale=true;
old.aggregate_age_seconds=650;
old.infrastructure.status='stale';
old.pipeline_summary={
 rescan:{state:'current',tracked:10,pending:1,processing:0,completed:9,blocked:0,rejected:0,dead_letter:0,
  worker_activity_verified:true,results_current_source_verified:true},
 s3:{motion_health_verified:true,healthy:true,motion_analysis_active:true},
 manual_binding:{decisions:48,without_reported_binding:48,current_source_binding_verified:true,live_write_binding_verified:true}
};
const olderUI=render(old);
assert.match(olderUI.summary,/aggregate report is stale/i);
assert.match(olderUI.fields['Rescan queue'],/Last reported/);
assert.match(olderUI.fields['Bedroom S3 motion'],/UNKNOWN/);
assert.match(olderUI.fields['Manual review media binding'],/Unknown \(stale report\)/);

console.log('V31_RENDERED_PRIVATE_STATUS_CONTRACTS_PASS 19');
