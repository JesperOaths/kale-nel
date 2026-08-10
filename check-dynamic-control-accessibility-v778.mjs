#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\d+)$/)?.[1]||0);
assert.ok(versionNumber>=778,`v778 dynamic accessibility invariant requires frontend v778+, got ${version}`);
const sources=Object.fromEntries(['boerenbridge.html','drinks_admin.html','paardenrace_live.html','toepen.html'].map(f=>[f,fs.readFileSync(f,'utf8')]));
const checks=[
  ['boerenbridge.html',"setupSelect?.setAttribute('aria-label',`Speler ${i+1}`)"],
  ['boerenbridge.html',"setAttribute('aria-label',`Speciale ronde ${Number(sel.getAttribute('data-special-index'))+1}`)"],
  ['boerenbridge.html',"el.setAttribute('aria-label',`Bod voor ${playerName}`)"],
  ['boerenbridge.html',"input[disabled]')?.setAttribute('aria-label',`Bod voor ${playerName}`)"],
  ['boerenbridge.html',"[data-won-player-index]')?.setAttribute('aria-label',`Gewonnen slagen voor ${playerName}`)"],
  ['boerenbridge.html',"input.setAttribute('aria-label',`Punten voor ${playerName}`)"],
  ['drinks_admin.html','data-kind="events" value="${Number(r.id||0)}" aria-label="${esc('],
  ['drinks_admin.html','data-kind="speed" value="${Number(r.id||0)}" aria-label="${esc('],
  ['paardenrace_live.html',"input.setAttribute('aria-label',`Bakken nomineren voor ${name}`)"],
  ['toepen.html',"s.setAttribute('aria-label',`Speler ${i+1}`)"],
  ['toepen.html',"a.setAttribute('aria-label',`Actie voor ${playerName}`)"],
  ['toepen.html',"setAttribute('aria-label',`Past op waarde voor ${playerName}`)"]
];
assert.equal(checks.length,12);
for(const [file,marker] of checks) assert.ok(sources[file].includes(marker),file+' missing dynamic accessibility marker '+marker);
assert.match(sources['drinks_admin.html'],/Selecteer .*event_type_label[\s\S]* van .*player_name/);
assert.match(sources['drinks_admin.html'],/Selecteer .*speed_type_label[\s\S]* van .*player_name/);
console.log(`v778 dynamic control accessibility PASS at ${version}: all 12 runtime-generated control templates receive context-aware accessible names across Boerenbridge, Drinks admin, Paardenrace and Toepen.`);
