#!/usr/bin/env node
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = String(process.env.GEJAST_BASE_URL || 'https://kalenel.nl/').replace(/\/+$/, '') + '/';
const token1 = String(process.env.GEJAST_PLAYER1_TOKEN || '').trim();
const token2 = String(process.env.GEJAST_PLAYER2_TOKEN || '').trim();
const name1 = String(process.env.GEJAST_PLAYER1_NAME || '').trim();
const name2 = String(process.env.GEJAST_PLAYER2_NAME || '').trim();
const siteScope = String(process.env.GEJAST_SITE_SCOPE || 'friends').trim() || 'friends';
const timeout = Number(process.env.GEJAST_BROWSER_TIMEOUT_MS || 20000);

if (!token1 || !token2 || !name1 || !name2) throw new Error('Two disposable player sessions/names are required');

const configText = fs.readFileSync('gejast-config.js', 'utf8');
const supabaseUrl = configText.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
const publishableKey = configText.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];
if (!supabaseUrl || !publishableKey) throw new Error('Could not resolve checked-in Supabase public config');

const state = { pikkenId: '', paardenCode: '', klaverId: '', klaverCode: '' };
const failures = [];
const safe = (value) => String(value?.message || value || 'unknown').replaceAll(token1, '[TOKEN1]').replaceAll(token2, '[TOKEN2]');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(name, payload = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(`${name}: ${data?.message || data?.error || data?.details || data?.hint || `HTTP ${res.status}`}`);
    return data && data[name] !== undefined ? data[name] : data;
  } finally { clearTimeout(timer); }
}

const tokenPayload = (token, extra = {}) => ({ session_token: token, session_token_input: token, site_scope_input: siteScope, ...extra });
const gameId = (x) => String(x?.game?.id || x?.game_id || x?.id || '').trim();
const lobbyCode = (x) => String(x?.game?.lobby_code || x?.lobby_code || x?.code || '').trim();
const roomCode = (x) => String(x?.room?.room_code || x?.room_code || x?.code || '').trim().toUpperCase();
const pikkenPhase = (x) => String(x?.game?.state?.phase || x?.state?.phase || x?.game?.status || x?.status || '').trim().toLowerCase();
const paardenStage = (x) => String(x?.room?.stage || x?.stage || '').trim().toLowerCase();

async function setupOnlineRooms() {
  // One die makes the two-player completion proof deterministic: the first resolved
  // challenge removes exactly one player's last die and must finish the match.
  const pikken = await rpc('pikken_create_lobby_fast_v687', tokenPayload(token1, { config_input: { penalty_mode: 'wrong_loses', start_dice: 1, final_certification: true } }));
  state.pikkenId = gameId(pikken);
  const pCode = lobbyCode(pikken);
  if (!state.pikkenId || !pCode) throw new Error('Pikken certification room create returned no id/code');
  await rpc('pikken_join_lobby_fast_v687', tokenPayload(token2, { lobby_code_input: pCode }));

  const paarden = await rpc('create_paardenrace_room_fast_v687', tokenPayload(token1, { room_code_input: null, room_name_input: null }));
  state.paardenCode = roomCode(paarden);
  if (!state.paardenCode) throw new Error('Paardenrace certification room create returned no code');
  await rpc('join_paardenrace_room_fast_v687', tokenPayload(token2, { room_code_input: state.paardenCode }));

  const klaver = await rpc('klaverjas_online_create', { session_token: token1, site_scope_input: siteScope, settings_input: { bot_count: 0, final_certification: true } });
  state.klaverId = gameId(klaver);
  state.klaverCode = lobbyCode(klaver);
  if (!state.klaverId || !state.klaverCode) throw new Error('Klaverjas certification room create returned no id/code');
  await rpc('klaverjas_online_join', { session_token: token2, lobby_code_input: state.klaverCode, site_scope_input: siteScope });
}

async function cleanupOnlineRooms() {
  if (state.pikkenId) {
    try { await rpc('pikken_destroy_game_fast_v687', tokenPayload(token1, { game_id_input: state.pikkenId })); } catch (e) { console.log(`Pikken cleanup warning: ${safe(e)}`); }
  }
  if (state.paardenCode) {
    try { await rpc('disband_paardenrace_room_fast_v687', tokenPayload(token1, { room_code_input: state.paardenCode })); } catch (e) { console.log(`Paardenrace cleanup warning: ${safe(e)}`); }
  }
  if (state.klaverId) {
    try { await rpc('klaverjas_online_delete_room', { session_token: token1, game_id_input: state.klaverId, lobby_code_input: null, site_scope_input: siteScope }); } catch (e) { console.log(`Klaverjas cleanup warning: ${safe(e)}`); }
  }
}

