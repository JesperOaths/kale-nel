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

if(read('VERSION').trim()!=='v780') throw new Error('v781 builder expects root VERSION v780');
if(!fs.existsSync('check-mobile-touch-runtime-v781.mjs')) throw new Error('permanent v781 guard missing');

replaceOnce('drinks.html',
  "let latestPageData=null, latestStatsData=null, latestTop5Data=null, latestDashboardData=null, currentLadderKey='today_units', currentSpeedType='', lastPosition=null, loadToken=0;",
  "let latestPageData=null, latestStatsData=null, latestTop5Data=null, latestDashboardData=null, currentLadderKey='today_units', currentSpeedType='', lastPosition=null, loadToken=0, lastStatsLoadedAt=0, statsLoadPromise=null, statsLoadScheduled=false;",
  'declare Drinks stats queue state');
replaceOnce('drinks.html',
  '<select id="speedTypeSelect" class="select-field" aria-label="Kies dranktype" style="margin-top:8px"></select>',
  '<select id="speedTypeSelect" class="select-field" aria-label="Kies dranktype" style="margin-top:8px;width:100%;min-height:44px;border:1px solid rgba(17,17,17,.12);border-radius:14px;padding:11px 12px;background:#fff;color:var(--ink);font:inherit"></select>',
  'touch-size Drinks speed selector');

replaceOnce('drinks-verify-float.js',
  "box.id = 'globalDrinksVerifyFloat';",
  "box.id = 'globalDrinksVerifyFloat';\r\n    box.setAttribute('aria-hidden','true');\r\n    box.setAttribute('inert','');",
  'initial verification float inert state');
replaceOnce('drinks-verify-float.js',
  "function showBox(){ const box = ensureBox(); box.classList.remove('show'); void box.offsetWidth; requestAnimationFrame(()=> box.classList.add('show')); }",
  "function showBox(){ const box = ensureBox(); box.removeAttribute('inert'); box.setAttribute('aria-hidden','false'); box.classList.remove('show'); void box.offsetWidth; requestAnimationFrame(()=> box.classList.add('show')); }",
  'verification float show state');
replaceOnce('drinks-verify-float.js',
  "function hideBox(){ const box = document.getElementById('globalDrinksVerifyFloat'); if (box) box.classList.remove('show'); activePromptId = null; activePromptKind = null; activePromptItem = null; activePromptSeenAt = 0; activePromptGraceUntil = 0; }",
  "function hideBox(){ const box = document.getElementById('globalDrinksVerifyFloat'); if (box) { box.classList.remove('show'); box.setAttribute('aria-hidden','true'); box.setAttribute('inert',''); } activePromptId = null; activePromptKind = null; activePromptItem = null; activePromptSeenAt = 0; activePromptGraceUntil = 0; }",
  'verification float hidden inert state');

for(const href of ['./beerpong_vault.html','./index.html']){
  replaceOnce('beerpong.html',
    `<a href="${href}" style="font-weight:800;color:#554e43;text-decoration:none">`,
    `<a href="${href}" style="display:inline-flex;align-items:center;min-height:32px;padding:4px 2px;font-weight:800;color:#554e43;text-decoration:none">`,
    `touch-size Beerpong link ${href}`);
}
for(const id of ['pussycupA','pussycupB']){
  replaceOnce('beerpong.html',
    `<input id="${id}" type="checkbox" style="width:18px;height:18px">`,
    `<input id="${id}" type="checkbox" style="width:24px;height:24px;flex:0 0 auto">`,
    `touch-size ${id}`);
}

let pkg=read('package.json');
const anchor='node check-rendered-accessibility-v780.mjs';
if(!pkg.includes(anchor)) throw new Error('verify:static v780 anchor missing');
if(pkg.includes('node check-mobile-touch-runtime-v781.mjs')) throw new Error('v781 guard already wired');
pkg=pkg.replace(anchor,`${anchor} && node check-mobile-touch-runtime-v781.mjs`);
write('package.json',pkg);

write('VERSION','v781\n');
const drift=spawnSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});
if(drift.status!==0) process.exit(drift.status||1);

const readiness=JSON.parse(read('beta-readiness.json'));
readiness.site_version='release candidate v781 / live v780';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.release_candidate_version='v781';
readiness.deployment_identity.note='v781 release candidate: isolated no-write mobile Chromium audit covered 24 routes and intercepted 201 non-GET requests. High-confidence findings are fixed narrowly: Drinks stats queue state is explicitly declared (removing the live lastStatsLoadedAt ReferenceError), the Drinks speed-type selector has a 44px touch surface, the off-canvas verification float is aria-hidden/inert while closed, and Beerpong top navigation/Pussycup controls have >=24px touch targets. Boerenbridge\'s wide special selects remain intentionally inside its horizontally scrollable score-table owner, and Toepen rule checkboxes remain inside padded label-pill targets. Live remains v780 until post-merge public-edge proof.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes all existing frontend/backend/security/accessibility regressions through v781. The accessibility naming backlog remains closed 70/70: 58 static controls are protected by v777 and 12 runtime-generated controls by v778; v779 keyboard/focus and v780 rendered Chromium/axe zero-violation baselines remain protected. v781 adds the mobile/runtime baseline for declared Drinks stats queue state, touch-sized Drinks/Beerpong controls and an inert hidden global verification float.';
write('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

const checklist=JSON.parse(read('beta-live-write-checklist.json'));
checklist.site_version='v781';
if(!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('live-write checklist must remain empty');
write('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');
console.log('v781 mobile/runtime patch prepared; live remains v780 pending post-merge proof.');
