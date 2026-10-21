#!/usr/bin/env node
'use strict';
// Execute real V31 contract (not a copy) on aggregate observations.
// Validation-only. No network, authentication, camera or database changes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const js=fs.readFileSync(path.join(__dirname,'security-hub-v31.js'),'utf8');
const begin=js.indexOf(' const nonnegative=x=>');
const end=js.indexOf(' const known=x=>',begin);
assert.ok(begin>0&&end>begin);
const definitions=js.slice(begin,end);
const {contract}=vm.runInNewContext(definitions+'\n({contract})');
const now=Date.now();
const make=(age=1)=>({
  ok:true,
  schema_version:'security_component_health_v1',
  observed_at_utc:new Date(now-age*1000).toISOString(),
  components:{
    infrastructure:{
      status:'current',age_seconds:5,root_available_bytes:0,
      root_total_bytes:21*1073741824,
      ntp_synchronized:null,original_digest_mismatches:null
    },
    evidence:{status:'current',age_seconds:9},
    saved_timing:{status:'current',age_seconds:7}
  }
});
const fresh=contract(make(5));
assert.ok(fresh);
assert.equal(fresh.infrastructure.status,'current');
assert.equal(fresh.infrastructure.root_available_bytes,0);
assert.equal(fresh.infrastructure.ntp_synchronized,null);
assert.equal(fresh.infrastructure.original_digest_mismatches,null);
assert.equal(fresh.aggregate_stale,false);
const stale=contract(make(360));
assert.ok(stale);
assert.equal(stale.aggregate_stale,true);
assert.equal(stale.infrastructure.status,'stale');
assert.equal(stale.evidence.status,'stale');
assert.equal(stale.saved_timing.status,'stale');
assert.equal(contract(make(-185)),null,'future-dated aggregate refused');
const negative=make();
negative.components.infrastructure.root_available_bytes=-1;
assert.equal(contract(negative),null,'negative disk bytes rejected');
const impossible=make();
impossible.components.infrastructure.root_available_bytes=22*1073741824;
assert.equal(contract(impossible),null,'free>total bytes cannot look healthy');
const zeroTotal=make();
zeroTotal.components.infrastructure.root_total_bytes=0;
assert.equal(contract(zeroTotal),null,'zero-capacity filesystem rejected');
const huge=make();
huge.components.infrastructure.root_total_bytes=Number.MAX_SAFE_INTEGER+1;
assert.equal(contract(huge),null,'unsafe integer rejected');
const invalidStatus=make();
invalidStatus.components.infrastructure.status='healthy';
assert.equal(contract(invalidStatus),null,'unrecognized health state rejected');
const missing=make();
missing.components.evidence=null;
assert.equal(contract(missing),null,'missing evidence state rejected');
const noPipeline=make();
assert.equal(contract(noPipeline).pipeline_summary,undefined,'missing pipeline not invented');
console.log('V31_AGGREGATE_CONTRACT_REGRESSIONS_PASS 15');
