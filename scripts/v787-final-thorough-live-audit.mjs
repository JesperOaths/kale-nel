#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, firefox, webkit } from 'playwright';

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const base = 'https://kalenel.nl';
const routes = [
  '/', '/index.html', '/scorer.html', '/score.html', '/klaverjas_scorer_v596_repo_ready.html',
  '/klaverjas_live.html', '/klaverjas_online.html', '/toepen.html', '/beerpong.html', '/boerenbridge.html',
  '/boerenbridge_live.html', '/pikken.html', '/pikken_live.html', '/pikken_spectator.html', '/paardenrace.html',
  '/paardenrace_live.html', '/paardenrace_spectator.html', '/drinks.html', '/drinks_add.html', '/drinks_pending.html',
  '/drinks_history.html', '/drinks_speed.html', '/despimarkt.html', '/beurs.html', '/rad.html', '/profiles.html',
  '/my_profile.html', '/login.html', '/request.html', '/activate.html', '/familie.html', '/familie/index.html',
  '/familie/login.html', '/familie/scorer.html', '/familie/leaderboard.html'
];
const viewports = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1366, height: 768 }
];
const engines = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit]
];
const familyTargets = new Map([
  ['/familie/index.html', ['/index.html', 'family']],
  ['/familie/login.html', ['/login.html', 'family']],
  ['/familie/scorer.html', ['/scorer.html', 'family']],
  ['/familie/leaderboard.html', ['/leaderboard.html', 'family']]
]);

const failures = [];
const rows = [];
let blockedNonGet = 0;
let total = 0;

function clean(value, max = 700) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function sameSite(url) {
  try { return new URL(url).hostname === 'kalenel.nl'; } catch { return false; }
}
function uniq(values) { return [...new Set(values)]; }

