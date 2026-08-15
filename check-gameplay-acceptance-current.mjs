#!/usr/bin/env node
import fs from 'node:fs';
import './check-pikken-live-viewmodel-v792.mjs';
import './check-paardenrace-live-viewmodel-v792.mjs';
import './check-backend-rpc-provenance.mjs';
import './check-backend-rpc-acl-hardening.mjs';

const version = fs.readFileSync('VERSION', 'utf8').trim();
const tracker = JSON.parse(fs.readFileSync('gameplay-acceptance.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/controlled-live-game-flows.yml', 'utf8');
const smoke = fs.readFileSync('check-live-game-flows.mjs', 'utf8');
const indexHtml = fs.readFileSync('index.html', 'utf8');
const pikkenJs = fs.readFileSync('gejast-pikken.js', 'utf8');
const paardenraceHtml = fs.readFileSync('paardenrace.html', 'utf8');
const klaverjasHtml = fs.readFileSync('klaverjas_online.html', 'utf8');
const failures = [];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const routeHrefPresent = (route) => {
  if (!route) return false;
  const escaped = String(route).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`href=["']${escaped}["']`).test(indexHtml);
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
}

const toepen = games.get('toepen');
const toepenCounts = [2,3,4,5,6,7,8];
if (!same(toepen?.supported_players, toepenCounts)) failures.push('Toepen tracker must preserve supported players 2-8');
if (!same(toepen?.player_contract?.supported_player_counts, toepenCounts) || toepen?.player_contract?.minimum !== 2 || toepen?.player_contract?.maximum !== 8) failures.push('Toepen player contract must preserve grounded range 2-8');
if (toepen?.player_contract?.maximum_status !== 'grounded') failures.push('Toepen maximum player count must remain grounded');
if (toepen?.deterministic_status !== 'verified_complete') failures.push('Toepen deterministic matrix must remain verified_complete');

const boerenbridge = games.get('boerenbridge');
const boerenbridgeCounts = [2,3,4,5,6,7];
if (!same(boerenbridge?.supported_players, boerenbridgeCounts)) failures.push('Boerenbridge tracker must preserve supported players 2-7');
if (!same(boerenbridge?.player_contract?.supported_player_counts, boerenbridgeCounts) || boerenbridge?.player_contract?.minimum !== 2 || boerenbridge?.player_contract?.maximum !== 7) failures.push('Boerenbridge player contract must preserve grounded range 2-7');
if (boerenbridge?.player_contract?.maximum_status !== 'grounded') failures.push('Boerenbridge maximum player count must remain grounded');
if (boerenbridge?.deterministic_status !== 'verified_complete') failures.push('Boerenbridge deterministic matrix must remain verified_complete');

const beerpong = games.get('beerpong');
if (!same(beerpong?.supported_formats, ['1v1','2v2'])) failures.push('Beerpong tracker must preserve 1v1 and 2v2 formats');
if (!same(beerpong?.player_contract?.supported_player_counts, [2,4]) || !same(beerpong?.player_contract?.formats, { '1v1':2, '2v2':4 })) failures.push('Beerpong player contract must preserve 2-player 1v1 and 4-player 2v2');
if (beerpong?.deterministic_status !== 'verified_complete') failures.push('Beerpong deterministic matrix must remain verified_complete');

