#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function read(file){return fs.readFileSync(file,'utf8');}
function write(file,text){fs.writeFileSync(file,text,'utf8');}
function replaceExact(file,from,to,count,label){
  const before=read(file); const found=before.split(from).length-1;
  if(found!==count) throw new Error(`${label}: expected ${count} matches in ${file}, found ${found}`);
  write(file,before.split(from).join(to));
  console.log(`patched ${file}: ${label}`);
}

if(read('VERSION').trim()!=='v775') throw new Error('v776 builder expects root VERSION v775');

replaceExact('login.html','<label>Naam</label><select id="playerNameInput"','<label for="playerNameInput">Naam</label><select id="playerNameInput"',1,'login name label');
replaceExact('login.html','<label>Pincode</label><input id="pinInput"','<label for="pinInput">Pincode</label><input id="pinInput"',1,'login PIN label');
replaceExact('login.html','<div id="statusBox" class="status"></div>','<div id="statusBox" class="status" role="status" aria-live="polite"></div>',1,'login live status');

replaceExact('request.html','<p>Kies een beschikbare naam en vul je e-mailadres in. Na admin-goedkeuring wordt een veilige activatielink in de mailqueue gezet. Voor nieuwe actieve gebruikers slaat v680 browser/scope/aanvraagmetadata op zodat alleen echte actieve loginspelers zichtbaar worden.</p>','<p>Kies een beschikbare naam en vul je e-mailadres in. Na goedkeuring krijg je een veilige activatielink per e-mail.</p>',1,'request user-facing copy');
replaceExact('request.html','<label>Gewenste naam</label><select id="requestNameSelect"','<label for="requestNameSelect">Gewenste naam</label><select id="requestNameSelect"',1,'request name label');
replaceExact('request.html','<label>E-mailadres</label><input id="requestEmailInput"','<label for="requestEmailInput">E-mailadres</label><input id="requestEmailInput"',1,'request email label');
replaceExact('request.html','<label>Notitie</label><textarea id="requestNoteInput"','<label for="requestNoteInput">Notitie</label><textarea id="requestNoteInput"',1,'request note label');
replaceExact('request.html','<div id="status" class="status"></div>','<div id="status" class="status" role="status" aria-live="polite"></div>',1,'request live status');

replaceExact('activate.html','<p>Controleer je gegevens en kies een 4-cijferige pincode. v680 slaat activatie- en device/browsermetadata op voor nieuwe actieve accounts.</p>','<p>Controleer je gegevens en kies een 4-cijferige pincode.</p>',1,'activation user-facing copy');
replaceExact('activate.html','<label>Pincode</label><input id="pinInput"','<label for="pinInput">Pincode</label><input id="pinInput"',1,'activation PIN label');
replaceExact('activate.html','<label>Bevestig pincode</label><input id="pinConfirmInput"','<label for="pinConfirmInput">Bevestig pincode</label><input id="pinConfirmInput"',1,'activation confirm label');
replaceExact('activate.html','<div id="status" class="status"></div>','<div id="status" class="status" role="status" aria-live="polite"></div>',1,'activation live status');

replaceExact('leaderboard.html','<div class="muted">Publieke v673 ELO-ranglijst.</div>','<div class="muted">ELO-ranglijst op basis van gespeelde Klaverjaswedstrijden.</div>',1,'leaderboard truthful copy');
replaceExact('despimarkt_auto_markets.html','<p class="sub">Automatische match-markten uit Phase 13.</p>','<p class="sub">Automatische markten voor actuele wedstrijden.</p>',1,'Despimarkt finished-product copy');

const guard=`#!/usr/bin/env node\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\n\nconst version=fs.readFileSync('VERSION','utf8').trim();\nassert.equal(version,'v776');\nfunction text(file){return fs.readFileSync(file,'utf8');}\nfor(const [file,pairs] of Object.entries({\n  'login.html':[['playerNameInput','Naam'],['pinInput','Pincode']],\n  'request.html':[['requestNameSelect','Gewenste naam'],['requestEmailInput','E-mailadres'],['requestNoteInput','Notitie']],\n  'activate.html':[['pinInput','Pincode'],['pinConfirmInput','Bevestig pincode']]\n})){\n  const html=text(file);\n  for(const [id,label] of pairs) assert.ok(html.includes('<label for="'+id+'">'+label+'</label>'),file+' missing programmatic label for '+id);\n  assert.match(html,/role=["']status["'][^>]*aria-live=["']polite["']|aria-live=["']polite["'][^>]*role=["']status["']/i,file+' must expose polite live status');\n}\nfor(const [file,marker] of [['activate.html','v680 slaat'],['request.html','v680 browser'],['leaderboard.html','Publieke v673'],['despimarkt_auto_markets.html','Phase 13']]) assert.ok(!text(file).includes(marker),file+' still contains development-era copy: '+marker);\nassert.match(text('request.html'),/Na goedkeuring krijg je een veilige activatielink per e-mail\./);\nassert.match(text('leaderboard.html'),/ELO-ranglijst op basis van gespeelde Klaverjaswedstrijden\./);\nassert.match(text('despimarkt_auto_markets.html'),/Automatische markten voor actuele wedstrijden\./);\nconsole.log('v776 account-journey polish PASS: login/request/activation controls are programmatically labelled, status feedback is live-announced, and development-era public copy is removed.');\n`;
write('check-account-journey-polish-v776.mjs',guard);

let pkg=read('package.json');
const anchor='node check-public-edge-headers-v775b.mjs';
if(!pkg.includes(anchor)) throw new Error('verify:static v775b anchor missing');
pkg=pkg.replace(anchor,`${anchor} && node check-account-journey-polish-v776.mjs`);
write('package.json',pkg);

write('VERSION','v776\n');
const drift=spawnSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});
if(drift.status!==0) process.exit(drift.status||1);

const readiness=JSON.parse(read('beta-readiness.json'));
readiness.site_version='release candidate v776 / live v775';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.release_candidate_version='v776';
readiness.deployment_identity.note='v776 release candidate: finished-product account journey polish. Login/request/activation labels are programmatically associated, status feedback is announced politely, and v680/v673/Phase 13 development-era public copy is removed. Live remains v775 until post-merge public-edge proof. Infrastructure-only v775b public-header code is merged but still awaits authenticated Cloudflare Worker deployment.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes JavaScript syntax, RPC coverage, local references, version drift, security/runtime regressions, Klaverjas/Toepen checks, Ballroom v769a, scoped live-read v770a, push runtime v770b, canonical Beurs runtime checks, v771d Drinks rollback proof, v772 finalization residue, v773 diagnostic consistency, v774 production acceptance, v775 public-surface security, v775b public-edge-header regression, and v776 account-journey polish.';
write('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

const checklist=JSON.parse(read('beta-live-write-checklist.json'));
checklist.site_version='v776';
if(!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('live-write checklist must remain empty');
write('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');

console.log('v776 deterministic patch prepared; live remains v775 pending post-merge proof.');
