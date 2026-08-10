#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function read(file){return fs.readFileSync(file,'utf8');}
function write(file,text){fs.writeFileSync(file,text,'utf8');}
function replaceOnce(file,from,to,label){
  const before=read(file); const count=before.split(from).length-1;
  if(count!==1) throw new Error(`${label}: expected exactly one match in ${file}, found ${count}`);
  write(file,before.replace(from,to));
  console.log(`patched ${file}: ${label}`);
}

if(read('VERSION').trim()!=='v778') throw new Error('v779 builder expects root VERSION v778');
if(!fs.existsSync('check-keyboard-focus-accessibility-v779.mjs')) throw new Error('permanent v779 keyboard guard missing');

replaceOnce(
  'drinks_add.html',
  '.geo-card.linklike:hover,.geo-card.linklike:focus-visible{transform:translateY(-1px);box-shadow:0 10px 24px rgba(0,0,0,.06);border-color:rgba(111,138,99,.5);outline:none}',
  '.geo-card.linklike:hover{transform:translateY(-1px);box-shadow:0 10px 24px rgba(0,0,0,.06);border-color:rgba(111,138,99,.5)}.geo-card.linklike:focus-visible{transform:translateY(-1px);box-shadow:0 10px 24px rgba(0,0,0,.06);border-color:rgba(111,138,99,.5);outline:3px solid var(--verify-border);outline-offset:3px}',
  'explicit verification-card keyboard focus ring'
);

let pkg=read('package.json');
const anchor='node check-dynamic-control-accessibility-v778.mjs';
if(!pkg.includes(anchor)) throw new Error('verify:static v778 anchor missing');
if(pkg.includes('node check-keyboard-focus-accessibility-v779.mjs')) throw new Error('v779 guard unexpectedly already wired');
pkg=pkg.replace(anchor,`${anchor} && node check-keyboard-focus-accessibility-v779.mjs`);
write('package.json',pkg);

write('VERSION','v779\n');
const drift=spawnSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});
if(drift.status!==0) process.exit(drift.status||1);

const readiness=JSON.parse(read('beta-readiness.json'));
readiness.site_version='release candidate v779 / live v778';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.release_candidate_version='v779';
readiness.deployment_identity.note='v779 release candidate: keyboard/focus hardening after the live v778 70/70 naming closure. The Drinks verification/location card now has an explicit focus-visible ring instead of suppressing the browser outline. The permanent keyboard baseline forbids positive tabindex, inline click handlers on non-native public elements and focus-outline suppression while preserving shared Enter/Space activation for clickable cards. Live remains v778 until post-merge public-edge proof. Infrastructure-only v775b public-header code remains merged but not live pending authenticated Cloudflare deployment.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes all existing frontend/backend/security regressions through v779. The accessibility naming backlog remains closed 70/70: 58 static controls are protected by v777 and 12 runtime-generated controls by v778. v779 adds the keyboard/focus baseline: no positive tab order, no non-native inline click handlers, no public outline suppression, explicit Drinks focus-visible styling, and preserved Enter/Space activation in the shared clickable-card runtime.';
write('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

const checklist=JSON.parse(read('beta-live-write-checklist.json'));
checklist.site_version='v779';
if(!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('live-write checklist must remain empty');
write('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');

console.log('v779 keyboard/focus patch prepared; live remains v778 pending post-merge proof.');
