#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const reportPath = path.resolve('visual-audit/report.json');
const markdownPath = path.resolve('visual-audit/report.md');
const galleryPath = path.resolve('visual-audit/index.html');

if (!fs.existsSync(reportPath)) throw new Error('VISUAL_ABORT_REFINE_FAIL visual-audit/report.json missing');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report?.degraded_fixture_mode !== false) throw new Error('VISUAL_ABORT_REFINE_FAIL authenticated fixture report required');
if (report?.certification_eligible !== true) throw new Error('VISUAL_ABORT_REFINE_FAIL certification_eligible=true required');
if (!Array.isArray(report?.records)) throw new Error('VISUAL_ABORT_REFINE_FAIL report records missing');

const sourceAbortAssets = new Set([
  '/gejast-mobile-route-fixes-v583.js',
  '/gejast-mobile-foundation-v583.js',
]);
const redirectRoutes = new Set([
  'boerenbridge_spectator.html',
  'despimarkt_force.html',
  'klaverjas_quick_stats_v596_repo.html',
  'klaverjas_room.html',
  'klaverjas_spectator.html',
  'klaverjas_online.html',
]);
const loginRpcNames = new Set([
  'get_login_active_names_v687',
  'get_player_selector_source_v1',
]);

function cleanRoute(route) {
  return String(route || '').replace(/^\/+/, '').split('?')[0];
}
function listEmpty(value) { return !Array.isArray(value) || value.length === 0; }
function otherwiseClean(record) {
  return record?.kind === 'tracked'
    && record?.judgement === 'warn'
    && Number(record?.status || 0) === 200
    && Number(record?.stale_loading_count || 0) === 0
    && listEmpty(record?.console_errors)
    && listEmpty(record?.page_errors)
    && listEmpty(record?.http_errors)
    && listEmpty(record?.issue_signals);
}
function parseAbortedRequest(line) {
  const match = String(line || '').match(/^(GET|POST)\s+(https:\/\/[^\s]+)\s+::\s+net::ERR_ABORTED$/);
  if (!match) return null;
  try { return { method: match[1], url: new URL(match[2]) }; }
  catch { return null; }
}
function sourceAssetAbortsOnly(record) {
  const failed = Array.isArray(record?.failed_requests) ? record.failed_requests : [];
  if (failed.length !== sourceAbortAssets.size) return false;
  const seen = new Set();
  for (const line of failed) {
    const parsed = parseAbortedRequest(line);
    if (!parsed || parsed.method !== 'GET' || parsed.url.origin !== 'https://kalenel.nl') return false;
    if (!sourceAbortAssets.has(parsed.url.pathname)) return false;
    seen.add(parsed.url.pathname);
  }
  return seen.size === sourceAbortAssets.size;
}
function redirectTargetMatches(record) {
  const route = cleanRoute(record?.route);
  if (!redirectRoutes.has(route)) return false;
  let requested, finalUrl;
  try {
    requested = new URL(String(record?.requested_url || ''));
    finalUrl = new URL(String(record?.final_url || ''));
  } catch { return false; }
  if (requested.origin !== 'https://kalenel.nl' || finalUrl.origin !== requested.origin) return false;

  if (route === 'boerenbridge_spectator.html') {
    return finalUrl.pathname === '/boerenbridge_live.html' && finalUrl.searchParams.get('spectator') === '1';
  }
  if (route === 'despimarkt_force.html') {
    return finalUrl.pathname === '/despimarkt_debts.html'
      && finalUrl.search === '?focus=nomination'
      && finalUrl.hash === '#nominationForm';
  }
  if (route === 'klaverjas_quick_stats_v596_repo.html') return finalUrl.pathname === '/leaderboard.html';
  if (route === 'klaverjas_room.html') return finalUrl.pathname === '/klaverjas_online.html';
  if (route === 'klaverjas_spectator.html') {
    return finalUrl.pathname === '/klaverjas_live.html'
      && finalUrl.searchParams.get('spectator') === '1'
      && finalUrl.searchParams.has('client_match_id');
  }
  if (route === 'klaverjas_online.html') {
    if (finalUrl.pathname !== '/klaverjas_room.html') return false;
    const requestedGame = requested.searchParams.get('game_id') || '';
    const requestedRoom = requested.searchParams.get('room') || '';
    return !!(requestedGame || requestedRoom)
      && finalUrl.searchParams.get('game_id') === requestedGame
      && finalUrl.searchParams.get('room') === requestedRoom;
  }
  return false;
}
function loginSelectorAbortOnly(record) {
  if (cleanRoute(record?.route) !== 'login.html' || !otherwiseClean(record)) return false;
  let requested, finalUrl;
  try {
    requested = new URL(String(record?.requested_url || ''));
    finalUrl = new URL(String(record?.final_url || ''));
  } catch { return false; }
  if (requested.pathname !== '/login.html' || finalUrl.pathname !== '/login.html') return false;
  const loaded = String(record?.body_preview || '').match(/\b(\d+)\s+actieve loginspeler\(s\) geladen\./i);
  if (!loaded || Number(loaded[1]) < 1) return false;
  const failed = Array.isArray(record?.failed_requests) ? record.failed_requests : [];
  if (!failed.length || failed.length > loginRpcNames.size) return false;
  const seen = new Set();
  for (const line of failed) {
    const parsed = parseAbortedRequest(line);
    if (!parsed || parsed.method !== 'POST' || parsed.url.hostname !== 'uiqntazgnrxwliaidkmy.supabase.co') return false;
    const match = parsed.url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
    if (!match || !loginRpcNames.has(match[1])) return false;
    seen.add(match[1]);
  }
  return seen.size === failed.length;
}

