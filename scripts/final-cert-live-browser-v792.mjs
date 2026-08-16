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

async function setupOnlineRooms() {
  const pikken = await rpc('pikken_create_lobby_fast_v687', tokenPayload(token1, { config_input: { penalty_mode: 'wrong_loses', start_dice: 6, final_certification: true } }));
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

try {
  await setupOnlineRooms();
  console.log(`Online fixtures ready: Pikken=${state.pikkenId ? 'yes' : 'no'} Paardenrace=${state.paardenCode ? 'yes' : 'no'} Klaverjas=${state.klaverId ? 'yes' : 'no'}`);
  await browserAcceptance();
  console.log('RESULT=V792_LIVE_BROWSER_MULTI_CONTEXT_PASS');
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
