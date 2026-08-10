#!/usr/bin/env node
import assert from 'node:assert/strict';

const base='https://kalenel.nl';
const stamp=Date.now();
async function request(path){
  const url=`${base}/${path}${path.includes('?')?'&':'?'}proof=${stamp}`;
  const r=await fetch(url,{redirect:'follow',headers:{'cache-control':'no-cache','pragma':'no-cache'}});
  const text=await r.text();
  console.log(`${path}: HTTP ${r.status} -> ${r.url}`);
  return {r,text};
}
async function publicText(path){
  const {r,text}=await request(path);
  assert.equal(r.status,200,`${path} must return 200`);
  return text;
}

assert.equal((await publicText('VERSION')).trim(),'v778','public VERSION must be v778');

const boerenbridge=await publicText('boerenbridge.html');
assert.match(boerenbridge,/GEJAST_PAGE_VERSION='v778'/);
for(const marker of [
  "setupSelect?.setAttribute('aria-label',`Speler ${i+1}`)",
  "setAttribute('aria-label',`Speciale ronde ${Number(sel.getAttribute('data-special-index'))+1}`)",
  "el.setAttribute('aria-label',`Bod voor ${playerName}`)",
  "setAttribute('aria-label',`Gewonnen slagen voor ${playerName}`)",
  "setAttribute('aria-label',`Punten voor ${playerName}`)"
]) assert.ok(boerenbridge.includes(marker),`Boerenbridge live source missing ${marker}`);
assert.ok(!boerenbridge.includes('aria-label="${playerName}'), 'Boerenbridge must not interpolate playerName directly into aria-label HTML');

const paardenrace=await publicText('paardenrace_live.html');
assert.match(paardenrace,/GEJAST_PAGE_VERSION='v778'/);
assert.ok(paardenrace.includes("input.setAttribute('aria-label',`Bakken nomineren voor ${name}`)"));
assert.ok(!paardenrace.includes('aria-label="${name}'));

const toepen=await publicText('toepen.html');
assert.match(toepen,/GEJAST_PAGE_VERSION='v778'/);
for(const marker of [
  "s.setAttribute('aria-label',`Speler ${i+1}`)",
  "a.setAttribute('aria-label',`Actie voor ${playerName}`)",
  "setAttribute('aria-label',`Past op waarde voor ${playerName}`)"
]) assert.ok(toepen.includes(marker),`Toepen live source missing ${marker}`);
assert.ok(!toepen.includes('aria-label="${playerName}'));

const drinks=await request('drinks_admin.html');
assert.equal(drinks.r.status,401,'drinks_admin.html must remain protected and terminate 401 unauthenticated');
assert.equal(new URL(drinks.r.url).hostname,'admin.kalenel.nl','drinks_admin.html must terminate on protected admin host');

// Representative v777 static fixes must remain served after v778.
const staticChecks={
  'despimarkt_create.html':['for="titleInput"','for="closeAtInput"'],
  'klaverjas_live.html':['for="scoreA"','for="roundNo"'],
  'pikken.html':['for="pkPenaltyMode"','id="pkBidCount" aria-label="Aantal dobbelstenen in bod"'],
  'scorer.html':['id="inputW" aria-label="Score Wij"','for="playerW1"']
};
for(const [file,markers] of Object.entries(staticChecks)){
  const html=await publicText(file);
  assert.match(html,/GEJAST_PAGE_VERSION='v778'/,`${file} must serve v778 marker`);
  for(const marker of markers) assert.ok(html.includes(marker),`${file} lost static accessibility marker ${marker}`);
}

console.log('LIVE_V778_ACCESSIBILITY=PASS: dynamic runtime naming is deployed, protected Drinks admin remains bounded, and representative v777 static labels persist.');
