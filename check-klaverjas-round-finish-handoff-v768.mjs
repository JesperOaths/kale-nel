#!/usr/bin/env node
import fs from 'node:fs';

const roundScorer = fs.readFileSync('scorer.html', 'utf8');
const saveScorer = fs.readFileSync('klaverjas_scorer_v596_repo_ready.html', 'utf8');
const scoreAlias = fs.readFileSync('score.html', 'utf8');

function need(text, needle, label) {
  if (!text.includes(needle)) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
}
function reject(text, needle, label) {
  if (text.includes(needle)) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
}

need(roundScorer, "const FINISHED_HANDOFF_KEY = 'gejast_klaverjas_finished_handoff_v1';", 'round scorer defines handoff key');
need(roundScorer, 'id="saveMatchBtn"', 'round scorer exposes finished-game save button');
need(roundScorer, 'function handoffFinishedGame()', 'round scorer has explicit handoff action');
need(roundScorer, 'team_a_names: [game.players[0], game.players[2]]', 'round scorer preserves W team mapping');
need(roundScorer, 'team_b_names: [game.players[1], game.players[3]]', 'round scorer preserves Z team mapping');
need(roundScorer, 'team_a_score: Number(game.w || 0)', 'round scorer transfers W final score');
need(roundScorer, 'team_b_score: Number(game.z || 0)', 'round scorer transfers Z final score');
need(roundScorer, 'sessionStorage.setItem(FINISHED_HANDOFF_KEY', 'round scorer stores handoff locally');
need(roundScorer, "new URL('./score.html', window.location.href)", 'round scorer opens safe save-form alias');
need(roundScorer, 'Controleer de eindstand en kies Wedstrijd opslaan.', 'round scorer has finished UX');
reject(roundScorer, 'via de andere scorepagina', 'old dead-end instruction removed');

need(saveScorer, "const FINISHED_HANDOFF_KEY = 'gejast_klaverjas_finished_handoff_v1';", 'save scorer reads same handoff key');
need(saveScorer, 'function readFinishedHandoff()', 'save scorer validates local handoff');
need(saveScorer, 'function applyFinishedHandoff()', 'save scorer applies transferred values');
need(saveScorer, "$('scoreA').value=String(pendingHandoff.team_a_score);", 'save scorer prefills team A score');
need(saveScorer, "$('scoreB').value=String(pendingHandoff.team_b_score);", 'save scorer prefills team B score');
need(saveScorer, "setStatus('Eindstand overgenomen. Controleer alles en druk daarna op Opslaan.', 'ok');", 'save scorer requires review before save');
need(saveScorer, 'await rt.saveMatch(payload());', 'existing explicit save action remains');
need(scoreAlias, "new URL('./klaverjas_scorer_v596_repo_ready.html',location.href)", 'score alias still targets save scorer');

console.log('Klaverjas finished-game handoff v768 regression PASS.');