async function auditPage(browser, engineName, viewport, routePath) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const badSameOrigin = [];
  const badExternal = [];
  const failedSameOrigin = [];
  const blockedLoginNavs = [];
  const navs = [];
  const wrongFamilyRequests = [];
  const requestTrace = [];

  await context.route('**/*', async (route) => {
    const req = route.request();
    let url;
    try { url = new URL(req.url()); } catch { return route.continue(); }

    if (url.hostname === 'kalenel.nl' && url.pathname === '/favicon.ico') {
      return route.fulfill({ status: 204, contentType: 'image/x-icon', body: '' });
    }

    if (url.hostname === 'kalenel.nl' && familyTargets.has(routePath) && url.pathname.startsWith('/familie/') && url.pathname !== routePath) {
      wrongFamilyRequests.push(`${req.method()} ${url.pathname}`);
    }

    if (url.hostname === 'kalenel.nl' && /\/gejast-home-gate\.js$/i.test(url.pathname)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: "document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');document.body&&document.body.classList.remove('boot-pending');window.GEJAST_HOME_GATE={audit:true};"
      });
    }
    if (url.hostname === 'kalenel.nl' && /\/gejast-config\.js$/i.test(url.pathname)) {
      const upstream = await route.fetch();
      const body = await upstream.text();
      return route.fulfill({
        response: upstream,
        contentType: 'application/javascript',
        body: `${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`
      });
    }

    const loginNav = req.isNavigationRequest()
      && url.hostname === 'kalenel.nl'
      && !['/login.html', '/familie/login.html'].includes(routePath)
      && (/\/login\.html$/i.test(url.pathname) || url.pathname === '/login');
    if (loginNav) {
      blockedLoginNavs.push(url.pathname);
      return route.abort('aborted');
    }

    if (!['GET', 'HEAD'].includes(req.method())) {
      blockedNonGet += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }

    return route.continue();
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navs.push(frame.url());
  });
  page.on('pageerror', (err) => pageErrors.push(clean(err?.stack || err?.message || err)));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = clean(msg.text());
    if (/favicon\.ico|ERR_BLOCKED_BY_CLIENT|cdn-cgi\/rum/i.test(text)) return;
    consoleErrors.push(text);
  });
  page.on('response', (res) => {
    const req = res.request();
    if (!['GET', 'HEAD'].includes(req.method()) || res.status() < 400) return;
    try {
      const url = new URL(res.url());
      const detail = `${res.status()} ${url.origin}${url.pathname}`;
      if (url.hostname === 'kalenel.nl') badSameOrigin.push(detail);
      else badExternal.push(detail);
      if (routePath === '/request.html') requestTrace.push(detail);
    } catch {}
  });
  page.on('requestfailed', (req) => {
    if (!['GET', 'HEAD'].includes(req.method()) || !sameSite(req.url())) return;
    const url = new URL(req.url());
    const reason = clean(req.failure()?.errorText || 'failed');
    if (blockedLoginNavs.includes(url.pathname) && /abort|cancel|NS_BINDING_ABORTED/i.test(reason)) return;
    if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(reason)) return;
    failedSameOrigin.push(`${url.pathname} :: ${reason}`);
  });

  let navigationError = '';
  try {
    await page.goto(`${base}${routePath}?finalaudit=20260812d-${Date.now()}-${Math.random().toString(36).slice(2)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
  } catch (err) {
    navigationError = clean(err?.message || err);
  }

  await page.waitForTimeout(1400);

  let axeSeriousCritical = [];
  let axeError = '';
  try {
    await page.evaluate(axeSource);
    axeSeriousCritical = await page.evaluate(async () => {
      const result = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
      });
      return result.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.slice(0, 8).map((n) => ({
            target: n.target,
            failureSummary: String(n.failureSummary || '').replace(/\s+/g, ' ').trim().slice(0, 220)
          }))
        }));
    });
  } catch (err) {
    axeError = clean(err?.message || err);
  }

  const state = await page.evaluate(() => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const positiveTab = [...document.querySelectorAll('[tabindex]')]
      .filter((el) => Number(el.getAttribute('tabindex')) > 0)
      .map((el) => `${el.tagName.toLowerCase()}#${el.id || ''}[tabindex=${el.getAttribute('tabindex')}]`)
      .slice(0, 20);
    const hiddenFocus = [...document.querySelectorAll('[aria-hidden="true"]:not([inert]) a[href],[aria-hidden="true"]:not([inert]) button,[aria-hidden="true"]:not([inert]) input,[aria-hidden="true"]:not([inert]) select,[aria-hidden="true"]:not([inert]) textarea,[aria-hidden="true"]:not([inert]) [tabindex]')]
      .filter((el) => !el.disabled && el.tabIndex >= 0 && visible(el))
      .map((el) => `${el.tagName.toLowerCase()}#${el.id || ''}`)
      .slice(0, 20);
    const counts = new Map();
    for (const el of document.querySelectorAll('[id]')) counts.set(el.id, (counts.get(el.id) || 0) + 1);
    const duplicateDomIds = [...counts]
      .filter(([, count]) => count > 1)
      .map(([id, count]) => `${id}:${count}`)
      .slice(0, 20);
    const docWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
    const overflowOwners = [...document.querySelectorAll('body *')]
      .filter((el) => visible(el))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          selector: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.classList?.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''}`,
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth
        };
      })
      .filter((x) => x.right > innerWidth + 4 || x.left < -4 || x.scrollWidth > x.clientWidth + 4)
      .sort((a, b) => Math.max(b.right - innerWidth, b.scrollWidth - b.clientWidth) - Math.max(a.right - innerWidth, a.scrollWidth - a.clientWidth))
      .slice(0, 20);
    const visibleDialogs = [...document.querySelectorAll('[role="dialog"]')]
      .filter(visible)
      .map((el) => ({
        id: el.id || '',
        label: el.getAttribute('aria-label') || '',
        labelledby: el.getAttribute('aria-labelledby') || '',
        heading: String(el.querySelector('h1,h2,h3')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140)
      }));
    return {
      url: location.href,
      title: document.title.trim(),
      bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 260),
      bodyTextLength: (document.body?.innerText || '').trim().length,
      authPending: document.documentElement.classList.contains('gejast-auth-pending') || document.body?.classList.contains('boot-pending'),
      docWidth,
      viewportWidth: innerWidth,
      positiveTab,
      hiddenFocus,
      duplicateDomIds,
      overflowOwners,
      visibleDialogs
    };
  }).catch(() => ({
    url: page.url(), title: '', bodyText: '', bodyTextLength: 0, authPending: true,
    docWidth: 99999, viewportWidth: viewport.width, positiveTab: ['evaluation-failed'],
    hiddenFocus: ['evaluation-failed'], duplicateDomIds: ['evaluation-failed'], overflowOwners: [], visibleDialogs: []
  }));

  let familyMismatch = '';
  const familyTarget = familyTargets.get(routePath);
  if (familyTarget) {
    const [expectedPath, expectedScope] = familyTarget;
    const normalized = navs.map((u) => { try { return new URL(u); } catch { return null; } }).filter(Boolean);
    const firstCanonical = normalized.find((u) => u.hostname === 'kalenel.nl' && u.pathname !== routePath);
    if (!firstCanonical || firstCanonical.pathname !== expectedPath || firstCanonical.searchParams.get('scope') !== expectedScope) {
      familyMismatch = `expected first canonical ${expectedPath}?scope=${expectedScope}; navs=${normalized.map((u) => u.pathname + u.search).join(' -> ')}`;
    }
  }

  const row = {
    engine: engineName,
    viewport: viewport.name,
    width: viewport.width,
    height: viewport.height,
    path: routePath,
    navigationError,
    pageErrors: uniq(pageErrors),
    consoleErrors: uniq(consoleErrors),
    badSameOrigin: uniq(badSameOrigin),
    badExternal: uniq(badExternal),
    failedSameOrigin: uniq(failedSameOrigin),
    axeSeriousCritical,
    axeError,
    familyMismatch,
    wrongFamilyRequests: uniq(wrongFamilyRequests),
    requestTrace: uniq(requestTrace),
    state
  };

  const failed = Boolean(
    row.navigationError
    || row.pageErrors.length
    || row.consoleErrors.length
    || row.badSameOrigin.length
    || row.failedSameOrigin.length
    || row.axeSeriousCritical.length
    || row.axeError
    || row.familyMismatch
    || row.wrongFamilyRequests.length
    || row.state.authPending
    || !row.state.title
    || !row.state.bodyText
    || row.state.docWidth > row.state.viewportWidth + 4
    || row.state.positiveTab.length
    || row.state.hiddenFocus.length
    || row.state.duplicateDomIds.length
  );

  if (routePath === '/request.html' && (row.consoleErrors.length || row.badSameOrigin.length || row.badExternal.length)) {
    console.log(`REQUEST_DIAGNOSTIC ${JSON.stringify(row)}`);
  }
  if (routePath === '/beerpong.html' && viewport.name === 'phone' && engineName === 'firefox') {
    console.log(`BEERPONG_FIREFOX_PHONE_DIAGNOSTIC ${JSON.stringify({ state: row.state, consoleErrors: row.consoleErrors, badSameOrigin: row.badSameOrigin })}`);
  }
  if ((routePath === '/scorer.html' || routePath === '/familie/scorer.html') && row.state.visibleDialogs.length) {
    console.log(`SCORER_DIALOG_DIAGNOSTIC ${JSON.stringify({ engine: engineName, viewport: viewport.name, path: routePath, dialogs: row.state.visibleDialogs, axe: row.axeSeriousCritical })}`);
  }

  rows.push(row);
  if (failed) {
    failures.push(row);
    console.log(`FINAL_BROWSER_FAIL ${JSON.stringify(row)}`);
  }

  await context.close();
}

for (const [engineName, engine] of engines) {
  const browser = await engine.launch({ headless: true });
  for (const viewport of viewports) {
    for (const routePath of routes) {
      total += 1;
      await auditPage(browser, engineName, viewport, routePath);
    }
  }
  await browser.close();
  console.log(`ENGINE_PASS_COMPLETE=${engineName}`);
}

console.log(`FINAL_AUDIT_CASES=${total}`);
console.log(`BLOCKED_NON_GET=${blockedNonGet}`);
console.log(`FINAL_AUDIT_FAILURES=${failures.length}`);
if (blockedNonGet === 0) throw new Error('Audit did not demonstrate local interception of non-GET traffic.');
if (failures.length) process.exit(1);
console.log('V787_FINAL_THOROUGH_BROWSER_AUDIT=PASS');
