#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { expectedPageVersion, listPublishedHtml, readRootVersion } from './published-page-inventory.mjs';

const BASE = String(process.env.GEJAST_BASE_URL || 'https://kalenel.nl/').replace(/\/+$/, '') + '/';
const token1 = String(process.env.GEJAST_PLAYER1_TOKEN || '').trim();
const token2 = String(process.env.GEJAST_PLAYER2_TOKEN || '').trim();
const familyToken = String(process.env.GEJAST_FAMILY_TOKEN || '').trim();
const name1 = String(process.env.GEJAST_PLAYER1_NAME || '').trim();
const name2 = String(process.env.GEJAST_PLAYER2_NAME || '').trim();
const familyName = String(process.env.GEJAST_FAMILY_NAME || '').trim();
const siteScope = String(process.env.GEJAST_SITE_SCOPE || 'friends').trim() || 'friends';
const profileTarget = String(process.env.GEJAST_VISUAL_PROFILE_TARGET || 'Antoni').trim() || 'Antoni';
const timeout = Number(process.env.GEJAST_VISUAL_TIMEOUT_MS || 25000);
const settleMs = Number(process.env.GEJAST_VISUAL_SETTLE_MS || 1800);
const degradedFixtures = String(process.env.GEJAST_VISUAL_DEGRADED_FIXTURES || '') === '1';
const trackedConcurrency = Math.max(1, Math.min(10, Number(process.env.GEJAST_VISUAL_PAGE_CONCURRENCY || 6)));
const authSettleTimeout = degradedFixtures ? Math.min(timeout, 1500) : Math.min(timeout, 12000);
const outDir = path.resolve('visual-audit');
const screenshotsDir = path.join(outDir, 'screenshots');

if (!name1 || !name2 || !familyName) throw new Error('Two Friends names plus one Family visual-audit name are required');
if (!degradedFixtures && (!token1 || !token2 || !familyToken)) throw new Error('Two Friends sessions plus one Family visual-audit session are required outside degraded fixture mode');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(screenshotsDir, { recursive: true });

const configText = fs.readFileSync('gejast-config.js', 'utf8');
const supabaseUrl = configText.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
const publishableKey = configText.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];
if (!supabaseUrl || !publishableKey) throw new Error('Could not resolve checked-in Supabase public config');

const rootVersion = readRootVersion(process.cwd());
const trackedHtml = listPublishedHtml(process.cwd());
const expectedVersionByRoute = new Map(trackedHtml.map((rel) => {
  const source = fs.readFileSync(rel, 'utf8');
  return [rel, expectedPageVersion(rel, rootVersion, source)];
}));

const state = { pikkenId: '', pikkenCode: '', paardenCode: '', klaverId: '', klaverCode: '' };
const records = [];
function safe(value) {
  let text = String(value?.message || value || 'unknown');
  for (const [token, label] of [[token1, '[TOKEN1]'], [token2, '[TOKEN2]'], [familyToken, '[FAMILY_TOKEN]']]) {
    if (token) text = text.replaceAll(token, label);
  }
  return text;
}

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
const first = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');

async function setupContextRooms() {
  if (degradedFixtures) {
    console.log('DEGRADED_FIXTURE_MODE: skipping authenticated context-room creation; tracked-route/perimeter evidence only.');
    return;
  }

  try {
    const pikken = await rpc('pikken_create_lobby_fast_v687', tokenPayload(token1, { config_input: { penalty_mode: 'wrong_loses', start_dice: 3, visual_audit: true } }));
    state.pikkenId = String(first(pikken?.game?.id, pikken?.game_id, pikken?.id) || '');
    state.pikkenCode = String(first(pikken?.game?.lobby_code, pikken?.lobby_code, pikken?.code) || '');
    if (state.pikkenCode) await rpc('pikken_join_lobby_fast_v687', tokenPayload(token2, { lobby_code_input: state.pikkenCode }));
  } catch (error) { console.log(`context-room warning pikken: ${safe(error)}`); }

  try {
    const paarden = await rpc('create_paardenrace_room_fast_v687', tokenPayload(token1, { room_code_input: null, room_name_input: null }));
    state.paardenCode = String(first(paarden?.room?.room_code, paarden?.room_code, paarden?.code) || '').toUpperCase();
    if (state.paardenCode) await rpc('join_paardenrace_room_fast_v687', tokenPayload(token2, { room_code_input: state.paardenCode }));
  } catch (error) { console.log(`context-room warning paardenrace: ${safe(error)}`); }

  try {
    const klaver = await rpc('klaverjas_online_create', { session_token: token1, site_scope_input: siteScope, settings_input: { bot_count: 0, visual_audit: true } });
    state.klaverId = String(first(klaver?.game?.id, klaver?.game_id, klaver?.id) || '');
    state.klaverCode = String(first(klaver?.game?.lobby_code, klaver?.lobby_code, klaver?.code) || '');
    if (state.klaverCode) await rpc('klaverjas_online_join', { session_token: token2, lobby_code_input: state.klaverCode, site_scope_input: siteScope });
  } catch (error) { console.log(`context-room warning klaverjas: ${safe(error)}`); }
}

