#!/usr/bin/env node
import { chromium } from 'playwright';

const base = process.env.GEJAST_LIVE_BASE_URL || 'https://kalenel.nl';
const expectedVersion = process.env.GEJAST_EXPECTED_VERSION || 'v773';
const timeoutMs = Number(process.env.GEJAST_BROWSER_TIMEOUT_MS || 20000);
const routes = [
  '/', '/index.html', '/home.html', '/login.html', '/request.html', '/activate.html',
  '/scorer.html', '/score.html', '/klaverjas_scorer_v596_repo_ready.html', '/klaverjas_live.html', '/klaverjas_online.html',
  '/toepen.html', '/beerpong.html', '/boerenbridge.html', '/boerenbridge_live.html',
  '/pikken.html', '/pikken_live.html', '/pikken_spectator.html',
  '/paardenrace.html', '/paardenrace_live.html', '/paardenrace_spectator.html',
  '/drinks.html', '/drinks_add.html', '/drinks_pending.html', '/drinks_history.html', '/drinks_speed.html',
  '/despimarkt.html', '/beurs.html', '/rad.html', '/profiles.html', '/my_profile.html',
  '/familie.html', '/familie/index.html', '/familie/login.html', '/familie/scorer.html', '/familie/leaderboard.html'
];
const viewports = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true }
];

const browser = await chromium.launch({ headless: true });
const report = { expectedVersion, base, generatedAt: new Date().toISOString(), viewports: {}, summary: {} };

function sameOrigin(url) {
  try { return new URL(url).origin === new URL(base).origin; } catch { return false; }
}
function cleanMessage(value) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500); }
function classifyConsole(msg) {
  const text = cleanMessage(msg.text());
  const lower = text.toLowerCase();
  if (/favicon|third.?party|cross-origin opener|deprecation|punycode/.test(lower)) return 'noise';
  return msg.type() === 'error' ? 'error' : msg.type();
}

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    ignoreHTTPSErrors: false
  });
  const rows = [];
  for (const route of routes) {
    const page = await context.newPage();
    const row = {
      route, finalUrl: '', documentStatus: 0, title: '', pageVersion: '',
      pageErrors: [], consoleErrors: [], failedRequests: [], badStaticResponses: [],
      xhrFailures: [], overflowPx: 0, visibleDevMarkers: [], blankBody: false,
      anchorDeadEnds: [], durationMs: 0
    };
    const started = Date.now();
    page.on('pageerror', (err) => row.pageErrors.push(cleanMessage(err?.message || err)));
    page.on('console', (msg) => {
      if (classifyConsole(msg) === 'error') row.consoleErrors.push(cleanMessage(msg.text()));
    });
    page.on('requestfailed', (req) => {
      if (sameOrigin(req.url())) row.failedRequests.push(`${req.resourceType()} ${req.url()} :: ${cleanMessage(req.failure()?.errorText)}`);
    });
    page.on('response', (res) => {
      if (!sameOrigin(res.url()) || res.status() < 400) return;
      const type = res.request().resourceType();
      const item = `${type} ${res.status()} ${res.url()}`;
      if (['document','script','stylesheet','image','font'].includes(type)) row.badStaticResponses.push(item);
      else if (['xhr','fetch'].includes(type)) row.xhrFailures.push(item);
    });
    try {
      const response = await page.goto(new URL(route, base).toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      row.documentStatus = response?.status() || 0;
      await page.waitForTimeout(1200);
      row.finalUrl = page.url();
      row.title = cleanMessage(await page.title());
      const state = await page.evaluate(() => {
        const body = document.body;
        const text = (body?.innerText || '').replace(/\s+/g,' ').trim();
        const html = document.documentElement;
        const overflow = Math.max(0, Math.ceil((html?.scrollWidth || 0) - (html?.clientWidth || 0)));
        const pageVersion = String(window.GEJAST_PAGE_VERSION || window.GEJAST_CONFIG?.VERSION || '').trim();
        const markers = [];
        const patterns = [
          /live proof needed/i, /mobile proof required/i, /run de v\d+ sql/i,
          /phase\s*\d+\s*(?:controle|control surface)/i, /TODO\b/i, /FIXME\b/i,
          /lorem ipsum/i, /under construction/i, /coming soon/i
        ];
        for (const p of patterns) if (p.test(text)) markers.push(p.source);
        const deadEnds = Array.from(document.querySelectorAll('a[href]')).filter((a) => {
          const h = (a.getAttribute('href') || '').trim();
          return h === '#' || /^javascript:\s*void\s*\(\s*0\s*\)\s*;?$/i.test(h);
        }).slice(0,20).map((a) => ({ text:(a.textContent||'').replace(/\s+/g,' ').trim().slice(0,120), href:a.getAttribute('href'), hasClick:!!a.getAttribute('onclick') }));
        return { textLength:text.length, overflow, pageVersion, markers, deadEnds };
      });
      row.pageVersion = state.pageVersion;
      row.overflowPx = state.overflow;
      row.visibleDevMarkers = state.markers;
      row.anchorDeadEnds = state.deadEnds.filter((x) => !x.hasClick);
      row.blankBody = state.textLength < 8;
    } catch (err) {
      row.pageErrors.push(`navigation: ${cleanMessage(err?.message || err)}`);
      row.finalUrl = page.url();
    }
    row.durationMs = Date.now() - started;
    rows.push(row);
    await page.close();
  }
  await context.close();
  report.viewports[viewport.name] = rows;
}

await browser.close();

const all = Object.values(report.viewports).flat();
const hard = all.filter((r) =>
  r.pageErrors.length || r.badStaticResponses.length || r.failedRequests.some((x)=>/document|script|stylesheet|image|font/.test(x)) ||
  r.blankBody || r.documentStatus >= 400 || r.overflowPx > 2
);
const soft = all.filter((r) => r.consoleErrors.length || r.xhrFailures.length || r.visibleDevMarkers.length || r.anchorDeadEnds.length);
report.summary = {
  pagesChecked: all.length,
  hardFindingPages: hard.length,
  softFindingPages: soft.length,
  versionMismatches: all.filter((r)=>r.pageVersion && r.pageVersion !== expectedVersion).map((r)=>`${r.route}:${r.pageVersion}`),
  hard: hard.map((r)=>({route:r.route,viewport:Object.entries(report.viewports).find(([,rows])=>rows.includes(r))?.[0],status:r.documentStatus,overflowPx:r.overflowPx,pageErrors:r.pageErrors,badStaticResponses:r.badStaticResponses,failedRequests:r.failedRequests,blankBody:r.blankBody})),
  soft: soft.map((r)=>({route:r.route,viewport:Object.entries(report.viewports).find(([,rows])=>rows.includes(r))?.[0],consoleErrors:r.consoleErrors,xhrFailures:r.xhrFailures,visibleDevMarkers:r.visibleDevMarkers,anchorDeadEnds:r.anchorDeadEnds}))
};

console.log(`PRODUCTION_BROWSER_AUDIT pages=${report.summary.pagesChecked} hard_pages=${report.summary.hardFindingPages} soft_pages=${report.summary.softFindingPages}`);
console.log(`VERSION_MISMATCHES=${report.summary.versionMismatches.length}`);
for (const item of report.summary.hard) console.log('HARD '+JSON.stringify(item));
for (const item of report.summary.soft) console.log('SOFT '+JSON.stringify(item));
console.log('REPORT_JSON='+JSON.stringify(report));
