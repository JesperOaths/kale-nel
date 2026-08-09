#!/usr/bin/env node
import fs from 'node:fs';

const readinessPath='beta-readiness.json';
const readiness=JSON.parse(fs.readFileSync(readinessPath,'utf8'));
readiness.version=5;
const badge=(readiness.beta_gaps||[]).find((item)=>item.id==='badge_awards');
if(!badge) throw new Error('badge_awards readiness item missing');
Object.assign(badge,{
  status:'verified_complete',
  proof_needed:'Complete: badges are derived from existing player snapshots by deterministic BADGE_RULES/evaluateBadgeKeys rather than granted by a separate badge-award mutation engine. Player/profile rendering uses the same evaluator/progress model.',
  next_action:'No badge-trigger mutation proof is required. Keep threshold/evaluator/profile-integration regression current when badge rules or snapshot fields change.',
  latest_probe:'v771b executable proof covers below/at-threshold behavior for Starter, Groeier, Klaverkoning, IJskoud, Verifieermeester and Pussycup-prins, verifies attained progress, and confirms player.html feeds buildBadgeSnapshot() into GEJAST_BADGE_PROGRESS.getBadgeProgressList().'
});
fs.writeFileSync(readinessPath,JSON.stringify(readiness,null,2)+'\n');

const checklistPath='beta-live-write-checklist.json';
const checklist=JSON.parse(fs.readFileSync(checklistPath,'utf8'));
checklist.version=5;
checklist.items=(checklist.items||[]).filter((item)=>item.id!=='badge_awards');
fs.writeFileSync(checklistPath,JSON.stringify(checklist,null,2)+'\n');

const safety=`#!/usr/bin/env node
import fs from 'node:fs';

const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const drinks=fs.readFileSync('check-beta-live-write-drinks.mjs','utf8');
const failures=[];
const permissionIds=(readiness.beta_gaps||[]).filter((item)=>item.status==='needs_permission').map((item)=>item.id).sort();
const checklistIds=(checklist.items||[]).map((item)=>item.id).sort();
const expected=['admin_mutations','drinks_create_verify_reject'];
if(checklist.site_version!=='v770') failures.push('live-write checklist must target v770');
if(JSON.stringify(permissionIds)!==JSON.stringify(expected)) failures.push('readiness must expose exactly drinks/admin permission gaps');
if(JSON.stringify(checklistIds)!==JSON.stringify(expected)) failures.push('live-write checklist must exactly match drinks/admin permission gaps');
for(const id of ['profile_editing','secondary_game_save_flows','real_device_push_delivery','badge_awards']) if(checklistIds.includes(id)) failures.push(id+' must not remain armed');
const drinksItem=checklist.items.find((item)=>item.id==='drinks_create_verify_reject');
if(drinksItem?.command!=='npm run beta:write:drinks') failures.push('drinks must use the single dedicated drinks harness');
const adminItem=checklist.items.find((item)=>item.id==='admin_mutations');
if(!adminItem) failures.push('admin_mutations missing'); else if(adminItem.command) failures.push('admin_mutations must remain unarmed until target-specific proof exists');
if(!drinks.includes('process.env[approvalName] === approvalValue')) failures.push('drinks harness must retain explicit approval gate');
if(!drinks.includes('rejectDrinkEvent')) failures.push('drinks harness must retain explicit rejection proof');
if(!drinks.includes('cancelDrinkEvent')) failures.push('drinks harness must retain best-effort pending cleanup');
if(failures.length){console.error('Live-write beta safety v771b failed:');failures.forEach((failure)=>console.error('- '+failure));process.exit(1);}
console.log('Live-write beta safety v771b PASS: only Drinks is armed; admin remains unarmed; derived badges require no mutation harness.');
`;
fs.writeFileSync('check-live-write-safety-v770e.mjs',safety,'utf8');
console.log('Applied v771b derived-badge readiness consolidation.');
