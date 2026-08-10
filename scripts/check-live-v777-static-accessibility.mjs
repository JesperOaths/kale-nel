#!/usr/bin/env node
import assert from 'node:assert/strict';

const base='https://kalenel.nl';
const stamp=Date.now();
async function get(path){
  const r=await fetch(`${base}/${path}?proof=${stamp}`,{redirect:'follow',headers:{'cache-control':'no-cache','pragma':'no-cache'}});
  const text=await r.text();
  console.log(`${path}: HTTP ${r.status}`);
  assert.equal(r.status,200,`${path} must return 200`);
  return text;
}
assert.equal((await get('VERSION')).trim(),'v777');
const checks={
  'boerenbridge.html':['for="playerCountInput"','for="dealerInput"'],
  'despimarkt_create.html':['for="titleInput"','for="descriptionInput"','for="closeAtInput"'],
  'despimarkt_debts.html':['for="targetInput"','for="amountInput"','for="reasonInput"'],
  'drinks_speed.html':['id="speedSeconds" aria-label="Tijd in seconden"'],
  'drinks_speed_stats.html':['id="playerSelect" aria-label="Speler"'],
  'invite.html':['for="inviteNote"','for="inviteOutput"'],
  'klaverjas_live.html':['for="scoreA"','for="scoreB"','for="roundNo"','for="note"'],
  'klaverjas_online.html':['id="finishMode" aria-label="Eindmodus"','id="codeInput" aria-label="Roomcode"'],
  'klaverjas_room.html':['id="finishMode" aria-label="Eindmodus"','id="codeInput" aria-label="Roomcode"'],
  'match_control.html':['id="payloadInput" aria-label="Wedstrijdgegevens JSON"'],
  'match_swap.html':['id="scopeFilter" aria-label="Groep"','id="editPayload" aria-label="Wedstrijdgegevens JSON"'],
  'my_profile.html':['for="displayNameInput"','for="avatarInput"'],
  'paardenrace.html':['for="roomCodeInput"','for="suitInput"','for="wagerInput"'],
  'pikken.html':['for="pkPenaltyMode"','id="pkBidCount" aria-label="Aantal dobbelstenen in bod"','id="pkBidFace" aria-label="Waarde van bod"'],
  'pikken_live.html':['id="bidSelect" aria-label="Bod"'],
  'rad.html':['for="nomineeSelect"'],
  'scorer.html':['id="inputW" aria-label="Score Wij"','id="inputZ" aria-label="Score Zij"','for="playerW1"','for="playerZ2"'],
  'toepen.html':['for="winner"','for="stake"','for="playerCount"','for="dealer"']
};
let markerCount=0;
for(const [file,markers] of Object.entries(checks)){
  const html=await get(file);
  assert.match(html,/GEJAST_PAGE_VERSION='v777'/,`${file} must serve v777 page marker`);
  for(const marker of markers){assert.ok(html.includes(marker),`${file} missing live accessibility marker ${marker}`);markerCount++;}
}
assert.equal(Object.keys(checks).length,18);
assert.ok(markerCount>=40);
console.log(`LIVE_V777_STATIC_ACCESSIBILITY=PASS pages=${Object.keys(checks).length} markers=${markerCount}`);
