#!/usr/bin/env node
import fs from 'node:fs';

const scorer = fs.readFileSync('scorer.html','utf8');
function need(needle,label){ if(!scorer.includes(needle)){ console.error('FAIL: '+label); process.exit(1); } }
function reject(needle,label){ if(scorer.includes(needle)){ console.error('FAIL: '+label); process.exit(1); } }

need('<div class="compact-divider">–</div>','compact rows use a real visual separator');
reject('<div class="compact-divider">?</div>','question-mark placeholder removed');
need("empty.textContent = `Kies de bieding om ronde ${currentRoundIndex()} te starten.`;",'empty state uses actual current round');
reject("empty.textContent = 'Kies de bieding om ronde 1 te starten.';",'hardcoded round 1 empty state removed');
need('id="saveMatchBtn"','v768 finished-game save handoff remains intact');
need("setMessage('16 rondes voltooid. Controleer de eindstand en kies Wedstrijd opslaan.');",'v768 finished-game UX remains intact');
console.log('Klaverjas round scorer polish v769 regression PASS');
