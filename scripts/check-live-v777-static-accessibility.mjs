#!/usr/bin/env node
import assert from 'node:assert/strict';

const base='https://kalenel.nl';
const stamp=Date.now();
async function request(path){
  const r=await fetch(`${base}/${path}?proof=${stamp}`,{redirect:'follow',headers:{'cache-control':'no-cache','pragma':'no-cache'}});
  const text=await r.text();
  console.log(`${path}: HTTP ${r.status} -> ${r.url}`);
  return {r,text};
}
async function getPublic(path){
  const {r,text}=await request(path);
  assert.equal(r.status,200,`${path} must return 200`);
  return text;
}
assert.equal((await getPublic('VERSION')).trim(),'v777');
const publicChecks={
  'boerenbridge.html':['for="playerCountInput"','for="dealerInput"'],
  'despimarkt_create.html':['for="titleInput"','for="descriptionInput"','for="closeAtInput"'],
  'despimarkt_debts.html':['for="targetInput"','for="amountInput"','for="reasonInput"'],
  'drinks_speed.html':['id="speedSeconds" aria-label="Tijd in seconden"'],
  'drinks_speed_stats.html':['id="playerSelect" aria-label="Speler"'],
  'invite.html':['for="inviteNote"','for="inviteOutput"'],
  'klaverjas_live.html':['for="scoreA"','for="scoreB"','for="roundNo"','for="note"'],
  'klaverjas_online.html':['id="finishMode" aria-label="Eindmodus"','id="codeInput" aria-label="Roomcode"'],
  'klaverjas_room.html':['id="finishMode" aria-label="Eindmodus"','id="codeInput" aria-label="Roomcode"'],
  'my_profile.html':['for="displayNameInput"','for="avatarInput"'],
  'paardenrace.html':['for="roomCodeInput"','for="suitInput"','for="wagerInput"'],
  'pikken.html':['for="pkPenaltyMode"','id="pkBidCount" aria-label="Aantal dobbelstenen in bod"','id="pkBidFace" aria-label="Waarde van bod"'],
  'pikken_live.html':['id="bidSelect" aria-label="Bod"'],
  'rad.html':['for="nomineeSelect"'],
  'scorer.html':['id="inputW" aria-label="Score Wij"','id="inputZ" aria-label="Score Zij"','for="playerW1"','for="playerZ2"'],
  'toepen.html':['for="winner"','for="stake"','for="playerCount"','for="dealer"']
};
let markerCount=0;
for(const [file,markers] of Object.entries(publicChecks)){
  const html=await getPublic(file);
  assert.match(html,/GEJAST_PAGE_VERSION='v777'/,`${file} must serve v777 page marker`);
  for(const marker of markers){assert.ok(html.includes(marker),`${file} missing live accessibility marker ${marker}`);markerCount++;}
}
const protectedPages=['match_control.html','match_swap.html'];
for(const file of protectedPages){
  const {r}=await request(file);
  assert.equal(r.status,401,`${file} must remain protected and terminate 401 unauthenticated`);
  assert.equal(new URL(r.url).hostname,'admin.kalenel.nl',`${file} must terminate on protected admin host`);
}
assert.equal(Object.keys(publicChecks).length,16);
assert.equal(protectedPages.length,2);
assert.ok(markerCount>=38);
console.log(`LIVE_V777_STATIC_ACCESSIBILITY=PASS publicPages=${Object.keys(publicChecks).length} protectedPages=${protectedPages.length} markers=${markerCount}`);
