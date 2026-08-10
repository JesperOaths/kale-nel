#!/usr/bin/env node
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number(version.match(/^v(\d+)$/)?.[1]||0);
const route=fs.readFileSync('gejast-mobile-route-fixes-v583.js','utf8');
const rad=fs.readFileSync('rad.html','utf8');
const failures=[];
if(n<786) failures.push('v786 Rad live-overflow guard requires VERSION >= v786');
if(route.includes('.wheel-box{width:min(96vw,460px)')) failures.push('Rad mobile runtime must not size wheel-box from viewport width');
for(const marker of ['.wheel-box{width:min(100%,460px) !important;max-width:100% !important;box-sizing:border-box !important;',"case 'rad.html': patchRad(); break;"]) if(!route.includes(marker)) failures.push('Rad mobile runtime marker missing: '+marker);
for(const marker of ['.layout{grid-template-columns:minmax(0,1fr)}','.panel{min-width:0}.wheel-box{width:min(100%,460px)}']) if(!rad.includes(marker)) failures.push('Rad page containment marker missing: '+marker);
if(failures.length){console.error('v786 Rad live-overflow regression failed:');for(const f of failures)console.error('- '+f);process.exit(1);}
console.log('v786 Rad live-overflow regression PASS: Rad runtime uses container width and v785 local containment is preserved.');
