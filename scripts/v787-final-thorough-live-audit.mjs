#!/usr/bin/env node
import { chromium, firefox, webkit } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

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
  { name: 'desktop', width: 1440, height: 1000 }
];
const engines = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit]
];
const failures = [];
let blockedWrites = 0;
let total = 0;

function short(s, n = 260) { return String(s || '').replace(/\s+/g, ' ').slice(0, n); }

for (const [engineName, engine] of engines) {
  const browser = await engine.launch({ headless: true });
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      locale: 'nl-NL',
      timezoneId: 'Europe/Amsterdam',
      serviceWorkers: 'block'
    });
    await context.route('**/*', async (route) => {
      const method = route.request().method().toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        blockedWrites += 1;
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });

    for (const routePath of routes) {
      total += 1;
      const label = `${engineName}/${viewport.name}${routePath}`;
      const page = await context.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      const failedSameOrigin = [];
      const requestFailures = [];

      page.on('pageerror', (err) => pageErrors.push(short(err?.message || err)));
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (!/favicon\.ico/i.test(text)) consoleErrors.push(short(text));
        }
      });
      page.on('response', (response) => {
        try {
          const u = new URL(response.url());
          if (u.origin === base && response.status() >= 400 && !/\/favicon\.ico$/i.test(u.pathname)) {
            failedSameOrigin.push(`${response.status()} ${u.pathname}`);
          }
        } catch {}
      });
      page.on('requestfailed', (request) => {
        try {
          const u = new URL(request.url());
          const reason = request.failure()?.errorText || 'failed';
          if (u.origin === base && !/favicon\.ico$/i.test(u.pathname) && !/ERR_BLOCKED_BY_CLIENT/i.test(reason)) {
            requestFailures.push(`${u.pathname}: ${reason}`);
          }
        } catch {}
      });

      try {
        const response = await page.goto(`${base}${routePath}?finalaudit=20260812`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(900);
        if (!response || response.status() >= 400) failures.push(`${label}: navigation HTTP ${response?.status() ?? 'none'}`);

        const state = await page.evaluate(() => {
          const body = document.body;
          const text = (body?.innerText || '').trim();
          const root = document.documentElement;
          const overflow = Math.max(0, root.scrollWidth - root.clientWidth, body ? body.scrollWidth - body.clientWidth : 0);
          const positiveTab = [...document.querySelectorAll('[tabindex]')].filter((el) => Number(el.getAttribute('tabindex')) > 0).length;
          const hiddenFocusable = [...document.querySelectorAll('[aria-hidden="true"]')].flatMap((rootEl) => [...rootEl.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')]).filter((el) => !el.hasAttribute('disabled') && Number(el.getAttribute('tabindex') || '0') >= 0).length;
          return {
            title: document.title.trim(),
            textLen: text.length,
            overflow,
            positiveTab,
            hiddenFocusable,
            url: location.href,
            readyState: document.readyState
          };
        });

        if (!state.title) failures.push(`${label}: empty document title`);
        if (state.textLen < 2) failures.push(`${label}: effectively empty body`);
        if (state.overflow > 4) failures.push(`${label}: horizontal overflow ${state.overflow}px`);
        if (state.positiveTab > 0) failures.push(`${label}: positive tabindex count ${state.positiveTab}`);
        if (state.hiddenFocusable > 0) failures.push(`${label}: focusable controls inside aria-hidden region ${state.hiddenFocusable}`);
        if (pageErrors.length) failures.push(`${label}: page errors: ${pageErrors.join(' | ')}`);
        if (consoleErrors.length) failures.push(`${label}: console errors: ${consoleErrors.join(' | ')}`);
        if (failedSameOrigin.length) failures.push(`${label}: same-origin HTTP failures: ${[...new Set(failedSameOrigin)].join(', ')}`);
        if (requestFailures.length) failures.push(`${label}: same-origin request failures: ${[...new Set(requestFailures)].join(', ')}`);

        const axe = await new AxeBuilder({ page }).analyze();
        const severe = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        if (severe.length) failures.push(`${label}: serious/critical axe violations: ${severe.map((v) => `${v.id}(${v.nodes.length})`).join(', ')}`);

        if (routePath.startsWith('/familie/') && routePath !== '/familie.html') {
          const finalUrl = new URL(state.url);
          if (finalUrl.searchParams.get('scope') !== 'family') failures.push(`${label}: Family alias lost scope=family -> ${state.url}`);
        }
      } catch (err) {
        failures.push(`${label}: audit exception ${short(err?.stack || err)}`);
      } finally {
        await page.close();
      }
    }
    await context.close();
  }
  await browser.close();
  console.log(`ENGINE_PASS_COMPLETE=${engineName}`);
}

console.log(`FINAL_AUDIT_CASES=${total}`);
console.log(`BLOCKED_NON_GET_REQUESTS=${blockedWrites}`);
if (failures.length) {
  console.error(`FINAL_AUDIT_FAILURES=${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('V787_FINAL_THOROUGH_BROWSER_AUDIT=PASS');
