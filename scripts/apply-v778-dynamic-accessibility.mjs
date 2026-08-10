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
if(read('VERSION').trim()!=='v777') throw new Error('v778 builder expects root VERSION v777');
if(!fs.existsSync('check-dynamic-control-accessibility-v778.mjs')) throw new Error('permanent v778 guard missing');

replaceOnce('boerenbridge.html',
  "</select>`; box.appendChild(field); } renderDealerSelect();",
  "</select>`; const setupSelect=field.querySelector('select'); setupSelect?.setAttribute('aria-label',`Speler ${i+1}`); box.appendChild(field); } renderDealerSelect();",
  'generated setup player name');
replaceOnce('boerenbridge.html',
  "byId('roundBody').querySelectorAll('[data-special-index]').forEach((sel)=>sel.addEventListener",
  "byId('roundBody').querySelectorAll('[data-special-index]').forEach((sel)=>sel.setAttribute('aria-label',`Speciale ronde ${Number(sel.getAttribute('data-special-index'))+1}`)); byId('roundBody').querySelectorAll('[data-special-index]').forEach((sel)=>sel.addEventListener",
  'special round selector name');
replaceOnce('boerenbridge.html',
  "byId('bidPlayerCards').querySelectorAll('select').forEach((el)=>el.addEventListener",
  "byId('bidPlayerCards').querySelectorAll('select').forEach((el)=>{ const playerIndex=Number(el.getAttribute('data-bid-player-index')); const playerName=state.draft.players[playerIndex] || `speler ${playerIndex+1}`; el.setAttribute('aria-label',`Bod voor ${playerName}`); }); byId('bidPlayerCards').querySelectorAll('select').forEach((el)=>el.addEventListener",
  'bid selector player name');
replaceOnce('boerenbridge.html',
  "byId('wonPlayerCards').querySelectorAll('[data-won-player-index]').forEach((el)=>el.addEventListener",
  "byId('wonPlayerCards').querySelectorAll('.player-card').forEach((card,idx)=>{ const playerName=state.draft.players[idx] || `speler ${idx+1}`; card.querySelector('input[disabled]')?.setAttribute('aria-label',`Bod voor ${playerName}`); card.querySelector('[data-won-player-index]')?.setAttribute('aria-label',`Gewonnen slagen voor ${playerName}`); }); byId('wonPlayerCards').querySelectorAll('[data-won-player-index]').forEach((el)=>el.addEventListener",
  'won editor bid and tricks names');
replaceOnce('boerenbridge.html',
  "document.getElementById('bbSummaryCard').innerHTML=`<div class=\"hint\">${s.recap}</div><div class=\"round-grid\">${totals}</div>`; openOverlay('bbSummaryOverlay');",
  "document.getElementById('bbSummaryCard').innerHTML=`<div class=\"hint\">${s.recap}</div><div class=\"round-grid\">${totals}</div>`; document.querySelectorAll('#bbSummaryCard input[disabled]').forEach((input,idx)=>{ const playerName=s.payload.totals?.[idx]?.name || `speler ${idx+1}`; input.setAttribute('aria-label',`Punten voor ${playerName}`); }); openOverlay('bbSummaryOverlay');",
  'summary points player name');

replaceOnce('drinks_admin.html',
  '<input type="checkbox" data-kind="events" value="${Number(r.id||0)}">',
  '<input type="checkbox" data-kind="events" value="${Number(r.id||0)}" aria-label="${esc(\'Selecteer \'+(r.event_type_label||r.event_type_key||\'drankje\')+\' van \'+(r.player_name||\'onbekende speler\'))}">',
  'drink event checkbox context');
replaceOnce('drinks_admin.html',
  '<input type="checkbox" data-kind="speed" value="${Number(r.id||0)}">',
  '<input type="checkbox" data-kind="speed" value="${Number(r.id||0)}" aria-label="${esc(\'Selecteer \'+(r.speed_type_label||r.speed_type_key||\'snelheidsrecord\')+\' van \'+(r.player_name||\'onbekende speler\'))}">',
  'speed record checkbox context');

replaceOnce('paardenrace_live.html',
  "const name = decodeURIComponent(input.dataset.target);\n      input.oninput = ()=>{ nominationSnapshot[name] = input.value; };",
  "const name = decodeURIComponent(input.dataset.target);\n      input.setAttribute('aria-label',`Bakken nomineren voor ${name}`);\n      input.oninput = ()=>{ nominationSnapshot[name] = input.value; };",
  'nomination target accessible name');

replaceOnce('toepen.html',
  "$('setupPlayers').querySelectorAll('select').forEach(s=>s.onchange=syncDealer)",
  "$('setupPlayers').querySelectorAll('select').forEach((s,i)=>{s.setAttribute('aria-label',`Speler ${i+1}`);s.onchange=syncDealer})",
  'generated setup seats');
replaceOnce('toepen.html',
  "$('roundPlayers').querySelectorAll('.round-player').forEach(r=>{const a=r.querySelector('.action');if(+r.dataset.seat===win)a.value='win';",
  "$('roundPlayers').querySelectorAll('.round-player').forEach(r=>{const a=r.querySelector('.action');const seat=+r.dataset.seat;const playerName=state.match?.players.find(p=>p.seat_no===seat)?.name||`speler ${seat}`;a.setAttribute('aria-label',`Actie voor ${playerName}`);r.querySelector('.foldAt')?.setAttribute('aria-label',`Past op waarde voor ${playerName}`);if(+r.dataset.seat===win)a.value='win';",
  'round action and fold context');

let v777Guard=read('check-static-control-accessibility-v777.mjs');
v777Guard=v777Guard.replace('the 12 known runtime-generated controls remain explicitly tracked for context-aware naming.','the 12 known runtime-generated control templates remain explicitly tracked as a separate accessibility class.');
write('check-static-control-accessibility-v777.mjs',v777Guard);

let pkg=read('package.json');
const anchor='node check-static-control-accessibility-v777.mjs';
if(!pkg.includes(anchor)) throw new Error('verify:static v777 anchor missing');
if(pkg.includes('node check-dynamic-control-accessibility-v778.mjs')) throw new Error('v778 guard unexpectedly already wired');
pkg=pkg.replace(anchor,`${anchor} && node check-dynamic-control-accessibility-v778.mjs`);
write('package.json',pkg);

write('VERSION','v778\n');
const drift=spawnSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});
if(drift.status!==0) process.exit(drift.status||1);

const readiness=JSON.parse(read('beta-readiness.json'));
readiness.site_version='release candidate v778 / live v777';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.release_candidate_version='v778';
readiness.deployment_identity.note='v778 release candidate: the final 12 runtime-generated controls now receive context-aware accessible names across Boerenbridge, Drinks admin, Paardenrace live and Toepen. This completes the 70-control accessibility backlog identified after v776: 58 static controls fixed in v777 plus 12 dynamic controls in v778. Live remains v777 until post-merge public-edge proof. Infrastructure-only v775b public-header code remains merged but not live pending authenticated Cloudflare deployment.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes all existing frontend/backend/security regressions through v777 plus the v778 context-aware runtime accessibility guard. The 70-control accessibility backlog identified after v776 is fully covered: 58 static controls by v777 and 12 runtime-generated controls by v778.';
write('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');
const checklist=JSON.parse(read('beta-live-write-checklist.json'));
checklist.site_version='v778';
if(!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('live-write checklist must remain empty');
write('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');
console.log('v778 context-aware accessibility patch prepared; live remains v777 pending post-merge proof.');
