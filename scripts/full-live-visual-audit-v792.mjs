#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const BASE = String(process.env.GEJAST_BASE_URL || 'https://kalenel.nl/').replace(/\/+$/, '') + '/';
const token1 = String(process.env.GEJAST_PLAYER1_TOKEN || '').trim();
const token2 = String(process.env.GEJAST_PLAYER2_TOKEN || '').trim();
const name1 = String(process.env.GEJAST_PLAYER1_NAME || '').trim();
const name2 = String(process.env.GEJAST_PLAYER2_NAME || '').trim();
const siteScope = String(process.env.GEJAST_SITE_SCOPE || 'friends').trim() || 'friends';
const timeout = Number(process.env.GEJAST_VISUAL_TIMEOUT_MS || 25000);
const settleMs = Number(process.env.GEJAST_VISUAL_SETTLE_MS || 1800);
const outDir = path.resolve('visual-audit');
const screenshotsDir = path.join(outDir, 'screenshots');

if (!token1 || !token2 || !name1 || !name2) throw new Error('Two disposable visual-audit sessions/names are required');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(screenshotsDir, { recursive: true });

const configText = fs.readFileSync('gejast-config.js', 'utf8');
const supabaseUrl = configText.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
const publishableKey = configText.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];
if (!supabaseUrl || !publishableKey) throw new Error('Could not resolve checked-in Supabase public config');

const trackedHtml = execFileSync('git', ['ls-files', '-z', '*.html'], { encoding: 'utf8' })
  .split('\0')
  .map((value) => value.trim())
  .filter(Boolean)
  .filter((value) => !value.startsWith('node_modules/'))
  .sort((a, b) => a.localeCompare(b));

const state = { pikkenId: '', pikkenCode: '', paardenCode: '', klaverId: '', klaverCode: '' };
const records = [];
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
const first = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');

async function setupContextRooms() {
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

function expectedProtected(route, status, finalUrl) {
  try {
    const u = new URL(finalUrl);
    return status === 401 && u.hostname === 'admin.kalenel.nl';
  } catch { return false; }
}

async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript(({ tokenValue, paardCode }) => {
    localStorage.setItem('jas_session_token_v11', tokenValue);
    localStorage.setItem('jas_session_token_v10', tokenValue);
    localStorage.setItem('jas_last_activity_at_v1', String(Date.now()));
    if (paardCode) {
      localStorage.setItem('gejast_paardenrace_room_code_v687', paardCode);
      localStorage.setItem('gejast_paardenrace_room_code_v506', paardCode);
    }
  }, { tokenValue: token1, paardCode: state.paardenCode });
  return context;
}

async function capture(context, route, label, index, kind = 'tracked') {
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(safe(msg.text())); });
  page.on('pageerror', (error) => pageErrors.push(safe(error)));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'failed';
    if (!/favicon/i.test(request.url())) failedRequests.push(`${request.method()} ${request.url()} :: ${failure}`);
  });

  let response = null;
  let navigationError = '';
  const started = Date.now();
  try {
    response = await page.goto(routeUrl(route), { waitUntil: 'domcontentloaded', timeout });
    await page.waitForTimeout(settleMs);
  } catch (error) {
    navigationError = safe(error);
  }

  const status = response?.status() || 0;
  const finalUrl = page.url();
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText().catch(() => '');
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
  let judgement = 'pass';
  const reasons = [];
  if (protectedGate) { judgement = 'protected'; reasons.push('live Cloudflare admin perimeter correctly visible instead of protected asset'); }
  if (navigationError) { judgement = 'broken'; reasons.push(`navigation: ${navigationError}`); }
  if (!protectedGate && status >= 500) { judgement = 'broken'; reasons.push(`document HTTP ${status}`); }
  if (!protectedGate && bodyText.trim().length < 20) { judgement = 'broken'; reasons.push('rendered body is effectively empty'); }
  if (signals.length) { judgement = 'broken'; reasons.push(`visible runtime signal: ${signals.join(', ')}`); }
  if (seriousConsole.length && judgement !== 'broken') { judgement = 'warn'; reasons.push(`${seriousConsole.length} console error(s)`); }
  if (seriousRequestFailures.length && judgement === 'pass') { judgement = 'warn'; reasons.push(`${seriousRequestFailures.length} failed request(s)`); }
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
    judgement,
    reasons,
  };
  records.push(record);
  console.log(`${String(index + 1).padStart(3, '0')} ${judgement.toUpperCase().padEnd(9)} ${route} -> ${status || 'NAVERR'} ${title || '<no title>'}${reasons.length ? ` :: ${reasons.join('; ')}` : ''}`);
  await page.close();
}

function contextualRoutes() {
  const routes = [
    ['ladder.html?game=klaverjas', 'context__ladder__klaverjas'],
    ['ladder.html?game=boerenbridge', 'context__ladder__boerenbridge'],
    ['ladder.html?game=beerpong', 'context__ladder__beerpong'],
    [`player.html?player=${encodeURIComponent(name1)}&game=klaverjas&scope=${encodeURIComponent(siteScope)}`, 'context__player__klaverjas'],
  ];
  if (state.pikkenId) {
    routes.push([`pikken.html?game_id=${encodeURIComponent(state.pikkenId)}`, 'context__pikken__lobby']);
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

function writeReports() {
  const counts = records.reduce((acc, row) => { acc[row.judgement] = (acc[row.judgement] || 0) + 1; return acc; }, {});
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    base_url: BASE,
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
  fs.writeFileSync(path.join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Kalenel visual audit</title><style>body{font-family:system-ui;margin:20px;background:#eee;color:#111}.summary{position:sticky;top:0;background:#111;color:#fff;padding:12px 16px;border-radius:14px;z-index:2}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:16px}.card{background:#fff;border:3px solid #bbb;border-radius:14px;overflow:hidden}.card.broken{border-color:#c00}.card.warn{border-color:#d78b00}.card.protected{border-color:#4682b4}.card img{width:100%;height:300px;object-fit:cover;object-position:top;display:block;background:#ddd}.copy{padding:12px;display:grid;gap:6px}.copy code{white-space:normal;overflow-wrap:anywhere}.copy p{margin:0;color:#a00}</style><div class="summary">${records.length} screenshots · ${trackedHtml.length} tracked HTML · ${JSON.stringify(counts)}</div><div class="grid">${cards}</div>`);

  console.log(`RESULT=FULL_LIVE_VISUAL_AUDIT_COMPLETE tracked=${trackedHtml.length} screenshots=${records.length} broken=${counts.broken || 0} warn=${counts.warn || 0} protected=${counts.protected || 0} pass=${counts.pass || 0}`);
}

await setupContextRooms();
const browser = await chromium.launch({ headless: true });
const context = await newContext(browser);
try {
  let index = 0;
  for (const htmlPath of trackedHtml) {
    await capture(context, htmlPath, htmlPath, index++, 'tracked');
  }
  for (const [route, label] of contextualRoutes()) {
    await capture(context, route, label, index++, 'context');
  }
} finally {
  await context.close();
  await browser.close();
  writeReports();
}
