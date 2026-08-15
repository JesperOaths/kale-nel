#!/usr/bin/env node
import fs from 'node:fs';

const version = fs.readFileSync('VERSION', 'utf8').trim();
const tracker = JSON.parse(fs.readFileSync('gameplay-acceptance.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/controlled-live-game-flows.yml', 'utf8');
const smoke = fs.readFileSync('check-live-game-flows.mjs', 'utf8');
const failures = [];

if (tracker.site_version !== version) failures.push(`gameplay tracker ${tracker.site_version || '(missing)'} must equal VERSION ${version}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tracker.last_updated || ''))) failures.push('gameplay tracker last_updated must be YYYY-MM-DD');

const games = new Map((tracker.games || []).map((game) => [game.id, game]));
for (const id of ['toepen','boerenbridge','beerpong','pikken','paardenrace','klaverjas_online']) {
  if (!games.has(id)) failures.push(`missing gameplay acceptance owner: ${id}`);
}

const toepen = games.get('toepen');
if (JSON.stringify(toepen?.supported_players) !== JSON.stringify([2,3,4,5,6,7,8])) failures.push('Toepen tracker must preserve supported players 2-8');
if (toepen?.deterministic_status !== 'verified_complete') failures.push('Toepen deterministic matrix must remain verified_complete');

const boerenbridge = games.get('boerenbridge');
if (JSON.stringify(boerenbridge?.supported_players) !== JSON.stringify([2,3,4,5,6,7])) failures.push('Boerenbridge tracker must preserve supported players 2-7');
if (boerenbridge?.deterministic_status !== 'verified_complete') failures.push('Boerenbridge deterministic matrix must remain verified_complete');

const beerpong = games.get('beerpong');
if (JSON.stringify(beerpong?.supported_formats) !== JSON.stringify(['1v1','2v2'])) failures.push('Beerpong tracker must preserve 1v1 and 2v2 formats');
if (beerpong?.deterministic_status !== 'verified_complete') failures.push('Beerpong deterministic matrix must remain verified_complete');

for (const id of ['pikken','paardenrace']) {
  const game = games.get(id);
  if (!String(game?.live_status || '').includes('two_player')) failures.push(`${id} live evidence must remain explicitly two-player scoped`);
  if (!String(game?.remaining_gap || '').trim()) failures.push(`${id} must retain an explicit remaining-gap statement`);
}

const klaverjas = games.get('klaverjas_online');
if (klaverjas?.supported_seats !== 4) failures.push('Online Klaverjas must remain a four-seat game');
if (klaverjas?.live_status !== 'production_guard_chain_not_applied') failures.push('Klaverjas tracker must not claim v792b-v792h production deployment before authorization/application');
if (!/explicit production SQL authorization/i.test(String(klaverjas?.remaining_gap || ''))) failures.push('Klaverjas remaining gap must preserve explicit production SQL authorization boundary');

if (!/on:\s*\n\s*workflow_dispatch:/m.test(workflow)) failures.push('controlled live game workflow must be workflow_dispatch-only');
for (const forbidden of [/^\s{2}push:/m, /^\s{2}pull_request:/m, /^\s{2}schedule:/m]) {
  if (forbidden.test(workflow)) failures.push('controlled live game workflow must not gain automatic triggers');
}
if (!workflow.includes('I_APPROVE_LIVE_BETA_WRITES')) failures.push('controlled live game workflow must require explicit live-write approval phrase');
if (!workflow.includes('secrets.BETA1_SESSION_TOKEN') || !workflow.includes('secrets.BETA2_SESSION_TOKEN')) failures.push('controlled live game workflow must source session tokens from GitHub Secrets');
if (!workflow.includes("GEJAST_REQUIRE_TWO_PLAYER: '1'")) failures.push('controlled live game workflow must fail closed when two-player credentials are absent');
if (!workflow.includes('node check-live-game-flows.mjs')) failures.push('controlled workflow must use the canonical cleanup-capable live game smoke');

if (!smoke.includes('finally {') || !smoke.includes('pikken_destroy_game_fast_v687') || !smoke.includes('disband_paardenrace_room_fast_v687')) {
  failures.push('canonical live game smoke must preserve finally-based Pikken and Paardenrace cleanup');
}
if (!smoke.includes('GEJAST_REQUIRE_TWO_PLAYER')) failures.push('canonical live game smoke must preserve require-two-player fail-closed mode');

if (failures.length) {
  console.error(`Gameplay acceptance regression failed for ${failures.length} item(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Gameplay acceptance regression PASS: evidence classes stay distinct; controlled live smoke remains manual, secret-backed and cleanup-capable.');