async function newContext(browser, token, mobile = false) {
  const context = await browser.newContext(mobile ? {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  } : { viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ tokenValue, paardCode }) => {
    localStorage.setItem('jas_session_token_v11', tokenValue);
    localStorage.setItem('jas_session_token_v10', tokenValue);
    localStorage.setItem('jas_last_activity_at_v1', String(Date.now()));
    if (paardCode) {
      localStorage.setItem('gejast_paardenrace_room_code_v687', paardCode);
      localStorage.setItem('gejast_paardenrace_room_code_v506', paardCode);
    }
  }, { tokenValue: token, paardCode: state.paardenCode });
  return context;
}

function watchPage(page, label) {
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror ${safe(e)}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(`console ${msg.text()}`); });
  return () => {
    const serious = errs.filter((x) => !/favicon|Failed to load resource.*404/i.test(x));
    if (serious.length) throw new Error(`${label} browser errors: ${serious.join(' | ')}`);
  };
}

async function loadRoute(page, route, label) {
  const response = await page.goto(new URL(route, BASE).toString(), { waitUntil: 'domcontentloaded', timeout });
  if (!response || response.status() >= 500) throw new Error(`${label} document HTTP ${response?.status() || 'none'}`);
  await page.waitForTimeout(900);
  if (/login\.html/i.test(page.url())) throw new Error(`${label} unexpectedly redirected to login`);
  const body = (await page.locator('body').innerText()).trim();
  if (body.length < 20) throw new Error(`${label} rendered an empty body`);
  const versionText = await page.locator('[data-version-watermark], .site-credit-watermark').allTextContents().catch(() => []);
  if (!versionText.join(' ').includes('v792')) throw new Error(`${label} missing v792 watermark`);
}

async function expectBoth(page, selector, label) {
  await page.waitForFunction(({ selector, a, b }) => {
    const text = document.querySelector(selector)?.textContent || document.body.textContent || '';
    return text.toLowerCase().includes(a.toLowerCase()) && text.toLowerCase().includes(b.toLowerCase());
  }, { selector, a: name1, b: name2 }, { timeout });
  console.log(`${label}: both disposable players rendered`);
}

async function browserAcceptance() {
  const browser = await chromium.launch({ headless: true });
  const c1 = await newContext(browser, token1, false);
  const c2 = await newContext(browser, token2, false);
  const mobile = await newContext(browser, token1, true);
  try {
    const p1 = await c1.newPage();
    const p2 = await c2.newPage();
    const m = await mobile.newPage();
    const done1 = watchPage(p1, 'desktop-player-1');
    const done2 = watchPage(p2, 'desktop-player-2');
    const doneM = watchPage(m, 'mobile-touch');

    for (const [route, label] of [
      ['toepen.html', 'Toepen'],
      ['boerenbridge.html', 'Boerenbridge'],
      ['beerpong.html', 'Beerpong'],
    ]) {
      await loadRoute(p1, route, label);
      console.log(`${label}: desktop Chromium route PASS`);
    }

    const pikkenRoute = `pikken.html?game_id=${encodeURIComponent(state.pikkenId)}`;
    await Promise.all([loadRoute(p1, pikkenRoute, 'Pikken player 1'), loadRoute(p2, pikkenRoute, 'Pikken player 2')]);
    await Promise.all([expectBoth(p1, '#pkPlayers', 'Pikken context 1'), expectBoth(p2, '#pkPlayers', 'Pikken context 2')]);
    await p2.reload({ waitUntil: 'domcontentloaded', timeout });
    await expectBoth(p2, '#pkPlayers', 'Pikken reconnect/refresh');

    await Promise.all([loadRoute(p1, 'paardenrace.html', 'Paardenrace player 1'), loadRoute(p2, 'paardenrace.html', 'Paardenrace player 2')]);
    await Promise.all([expectBoth(p1, '#playersBox', 'Paardenrace context 1'), expectBoth(p2, '#playersBox', 'Paardenrace context 2')]);
    await p2.reload({ waitUntil: 'domcontentloaded', timeout });
    await expectBoth(p2, '#playersBox', 'Paardenrace reconnect/refresh');

    const klaverRoute = `klaverjas_online.html?game_id=${encodeURIComponent(state.klaverId)}&room=${encodeURIComponent(state.klaverCode)}`;
    await Promise.all([loadRoute(p1, klaverRoute, 'Klaverjas player 1'), loadRoute(p2, klaverRoute, 'Klaverjas player 2')]);
    await Promise.all([expectBoth(p1, 'body', 'Klaverjas context 1'), expectBoth(p2, 'body', 'Klaverjas context 2')]);
    await p2.reload({ waitUntil: 'domcontentloaded', timeout });
    await expectBoth(p2, 'body', 'Klaverjas reconnect/refresh');

    for (const [route, label] of [
      ['toepen.html', 'Toepen mobile'],
      ['boerenbridge.html', 'Boerenbridge mobile'],
      ['beerpong.html', 'Beerpong mobile'],
      [pikkenRoute, 'Pikken mobile'],
      ['paardenrace.html', 'Paardenrace mobile'],
      [klaverRoute, 'Klaverjas mobile'],
    ]) {
      await loadRoute(m, route, label);
      const overflow = await m.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
      if (overflow > 64) throw new Error(`${label} horizontal overflow ${overflow}px`);
      console.log(`${label}: 390x844 touch viewport PASS (overflow ${overflow}px)`);
    }

    done1(); done2(); doneM();
  } finally {
    await c1.close();
    await c2.close();
    await mobile.close();
    await browser.close();
  }
}

