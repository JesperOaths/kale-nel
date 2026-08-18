#!/usr/bin/env node
import { chromium } from 'playwright';

const BASE = String(process.env.GEJAST_BASE_URL || 'https://kalenel.nl/').replace(/\/+$/, '') + '/';
const token = String(process.env.GEJAST_FAMILY_TOKEN || '').trim();
const familyName = String(process.env.GEJAST_FAMILY_NAME || '').trim();
const chrome = String(process.env.GEJAST_SYSTEM_CHROME || '').trim();
const timeout = Number(process.env.GEJAST_BROWSER_TIMEOUT_MS || 25000);
if (!/^[0-9a-f]{48}$/.test(token)) throw new Error('Canonical Family session token required');
if (!familyName) throw new Error('Family fixture name required');
if (!chrome) throw new Error('System Chrome path required');

const staleRpc = [];
const nestedAsset = [];
const browserErrors = [];
const records = [];
const routes = [
  { route: 'familie/index.html', finalPath: '/index.html', required: ['scope=family'] },
  { route: 'familie/ladder.html', finalPath: '/ladder.html', required: ['game=klaverjas', 'scope=family'] },
  { route: 'familie/profiles.html', finalPath: '/profiles.html', required: ['scope=family'] },
  { route: 'familie/player.html', finalPath: '/profiles.html', required: ['scope=family'], emptyAlias: true },
  { route: `familie/player.html?player=${encodeURIComponent(familyName)}`, finalPath: '/player.html', required: [`player=${encodeURIComponent(familyName)}`, 'scope=family'], namedAlias: true },
  { route: 'familie/scorer.html', finalPath: '/scorer.html', required: ['scope=family'] },
  { route: 'familie/boerenbridge.html', finalPath: '/boerenbridge.html', required: ['scope=family'] },
];

function isStaleSessionRpc(url) {
  return /\/rest\/v1\/rpc\/get_public_state(?:\?|$)/i.test(url);
}
function isWrongNestedSharedAsset(url) {
  return /\/familie\/(?:gejast-[^/?]+\.js|VERSION)(?:\?|$)/i.test(url);
}
function normalizeError(text) {
  return String(text || '').replaceAll(token, '[TOKEN]').replaceAll(familyName, '[FAMILY]');
}

const browser = await chromium.launch({ headless: true, executablePath: chrome });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(({ tokenValue }) => {
  for (const store of [localStorage, sessionStorage]) {
    store.setItem('jas_session_token_v11', tokenValue);
    store.setItem('jas_session_token_v10', tokenValue);
  }
  localStorage.setItem('jas_last_activity_at_v1', String(Date.now()));
}, { tokenValue: token });

try {
  for (const spec of routes) {
    const page = await context.newPage();
    const routeRequests = [];
    const routeErrors = [];
    page.on('request', (req) => {
      const url = req.url();
      routeRequests.push(url);
      if (isStaleSessionRpc(url)) staleRpc.push(`${spec.route} :: ${url}`);
      if (isWrongNestedSharedAsset(url)) nestedAsset.push(`${spec.route} :: ${url}`);
    });
    page.on('pageerror', (err) => routeErrors.push(`pageerror ${normalizeError(err?.message || err)}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = normalizeError(msg.text());
      if (/favicon/i.test(text)) return;
      routeErrors.push(`console ${text}`);
    });

    const response = await page.goto(new URL(spec.route, BASE).toString(), { waitUntil: 'domcontentloaded', timeout });
    if (!response || response.status() >= 500) throw new Error(`${spec.route}: document HTTP ${response?.status() || 'none'}`);
    await page.waitForFunction(() => {
      if (/login\.html$/i.test(location.pathname)) return true;
      const root = document.documentElement;
      const state = root.getAttribute('data-gejast-auth-state');
      return state === 'authenticated' && !root.classList.contains('gejast-auth-pending');
    }, null, { timeout }).catch(async () => {
      // Redirect-only aliases may immediately land on canonical pages where the gate
      // has already settled before this wait begins; capture the current state below.
    });
    await page.waitForTimeout(900);

    const final = new URL(page.url());
    if (/\/login\.html$/i.test(final.pathname)) throw new Error(`${spec.route}: unexpectedly redirected to login`);
    if (final.pathname !== spec.finalPath) throw new Error(`${spec.route}: expected ${spec.finalPath}, got ${final.pathname}`);
    for (const piece of spec.required) {
      if (!`${final.searchParams.toString()}`.includes(piece)) throw new Error(`${spec.route}: missing final query fragment ${piece}; final=${final.href}`);
    }
    const rootState = await page.evaluate(() => ({
      auth: document.documentElement.getAttribute('data-gejast-auth-state') || '',
      pending: document.documentElement.classList.contains('gejast-auth-pending'),
      visibility: getComputedStyle(document.body).visibility,
      body: (document.body.innerText || '').trim(),
    }));
    if (rootState.pending) throw new Error(`${spec.route}: legacy auth pending class remained after settle`);
    if (rootState.auth && rootState.auth !== 'authenticated') throw new Error(`${spec.route}: canonical auth state=${rootState.auth}`);
    if (rootState.visibility === 'hidden') throw new Error(`${spec.route}: body remained hidden after authentication`);
    if (rootState.body.length < 20) throw new Error(`${spec.route}: rendered body is unexpectedly empty`);
    if (spec.namedAlias && !rootState.body.toLowerCase().includes(familyName.toLowerCase())) {
      throw new Error(`${spec.route}: named Family player page did not render the requested fixture`);
    }
    if (routeErrors.some((x) => /mime type|refused to execute script/i.test(x))) {
      throw new Error(`${spec.route}: nested asset MIME/runtime error: ${routeErrors.join(' | ')}`);
    }
    browserErrors.push(...routeErrors.map((x) => `${spec.route} :: ${x}`));
    records.push({ route: spec.route, final: `${final.pathname}${final.search}`, requests: routeRequests.length, errors: routeErrors.length });
    console.log(`FAMILY_ROUTE_PASS ${spec.route} -> ${final.pathname}${final.search}`);
    await page.close();
  }
} finally {
  await context.close();
  await browser.close();
}

if (staleRpc.length) throw new Error(`Stale get_public_state RPCs observed: ${staleRpc.join(' | ')}`);
if (nestedAsset.length) throw new Error(`Wrong nested Family shared-asset requests observed: ${nestedAsset.join(' | ')}`);
const seriousErrors = browserErrors.filter((x) => !/Failed to load resource: the server responded with a status of 400/i.test(x));
if (seriousErrors.length) throw new Error(`Unexpected Family browser errors: ${seriousErrors.join(' | ')}`);
console.log(`RESULT=V808_FAMILY_RUNTIME_PASS routes=${records.length} stale_rpc=0 nested_asset=0`);
