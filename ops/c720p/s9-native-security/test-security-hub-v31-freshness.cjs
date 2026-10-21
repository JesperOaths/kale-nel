#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'security-hub-v31.js'),'utf8');
const begin=src.indexOf(' const nonnegative=x=>');
const end=src.indexOf(' const known=x=>',begin);
assert(begin>0&&end>begin,'source contract markers');
const contractScript=src.slice(begin,end);
function contract(payload){return vm.runInNewContext(contractScript+'\ncontract(payload)',{payload});}
function report(ageSeconds){
 return {
  ok:true,schema_version:'security_component_health_v1',
  observed_at_utc:new Date(Date.now()-ageSeconds*1000).toISOString(),
  components:{
   infrastructure:{status:'current',age_seconds:15,
    root_available_bytes:0,root_total_bytes:21*1073741824,
    ntp_synchronized:true,original_digest_mismatches:0},
   evidence:{status:'current',age_seconds:15},
   saved_timing:{status:'current',age_seconds:15}
  },
  pipeline_summary:{schema_version:'security_ui_pipeline_summary_v1',
   state:'reported',
   rescan:{state:'current',revision:8,tracked:48,pending:3,processing:0,
    completed:15,blocked:30,rejected:0,dead_letter:0,
    worker_activity_verified:true,results_current_source_verified:true},
   s3:{state:'current',healthy:true,motion_analysis_active:true,
    motion_health_verified:true,privacy_adb_port_closed_recently:true,age_seconds:15},
   manual_binding:{state:'current',revision:48,decisions:48,
    reported_bound_at_decision:0,without_reported_binding:48,
    current_source_binding_verified:true,live_write_binding_verified:true}
  }
 };
}
const recent=contract(report(30));
assert.equal(recent.aggregate_stale,false);
assert.equal(recent.infrastructure.status,'current');
assert(recent.infrastructure.age_seconds>=40,'component age includes report transit');
assert.equal(recent.pipeline_summary.s3.motion_health_verified,true);
const expired=contract(report(360));
assert.equal(expired.aggregate_stale,true);
assert.equal(expired.infrastructure.status,'stale');
assert(expired.infrastructure.age_seconds>=370,'stale component age cannot stay frozen at old reported 15 seconds');
assert.equal(expired.evidence.status,'stale');
assert.equal(expired.saved_timing.status,'stale');
assert.equal(expired.pipeline_summary.manual_binding.without_reported_binding,48);
const future=report(-600);
assert.equal(contract(future),null);
const malformed=report(15);
malformed.observed_at_utc='2026-10-21';
assert.equal(contract(malformed),null);
const missing=report(15);
delete missing.components.saved_timing;
assert.equal(contract(missing),null);
console.log('V31_AGGREGATE_FRESHNESS_CONTRACTS_PASS 13');
