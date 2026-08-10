#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\d+)$/)?.[1]||0);
assert.ok(versionNumber>=777,`v777 accessibility invariant requires frontend v777+, got ${version}`);
const associated=[["boerenbridge.html","playerCountInput","Aantal spelers"],["boerenbridge.html","dealerInput","Deler"],["despimarkt_create.html","titleInput","Titel"],["despimarkt_create.html","descriptionInput","Beschrijving"],["despimarkt_create.html","outcomeAInput","Uitkomst A"],["despimarkt_create.html","outcomeBInput","Uitkomst B"],["despimarkt_create.html","closeAtInput","Sluit op"],["despimarkt_debts.html","targetInput","Ontvanger / schuldeiser"],["despimarkt_debts.html","amountInput","Bedrag"],["despimarkt_debts.html","dueAtInput","Deadline"],["despimarkt_debts.html","reasonInput","Reden"],["invite.html","inviteNote","Notitie"],["invite.html","inviteOutput","Link"],["klaverjas_live.html","scoreA","Score Team A"],["klaverjas_live.html","scoreB","Score Team B"],["klaverjas_live.html","roundNo","Ronde / hand"],["klaverjas_live.html","note","Notitie / laatste slag"],["my_profile.html","displayNameInput","Zichtbare naam"],["my_profile.html","avatarInput","Profielfoto uploaden"],["paardenrace.html","roomCodeInput","Roomcode"],["paardenrace.html","suitInput","Jouw paard"],["paardenrace.html","wagerInput","Jouw inzet in Bakken"],["pikken.html","pkPenaltyMode","Variant"],["pikken.html","pkJoinCode","Join code"],["pikken.html","pkStartDice","Startdobbelstenen"],["rad.html","nomineeSelect","Speler"],["scorer.html","playerW1","Wij - speler 1"],["scorer.html","playerZ1","Zij - speler 1"],["scorer.html","playerW2","Wij - speler 2"],["scorer.html","playerZ2","Zij - speler 2"],["toepen.html","winner","Winnaar van de vierde slag"],["toepen.html","stake","Eindwaarde"],["toepen.html","note","Notitie"],["toepen.html","playerCount","Aantal spelers"],["toepen.html","target","Doelscore"],["toepen.html","dealer","Beginnende deler"]];
const ariaNamed=[["drinks_speed.html","speedSeconds","Tijd in seconden"],["drinks_speed_stats.html","playerSelect","Speler"],["klaverjas_online.html","finishMode","Eindmodus"],["klaverjas_online.html","codeInput","Roomcode"],["klaverjas_room.html","finishMode","Eindmodus"],["klaverjas_room.html","codeInput","Roomcode"],["match_control.html","payloadInput","Wedstrijdgegevens JSON"],["match_swap.html","scopeFilter","Groep"],["match_swap.html","gameFilter","Spel"],["match_swap.html","playerFilter","Speler"],["match_swap.html","fromFilter","Vanaf datum"],["match_swap.html","toFilter","Tot datum"],["match_swap.html","editGame","Spel"],["match_swap.html","editClientId","Client-ID"],["match_swap.html","replaceOldPlayer","Oude speler"],["match_swap.html","replaceNewPlayer","Nieuwe speler"],["match_swap.html","editPayload","Wedstrijdgegevens JSON"],["pikken.html","pkBidCount","Aantal dobbelstenen in bod"],["pikken.html","pkBidFace","Waarde van bod"],["pikken_live.html","bidSelect","Bod"],["scorer.html","inputW","Score Wij"],["scorer.html","inputZ","Score Zij"]];
assert.equal(associated.length+ariaNamed.length,58);
for(const [file,id,label] of associated){const text=fs.readFileSync(file,'utf8');const ci=text.indexOf('id="'+id+'"');const fi=text.lastIndexOf('for="'+id+'"',ci);assert.ok(ci>=0&&fi>=0&&ci-fi<500,file+' missing nearby label association for '+id);assert.ok(text.slice(fi,ci).includes('>'+label+'</label>'),file+' associated label text mismatch for '+id);}
for(const [file,id,label] of ariaNamed){const text=fs.readFileSync(file,'utf8');assert.ok(text.includes('id="'+id+'" aria-label="'+label+'"'),file+' missing aria-label for '+id);}
const deferredDynamic=[
 ['boerenbridge.html','data-player-index="${i}"'],
 ['boerenbridge.html','class="special-select" data-special-index'],
 ['boerenbridge.html','data-bid-player-index="${playerIndex}"'],
 ['boerenbridge.html','<input type="text" value="${bid}" disabled'],
 ['boerenbridge.html','data-won-player-index="${idx}"'],
 ['boerenbridge.html','disabled value="${r.final_total_points||0}"'],
 ['drinks_admin.html','data-kind="events" value="${Number(r.id||0)}"'],
 ['drinks_admin.html','data-kind="speed" value="${Number(r.id||0)}"'],
 ['paardenrace_live.html','class="nom-input" type="number"'],
 ['toepen.html','data-seat="${i}"'],
 ['toepen.html','class="action" ${p.seat_no===win'],
 ['toepen.html','class="foldAt"']
];
assert.equal(deferredDynamic.length,12);
for(const [file,marker] of deferredDynamic){const text=fs.readFileSync(file,'utf8');assert.ok(text.includes(marker),file+' dynamic accessibility baseline changed or disappeared: '+marker);}
console.log(`v777 static control accessibility PASS at ${version}: 58 static controls keep deterministic accessible names and the 12 known runtime-generated control templates remain explicitly tracked as a separate accessibility class.`);
