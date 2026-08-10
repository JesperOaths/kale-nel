#!/usr/bin/env node
import assert from 'node:assert/strict';

const base='https://kalenel.nl';
const stamp=Date.now();
async function get(path){
  const url=`${base}${path}${path.includes('?')?'&':'?'}proof=${stamp}`;
  const r=await fetch(url,{redirect:'follow',headers:{'cache-control':'no-cache','pragma':'no-cache'}});
  const text=await r.text();
  console.log(`${path}: ${r.status} ${r.url}`);
  assert.equal(r.status,200,`${path} must return 200`);
  return text;
}

const version=(await get('/VERSION')).trim();
assert.equal(version,'v776','public VERSION must be v776');

const login=await get('/login.html');
assert.match(login,/GEJAST_PAGE_VERSION='v776'/);
assert.ok(login.includes('<label for="playerNameInput">Naam</label>'));
assert.ok(login.includes('<label for="pinInput">Pincode</label>'));
assert.match(login,/id="statusBox"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(login,/autocomplete="username"/);
assert.match(login,/autocomplete="current-password"/);

const request=await get('/request.html');
for(const marker of ['<label for="requestNameSelect">Gewenste naam</label>','<label for="requestEmailInput">E-mailadres</label>','<label for="requestNoteInput">Notitie</label>']) assert.ok(request.includes(marker),`request missing ${marker}`);
assert.match(request,/id="status"[^>]*role="status"[^>]*aria-live="polite"/);
assert.ok(request.includes('Na goedkeuring krijg je een veilige activatielink per e-mail.'));
for(const stale of ['v680 browser','mailqueue','aanvraagmetadata']) assert.ok(!request.includes(stale),`request still exposes ${stale}`);

const activate=await get('/activate.html');
for(const marker of ['<label for="pinInput">Pincode</label>','<label for="pinConfirmInput">Bevestig pincode</label>']) assert.ok(activate.includes(marker),`activate missing ${marker}`);
assert.match(activate,/id="status"[^>]*role="status"[^>]*aria-live="polite"/);
assert.ok(!activate.includes('v680 slaat'));
assert.ok(!activate.includes('device/browsermetadata'));

const leaderboard=await get('/leaderboard.html');
assert.ok(leaderboard.includes('ELO-ranglijst op basis van gespeelde Klaverjaswedstrijden.'));
assert.ok(!leaderboard.includes('Publieke v673 ELO-ranglijst'));

const markets=await get('/despimarkt_auto_markets.html');
assert.ok(markets.includes('Automatische markten voor actuele wedstrijden.'));
assert.ok(!markets.includes('Phase 13'));

console.log('LIVE_V776_ACCOUNT_POLISH=PASS');