function routeUrl(route) {
  return new URL(route.replace(/^\/+/, ''), BASE).toString();
}

function outputName(label, index) {
  const clean = label.replace(/[^a-z0-9._-]+/gi, '__').replace(/^_+|_+$/g, '').slice(0, 150) || `route_${index}`;
  return `${String(index + 1).padStart(3, '0')}__${clean}.jpg`;
}

function issueSignals(text) {
  const patterns = [
    /game_key ongeldig/i,
    /game key ongeldig/i,
    /game_type ongeldig/i,
    /supabase config missing/i,
    /schema cache.*function/i,
    /could not find the function/i,
    /function .* does not exist/i,
    /laden mislukt/i,
    /kon niet worden geladen/i,
    /kan niet worden geladen/i,
    /unexpectedly redirected/i,
    /forbidden\b/i,
  ];
  return patterns.filter((rx) => rx.test(text)).map((rx) => rx.source);
}

function deeplyDecodedUrl(value) {
  let text = String(value || '');
  for (let i = 0; i < 4; i++) {
    try {
      const next = decodeURIComponent(text);
      if (next === text) break;
      text = next;
    } catch { break; }
  }
  return text;
}

function expectedProtected(route, status, finalUrl) {
  try {
    const u = new URL(finalUrl);
    const host = u.hostname.toLowerCase();
    if ((status === 401 || status === 403) && host === 'admin.kalenel.nl') return true;
    if (host !== 'github.com') return false;
    const decoded = deeplyDecodedUrl(finalUrl).toLowerCase();
    return decoded.includes('admin.kalenel.nl/oauth/callback')
      && (decoded.includes('/login/oauth/authorize') || decoded.includes('github.com/login'));
  } catch { return false; }
}

async function newContext(browser, tokenValue = token1, paardCode = '') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript(({ sessionToken, savedPaardCode }) => {
    if (sessionToken) {
      for (const store of [localStorage, sessionStorage]) {
        store.setItem('jas_session_token_v11', sessionToken);
        store.setItem('jas_session_token_v10', sessionToken);
        store.setItem('jas_last_activity_at_v1', String(Date.now()));
      }
    }
    if (savedPaardCode) {
      localStorage.setItem('gejast_paardenrace_room_code_v687', savedPaardCode);
      localStorage.setItem('gejast_paardenrace_room_code_v506', savedPaardCode);
    }
  }, { sessionToken: tokenValue, savedPaardCode: paardCode });
  return context;
}

function trackedRouteUsesAuthGate(route) {
  const repoPath = String(route || '').split('?')[0].replace(/^\/+/, '');
  if (!repoPath || !fs.existsSync(repoPath)) return false;
  try { return /gejast-auth-gate\.js/i.test(fs.readFileSync(repoPath, 'utf8')); }
  catch { return false; }
}

