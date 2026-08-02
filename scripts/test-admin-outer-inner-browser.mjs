import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import worker, { __test } from '../cloudflare/workers/admin-gate/src/worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const staticRoot = path.join(root, 'cloudflare', 'workers', 'admin-gate', 'static');
const sensitiveSuffix = String.fromCharCode(83, 69, 67, 82, 69, 84);
const OUTER_COOKIE_NAME = ['__Host-kalenel', 'admin', 'session'].join('_');
const INNER_SESSION_KEY = ['jas', 'admin', 'session', 'v8'].join('_');
const FAKE_SIGNING_VALUE = Array.from({ length: 10 }, (_, i) => `fixture-part-${i}`).join('|');
const ENV_KEYS = {
  cookie: ['COOKIE', sensitiveSuffix].join('_'),
  clientId: ['GITHUB', 'CLIENT', 'ID'].join('_'),
  clientCred: ['GITHUB', 'CLIENT', sensitiveSuffix].join('_'),
  approvedId: ['APPROVED', 'GITHUB', 'ID'].join('_'),
  approvedLogin: ['APPROVED', 'GITHUB', 'LOGIN'].join('_')
};

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function env() {
  return {
    [ENV_KEYS.cookie]: FAKE_SIGNING_VALUE,
    [ENV_KEYS.clientId]: 'Iv1.notrealclientid',
    [ENV_KEYS.clientCred]: Array.from({ length: 12 }, (_, i) => `fixture${i}`).join('-'),
    [ENV_KEYS.approvedId]: '12345',
    [ENV_KEYS.approvedLogin]: 'bruis-approved',
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        const pathname = url.pathname === '/' ? '/admin.html' : url.pathname;
        const safe = path.normalize(pathname).replace(/^([/\\])+/, '');
        if (safe.includes('..')) return new Response('missing', { status: 404 });
        const file = path.join(staticRoot, safe);
        try {
          const body = await fs.readFile(file);
          return new Response(body, { status: 200, headers: { 'Content-Type': contentType(file) } });
        } catch (_) {
          return new Response('missing', { status: 404 });
        }
      }
    }
  };
}

function responseHeaders(headers) {
  const out = {};
  for (const [key, value] of headers) out[key] = value;
  return out;
}

async function installRoutes(context, signedOuterCookie, mode) {
  await context.addCookies([{ name: OUTER_COOKIE_NAME, value: signedOuterCookie.split('=').slice(1).join('='), domain: 'admin.kalenel.nl', path: '/', secure: true, httpOnly: true, sameSite: 'Strict' }]);
  await context.route('https://admin.kalenel.nl/**', async (route) => {
    const request = route.request();
    const headers = { ...request.headers() };
    if (!headers.cookie) headers.cookie = `${OUTER_COOKIE_NAME}=${signedOuterCookie.split('=').slice(1).join('=')}`;
    const body = ['GET', 'HEAD'].includes(request.method()) ? undefined : request.postDataBuffer();
    const workerResponse = await worker.fetch(new Request(request.url(), { method: request.method(), headers, body, redirect: 'manual' }), env(), {});
    await route.fulfill({ status: workerResponse.status, headers: responseHeaders(workerResponse.headers), body: Buffer.from(await workerResponse.arrayBuffer()) });
  });
  await context.route('https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/**', async (route) => {
    const rpc = new URL(route.request().url()).pathname.split('/').pop();
    if (mode === 'valid-inner' && rpc === 'admin_check_session') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ admin_session_token: 'mock-inner', admin_username: 'admin' }) });
    if (mode === 'valid-inner' && rpc === 'admin_check_session_with_device') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ admin_session_token: 'mock-inner', admin_username: 'admin', raw_device_token: 'device' }) });
    if (mode === 'valid-inner') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [], history: [], items: [] }) });
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'mock invalid inner session' }) });
  });
}

