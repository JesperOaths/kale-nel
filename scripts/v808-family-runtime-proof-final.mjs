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
const nestedSharedAssets = [];
const pageErrors = [];
const httpDiagnostics = [];
const routes = [
  { route: 'familie/index.html', finalPath: '/index.html', required: ['scope=family'] },
  { route: 'familie/ladder.html', finalPath: '/ladder.html', required: ['game=klaverjas', 'scope=family'] },
  { route: 'familie/profiles.html', finalPath: '/profiles.html', required: ['scope=family'] },
  { route: 'familie/player.html', finalPath: '/profiles.html', required: ['scope=family'] },
  { route: `familie/player.html?player=${encodeURIComponent(familyName)}`, finalPath: '/player.html', required: [`player=${encodeURIComponent(familyName)}`, 'scope=family'], namedAlias: true },
  { route: 'familie/scorer.html', finalPath: '/scorer.html', required: ['scope=family'] },
  { route: 'familie/boerenbridge.html', finalPath: '/boerenbridge.html', required: ['scope=family'] },
];

const staleRe = /\/rest\/v1\/rpc\/get_public_state(?:\?|$)/i;
const nestedRe = /\/familie\/(?:gejast-[^/?]+\.js|VERSION)(?:\?|$)/i;
const clean = (text) => String(text || '').replaceAll(token, '[TOKEN]').replaceAll(familyName, '[FAMILY]');

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
    page.on('request', (req) => {
      const url = req.url();
      if (staleRe.test(url)) staleRpc.push(`${spec.route} :: ${url}`);
      if (nestedRe.test(url)) nestedSharedAssets.push(`${spec.route} :: ${url}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 400) httpDiagnostics.push(`${spec.route} :: ${res.request().method()} ${res.status()} ${res.url()}`);
    });
    page.on('pageerror', (err) => pageErrors.push(`${spec.route} :: ${clean(err?.message || err)}`));

    const response = await page.goto(new URL(spec.route, BASE).toString(), { waitUntil: 'domcontentloaded', timeout });
    if (!response || response.status() >= 500) throw new Error(`${spec.route}: document HTTP ${response?.status() || 'none'}`);
    await page.waitForFunction(() => {
      if (/login\.html$/i.test(location.pathname)) return true;
      const root = document.documentElement;
      return root.getAttribute('data-gejast-auth-state') === 'authenticated' && !root.classList.contains('gejast-auth-pending');
    }, null, { timeout });

    const final = new URL(page.url());
    if (/\/login\.html$/i.test(final.pathname)) throw new Error(`${spec.route}: unexpectedly redirected to login`);
    if (final.pathname !== spec.finalPath) throw new Error(`${spec.route}: expected ${spec.finalPath}, got ${final.pathname}`);
    const finalQuery = final.searchParams.toString();
    for (const piece of spec.required) {
      if (!finalQuery.includes(piece)) throw new Error(`${spec.route}: missing ${piece}; final=${final.href}`);
    }

    if (spec.namedAlias) {
      await page.waitForFunction((expected) => {
        const wanted = String(expected || '').trim().toLowerCase();
        const title = (document.getElementById('title')?.textContent || '').trim().toLowerCase();
        const body = (document.body?.innerText || '').toLowerCase();
        return !!wanted && (title.includes(wanted) || body.includes(wanted));
      }, familyName, { timeout });
    } else {
      await page.waitForTimeout(500);
    }

    const state = await page.evaluate(() => ({
      auth: document.documentElement.getAttribute('data-gejast-auth-state') || '',
      pending: document.documentElement.classList.contains('gejast-auth-pending'),
      visibility: getComputedStyle(document.body).visibility,
      bodyLength: (document.body.innerText || '').trim().length,
    }));
    if (state.pending || state.visibility === 'hidden') throw new Error(`${spec.route}: remained auth-hidden after settle`);
    if (state.auth && state.auth !== 'authenticated') throw new Error(`${spec.route}: canonical auth state=${state.auth}`);
    if (state.bodyLength < 20) throw new Error(`${spec.route}: rendered body unexpectedly empty`);

    console.log(`FAMILY_ROUTE_PASS ${spec.route} -> ${final.pathname}${final.search}`);
    await page.close();
  }
} finally {
  await context.close();
  await browser.close();
}

if (staleRpc.length) throw new Error(`Stale get_public_state RPCs observed: ${staleRpc.join(' | ')}`);
if (nestedSharedAssets.length) throw new Error(`Wrong nested Family shared assets observed: ${nestedSharedAssets.join(' | ')}`);
if (pageErrors.length) throw new Error(`Family page errors observed: ${pageErrors.join(' | ')}`);
for (const row of httpDiagnostics) console.log(`FAMILY_HTTP_DIAGNOSTIC ${row}`);
console.log(`RESULT=V808_FAMILY_RUNTIME_PASS routes=${routes.length} stale_rpc=0 nested_asset=0 page_errors=0 http_diagnostics=${httpDiagnostics.length}`);
