#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\d+)$/)?.[1]||0);
assert.ok(versionNumber>=776,`v776 account-journey invariant requires frontend v776+, got ${version}`);
function text(file){return fs.readFileSync(file,'utf8');}
for(const [file,pairs] of Object.entries({
  'login.html':[['playerNameInput','Naam'],['pinInput','Pincode']],
  'request.html':[['requestNameSelect','Gewenste naam'],['requestEmailInput','E-mailadres'],['requestNoteInput','Notitie']],
  'activate.html':[['pinInput','Pincode'],['pinConfirmInput','Bevestig pincode']]
})){
  const html=text(file);
  for(const [id,label] of pairs) assert.ok(html.includes('<label for="'+id+'">'+label+'</label>'),file+' missing programmatic label for '+id);
  assert.match(html,/role=["']status["'][^>]*aria-live=["']polite["']|aria-live=["']polite["'][^>]*role=["']status["']/i,file+' must expose polite live status');
}
const login=text('login.html');
assert.match(login,/id="playerNameInput"[^>]*autocomplete="username"/);
assert.match(login,/id="pinInput"[^>]*autocomplete="current-password"/);
const request=text('request.html');
assert.match(request,/id="requestEmailInput"[^>]*autocomplete="email"/);
const activate=text('activate.html');
assert.match(activate,/id="pinInput"[^>]*autocomplete="new-password"/);
assert.match(activate,/id="pinConfirmInput"[^>]*autocomplete="new-password"/);
for(const [file,marker] of [
  ['activate.html','v680 slaat'],['activate.html','device/browsermetadata'],
  ['request.html','v680 browser'],['request.html','mailqueue'],['request.html','browser/scope/aanvraagmetadata'],
  ['leaderboard.html','Publieke v673'],['despimarkt_auto_markets.html','Phase 13']
]) assert.ok(!text(file).includes(marker),file+' still contains development-era copy: '+marker);
assert.match(request,/Na goedkeuring krijg je een veilige activatielink per e-mail\./);
assert.match(text('leaderboard.html'),/ELO-ranglijst op basis van gespeelde Klaverjaswedstrijden\./);
assert.match(text('despimarkt_auto_markets.html'),/Automatische markten voor actuele wedstrijden\./);
console.log(`v776 account-journey polish PASS at ${version}: v776+ releases preserve account labels/autocomplete/live status and finished public copy.`);