async function runBrowser(browserName, browserType) {
  const signed = await __test.signedCookie(env(), OUTER_COOKIE_NAME, { kind: 'session', github: { id: '12345', login: 'bruis-approved' }, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, nonce: `browser-${browserName}` }, 300);
  const cookieValue = signed.match(new RegExp(`${OUTER_COOKIE_NAME}=([^;]+)`))?.[1];
  assert.ok(cookieValue, 'synthetic outer cookie produced');

  async function scenario(name, mode, initialUrl, seedInner = false) {
    const browser = await browserType.launch({ headless: true });
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } });
    await installRoutes(context, `${OUTER_COOKIE_NAME}=${cookieValue}`, mode);
    const page = await context.newPage();
    const chain = [];
    const navStacks = [];
    page.on('request', (req) => {
      if (req.frame() === page.mainFrame() && req.resourceType() === 'document') {
        chain.push({ event: 'request', url: req.url(), redirectedFrom: req.redirectedFrom()?.url() || '', stack: navStacks.at(-1)?.stack || '' });
      }
    });
    page.on('response', (res) => {
      const req = res.request();
      if (req.frame() === page.mainFrame() && req.resourceType() === 'document') chain.push({ event: 'response', url: res.url(), status: res.status(), location: res.headers().location || '' });
    });
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) chain.push({ event: 'framenavigated', url: frame.url() }); });
    page.on('console', (msg) => { if (msg.type() === 'error') chain.push({ event: 'console-error', text: msg.text() }); });
    await page.addInitScript(() => {
      const record = (kind, value) => {
        window.__navStacks = window.__navStacks || [];
        window.__navStacks.push({ kind, value: String(value), stack: new Error(`${kind}:${value}`).stack });
      };
      const originalAssign = window.location.assign.bind(window.location);
      const originalReplace = window.location.replace.bind(window.location);
      window.location.assign = (value) => { record('location.assign', value); return originalAssign(value); };
      window.location.replace = (value) => { record('location.replace', value); return originalReplace(value); };
      const originalSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value) {
        if (this.tagName === 'META' && String(name).toLowerCase() === 'http-equiv' && String(value).toLowerCase() === 'refresh') record('meta-refresh', value);
        return originalSetAttribute.call(this, name, value);
      };
    });
    if (seedInner) {
      await page.goto('https://admin.kalenel.nl/admin.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.evaluate((key) => { localStorage.setItem(key, 'mock-inner'); sessionStorage.setItem(key, 'mock-inner'); }, INNER_SESSION_KEY);
      chain.length = 0;
    }
    let failed = null;
    try {
      await page.goto(initialUrl, { waitUntil: 'load', timeout: 20000 });
      await page.waitForTimeout(900);
    } catch (error) {
      failed = error;
    }
    const stacks = await page.evaluate(() => window.__navStacks || []).catch(() => []);
    navStacks.push(...stacks);
    const state = await page.evaluate(() => ({
      url: location.href,
      pathname: location.pathname,
      search: location.search,
      loginVisible: !document.getElementById('loginView')?.classList.contains('hidden'),
      hubHidden: document.getElementById('hubView')?.classList.contains('hidden'),
      hubVisible: !document.getElementById('hubView')?.classList.contains('hidden'),
      loginHidden: document.getElementById('loginView')?.classList.contains('hidden'),
      status: document.getElementById('statusBox')?.textContent || ''
    })).catch(() => ({}));
    const docRequests = chain.filter((entry) => entry.event === 'request');
    if (docRequests.length > 10) throw new Error(`${browserName}/${name} exceeded navigation cap: ${JSON.stringify({ chain, navStacks }, null, 2)}`);
    await browser.close();
    return { browserName, name, failed: failed?.message || '', chain, navStacks, state, docRequestCount: docRequests.length };
  }

  const missing = await scenario('admin-html-missing-inner', 'missing-inner', 'https://admin.kalenel.nl/admin.html');
  assert.equal(missing.failed, '', JSON.stringify(missing, null, 2));
  assert.equal(missing.docRequestCount, 1, JSON.stringify(missing, null, 2));
  assert.equal(missing.state.url, 'https://admin.kalenel.nl/admin.html', JSON.stringify(missing, null, 2));
  assert.equal(missing.state.loginVisible, true, JSON.stringify(missing, null, 2));
  assert.equal(missing.state.hubHidden, true, JSON.stringify(missing, null, 2));
  assert.equal(missing.navStacks.length, 0, JSON.stringify(missing, null, 2));

  const valid = await scenario('admin-html-valid-inner', 'valid-inner', 'https://admin.kalenel.nl/admin.html', true);
  assert.equal(valid.failed, '', JSON.stringify(valid, null, 2));
  assert.equal(valid.state.url, 'https://admin.kalenel.nl/admin.html', JSON.stringify(valid, null, 2));
  assert.equal(valid.state.loginHidden, true, JSON.stringify(valid, null, 2));
  assert.equal(valid.state.hubVisible, true, JSON.stringify(valid, null, 2));

  const protectedPage = await scenario('protected-subpage-missing-inner', 'missing-inner', 'https://admin.kalenel.nl/admin_claims.html');
  const responses = protectedPage.chain.filter((entry) => entry.event === 'response').map((entry) => [entry.status, entry.location || '']);
  assert.deepEqual(responses.slice(0, 2), [[200, ''], [200, '']], JSON.stringify(protectedPage, null, 2));
  assert.equal(protectedPage.state.pathname, '/admin.html', JSON.stringify(protectedPage, null, 2));
  assert.match(protectedPage.state.search, /reason=session_invalid/, JSON.stringify(protectedPage, null, 2));
  assert.match(protectedPage.state.search, /return_to=admin_claims\.html/, JSON.stringify(protectedPage, null, 2));

  return [missing, valid, protectedPage];
}

const results = [
  ...(await runBrowser('chromium', chromium)),
  ...(await runBrowser('firefox', firefox))
];
await fs.writeFile(path.join(root, 'ADMIN_OUTER_INNER_BROWSER_PROOF_20260801.json'), JSON.stringify(results, null, 2) + '\n');
console.log('admin outer/inner browser integration passed');