async function completePikkenNaturally() {
  let s1 = await rpc('pikken_set_ready_scoped', tokenPayload(token1, { game_id_input: state.pikkenId, ready_input: true }));
  let s2 = await rpc('pikken_set_ready_scoped', tokenPayload(token2, { game_id_input: state.pikkenId, ready_input: true }));
  if (!s1?.viewer?.is_ready || !s2?.viewer?.is_ready) throw new Error('Pikken completion: both players did not become ready');

  let started = await rpc('pikken_start_game_scoped', tokenPayload(token1, { game_id_input: state.pikkenId }));
  if (pikkenPhase(started) !== 'bidding') throw new Error(`Pikken completion: expected bidding after start, got ${pikkenPhase(started) || 'unknown'}`);
  if (Number(started?.viewer?.dice_count || 0) !== 1) throw new Error('Pikken completion: certification host did not start with exactly one die');

  const bid = await rpc('pikken_place_bid_scoped', tokenPayload(token1, { game_id_input: state.pikkenId, bid_count_input: 1, bid_face_input: 1 }));
  if (!bid?.game?.state?.bid) throw new Error('Pikken completion: first legal bid was not stored');

  const resolved = await rpc('pikken_reject_bid_scoped', tokenPayload(token2, { game_id_input: state.pikkenId }));
  if (pikkenPhase(resolved) !== 'finished') throw new Error(`Pikken completion: one-die two-player challenge did not finish match; phase=${pikkenPhase(resolved) || 'unknown'}`);
  const winnerId = resolved?.game?.state?.winner_id;
  const alive = Array.isArray(resolved?.players) ? resolved.players.filter((p) => p?.alive && Number(p?.dice_count || 0) > 0) : [];
  if (!winnerId || alive.length !== 1) throw new Error(`Pikken completion: invalid terminal winner/alive state winner=${winnerId || 'none'} alive=${alive.length}`);

  const reread = await rpc('pikken_get_state_scoped', tokenPayload(token2, { game_id_input: state.pikkenId, game_id: state.pikkenId, lobby_code_input: null }));
  if (pikkenPhase(reread) !== 'finished' || String(reread?.game?.state?.winner_id || '') !== String(winnerId)) {
    throw new Error('Pikken completion: finished winner did not persist on independent reread');
  }
  console.log(`Pikken natural completion PASS: winner_id=${winnerId}`);
}

