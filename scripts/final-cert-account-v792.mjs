#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = new URL(process.env.GEJAST_BASE_URL || 'https://kalenel.nl/');
const MODE = process.env.GEJAST_ACCOUNT_MODE || '';
const NAME = process.env.GEJAST_ACCOUNT_NAME || '';
const EMAIL = process.env.GEJAST_ACCOUNT_EMAIL || '';
const PIN = process.env.GEJAST_ACCOUNT_PIN || '4827';
const ACTIVATION_TOKEN = process.env.GEJAST_ACTIVATION_TOKEN || '';
const TIMEOUT = Number(process.env.GEJAST_BROWSER_TIMEOUT_MS || 30000);
const SYSTEM_CHROME = String(process.env.GEJAST_SYSTEM_CHROME || '').trim();

assert.ok(NAME, 'GEJAST_ACCOUNT_NAME required');
assert.ok(EMAIL, 'GEJAST_ACCOUNT_EMAIL required');
assert.match(PIN, /^\d{4}$/, 'GEJAST_ACCOUNT_PIN must be four digits');
assert.ok(['request', 'activate_login'].includes(MODE), `unsupported GEJAST_ACCOUNT_MODE=${MODE}`);
if (MODE === 'activate_login') assert.ok(ACTIVATION_TOKEN, 'GEJAST_ACTIVATION_TOKEN required for activation mode');
if (SYSTEM_CHROME) assert.ok(fs.existsSync(SYSTEM_CHROME), `GEJAST_SYSTEM_CHROME does not exist: ${SYSTEM_CHROME}`);

const browser = await chromium.launch({ headless: true, ...(SYSTEM_CHROME ? { executablePath: SYSTEM_CHROME } : {}) });

function liveUrl(path) {
  const url = new URL(path, BASE);
  url.searchParams.set('_final_cert', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return url.toString();
}

async function attachDiagnostics(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[${label} browser ${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => console.log(`[${label} pageerror] ${err.message}`));
}

async function gotoReady(page, url, selector) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      assert.ok(res && res.ok(), `HTTP ${res?.status()} loading ${url}`);
      await page.locator(selector).waitFor({ state: 'visible', timeout: TIMEOUT });
      return;
    } catch (err) {
      last = err;
      if (attempt === 5) break;
      await page.waitForTimeout(attempt * 1000);
    }
  }
  throw last;
}

async function storedPlayerToken(page) {
  return page.evaluate(() => {
    const preferred = ['jas_session_token_v11', 'jas_session_token_v10'];
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of preferred) {
        const value = storage.getItem(key);
        if (value) return value;
      }
    }
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i) || '';
        if (/session.*token|token.*session/i.test(key)) {
          const value = storage.getItem(key);
          if (value) return value;
        }
      }
    }
    return '';
  });
}

