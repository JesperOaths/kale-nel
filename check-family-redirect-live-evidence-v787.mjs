#!/usr/bin/env node
import fs from 'node:fs';
const rootN=Number(fs.readFileSync('VERSION','utf8').trim().match(/^v(\d+)$/)?.[1]||0);
if(rootN<787){console.log('v787 live Family evidence guard pre-v787 skip');process.exit(0);}
const failures=[];
const readiness=fs.readFileSync('beta-readiness.json','utf8');
const doc=fs.readFileSync('FINALIZED_PROJECT_STATE.md','utf8');
const combined=readiness+'\n'+doc;
for(const token of ['2026-08-11','live v787','Firefox','WebKit','16','zero wrong /familie/ subresource requests','35-route','performance']) if(!combined.includes(token)) failures.push('durable v787 live evidence missing: '+token);
if(failures.length){console.error('v787 live Family evidence regression failed:');for(const f of failures) console.error('- '+f);process.exit(1);}
console.log('v787 live Family evidence PASS: public closure, Firefox/WebKit 16-case alias proof and zero wrong /familie/ requests remain durably recorded.');