function declaredRedirectTarget(route) {
  const repoPath = String(route || '').split('?')[0].replace(/^\/+/, '');
  if (!repoPath || !fs.existsSync(repoPath)) return null;
  try {
    const sourceText = fs.readFileSync(repoPath, 'utf8');
    const match = sourceText.match(/(?:window\.)?location\.replace\(\s*(['"])([^'"]+)\1\s*\)/i);
    return match ? new URL(match[2], routeUrl(route)) : null;
  } catch (_) { return null; }
}

function redirectDestinationReached(target, current) {
  if (!target) return true;
  if (current.href === target.href) return true;
  return target.hostname === 'kalenel.nl'
    && current.hostname === 'admin.kalenel.nl'
    && target.pathname === current.pathname
    && target.search === current.search;
}

async function waitForAuthGateToSettle(page, route, kind) {
  const redirectTarget = declaredRedirectTarget(route);
  let expected = kind === 'context' || trackedRouteUsesAuthGate(route) || !!redirectTarget;

  if (!expected) {
    await page.waitForTimeout(250);
    let currentPath = '';
    try { currentPath = new URL(page.url()).pathname; } catch (_) {}
    let liveMarker = false;
    try { liveMarker = await page.evaluate(() => document.documentElement.hasAttribute('data-gejast-auth-state')); }
    catch (_) {}
    expected = trackedRouteUsesAuthGate(currentPath) || liveMarker;
  }
  if (!expected) return { expected: false, settled: true, state: '', waited_ms: 0 };

  const started = Date.now();
  const deadline = started + authSettleTimeout;
  let lastState = '';
  while (Date.now() < deadline) {
    let snapshot = { authState: '', pending: false, gatePresent: false, bodyVisible: false, bodyChars: 0 };
    try {
      snapshot = await page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;
        return {
          authState: root.getAttribute('data-gejast-auth-state') || '',
          pending: root.classList.contains('gejast-auth-pending'),
          gatePresent: !!document.querySelector('style[data-gejast-auth-gate]'),
          bodyVisible: !!body && getComputedStyle(body).visibility !== 'hidden',
          bodyChars: body ? (body.innerText || '').trim().length : 0,
        };
      });
    } catch (_) {}
    if (snapshot.authState) lastState = snapshot.authState;
    if (snapshot.authState || snapshot.pending || snapshot.gatePresent) expected = true;

    let current = null;
    try { current = new URL(page.url()); } catch (_) {}
    if (!current || !redirectDestinationReached(redirectTarget, current)) {
      await page.waitForTimeout(200);
      continue;
    }

    if (current.hostname === 'admin.kalenel.nl' && snapshot.bodyVisible && snapshot.bodyChars >= 20) {
      return { expected: true, settled: true, state: 'outer-admin', waited_ms: Date.now() - started };
    }
    if (current.pathname === '/login.html' && snapshot.authState !== 'checking' && snapshot.bodyVisible) {
      return { expected: true, settled: true, state: snapshot.authState || 'login', waited_ms: Date.now() - started };
    }

    const destinationGatePresent = snapshot.authState || snapshot.pending || snapshot.gatePresent;
    if (!destinationGatePresent && snapshot.bodyVisible && snapshot.bodyChars >= 20) {
      return { expected, settled: true, state: 'public-destination', waited_ms: Date.now() - started };
    }
    if (destinationGatePresent && !snapshot.pending && snapshot.authState && snapshot.authState !== 'checking' && snapshot.bodyVisible && snapshot.bodyChars >= 20) {
      return { expected: true, settled: true, state: snapshot.authState, waited_ms: Date.now() - started };
    }
    await page.waitForTimeout(200);
  }
  return { expected: true, settled: false, state: lastState, waited_ms: Date.now() - started };
}

async function capture(context, route, label, index, kind = 'tracked') {
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const httpErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(safe(msg.text())); });
  page.on('pageerror', (error) => pageErrors.push(safe(error)));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'failed';
    if (!/favicon/i.test(request.url())) failedRequests.push(`${request.method()} ${request.url()} :: ${failure}`);
  });
  page.on('response', (res) => {
    const status = res.status();
    if (status >= 400 && !/favicon/i.test(res.url())) {
      const request = res.request();
      httpErrors.push(`${request.method()} ${res.url()} :: HTTP ${status}`);
    }
  });

  let response = null;
  let finalNavigationStatus = 0;
  page.on('response', (res) => {
    try {
      const request = res.request();
      if (request.isNavigationRequest() && res.frame() === page.mainFrame()) finalNavigationStatus = res.status();
    } catch (_) {}
  });
  let navigationError = '';
  let authGate = { expected: false, settled: true, state: '', waited_ms: 0 };
  let authRetryCount = 0;
  const started = Date.now();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        authRetryCount += 1;
        consoleErrors.length = 0;
        pageErrors.length = 0;
        failedRequests.length = 0;
        httpErrors.length = 0;
        await page.waitForTimeout(700);
      }

      response = await page.goto(routeUrl(route), { waitUntil: 'domcontentloaded', timeout });
      const protectedOnArrival = expectedProtected(route, response?.status() || 0, page.url());
      authGate = { expected: false, settled: true, state: protectedOnArrival ? 'protected' : '', waited_ms: 0 };
      if (!protectedOnArrival) {
        authGate = await waitForAuthGateToSettle(page, route, kind);
      }
      await page.waitForTimeout(settleMs);
      const loadingDeadline = Date.now() + Math.min(10000, timeout);
      while (Date.now() < loadingDeadline) {
        const visibleLoading = await page.evaluate(() => ((document.body?.innerText || '').match(/Laden(?:…|\.\.\.)/gi) || []).length).catch(() => 0);
        if (!visibleLoading) break;
        await page.waitForTimeout(500);
      }

      let currentPath = '';
      try { currentPath = new URL(page.url()).pathname; } catch (_) {}
      const currentAuthState = await page.evaluate(() => document.documentElement.getAttribute('data-gejast-auth-state') || '').catch(() => '');
      const transientAuthFailure = !protectedOnArrival && authGate.expected && !authGate.settled;
      const contextualLoginFallback = kind === 'context' && currentPath === '/login.html' && currentAuthState !== 'authenticated';
      if ((!transientAuthFailure && !contextualLoginFallback) || attempt === 1) break;
    }
  } catch (error) {
    navigationError = safe(error);
  }

  const status = finalNavigationStatus || response?.status() || 0;
  const finalUrl = page.url();
  let finalPath = '';
  try { finalPath = new URL(finalUrl).pathname; } catch {}
  const authState = await page.evaluate(() => document.documentElement.getAttribute('data-gejast-auth-state') || '').catch(() => '');
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const repoPath = kind === 'tracked' ? String(route || '').split('?')[0].replace(/^\/+/, '') : '';
  const expectedVersion = kind === 'tracked' ? (expectedVersionByRoute.get(repoPath) || '') : '';
  const runtimeVersion = await page.evaluate(() => {
    const declared = String(window.GEJAST_PAGE_VERSION || window.GEJAST_SITE_VERSION || '').trim().toLowerCase();
    const selectors = '[data-version-watermark],.site-credit-watermark,.version-watermark,.watermark';
    const watermarkTexts = [...document.querySelectorAll(selectors)]
      .map((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return '';
        return String(el.textContent || '').replace(/\s+/g, ' ').trim();
      })
      .filter(Boolean);
    return { declared, watermarkTexts };
  }).catch(() => ({ declared: '', watermarkTexts: [] }));
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    visibleLinks: [...document.querySelectorAll('a')].filter((el) => {
      const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    }).length,
    visibleButtons: [...document.querySelectorAll('button,[role="button"]')].filter((el) => {
      const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    }).length,
  })).catch(() => ({ width: 0, scrollWidth: 0, scrollHeight: 0, visibleLinks: 0, visibleButtons: 0 }));
  const overflow = Math.max(0, Number(metrics.scrollWidth || 0) - Number(metrics.width || 0));
  const signals = issueSignals(bodyText);
  const staleLoadingCount = (bodyText.match(/Laden(?:…|\.\.\.)/gi) || []).length;
  const protectedGate = expectedProtected(route, status, finalUrl);
  const screenshot = outputName(label, index);
  try {
    await page.screenshot({ path: path.join(screenshotsDir, screenshot), type: 'jpeg', quality: 72, fullPage: true });
  } catch (error) {
    pageErrors.push(`screenshot ${safe(error)}`);
  }

  const seriousConsole = consoleErrors.filter((entry) => !/favicon|Failed to load resource.*404|net::ERR_ABORTED/i.test(entry));
  const seriousRequestFailures = failedRequests.filter((entry) => !/favicon|google-analytics|doubleclick/i.test(entry));
  const seriousHttpErrors = httpErrors.filter((entry) => !/favicon|google-analytics|doubleclick/i.test(entry));
  let judgement = 'pass';
  const reasons = [];
  if (protectedGate) { judgement = 'protected'; reasons.push('live Cloudflare admin perimeter correctly visible instead of protected asset'); }
  if (navigationError) { judgement = 'broken'; reasons.push(`navigation: ${navigationError}`); }
  if (!protectedGate && status >= 500) { judgement = 'broken'; reasons.push(`document HTTP ${status}`); }
  if (!protectedGate && authGate.expected && !authGate.settled) { judgement = 'broken'; reasons.push(`auth gate did not settle within ${authSettleTimeout}ms (last state ${authState || authGate.state || 'missing'})`); }
  if (!protectedGate && bodyText.trim().length < 20) { judgement = 'broken'; reasons.push('rendered body is effectively empty'); }
  if (!protectedGate && kind === 'tracked' && expectedVersion) {
    const declared = String(runtimeVersion.declared || '').toLowerCase();
    const expected = String(expectedVersion).toLowerCase();
    const expectedWatermark = (runtimeVersion.watermarkTexts || []).some((text) =>
      new RegExp('\\b' + expected.replace(/[.*+?^$\\{}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text) && /Made by Bruis/i.test(text)
    );
    if (declared && declared !== expected) {
      judgement = 'broken';
      reasons.push(`runtime page version ${declared} != expected ${expected}`);
    }
    if (!expectedWatermark) {
      judgement = 'broken';
      reasons.push(`runtime watermark does not expose ${expected} - Made by Bruis`);
    }
  }
  if (signals.length) { judgement = 'broken'; reasons.push(`visible runtime signal: ${signals.join(', ')}`); }
  if (kind === 'context' && finalPath === '/login.html') { judgement = 'broken'; reasons.push('contextual authenticated capture ended at login'); }
  if (kind === 'context' && authState !== 'authenticated') { judgement = 'broken'; reasons.push(`contextual auth state is ${authState || 'missing'}, expected authenticated`); }
  if (seriousConsole.length && judgement !== 'broken' && judgement !== 'protected') { judgement = 'warn'; reasons.push(`${seriousConsole.length} console error(s)`); }
  if (seriousRequestFailures.length && judgement === 'pass') { judgement = 'warn'; reasons.push(`${seriousRequestFailures.length} failed request(s)`); }
  if (seriousHttpErrors.length && judgement === 'pass') { judgement = 'warn'; reasons.push(`${seriousHttpErrors.length} HTTP error response(s)`); }
  if (overflow > 16 && judgement === 'pass') { judgement = 'warn'; reasons.push(`horizontal overflow ${overflow}px`); }
  if (staleLoadingCount > 0 && judgement === 'pass') { judgement = 'warn'; reasons.push(`${staleLoadingCount} visible loading placeholder(s) after ${settleMs}ms`); }

  const record = {
    index: index + 1,
    kind,
    route,
    label,
    screenshot: `screenshots/${screenshot}`,
    requested_url: routeUrl(route),
    final_url: finalUrl,
    status,
    title,
    expected_version: expectedVersion,
    runtime_version_declared: runtimeVersion.declared || '',
    runtime_watermark_texts: runtimeVersion.watermarkTexts || [],
    auth_state: authState,
    auth_gate_expected: authGate.expected,
    auth_gate_settled: authGate.settled,
    auth_gate_wait_ms: authGate.waited_ms,
    auth_retry_count: authRetryCount,
    elapsed_ms: Date.now() - started,
    body_chars: bodyText.trim().length,
    body_preview: bodyText.replace(/\s+/g, ' ').trim().slice(0, 700),
    visible_links: metrics.visibleLinks,
    visible_buttons: metrics.visibleButtons,
    scroll_height: metrics.scrollHeight,
    horizontal_overflow_px: overflow,
    stale_loading_count: staleLoadingCount,
    issue_signals: signals,
    console_errors: seriousConsole.slice(0, 20),
    page_errors: pageErrors.slice(0, 20),
    failed_requests: seriousRequestFailures.slice(0, 20),
    http_errors: seriousHttpErrors.slice(0, 20),
    judgement,
    reasons,
  };
  records.push(record);
  console.log(`${String(index + 1).padStart(3, '0')} ${judgement.toUpperCase().padEnd(9)} ${route} -> ${status || 'NAVERR'} ${title || '<no title>'}${reasons.length ? ` :: ${reasons.join('; ')}` : ''}`);
  await page.close();
}

function contextualRoutes() {
  const routes = [
    ['index.html', 'context__index__authenticated'],
    ['ladder.html?game=klaverjas', 'context__ladder__klaverjas'],
    ['ladder.html?game=boerenbridge', 'context__ladder__boerenbridge'],
    ['ladder.html?game=beerpong', 'context__ladder__beerpong'],
    [`player.html?player=${encodeURIComponent(profileTarget)}&game=klaverjas&scope=${encodeURIComponent(siteScope)}`, 'context__player__klaverjas'],
  ];
  if (state.pikkenId) {
    routes.push([`pikken_live.html?game_id=${encodeURIComponent(state.pikkenId)}`, 'context__pikken__live']);
    routes.push([`pikken_spectator.html?game_id=${encodeURIComponent(state.pikkenId)}`, 'context__pikken__spectator']);
  }
  if (state.paardenCode) {
    const q = `room=${encodeURIComponent(state.paardenCode)}&room_code=${encodeURIComponent(state.paardenCode)}`;
    routes.push([`paardenrace.html?${q}`, 'context__paardenrace__lobby']);
    routes.push([`paardenrace_live.html?${q}`, 'context__paardenrace__live']);
    routes.push([`paardenrace_spectator.html?${q}`, 'context__paardenrace__spectator']);
  }
  if (state.klaverId && state.klaverCode) {
    routes.push([`klaverjas_online.html?game_id=${encodeURIComponent(state.klaverId)}&room=${encodeURIComponent(state.klaverCode)}`, 'context__klaverjas__online']);
  }
  return routes;
}

function contextualFamilyRoutes() {
  return [
    ['index.html?scope=family', 'context__family__index'],
    ['ladder.html?game=klaverjas&scope=family', 'context__family__ladder'],
    ['leaderboard.html?scope=family', 'context__family__leaderboard'],
    ['profiles.html?scope=family', 'context__family__profiles'],
    [`player.html?player=${encodeURIComponent(familyName)}&scope=family`, 'context__family__player'],
    ['boerenbridge.html?scope=family', 'context__family__boerenbridge'],
    ['scorer.html?scope=family', 'context__family__scorer'],
  ];
}

function writeReports() {
  const counts = records.reduce((acc, row) => { acc[row.judgement] = (acc[row.judgement] || 0) + 1; return acc; }, {});
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    base_url: BASE,
    degraded_fixture_mode: degradedFixtures,
    certification_eligible: !degradedFixtures,
    tracked_html_count: trackedHtml.length,
    contextual_route_count: records.filter((row) => row.kind === 'context').length,
    total_screenshots: records.length,
    counts,
    context_state: { pikken_created: !!state.pikkenId, paardenrace_created: !!state.paardenCode, klaverjas_created: !!state.klaverId },
    records,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'tracked-html.txt'), `${trackedHtml.join('\n')}\n`);

  const bad = records.filter((row) => row.judgement === 'broken' || row.judgement === 'warn');
  const md = [
    '# Full live visual audit',
    '',
    `Generated: ${report.generated_at}`,
    `Fixture mode: ${degradedFixtures ? 'DEGRADED — anonymous/perimeter evidence only' : 'authenticated disposable fixtures'}`,
    `Certification eligible: ${report.certification_eligible ? 'yes' : 'no'}`,
    `Tracked HTML pages: ${trackedHtml.length}`,
    `Contextual variants: ${report.contextual_route_count}`,
    `Screenshots: ${records.length}`,
    `Judgements: ${JSON.stringify(counts)}`,
    '',
    '## Broken / warning pages',
    '',
    ...(bad.length ? bad.map((row) => `- **${row.judgement.toUpperCase()}** \`${row.route}\` — HTTP ${row.status}; ${row.reasons.join('; ') || 'see report.json'}; screenshot \`${row.screenshot}\``) : ['- None detected by automated runtime heuristics.']),
    '',
    '## All pages',
    '',
    ...records.map((row) => `- ${row.judgement.toUpperCase()} — \`${row.route}\` — ${row.title || '(no title)'} — \`${row.screenshot}\``),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'report.md'), md);

  const cards = records.map((row) => `<article class="card ${row.judgement}"><a href="${row.screenshot}"><img src="${row.screenshot}" loading="lazy" alt="${row.label.replaceAll('&','&amp;').replaceAll('"','&quot;')}"></a><div class="copy"><b>${row.judgement.toUpperCase()}</b><code>${row.route.replaceAll('&','&amp;').replaceAll('<','&lt;')}</code><span>${String(row.title || '').replaceAll('&','&amp;').replaceAll('<','&lt;')}</span><small>HTTP ${row.status} · overflow ${row.horizontal_overflow_px}px · loading ${row.stale_loading_count}</small><p>${row.reasons.join('; ').replaceAll('&','&amp;').replaceAll('<','&lt;')}</p></div></article>`).join('\n');
  fs.writeFileSync(path.join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Kalenel visual audit</title><style>body{font-family:system-ui;margin:20px;background:#eee;color:#111}.summary{position:sticky;top:0;background:#111;color:#fff;padding:12px 16px;border-radius:14px;z-index:2}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:16px}.card{background:#fff;border:3px solid #bbb;border-radius:14px;overflow:hidden}.card.broken{border-color:#c00}.card.warn{border-color:#d78b00}.card.protected{border-color:#4682b4}.card img{width:100%;height:300px;object-fit:cover;object-position:top;display:block;background:#ddd}.copy{padding:12px;display:grid;gap:6px}.copy code{white-space:normal;overflow-wrap:anywhere}.copy p{margin:0;color:#a00}</style><div class="summary">${records.length} screenshots · ${trackedHtml.length} tracked HTML · degraded=${degradedFixtures ? 'yes' : 'no'} · ${JSON.stringify(counts)}</div><div class="grid">${cards}</div>`);

  console.log(`RESULT=FULL_LIVE_VISUAL_AUDIT_COMPLETE tracked=${trackedHtml.length} screenshots=${records.length} broken=${counts.broken || 0} warn=${counts.warn || 0} protected=${counts.protected || 0} pass=${counts.pass || 0} degraded=${degradedFixtures ? 1 : 0}`);
  if ((counts.broken || 0) > 0) {
    console.error(`FULL_LIVE_VISUAL_AUDIT_FAIL broken=${counts.broken}`);
    process.exitCode = 1;
  }
  if (degradedFixtures) {
    console.error('FULL_LIVE_VISUAL_AUDIT_DEGRADED fixture provisioning unavailable; artifact is not certification eligible');
    process.exitCode = 1;
  }
  return counts;
}

await setupContextRooms();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.GEJAST_SYSTEM_CHROME ? { executablePath: process.env.GEJAST_SYSTEM_CHROME } : {}),
});
try {
  const indexedTracked = trackedHtml.map((htmlPath, index) => ({ htmlPath, index }));
  let nextTracked = 0;
  async function trackedWorker() {
    for (;;) {
      const cursor = nextTracked++;
      if (cursor >= indexedTracked.length) return;
      const { htmlPath, index } = indexedTracked[cursor];
      const familyRoute = htmlPath === 'familie.html' || htmlPath.startsWith('familie/');
      const sessionToken = degradedFixtures ? '' : (familyRoute ? familyToken : token1);
      const paardCode = (degradedFixtures || familyRoute) ? '' : state.paardenCode;
      const context = await newContext(browser, sessionToken, paardCode);
      try { await capture(context, htmlPath, htmlPath, index, 'tracked'); }
      finally { await context.close(); }
    }
  }

  const workers = Math.min(trackedConcurrency, indexedTracked.length || 1);
  console.log(`VISUAL_AUDIT_TRACKED_CONCURRENCY workers=${workers} pages=${indexedTracked.length}`);
  await Promise.all(Array.from({ length: workers }, () => trackedWorker()));

  let index = trackedHtml.length;
  if (!degradedFixtures) {
    for (const [route, label] of contextualRoutes()) {
      const context = await newContext(browser, token1, state.paardenCode);
      try { await capture(context, route, label, index++, 'context'); }
      finally { await context.close(); }
    }
    for (const [route, label] of contextualFamilyRoutes()) {
      const context = await newContext(browser, familyToken, '');
      try { await capture(context, route, label, index++, 'context'); }
      finally { await context.close(); }
    }
  }
} finally {
  await browser.close();
  records.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  writeReports();
}
