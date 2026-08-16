#!/usr/bin/env node
import fs from 'node:fs';
import './check-pikken-live-viewmodel-v792.mjs';
import './check-paardenrace-live-viewmodel-v792.mjs';

const version = fs.readFileSync('VERSION', 'utf8').trim();
const tracker = JSON.parse(fs.readFileSync('gameplay-acceptance.json', 'utf8'));
const provenance = JSON.parse(fs.readFileSync('backend-rpc-provenance.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/controlled-live-game-flows.yml', 'utf8');
const smoke = fs.readFileSync('check-live-game-flows.mjs', 'utf8');
const indexHtml = fs.readFileSync('index.html', 'utf8');
const pikkenJs = fs.readFileSync('gejast-pikken.js', 'utf8');
const paardenraceHtml = fs.readFileSync('paardenrace.html', 'utf8');
const klaverjasHtml = fs.readFileSync('klaverjas_online.html', 'utf8');
const failures = [];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const routeHrefPresent = (route) => {
  const escaped = String(route || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !!route && new RegExp(`href=["']${escaped}["']`).test(indexHtml);
};
const rpcEvidence = (name, identityArguments) => (provenance.rpcs || []).find((rpc) => rpc?.name === name && rpc?.identity_arguments === identityArguments);
const rejectStaleLiveState = (game) => {
  const state = String(game?.live_status || '').toLowerCase();
  if (!state || /blocked|not_applied|available$|pending|unknown/.test(state)) failures.push(`${game?.id || 'game'} live_status is stale/non-proven: ${state || '(missing)'}`);
};

if (tracker.version !== 2) failures.push('gameplay tracker schema must remain version 2');
if (tracker.site_version !== version) failures.push(`gameplay tracker ${tracker.site_version || '(missing)'} must equal VERSION ${version}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tracker.last_updated || ''))) failures.push('gameplay tracker last_updated must be YYYY-MM-DD');

const gameRows = tracker.games || [];
const games = new Map(gameRows.map((game) => [game.id, game]));
if (games.size !== gameRows.length) failures.push('gameplay tracker game ids must be unique');
for (const id of ['toepen','boerenbridge','beerpong','pikken','paardenrace','klaverjas_online']) {
  if (!games.has(id)) failures.push(`missing gameplay acceptance owner: ${id}`);
}
for (const game of gameRows) {
  if (!game?.canonical_route) failures.push(`${game?.id || '(unknown game)'} must declare a canonical_route`);
  else if (!routeHrefPresent(game.canonical_route)) failures.push(`${game.id} canonical route ${game.canonical_route} must remain directly selectable from index.html`);
  if (!game?.player_contract || typeof game.player_contract !== 'object') failures.push(`${game?.id || '(unknown game)'} must declare an explicit player_contract`);
  rejectStaleLiveState(game);
}

const toepen = games.get('toepen');
const toepenCounts = [2,3,4,5,6,7,8];
if (!same(toepen?.supported_players, toepenCounts)) failures.push('Toepen tracker must preserve supported players 2-8');
if (!same(toepen?.player_contract?.supported_player_counts, toepenCounts) || toepen?.player_contract?.minimum !== 2 || toepen?.player_contract?.maximum !== 8) failures.push('Toepen player contract must preserve grounded range 2-8');
if (toepen?.player_contract?.maximum_status !== 'grounded' || toepen?.deterministic_status !== 'verified_complete') failures.push('Toepen grounded deterministic contract regressed');

const boerenbridge = games.get('boerenbridge');
const boerenbridgeCounts = [2,3,4,5,6,7];
if (!same(boerenbridge?.supported_players, boerenbridgeCounts)) failures.push('Boerenbridge tracker must preserve supported players 2-7');
if (!same(boerenbridge?.player_contract?.supported_player_counts, boerenbridgeCounts) || boerenbridge?.player_contract?.minimum !== 2 || boerenbridge?.player_contract?.maximum !== 7) failures.push('Boerenbridge player contract must preserve grounded range 2-7');
if (boerenbridge?.player_contract?.maximum_status !== 'grounded' || boerenbridge?.deterministic_status !== 'verified_complete') failures.push('Boerenbridge grounded deterministic contract regressed');

const beerpong = games.get('beerpong');
if (!same(beerpong?.supported_formats, ['1v1','2v2'])) failures.push('Beerpong tracker must preserve 1v1 and 2v2 formats');
if (!same(beerpong?.player_contract?.supported_player_counts, [2,4]) || !same(beerpong?.player_contract?.formats, {'1v1':2,'2v2':4})) failures.push('Beerpong player contract must preserve 2-player 1v1 and 4-player 2v2');
if (beerpong?.deterministic_status !== 'verified_complete') failures.push('Beerpong deterministic matrix must remain verified_complete');

const pikken = games.get('pikken');
const pikkenIdentity = 'session_token text, session_token_input text, game_id_input uuid, site_scope_input text';
const pikkenProv = rpcEvidence('pikken_start_game_scoped', pikkenIdentity);
const pikkenEv = pikken?.player_contract?.minimum_evidence || {};
if (pikken?.deterministic_status !== 'rules_and_live_viewmodel_proven' || !/check-pikken-live-viewmodel-v792\.mjs/.test(String(pikken?.deterministic_evidence || ''))) failures.push('Pikken shipped live-viewmodel evidence regressed');
if (!String(pikken?.live_status || '').includes('two_player') || !String(pikken?.live_status || '').includes('proven')) failures.push('Pikken live evidence must remain proven and explicitly two-player scoped');
if (!same(pikken?.player_contract?.live_proven_player_counts, [2])) failures.push('Pikken must preserve only the live-proven two-player startup count');
if (pikken?.player_contract?.minimum !== 2 || pikken?.player_contract?.minimum_status !== 'grounded') failures.push('Pikken minimum-to-start must remain grounded at two players');
if (pikken?.player_contract?.maximum !== null || pikken?.player_contract?.maximum_status !== 'not_yet_proven' || pikken?.player_contract?.supported_player_counts_status !== 'minimum_grounded_maximum_unknown') failures.push('Pikken maximum must remain explicitly unknown');
if (!pikkenProv) failures.push('Pikken grounded minimum requires exact production provenance');
else {
  const authorityPath = String(pikkenProv?.repository_authority?.path || '').replaceAll('\\','/');
  if (pikkenProv?.repository_authority?.status !== 'checked_in' || !authorityPath) failures.push('Pikken start RPC authority must be checked in');
  if (pikkenEv.rpc !== 'pikken_start_game_scoped' || pikkenEv.identity_arguments !== pikkenIdentity || pikkenEv.repository_authority_path !== authorityPath || pikken?.player_contract?.source !== authorityPath) failures.push('Pikken minimum evidence must match exact provenance');
  if (pikkenEv.observed_production_definition_md5 !== pikkenProv?.observed_production?.definition_md5) failures.push('Pikken minimum evidence production fingerprint drifted');
  if (!fs.existsSync(authorityPath)) failures.push(`Pikken authority path does not exist: ${authorityPath}`);
  else {
    const sql = fs.readFileSync(authorityPath,'utf8');
    if (!/create\s+or\s+replace\s+function\s+public\.pikken_start_game_scoped\s*\(/i.test(sql) || !/v_players\s*<\s*2/i.test(sql)) failures.push('Pikken authoritative start RPC lost explicit two-player minimum');
  }
}
if (!/minimum at 2/i.test(String(pikken?.remaining_gap || '')) || !/maximum remains unknown/i.test(String(pikken?.remaining_gap || ''))) failures.push('Pikken remaining gap must preserve grounded-minimum/unknown-maximum distinction');
if (!/await\s+api\.startGame\(state\.gameId\)/.test(pikkenJs)) failures.push('Pikken shipped lobby must still delegate start acceptance to backend contract');

const paardenrace = games.get('paardenrace');
if (paardenrace?.deterministic_status !== 'engine_and_live_viewmodel_proven' || !/check-paardenrace-live-viewmodel-v792\.mjs/.test(String(paardenrace?.deterministic_evidence || ''))) failures.push('Paardenrace shipped engine/live-viewmodel evidence regressed');
if (!String(paardenrace?.live_status || '').includes('two_player') || !String(paardenrace?.live_status || '').includes('proven')) failures.push('Paardenrace live evidence must remain proven and explicitly two-player scoped');
if (!same(paardenrace?.player_contract?.live_proven_player_counts, [2])) failures.push('Paardenrace must preserve live-proven two-player startup count');
if (paardenrace?.player_contract?.minimum !== 2 || paardenrace?.player_contract?.minimum_status !== 'grounded') failures.push('Paardenrace minimum-to-start must remain grounded at two players');
if (paardenrace?.player_contract?.maximum !== null || paardenrace?.player_contract?.maximum_status !== 'not_yet_proven') failures.push('Paardenrace must not infer a human maximum from horse suits');
if (!/players\.length\s*<\s*2/.test(paardenraceHtml) || !/readyTotal\s*<\s*2/.test(paardenraceHtml) || !/kan niet starten met minder dan 2 spelers/i.test(paardenraceHtml)) failures.push('Paardenrace shipped lobby lost two-player start guards');
if (!String(paardenrace?.remaining_gap || '').trim()) failures.push('Paardenrace must retain an explicit unknown-maximum statement');

const klaverjas = games.get('klaverjas_online');
if (klaverjas?.supported_seats !== 4 || klaverjas?.player_contract?.seats !== 4) failures.push('Online Klaverjas must remain four-seat');
if (!same(klaverjas?.player_contract?.supported_humans, {minimum:1,maximum:4})) failures.push('Online Klaverjas must preserve 1-4 human seats');
if (!same(klaverjas?.player_contract?.supported_bots, {minimum:0,maximum:3})) failures.push('Online Klaverjas must preserve 0-3 bot seats');
if (klaverjas?.player_contract?.start_requires_full_table !== true) failures.push('Online Klaverjas start must require full four-seat table');
if (!/\(st\.players\s*\|\|\s*\[\]\)\.length\s*<\s*4/.test(klaverjasHtml)) failures.push('Online Klaverjas UI lost full-table start guard');
if (!/for\s*\(let\s+i\s*=\s*0\s*;\s*i\s*<\s*4\s*;\s*i\+\+\)/.test(klaverjasHtml)) failures.push('Online Klaverjas bot allocation lost four-seat bound');
if (!/nextBotSeat\(\[\{\s*seat\s*:\s*0\s*\},\s*\.\.\.UI\.botRoster\]\)/.test(klaverjasHtml)) failures.push('Online Klaverjas bot builder must preserve creator seat');
if (klaverjas?.live_status !== 'two_player_room_lifecycle_proven') failures.push('Online Klaverjas must record the completed production two-player room lifecycle proof');
if (!/production v792b-v792h is applied/i.test(String(klaverjas?.live_evidence || ''))) failures.push('Online Klaverjas evidence must record deployed v792b-v792h');
if (!/randomized disposable player sessions/i.test(String(klaverjas?.live_evidence || ''))) failures.push('Online Klaverjas evidence must record disposable-session live proof');
if (!/post-cleanup counts were zero/i.test(String(klaverjas?.live_evidence || ''))) failures.push('Online Klaverjas evidence must record zero-residue cleanup');
if (/production_guard_chain_not_applied|explicit production SQL authorization/i.test(JSON.stringify(klaverjas))) failures.push('Online Klaverjas tracker still contains the stale pre-deployment blocker');

if (!/on:\s*\n\s*workflow_dispatch:/m.test(workflow)) failures.push('controlled live game workflow must remain workflow_dispatch-only');
for (const forbidden of [/^\s{2}push:/m,/^\s{2}pull_request:/m,/^\s{2}schedule:/m]) if (forbidden.test(workflow)) failures.push('controlled live game workflow must not gain automatic triggers');
if (!workflow.includes('I_APPROVE_LIVE_BETA_WRITES')) failures.push('controlled live workflow must retain explicit write approval phrase');
if (!workflow.includes('secrets.BETA1_SESSION_TOKEN') || !workflow.includes('secrets.BETA2_SESSION_TOKEN')) failures.push('controlled live workflow must keep secret-backed legacy/manual credential inputs');
if (!workflow.includes("GEJAST_REQUIRE_TWO_PLAYER: '1'") || !workflow.includes('node check-live-game-flows.mjs')) failures.push('controlled live workflow must fail closed and use canonical cleanup-capable smoke');
if (!smoke.includes('finally {') || !smoke.includes('pikken_destroy_game_fast_v687') || !smoke.includes('disband_paardenrace_room_fast_v687') || !smoke.includes('GEJAST_REQUIRE_TWO_PLAYER')) failures.push('canonical live game smoke cleanup/fail-closed guards regressed');

if (failures.length) {
  console.error(`Gameplay acceptance regression failed for ${failures.length} item(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Gameplay acceptance regression PASS: routes, player contracts, production evidence classes and guarded live smoke are current and machine-checked.');