async function completePaardenraceNaturally() {
  // Mirror the shipped lobby RPC shapes: save choice, host verification, ready, start.
  await rpc('update_paardenrace_room_choice_safe', tokenPayload(token1, { room_code_input: state.paardenCode, selected_suit_input: 'hearts', wager_bakken_input: 1, ready_input: false }));
  await rpc('update_paardenrace_room_choice_safe', tokenPayload(token2, { room_code_input: state.paardenCode, selected_suit_input: 'spades', wager_bakken_input: 1, ready_input: false }));
  await rpc('verify_paardenrace_wager_safe', tokenPayload(token1, { room_code_input: state.paardenCode, target_player_name_input: name1 }));
  await rpc('verify_paardenrace_wager_safe', tokenPayload(token1, { room_code_input: state.paardenCode, target_player_name_input: name2 }));
  await rpc('set_paardenrace_ready_safe', tokenPayload(token1, { room_code_input: state.paardenCode, ready_input: true }));
  const ready = await rpc('set_paardenrace_ready_safe', tokenPayload(token2, { room_code_input: state.paardenCode, ready_input: true }));
  const players = Array.isArray(ready?.players) ? ready.players : [];
  if (players.length !== 2 || players.some((p) => !p?.is_ready || !p?.wager_verified)) {
    throw new Error('Paardenrace completion: verified/ready two-player lobby invariant failed');
  }

  const countdown = await rpc('start_paardenrace_countdown_safe', tokenPayload(token1, { room_code_input: state.paardenCode }));
  if (paardenStage(countdown) !== 'countdown') throw new Error(`Paardenrace completion: expected countdown, got ${paardenStage(countdown) || 'unknown'}`);
  await sleep(5600);

  // Exact browser helper payload shape includes both session token names + site_scope_input;
  // v792q specifically guarantees this resolves to the current room pipeline.
  let race = await rpc('tick_paardenrace_room_safe', tokenPayload(token1, { room_code_input: state.paardenCode }));
  if (paardenStage(race) !== 'race') throw new Error(`Paardenrace completion: countdown tick did not enter race, got ${paardenStage(race) || 'unknown'}`);

  let draws = 0;
  let reshuffles = 0;
  const maxDraws = 260;
  const maxReshuffles = 10;
  while (paardenStage(race) === 'race' && draws < maxDraws) {
    try {
      race = await rpc('draw_paardenrace_card_safe', tokenPayload(token1, { room_code_input: state.paardenCode }));
      draws += 1;
    } catch (error) {
      const message = safe(error);
      if (!/trekstapel.*leeg|geen kaarten meer/i.test(message)) throw error;
      if (reshuffles >= maxReshuffles) throw new Error(`Paardenrace completion: exceeded ${maxReshuffles} real reshuffles without winner`);
      race = await rpc('reshuffle_paardenrace_draw_pile_safe', tokenPayload(token1, { room_code_input: state.paardenCode }));
      reshuffles += 1;
      if (paardenStage(race) !== 'race') throw new Error(`Paardenrace completion: reshuffle changed stage to ${paardenStage(race) || 'unknown'}`);
      const resetIndex = Number(race?.match?.draw_index ?? -1);
      const newDeck = Array.isArray(race?.match?.draw_deck) ? race.match.draw_deck : [];
      if (resetIndex !== 0 || newDeck.length === 0) throw new Error('Paardenrace completion: real reshuffle did not reset draw index/build a deck');
    }
  }

  if (paardenStage(race) !== 'nominations') {
    throw new Error(`Paardenrace completion: no claimed winner after ${draws} draws/${reshuffles} reshuffles; stage=${paardenStage(race) || 'unknown'}`);
  }
  const winnerSuit = String(race?.match?.winner_suit || '').trim().toLowerCase();
  if (!['hearts', 'spades'].includes(winnerSuit)) throw new Error(`Paardenrace completion: unclaimed/invalid winner suit ${winnerSuit || 'none'}`);

  const winnerToken = winnerSuit === 'hearts' ? token1 : token2;
  const winnerName = winnerSuit === 'hearts' ? name1 : name2;
  const targetName = winnerSuit === 'hearts' ? name2 : name1;
  const nomination = await rpc('submit_paardenrace_nominations_safe', tokenPayload(winnerToken, {
    room_code_input: state.paardenCode,
    allocations_input: [{ target_player_name: targetName, bakken: 2 }],
  }));
  if (paardenStage(nomination) !== 'finished') throw new Error(`Paardenrace completion: nomination did not finalize race; stage=${paardenStage(nomination) || 'unknown'}`);
  if (String(nomination?.match?.winner_suit || '').toLowerCase() !== winnerSuit) throw new Error('Paardenrace completion: winner suit changed during finalization');
  if (!nomination?.result_summary || typeof nomination.result_summary !== 'object') throw new Error('Paardenrace completion: terminal result summary missing');

  const persisted = await rpc('get_paardenrace_room_state_fast_v687', tokenPayload(winnerToken, { room_code_input: state.paardenCode }));
  if (paardenStage(persisted) !== 'finished' || String(persisted?.match?.winner_suit || '').toLowerCase() !== winnerSuit) {
    throw new Error('Paardenrace completion: finished state/winner did not persist on reread');
  }
  console.log(`Paardenrace natural completion PASS: winner=${winnerName}/${winnerSuit}, draws=${draws}, reshuffles=${reshuffles}`);
}

try {
  await setupOnlineRooms();
  console.log(`Online fixtures ready: Pikken=${state.pikkenId ? 'yes' : 'no'} Paardenrace=${state.paardenCode ? 'yes' : 'no'} Klaverjas=${state.klaverId ? 'yes' : 'no'}`);
  await browserAcceptance();
  console.log('RESULT=V792_LIVE_BROWSER_MULTI_CONTEXT_PASS');
  await completePikkenNaturally();
  console.log('RESULT=V792_PIKKEN_PLAY_TO_COMPLETION_PASS');
  await completePaardenraceNaturally();
  console.log('RESULT=V792_PAARDENRACE_PLAY_TO_COMPLETION_PASS');
  console.log('RESULT=V792_LIVE_GAME_COMPLETION_CERTIFICATION_PASS');
} catch (error) {
  failures.push(safe(error));
} finally {
  await cleanupOnlineRooms();
}

if (failures.length) {
  console.error('Final live browser certification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
