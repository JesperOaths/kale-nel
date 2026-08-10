#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
assert.equal(version,'v776');
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
for(const [file,marker] of [['activate.html','v680 slaat'],['request.html','v680 browser'],['leaderboard.html','Publieke v673'],['despimarkt_auto_markets.html','Phase 13']]) assert.ok(!text(file).includes(marker),file+' still contains development-era copy: '+marker);
assert.match(text('request.html'),/Na goedkeuring krijg je een veilige activatielink per e-mail./);
assert.match(text('leaderboard.html'),/ELO-ranglijst op basis van gespeelde Klaverjaswedstrijden./);
assert.match(text('despimarkt_auto_markets.html'),/Automatische markten voor actuele wedstrijden./);
console.log('v776 account-journey polish PASS: login/request/activation controls are programmatically labelled, status feedback is live-announced, and development-era public copy is removed.');
