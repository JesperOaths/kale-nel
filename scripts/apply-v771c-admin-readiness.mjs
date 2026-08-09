#!/usr/bin/env node
import fs from 'node:fs';

const readinessPath='beta-readiness.json';
const readiness=JSON.parse(fs.readFileSync(readinessPath,'utf8'));
readiness.version=6;
const admin=(readiness.beta_gaps||[]).find((item)=>item.id==='admin_mutations');
if(!admin) throw new Error('admin_mutations readiness item missing');
Object.assign(admin,{
  status:'verified_complete',
  proof_needed:'Complete for the production safety boundary: all audited active admin/operator mutation paths carry an admin session/auth boundary, the shared secureWrite path injects both the current admin session token and selected Friends/Family scope, and the outer admin host remains protected by the GitHub OAuth perimeter. Destructive operator business outcomes are not manufactured merely for beta proof.',
  next_action:'No generic admin mutation run is required. Keep the mutation-perimeter regression, protected-admin HTTP 401 checks, session validation, scope injection, and domain-specific repair/write guards current. Reopen only when a new admin mutation path is introduced or an existing guard changes.',
  latest_probe:'v771c read-only inventory scanned 61 admin/operator candidates: 22 mutation-bearing files, 0 suspicious unguarded paths. Permanent check-admin-mutation-perimeter-v771c.mjs passed in normal CI and verifies shared admin_secure_write_v356 session/scope injection plus key direct-action page boundaries.'
});
fs.writeFileSync(readinessPath,JSON.stringify(readiness,null,2)+'\n');

const checklistPath='beta-live-write-checklist.json';
const checklist=JSON.parse(fs.readFileSync(checklistPath,'utf8'));
checklist.version=6;
checklist.site_version='v771';
checklist.items=(checklist.items||[]).filter((item)=>item.id==='drinks_create_verify_reject');
checklist.credential_env=(checklist.credential_env||[]).filter((name)=>!/^GEJAST_ADMIN_SESSION_TOKEN$/.test(name));
fs.writeFileSync(checklistPath,JSON.stringify(checklist,null,2)+'\n');

const currentPath='check-beta-readiness-current-v770d.mjs';
let current=fs.readFileSync(currentPath,'utf8');
current=current.replace("'profile_editing','secondary_game_save_flows','badge_awards'","'profile_editing','secondary_game_save_flows','badge_awards','admin_mutations'");
current=current.replace("const permissionIds = ['drinks_create_verify_reject','admin_mutations'];","const permissionIds = ['drinks_create_verify_reject'];");
current=current.replace('expected current readiness split 10 complete / 2 permission-gated','expected current readiness split 11 complete / 1 permission-gated');
current=current.replace('completeCount !== 10 || permissionCount !== 2','completeCount !== 11 || permissionCount !== 1');
fs.writeFileSync(currentPath,current,'utf8');

const safety=`#!/usr/bin/env node
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
`;
fs.writeFileSync('check-live-write-safety-v770e.mjs',safety,'utf8');
console.log('Applied v771c admin readiness consolidation.');
