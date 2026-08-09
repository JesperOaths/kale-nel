#!/usr/bin/env node
import fs from 'node:fs';

const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const drinks=fs.readFileSync('check-beta-live-write-drinks.mjs','utf8');
const failures=[];
const permissionIds=(readiness.beta_gaps||[]).filter((item)=>item.status==='needs_permission').map((item)=>item.id).sort();
const checklistIds=(checklist.items||[]).map((item)=>item.id).sort();
const expected=['drinks_create_verify_reject'];
if(checklist.site_version!=='v771') failures.push('live-write checklist must target v771');
if(JSON.stringify(permissionIds)!==JSON.stringify(expected)) failures.push('readiness must expose exactly the Drinks permission gap');
if(JSON.stringify(checklistIds)!==JSON.stringify(expected)) failures.push('live-write checklist must contain exactly the Drinks permission gap');
for(const id of ['admin_mutations','profile_editing','secondary_game_save_flows','real_device_push_delivery','badge_awards']) if(checklistIds.includes(id)) failures.push(id+' must not remain armed');
const drinksItem=checklist.items.find((item)=>item.id==='drinks_create_verify_reject');
if(drinksItem?.command!=='npm run beta:write:drinks') failures.push('drinks must use the single dedicated drinks harness');
if(!drinks.includes('process.env[approvalName] === approvalValue')) failures.push('drinks harness must retain explicit approval gate');
if(!drinks.includes('rejectDrinkEvent')) failures.push('drinks harness must retain explicit rejection proof');
if(!drinks.includes('cancelDrinkEvent')) failures.push('drinks harness must retain best-effort pending cleanup');
if(failures.length){console.error('Live-write beta safety v771c failed:');failures.forEach((failure)=>console.error('- '+failure));process.exit(1);}
console.log('Live-write beta safety v771c PASS: Drinks verify/reject is the sole remaining permission-gated mutation proof.');