const pikken = games.get('pikken');
if (pikken?.deterministic_status !== 'rules_and_live_viewmodel_proven') failures.push('Pikken deterministic evidence must include the shipped live-viewmodel acceptance');
if (!/check-pikken-live-viewmodel-v792\.mjs/.test(String(pikken?.deterministic_evidence || ''))) failures.push('Pikken tracker must name the permanent live-viewmodel regression');
if (!String(pikken?.live_status || '').includes('two_player')) failures.push('pikken live evidence must remain explicitly two-player scoped');
if (!same(pikken?.player_contract?.live_proven_player_counts, [2])) failures.push('Pikken player contract must preserve only the live-proven two-player startup count');
if (pikken?.player_contract?.minimum !== null || pikken?.player_contract?.maximum !== null) failures.push('Pikken must not invent an exact minimum or maximum while the backend room-size contract is not grounded');
if (pikken?.player_contract?.minimum_status !== 'not_yet_proven' || pikken?.player_contract?.maximum_status !== 'not_yet_proven') failures.push('Pikken unknown player limits must remain explicit');
if (!/backend RPC/i.test(String(pikken?.remaining_gap || '')) || !/not an inferred minimum or maximum/i.test(String(pikken?.remaining_gap || ''))) failures.push('Pikken remaining gap must explain the backend-owned unknown range');
if (!/await\s+api\.startGame\(state\.gameId\)/.test(pikkenJs)) failures.push('Pikken shipped lobby must still delegate start acceptance to its contract/backend API');

const paardenrace = games.get('paardenrace');
if (paardenrace?.deterministic_status !== 'engine_and_live_viewmodel_proven') failures.push('Paardenrace deterministic evidence must include engine and shipped live-viewmodel acceptance');
if (!/check-paardenrace-live-viewmodel-v792\.mjs/.test(String(paardenrace?.deterministic_evidence || ''))) failures.push('Paardenrace tracker must name the permanent live-viewmodel regression');
if (!String(paardenrace?.live_status || '').includes('two_player')) failures.push('paardenrace live evidence must remain explicitly two-player scoped');
if (!same(paardenrace?.player_contract?.live_proven_player_counts, [2])) failures.push('Paardenrace player contract must preserve the live-proven two-player startup count');
if (paardenrace?.player_contract?.minimum !== 2 || paardenrace?.player_contract?.minimum_status !== 'grounded') failures.push('Paardenrace minimum-to-start must remain grounded at two players');
if (paardenrace?.player_contract?.maximum !== null || paardenrace?.player_contract?.maximum_status !== 'not_yet_proven') failures.push('Paardenrace must not infer a maximum human room size from the four horse suits');
if (!/members\.length\s*<\s*2/.test(paardenraceHtml) || !/minimaal 2 spelers nodig/i.test(paardenraceHtml)) failures.push('Paardenrace shipped lobby must preserve its explicit two-player minimum start guard');
if (!String(paardenrace?.remaining_gap || '').trim()) failures.push('paardenrace must retain an explicit remaining-gap statement');

const klaverjas = games.get('klaverjas_online');
if (klaverjas?.supported_seats !== 4 || klaverjas?.player_contract?.seats !== 4) failures.push('Online Klaverjas must remain a four-seat game');
if (!same(klaverjas?.player_contract?.supported_humans, { minimum:1, maximum:4 })) failures.push('Online Klaverjas frontend contract must preserve 1-4 human seats');
if (!same(klaverjas?.player_contract?.supported_bots, { minimum:0, maximum:3 })) failures.push('Online Klaverjas frontend contract must preserve 0-3 bot seats');
if (klaverjas?.player_contract?.start_requires_full_table !== true) failures.push('Online Klaverjas start contract must require a full four-seat table');
if (!/\(st\.players\s*\|\|\s*\[\]\)\.length\s*<\s*4/.test(klaverjasHtml)) failures.push('Online Klaverjas shipped lobby must still withhold start controls until four seats are occupied');
if (!/for\s*\(let\s+i\s*=\s*0\s*;\s*i\s*<\s*4\s*;\s*i\+\+\)/.test(klaverjasHtml)) failures.push('Online Klaverjas bot seat allocation must remain four-seat bounded');
if (!/nextBotSeat\(\[\{\s*seat\s*:\s*0\s*\},\s*\.\.\.UI\.botRoster\]\)/.test(klaverjasHtml)) failures.push('Online Klaverjas pre-room bot builder must preserve the human creator seat');
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

console.log('Gameplay acceptance regression PASS: canonical routes, explicit player contracts, evidence classes and guarded live smoke remain aligned.');
