#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
const state=JSON.parse(fs.readFileSync('release-certification.json','utf8'));
assert.equal(state.schema_version,1,'unsupported release certification schema');
assert.equal(state.current_version,version,'release certification state must track root VERSION');
assert(['REVALIDATION_REQUIRED','PASS'].includes(state.status),'invalid release certification state');
if(state.status==='PASS'){
  assert(fs.existsSync('final-acceptance-v793.json'),'PASS requires final-acceptance-v793.json');
  const final=JSON.parse(fs.readFileSync('final-acceptance-v793.json','utf8'));
  assert.equal(final.site_version,version,'final acceptance must match current VERSION');
  assert.equal(final.status,'PASS','current final acceptance must be PASS');
}
console.log('Release certification state:',state.current_version,state.status);
