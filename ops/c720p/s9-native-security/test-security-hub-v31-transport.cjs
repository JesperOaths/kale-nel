#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'security-hub-v31.js'),'utf8');
const a=src.indexOf(' function degradedSnapshot(last){');
const b=src.indexOf(' let lastGood=null;',a);
assert(a>0&&b>a,'degraded snapshot recovery source missing');
const degraded=vm.runInNewContext('('+src.slice(a,b).trim()+')');
assert.equal(degraded(null),null);
const last={
 aggregate_stale:false,aggregate_age_seconds:30,
 infrastructure:{status:'current',root_available_bytes:0,root_total_bytes:21*1073741824},
 evidence:{status:'current',recordings_indexed:300},
 saved_timing:{status:'unavailable',paired_recordings:null},
 pipeline_summary:{s3:{motion_health_verified:true},manual_binding:{live_write_binding_verified:true}}
};
const cached=degraded(last);
assert.equal(cached.report_transport_error,true);
assert.equal(cached.aggregate_stale,true);
assert(cached.aggregate_age_seconds>=301);
assert.equal(cached.infrastructure.status,'stale');
assert.equal(cached.infrastructure.root_available_bytes,0);
assert.equal(cached.evidence.status,'stale');
assert.equal(cached.saved_timing.status,'unavailable');
assert.equal(last.infrastructure.status,'current');
assert.equal(last.aggregate_stale,false);
assert.equal(cached.pipeline_summary,last.pipeline_summary,'retain provenance but renderer must mask old readiness');
assert.match(src,/lastGood=data;render\(data\)/);
assert.match(src,/render\(degradedSnapshot\(lastGood\)\)/);
assert.match(src,/if\(data.report_transport_error\)warnings.push\('Private health request failed/);
console.log('V31_FAILED_REFRESH_RETAINS_CRITICAL_AS_STALE_PASS 14');
