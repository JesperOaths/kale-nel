#!/usr/bin/env node
import fs from 'node:fs';

const readinessPath='beta-readiness.json';
const readiness=JSON.parse(fs.readFileSync(readinessPath,'utf8'));
readiness.version=4;
const gapById=new Map((readiness.beta_gaps||[]).map((item)=>[item.id,item]));

Object.assign(gapById.get('profile_editing'),{
  status:'verified_complete',
  proof_needed:'Complete: the v755m production proof exercised the real my_profile.html RPC contract with a valid own-profile display-name update, deterministic retry, exact restore, unchanged avatar length/hash after restore, and missing/invalid/stale session rejection before write.',
  next_action:'No further profile mutation proof is required unless get_my_profile_settings/update_my_profile_settings or the profile UI contract changes.',
  latest_probe:'v755m post-apply production proof: Bruis -> harmless temporary display name -> same-value retry -> exact restore to Bruis; app and database readback agreed, avatar length/hash matched the captured original, invalid marker residue was 0, and exposed RPC accepts no target player_id.'
});

Object.assign(gapById.get('secondary_game_save_flows'),{
  status:'verified_complete',
  proof_needed:'Complete for the active production surfaces: Klaverjas save/live is proven through v755r/v755s and v765-v769; Beerpong v755p proved valid save, owner/replay/cross-player guards and cleanup; Boerenbridge BRIDGE-02 proved valid save, replay, owner isolation and exact cleanup; active Rad spins are browser-local and do not call rad_log_* persistence RPCs.',
  next_action:'Do not create artificial secondary-game history. Keep the proven Klaverjas/Beerpong/Boerenbridge guards in regression. Rad self-drink outcomes remain covered by the Drinks workflow; the local target-nomination wording is handled as a frontend UX issue, not a missing backend save flow.',
  latest_probe:'v764/v755p/v755l-v755m matrix evidence plus current v770 rad.html inspection. Rad self outcomes call GEJAST_DRINKS_WORKFLOW.createDrinkEvent; target nomination only records local UI selection and no active rad_log_* call exists.'
});

const gameSurface=readiness.baseline_checks?.find((item)=>item.id==='game_surface');
if(gameSurface) gameSurface.evidence='Public game surfaces and guarded backend contracts pass. Existing controlled production proofs now cover the active Klaverjas, Beerpong and Boerenbridge persistence paths; Rad spin state is browser-local and its drink side effects route through the separately tracked Drinks workflow.';
fs.writeFileSync(readinessPath,JSON.stringify(readiness,null,2)+'\n');

const checklistPath='beta-live-write-checklist.json';
const checklist=JSON.parse(fs.readFileSync(checklistPath,'utf8'));
checklist.version=4;
checklist.credential_env=(checklist.credential_env||[]).filter((name)=>name!=='GEJAST_BETA_WRITE_TARGET');
const keep=new Set(['drinks_create_verify_reject','admin_mutations','badge_awards']);
checklist.items=(checklist.items||[]).filter((item)=>keep.has(item.id));
fs.writeFileSync(checklistPath,JSON.stringify(checklist,null,2)+'\n');

const packagePath='package.json';
const pkg=JSON.parse(fs.readFileSync(packagePath,'utf8'));
delete pkg.scripts['beta:write:secondary'];
delete pkg.scripts['beta:write:profile'];
pkg.scripts['verify:static']=String(pkg.scripts['verify:static']||'').replace(' && node check-profile-edit-harness-v770f.mjs','');
fs.writeFileSync(packagePath,JSON.stringify(pkg,null,2)+'\n');

const safety=`#!/usr/bin/env node\nimport fs from 'node:fs';\n\nconst checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));\nconst readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));\nconst drinks=fs.readFileSync('check-beta-live-write-drinks.mjs','utf8');\nconst failures=[];\nconst permissionIds=(readiness.beta_gaps||[]).filter((item)=>item.status==='needs_permission').map((item)=>item.id).sort();\nconst checklistIds=(checklist.items||[]).map((item)=>item.id).sort();\nconst expected=['admin_mutations','badge_awards','drinks_create_verify_reject'];\nif(checklist.site_version!=='v770') failures.push('live-write checklist must target v770');\nif(JSON.stringify(permissionIds)!==JSON.stringify(expected)) failures.push('readiness must expose exactly drinks/admin/badge permission gaps');\nif(JSON.stringify(checklistIds)!==JSON.stringify(expected)) failures.push('live-write checklist must exactly match drinks/admin/badge permission gaps');\nfor(const id of ['profile_editing','secondary_game_save_flows','real_device_push_delivery']) if(checklistIds.includes(id)) failures.push(id+' must not remain armed');\nconst drinksItem=checklist.items.find((item)=>item.id==='drinks_create_verify_reject');\nif(drinksItem?.command!=='npm run beta:write:drinks') failures.push('drinks must use the single dedicated drinks harness');\nfor(const id of ['admin_mutations','badge_awards']){const item=checklist.items.find((entry)=>entry.id===id);if(!item) failures.push(id+' missing'); else if(item.command) failures.push(id+' must remain unarmed until target-specific proof exists');}\nif(!drinks.includes('process.env[approvalName] === approvalValue')) failures.push('drinks harness must retain explicit approval gate');\nif(!drinks.includes('rejectDrinkEvent')) failures.push('drinks harness must retain explicit rejection proof');\nif(!drinks.includes('cancelDrinkEvent')) failures.push('drinks harness must retain best-effort pending cleanup');\nif(failures.length){console.error('Live-write beta safety v770h failed:');failures.forEach((failure)=>console.error('- '+failure));process.exit(1);}\nconsole.log('Live-write beta safety v770h PASS: only Drinks is armed; admin/badge remain unarmed; profile/secondary are retired from mutation testing.');\n`;
fs.writeFileSync('check-live-write-safety-v770e.mjs',safety,'utf8');

if(fs.existsSync('check-beta-live-write-secondary-games.mjs')) fs.unlinkSync('check-beta-live-write-secondary-games.mjs');
console.log('Applied v770h readiness evidence consolidation.');
