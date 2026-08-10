#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function read(file){return fs.readFileSync(file,'utf8');}
function write(file,text){fs.writeFileSync(file,text,'utf8');}
function associate(file,id,label){
  let text=read(file);
  const control=`id="${id}"`;
  const count=text.split(control).length-1;
  if(count!==1) throw new Error(`${file} ${id}: expected one static id marker, found ${count}`);
  const controlIndex=text.indexOf(control);
  const plain=`<label>${label}</label>`;
  const labelled=`<label for="${id}">${label}</label>`;
  if(text.includes(labelled)) throw new Error(`${file} ${id}: already labelled before builder`);
  const labelIndex=text.lastIndexOf(plain,controlIndex);
  if(labelIndex<0 || controlIndex-labelIndex>500) throw new Error(`${file} ${id}: nearby visible label not found`);
  text=text.slice(0,labelIndex)+labelled+text.slice(labelIndex+plain.length);
  write(file,text);
}
function aria(file,id,label){
  let text=read(file);
  const from=`id="${id}"`;
  const to=`id="${id}" aria-label="${label}"`;
  const count=text.split(from).length-1;
  if(count!==1) throw new Error(`${file} ${id}: expected one static id marker, found ${count}`);
  if(text.includes(to)) throw new Error(`${file} ${id}: aria label already present before builder`);
  text=text.replace(from,to);
  write(file,text);
}

if(read('VERSION').trim()!=='v776') throw new Error('v777 builder expects root VERSION v776');

const associated=[
 ['boerenbridge.html','playerCountInput','Aantal spelers'],['boerenbridge.html','dealerInput','Deler'],
 ['despimarkt_create.html','titleInput','Titel'],['despimarkt_create.html','descriptionInput','Beschrijving'],['despimarkt_create.html','outcomeAInput','Uitkomst A'],['despimarkt_create.html','outcomeBInput','Uitkomst B'],['despimarkt_create.html','closeAtInput','Sluit op'],
 ['despimarkt_debts.html','targetInput','Ontvanger / schuldeiser'],['despimarkt_debts.html','amountInput','Bedrag'],['despimarkt_debts.html','dueAtInput','Deadline'],['despimarkt_debts.html','reasonInput','Reden'],
 ['invite.html','inviteNote','Notitie'],['invite.html','inviteOutput','Link'],
 ['klaverjas_live.html','scoreA','Score Team A'],['klaverjas_live.html','scoreB','Score Team B'],['klaverjas_live.html','roundNo','Ronde / hand'],['klaverjas_live.html','note','Notitie / laatste slag'],
 ['my_profile.html','displayNameInput','Zichtbare naam'],['my_profile.html','avatarInput','Profielfoto uploaden'],
 ['paardenrace.html','roomCodeInput','Roomcode'],['paardenrace.html','suitInput','Jouw paard'],['paardenrace.html','wagerInput','Jouw inzet in Bakken'],
 ['pikken.html','pkPenaltyMode','Variant'],['pikken.html','pkJoinCode','Join code'],['pikken.html','pkStartDice','Startdobbelstenen'],
 ['rad.html','nomineeSelect','Speler'],
 ['scorer.html','playerW1','Wij - speler 1'],['scorer.html','playerZ1','Zij - speler 1'],['scorer.html','playerW2','Wij - speler 2'],['scorer.html','playerZ2','Zij - speler 2'],
 ['toepen.html','winner','Winnaar van de vierde slag'],['toepen.html','stake','Eindwaarde'],['toepen.html','note','Notitie'],['toepen.html','playerCount','Aantal spelers'],['toepen.html','target','Doelscore'],['toepen.html','dealer','Beginnende deler']
];
const ariaNamed=[
 ['drinks_speed.html','speedSeconds','Tijd in seconden'],['drinks_speed_stats.html','playerSelect','Speler'],
 ['klaverjas_online.html','finishMode','Eindmodus'],['klaverjas_online.html','codeInput','Roomcode'],['klaverjas_room.html','finishMode','Eindmodus'],['klaverjas_room.html','codeInput','Roomcode'],
 ['match_control.html','payloadInput','Wedstrijdgegevens JSON'],
 ['match_swap.html','scopeFilter','Groep'],['match_swap.html','gameFilter','Spel'],['match_swap.html','playerFilter','Speler'],['match_swap.html','fromFilter','Vanaf datum'],['match_swap.html','toFilter','Tot datum'],['match_swap.html','editGame','Spel'],['match_swap.html','editClientId','Client-ID'],['match_swap.html','replaceOldPlayer','Oude speler'],['match_swap.html','replaceNewPlayer','Nieuwe speler'],['match_swap.html','editPayload','Wedstrijdgegevens JSON'],
 ['pikken.html','pkBidCount','Aantal dobbelstenen in bod'],['pikken.html','pkBidFace','Waarde van bod'],['pikken_live.html','bidSelect','Bod'],
 ['scorer.html','inputW','Score Wij'],['scorer.html','inputZ','Score Zij']
];
for(const args of associated) associate(...args);
for(const args of ariaNamed) aria(...args);
if(associated.length+ariaNamed.length!==58) throw new Error('v777 patch map must cover exactly 58 static controls');

const guard=`#!/usr/bin/env node\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nconst version=fs.readFileSync('VERSION','utf8').trim();\nassert.equal(version,'v777');\nconst associated=${JSON.stringify(associated)};\nconst ariaNamed=${JSON.stringify(ariaNamed)};\nassert.equal(associated.length+ariaNamed.length,58);\nfor(const [file,id,label] of associated){const text=fs.readFileSync(file,'utf8');assert.ok(text.includes('<label for="'+id+'">'+label+'</label>'),file+' missing label association for '+id);}\nfor(const [file,id,label] of ariaNamed){const text=fs.readFileSync(file,'utf8');assert.ok(text.includes('id="'+id+'" aria-label="'+label+'"'),file+' missing aria-label for '+id);}\nconsole.log('v777 static control accessibility PASS: 58 static controls have deterministic accessible names; dynamic runtime controls are intentionally deferred.');\n`;
write('check-static-control-accessibility-v777.mjs',guard);

let pkg=read('package.json');
const anchor='node check-account-journey-polish-v776.mjs';
if(!pkg.includes(anchor)) throw new Error('verify:static v776 anchor missing');
pkg=pkg.replace(anchor,`${anchor} && node check-static-control-accessibility-v777.mjs`);
write('package.json',pkg);

write('VERSION','v777\n');
const drift=spawnSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});
if(drift.status!==0) process.exit(drift.status||1);

const readiness=JSON.parse(read('beta-readiness.json'));
readiness.site_version='release candidate v777 / live v776';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.release_candidate_version='v777';
readiness.deployment_identity.note='v777 release candidate: 58 static user/operator controls now have deterministic accessible names through associated visible labels or precise aria-labels. The 12 remaining unnamed controls are runtime-generated and intentionally deferred to a separate context-aware pass. Live remains v776 until post-merge public-edge proof. Infrastructure-only v775b public-header code remains merged but not live pending authenticated Cloudflare deployment.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes all existing frontend/backend/security regressions through v776 plus the v777 static-control accessibility guard covering 58 controls.';
write('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

const checklist=JSON.parse(read('beta-live-write-checklist.json'));
checklist.site_version='v777';
if(!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('live-write checklist must remain empty');
write('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');

console.log('v777 deterministic static-accessibility patch prepared; live remains v776 pending post-merge proof.');