let redirectRefined = 0;
let loginRefined = 0;
for (const record of report.records) {
  if (otherwiseClean(record) && sourceAssetAbortsOnly(record) && redirectTargetMatches(record)) {
    record.judgement = 'pass';
    record.benign_abort_refined = true;
    record.reasons = ['declared navigation reached its intended destination; only deferred source-page mobile assets were aborted'];
    redirectRefined += 1;
    continue;
  }
  if (loginSelectorAbortOnly(record)) {
    record.judgement = 'pass';
    record.benign_abort_refined = true;
    record.reasons = ['login selector loaded active players; only superseded read-only selector requests were aborted'];
    loginRefined += 1;
  }
}

const counts = report.records.reduce((acc, row) => {
  const key = String(row?.judgement || 'unknown');
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
report.counts = counts;
report.benign_abort_refined_count = redirectRefined + loginRefined;
report.benign_redirect_abort_count = redirectRefined;
report.benign_login_abort_count = loginRefined;
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const bad = report.records.filter((row) => row.judgement === 'broken' || row.judgement === 'warn');
const md = [
  '# Full live visual audit',
  '',
  `Generated: ${report.generated_at}`,
  'Fixture mode: AUTHENTICATED — Friends + Family disposable sessions',
  'Certification eligible: yes',
  `Tracked HTML pages: ${report.tracked_html_count}`,
  `Contextual variants: ${report.contextual_route_count}`,
  `Screenshots: ${report.total_screenshots}`,
  `Benign aborts refined: ${redirectRefined + loginRefined}`,
  `Judgements: ${JSON.stringify(counts)}`,
  '',
  '## Broken / warning pages',
  '',
  ...(bad.length
    ? bad.map((row) => `- **${String(row.judgement).toUpperCase()}** \`${row.route}\` — HTTP ${row.status}; ${(row.reasons || []).join('; ') || 'see report.json'}; screenshot \`${row.screenshot}\``)
    : ['- None detected by automated runtime heuristics.']),
  '',
  '## All pages',
  '',
  ...report.records.map((row) => `- ${String(row.judgement).toUpperCase()} — \`${row.route}\` — ${row.title || '(no title)'} — \`${row.screenshot}\``),
  '',
].join('\n');
fs.writeFileSync(markdownPath, md);

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const cards = report.records.map((row) => `<article class="card ${escapeHtml(row.judgement)}"><a href="${escapeHtml(row.screenshot)}"><img src="${escapeHtml(row.screenshot)}" loading="lazy" alt="${escapeHtml(row.label)}"></a><div class="copy"><b>${escapeHtml(String(row.judgement).toUpperCase())}</b><code>${escapeHtml(row.route)}</code><span>${escapeHtml(row.title)}</span><small>HTTP ${escapeHtml(row.status)} · overflow ${escapeHtml(row.horizontal_overflow_px)}px · loading ${escapeHtml(row.stale_loading_count)}</small><p>${escapeHtml((row.reasons || []).join('; '))}</p></div></article>`).join('\n');
fs.writeFileSync(galleryPath, `<!doctype html><meta charset="utf-8"><title>Kalenel visual audit</title><style>body{font-family:system-ui;margin:20px;background:#eee;color:#111}.summary{position:sticky;top:0;background:#111;color:#fff;padding:12px 16px;border-radius:14px;z-index:2}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:16px}.card{background:#fff;border:3px solid #bbb;border-radius:14px;overflow:hidden}.card.broken{border-color:#c00}.card.warn{border-color:#d78b00}.card.protected{border-color:#4682b4}.card.pass{border-color:#2e8b57}.card img{width:100%;height:300px;object-fit:cover;object-position:top;display:block;background:#ddd}.copy{padding:12px;display:grid;gap:6px}.copy code{white-space:normal;overflow-wrap:anywhere}.copy p{margin:0;color:#555}</style><div class="summary">${report.total_screenshots} screenshots · ${report.tracked_html_count} tracked HTML · authenticated=yes · benign_aborts=${redirectRefined + loginRefined} · ${escapeHtml(JSON.stringify(counts))}</div><div class="grid">${cards}</div>`);

console.log(`RESULT=VISUAL_BENIGN_ABORTS_REFINED total=${redirectRefined + loginRefined} redirects=${redirectRefined} login=${loginRefined} broken=${counts.broken || 0} warn=${counts.warn || 0} pass=${counts.pass || 0} protected=${counts.protected || 0}`);
if ((counts.broken || 0) > 0) {
  console.error(`VISUAL_ABORT_REFINE_FAIL remaining_broken=${counts.broken}`);
  process.exit(1);
}
