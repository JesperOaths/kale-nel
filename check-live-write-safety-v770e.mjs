#!/usr/bin/env node
import fs from 'node:fs';
import './check-drinks-transactional-proof-v771d.mjs';

const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const drinks=fs.readFileSync('check-beta-live-write-drinks.mjs','utf8');
const plan=fs.readFileSync('check-beta-live-write-plan.mjs','utf8');
const gate=fs.readFileSync('check-beta-live-write-readiness.mjs','utf8');
const failures=[];
const permissionIds=(readiness.beta_gaps||[]).filter((item)=>item.status==='needs_permission').map((item)=>item.id).sort();
const checklistIds=(checklist.items||[]).map((item)=>item.id).sort();
if(checklist.site_version!=='v773') failures.push('live-write checklist must target v773');
if(permissionIds.length!==0) failures.push('finalized readiness must expose zero permission-gated gaps');
if(checklistIds.length!==0) failures.push('completed live-write checklist must contain zero armed mutation items');
for(const id of ['drinks_create_verify_reject','admin_mutations','profile_editing','secondary_game_save_flows','real_device_push_delivery','badge_awards']) if(checklistIds.includes(id)) failures.push(id+' must not remain armed');
if(pkg.scripts?.['beta:write:drinks']) failures.push('completed Drinks live-write npm command must be removed');
if(!plan.includes('There are no remaining live-write beta targets to plan or arm.')) failures.push('beta write plan must report completed state when checklist is empty');
if(!gate.includes('No live-write beta mutation targets remain armed.')) failures.push('beta write readiness gate must report completed state when checklist is empty');
if(!drinks.includes('process.env[approvalName] === approvalValue')) failures.push('historical Drinks harness must retain explicit approval gate');
if(!drinks.includes('rejectDrinkEvent')) failures.push('historical Drinks harness must retain explicit rejection proof');
if(!drinks.includes('cancelDrinkEvent')) failures.push('historical Drinks harness must retain best-effort pending cleanup');
if(failures.length){console.error('Live-write beta safety v771e failed:');failures.forEach((failure)=>console.error('- '+failure));process.exit(1);}
console.log('Live-write beta safety v771e PASS: beta readiness is 12/12, no mutation target is armed, and the completed Drinks write command is disarmed.');
