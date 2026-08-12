#!/usr/bin/env node
import { chromium, firefox, webkit } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base = 'https://kalenel.nl';
const supabaseOrigin = 'https://uiqntazgnrxwliaidkmy.supabase.co';
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
const blockedRpcNames = new Map();
let blockedWrites = 0;
let total = 0;

function short(s, n = 360) { return String(s || '').replace(/\s+/g, ' ').slice(0, n); }
function rpcName(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  } catch { return ''; }
}
function isReadOnlyRpc(name) {
  return /^get_/i.test(name)
    || /^account_public_/i.test(name)
    || /^contract_drinks_read_/i.test(name)
    || name === 'klaverjas_online_list_open';
}
function expectedBlockedNoise(text) {
  return /ERR_BLOCKED_BY_CLIENT|NS_ERROR_FAILURE.*cdn-cgi\/rum|cdn-cgi\/rum/i.test(text);
}

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
      const req = route.request();
      const method = req.method().toUpperCase();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
      let u;
      try { u = new URL(req.url()); } catch { u = null; }

      // Supabase RPC POSTs are the site's transport for reads as well as writes.
      // Permit only names whose contract is explicitly read-shaped; fail closed for every other RPC.
      if (u?.origin === supabaseOrigin) {
        const name = rpcName(req.url());
        if (name && isReadOnlyRpc(name)) return route.continue();
        blockedWrites += 1;
        blockedRpcNames.set(name || '(non-rpc-supabase)', (blockedRpcNames.get(name || '(non-rpc-supabase)') || 0) + 1);
        return route.abort('blockedbyclient');
      }

      // Cloudflare RUM and same-origin analytics are deliberately suppressed during acceptance.
      if (u?.origin === base && /\/cdn-cgi\/rum$|\/api\/analytics\b/i.test(u.pathname)) {
        blockedWrites += 1;
        return route.abort('blockedbyclient');
      }

      // Any other non-read request is unknown and therefore blocked.
      blockedWrites += 1;
      blockedRpcNames.set(`OTHER:${method}:${u?.pathname || req.url()}`, (blockedRpcNames.get(`OTHER:${method}:${u?.pathname || req.url()}`) || 0) + 1);
      return route.abort('blockedbyclient');
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
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (/favicon\.ico/i.test(text) || expectedBlockedNoise(text)) return;
        // A blocked mutation may be surfaced by Firefox as a generic CORS failure. Reads are allowed,
        // so genuine CORS failures of get_*/read contracts will still be reported.
        const rpc = text.match(/\/rpc\/([A-Za-z0-9_]+)/)?.[1] || '';
        if (rpc && !isReadOnlyRpc(rpc)) return;
        consoleErrors.push(short(text));
      });
      page.on('response', (response) => {
        try {
          const u = new URL(response.url());
          if (u.origin === base && response.status() >= 400 && !/\/favicon\.ico$|\/cdn-cgi\/rum$/i.test(u.pathname)) {
            failedSameOrigin.push(`${response.status()} ${u.pathname}`);
          }
        } catch {}
      });
      page.on('requestfailed', (request) => {
        try {
          const u = new URL(request.url());
          const reason = request.failure()?.errorText || 'failed';
          if (u.origin !== base || /favicon\.ico$|\/cdn-cgi\/rum$/i.test(u.pathname)) return;
          // Navigation/redirect/version-loader cancellation is not a failed resource response.
          if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(reason)) return;
          if (/ERR_BLOCKED_BY_CLIENT/i.test(reason)) return;
          requestFailures.push(`${u.pathname}: ${reason}`);
        } catch {}
      });

      try {
        const response = await page.goto(`${base}${routePath}?finalaudit=20260812b`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(1100);
        if (!response || response.status() >= 400) failures.push(`${label}: navigation HTTP ${response?.status() ?? 'none'}`);

        const state = await page.evaluate(() => {
          const body = document.body;
          const text = (body?.innerText || '').trim();
          const root = document.documentElement;
          const overflow = Math.max(0, root.scrollWidth - root.clientWidth, body ? body.scrollWidth - body.clientWidth : 0);
          const positiveTab = [...document.querySelectorAll('[tabindex]')].filter((el) => Number(el.getAttribute('tabindex')) > 0).map((el) => el.id || el.className || el.tagName);
          const candidates = [...document.querySelectorAll('[aria-hidden="true"]')].flatMap((hiddenRoot) => [...hiddenRoot.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')]);
          const hiddenFocusable = candidates.filter((el) => {
            if (el.hasAttribute('disabled') || el.closest('[inert]') || el.closest('[hidden]')) return false;
            if (Number(el.getAttribute('tabindex')) < 0) return false;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            return true;
          }).map((el) => ({
            target: el.id ? `#${el.id}` : (el.className ? `${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g,'.')}` : el.tagName.toLowerCase()),
            ariaHiddenRoot: el.closest('[aria-hidden="true"]')?.id || el.closest('[aria-hidden="true"]')?.className || '(unnamed)'
          }));
          return { title: document.title.trim(), textLen: text.length, overflow, positiveTab, hiddenFocusable, url: location.href };
        });

        if (!state.title) failures.push(`${label}: empty document title`);
        if (state.textLen < 2) failures.push(`${label}: effectively empty body`);
        if (state.overflow > 4) failures.push(`${label}: horizontal overflow ${state.overflow}px`);
        if (state.positiveTab.length) failures.push(`${label}: positive tabindex ${JSON.stringify(state.positiveTab.slice(0,8))}`);
        if (state.hiddenFocusable.length) failures.push(`${label}: visible focusables inside aria-hidden ${JSON.stringify(state.hiddenFocusable.slice(0,10))}`);
        if (pageErrors.length) failures.push(`${label}: page errors: ${pageErrors.join(' | ')}`);
        if (consoleErrors.length) failures.push(`${label}: console errors: ${consoleErrors.join(' | ')}`);
        if (failedSameOrigin.length) failures.push(`${label}: same-origin HTTP failures: ${[...new Set(failedSameOrigin)].join(', ')}`);
        if (requestFailures.length) failures.push(`${label}: same-origin request failures: ${[...new Set(requestFailures)].join(', ')}`);

        const axe = await new AxeBuilder({ page }).analyze();
        const severe = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        if (severe.length) {
          const detail = severe.map((v) => `${v.id}:${v.nodes.slice(0,4).map((n) => `${n.target.join('>')}[${short(n.failureSummary,120)}]`).join(';')}`).join(' | ');
          failures.push(`${label}: serious/critical axe: ${short(detail, 1000)}`);
        }

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
console.log(`BLOCKED_MUTATION_OR_UNKNOWN_REQUESTS=${blockedWrites}`);
console.log('BLOCKED_RPC_COUNTS='+JSON.stringify(Object.fromEntries([...blockedRpcNames.entries()].sort((a,b)=>b[1]-a[1]).slice(0,40))));
if (failures.length) {
  console.error(`FINAL_AUDIT_FAILURES=${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('V787_FINAL_THOROUGH_BROWSER_AUDIT=PASS');