async function canonicalState(page, token) {
  return page.evaluate(async ({ token, expectedScope }) => {
    const cfg = window.GEJAST_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) throw new Error('GEJAST Supabase config missing in live page');
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/account_public_state_v687`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        apikey: cfg.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ session_token_input: token, site_scope_input: expectedScope })
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { throw new Error(`state non-JSON HTTP ${res.status}: ${text}`); }
    if (!res.ok) throw new Error(`state HTTP ${res.status}: ${JSON.stringify(data)}`);
    return data?.account_public_state_v687 ?? data;
  }, { token, expectedScope: 'friends' });
}

async function waitForOption(select, expected) {
  await select.locator(`option[value="${expected.replaceAll('"', '\\"')}"]`).waitFor({ state: 'attached', timeout: TIMEOUT });
}

try {
  if (MODE === 'request') {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await attachDiagnostics(page, 'request');
    await gotoReady(page, liveUrl('request.html'), '#requestForm');

    const select = page.locator('#requestNameSelect');
    await waitForOption(select, NAME);
    await select.selectOption({ label: NAME });
    await page.locator('#requestEmailInput').fill(EMAIL);
    await page.locator('#requestNoteInput').fill('v792 final disposable browser certification');
    await page.locator('#requestForm button[type="submit"]').click();
    await page.locator('#status').filter({ hasText: /Aanvraag verstuurd/i }).waitFor({ state: 'visible', timeout: TIMEOUT });

    const status = (await page.locator('#status').innerText()).trim();
    assert.match(status, /Aanvraag verstuurd/i);
    console.log(`ACCOUNT_REQUEST_BROWSER_PASS name=${NAME}`);
    await context.close();
  }

  if (MODE === 'activate_login') {
    const activationContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const activationPage = await activationContext.newPage();
    await attachDiagnostics(activationPage, 'activation');
    const activationUrl = new URL('activate.html', BASE);
    activationUrl.searchParams.set('token', ACTIVATION_TOKEN);
    activationUrl.searchParams.set('_final_cert', String(Date.now()));
    await gotoReady(activationPage, activationUrl.toString(), '#activateForm');

    await activationPage.locator('#approvedName').filter({ hasText: NAME }).waitFor({ state: 'visible', timeout: TIMEOUT });
    await activationPage.locator('#approvedEmail').filter({ hasText: EMAIL }).waitFor({ state: 'visible', timeout: TIMEOUT });
    await activationPage.locator('#pinInput').fill(PIN);
    await activationPage.locator('#pinConfirmInput').fill(PIN);
    await activationPage.locator('#activateForm button[type="submit"]').click();
    await activationPage.locator('#status').filter({ hasText: /Account geactiveerd/i }).waitFor({ state: 'visible', timeout: TIMEOUT });

    await activationPage.waitForTimeout(900);
    if (!/index\.html|\/$/.test(new URL(activationPage.url()).pathname)) {
      await activationPage.goto(liveUrl('index.html'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    }
    const activationSession = await storedPlayerToken(activationPage);
    assert.ok(activationSession.length >= 20, 'activation did not store a canonical player session token');
    const activationState = await canonicalState(activationPage, activationSession);
    assert.equal(activationState?.ok, true, `activation session public state not ok: ${JSON.stringify(activationState)}`);
    assert.equal(String(activationState?.display_name || activationState?.player_name || activationState?.my_name), NAME);
    console.log('ACCOUNT_ACTIVATION_AND_STATE_PASS');

    await gotoReady(activationPage, liveUrl('login.html'), '#loginForm');
    assert.ok(await storedPlayerToken(activationPage), 'expected activation session before logout');
    await activationPage.locator('#logoutBtn').click();
    await activationPage.locator('#statusBox').filter({ hasText: /Sessie gewist/i }).waitFor({ state: 'visible', timeout: TIMEOUT });
    assert.equal(await storedPlayerToken(activationPage), '', 'logout left a player session token in browser storage');
    console.log('ACCOUNT_CLIENT_LOGOUT_PASS');
    await activationContext.close();

    const loginContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const loginPage = await loginContext.newPage();
    await attachDiagnostics(loginPage, 'fresh-login');
    await gotoReady(loginPage, liveUrl('login.html'), '#loginForm');
    const loginSelect = loginPage.locator('#playerNameInput');
    await waitForOption(loginSelect, NAME);
    await loginSelect.selectOption({ label: NAME });
    await loginPage.locator('#pinInput').fill(PIN);
    await loginPage.locator('#loginBtn').click();
    await loginPage.locator('#statusBox').filter({ hasText: new RegExp(`Ingelogd als ${NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') }).waitFor({ state: 'visible', timeout: TIMEOUT });
    await loginPage.waitForTimeout(650);
    const loginSession = await storedPlayerToken(loginPage);
    assert.ok(loginSession.length >= 20, 'fresh PIN login did not store a canonical session token');
    assert.notEqual(loginSession, activationSession, 'fresh login should issue a new canonical session token');
    const loginState = await canonicalState(loginPage, loginSession);
    assert.equal(loginState?.ok, true, `fresh login public state not ok: ${JSON.stringify(loginState)}`);
    assert.equal(String(loginState?.display_name || loginState?.player_name || loginState?.my_name), NAME);
    console.log('ACCOUNT_FRESH_LOGIN_AND_STATE_PASS');
    await loginContext.close();
  }
} finally {
  await browser.close();
}
