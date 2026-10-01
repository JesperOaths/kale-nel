#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const reportPath = path.resolve('visual-audit/report.json');
const markdownPath = path.resolve('visual-audit/report.md');
const galleryPath = path.resolve('visual-audit/index.html');

if (!fs.existsSync(reportPath)) throw new Error('DEGRADED_LOGIN_GATE_REFINE_FAIL visual-audit/report.json missing');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report?.degraded_fixture_mode !== true) throw new Error('DEGRADED_LOGIN_GATE_REFINE_FAIL report is not degraded fixture mode');
if (report?.certification_eligible !== false) throw new Error('DEGRADED_LOGIN_GATE_REFINE_FAIL degraded report must remain certification_eligible=false');
if (!Array.isArray(report?.records)) throw new Error('DEGRADED_LOGIN_GATE_REFINE_FAIL report records missing');

function repoPathForRoute(route) {
  return String(route || '').split('?')[0].replace(/^\/+/, '');
}

function trackedRouteUsesAuthGate(route) {
  const repoPath = repoPathForRoute(route);
  if (!repoPath || !fs.existsSync(repoPath)) return false;
  try { return /gejast-auth-gate\.js/i.test(fs.readFileSync(repoPath, 'utf8')); }
  catch { return false; }
}

function declaredRedirectTarget(route) {
  const repoPath = repoPathForRoute(route);
  if (!repoPath || !fs.existsSync(repoPath)) return '';
  try {
    const html = fs.readFileSync(repoPath, 'utf8');
    const jsTarget = html.match(/(?:window\.)?location\.replace\(\s*(['"])([^'"]+)\1\s*\)/i)?.[2] || '';
    const metaTarget = html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*?url\s*=\s*([^"'\s>]+)[^"']*["']/i)?.[1] || '';
    const raw = jsTarget || metaTarget;
    if (!raw) return '';
    const base = new URL(String(route || '').replace(/^\/+/, ''), 'https://kalenel.nl/');
    const target = new URL(raw, base);
    if (target.hostname !== 'kalenel.nl') return '';
    return target.pathname.replace(/^\/+/, '');
  } catch { return ''; }
}

function routeEventuallyUsesAuthGate(route, seen = new Set()) {
  const repoPath = repoPathForRoute(route);
  if (!repoPath || seen.has(repoPath)) return false;
  seen.add(repoPath);
  if (trackedRouteUsesAuthGate(route)) return true;
  const target = declaredRedirectTarget(route);
  if (!target) return false;
  return routeEventuallyUsesAuthGate(target, seen);
}

function finalPathname(finalUrl) {
  try { return new URL(String(finalUrl || '')).pathname; }
  catch { return ''; }
}

function onlyExpectedDegradedLoginNoise(record) {
  const reasons = Array.isArray(record?.reasons) ? record.reasons : [];
  const allowedReason = (reason) => {
    const text = String(reason || '').trim();
    return /^\d+ failed request\(s\)$/.test(text)
      || /^auth gate did not settle within \d+ms \(last state (?:missing|checking)\)$/.test(text);
  };
  if (!reasons.every(allowedReason)) return false;

  const expectedEndpoint = /\/rest\/v1\/rpc\/(?:get_player_selector_source_v1|get_login_active_names_v687|account_public_state_v687)(?:\?|$)/i;
  const requestNoise = [
    ...(Array.isArray(record?.failed_requests) ? record.failed_requests : []),
    ...(Array.isArray(record?.http_errors) ? record.http_errors : []),
  ];
  if (!requestNoise.every((entry) => /:: net::ERR_ABORTED$/.test(String(entry || '').trim()) || expectedEndpoint.test(String(entry || '')))) return false;

  const consoleErrors = Array.isArray(record?.console_errors) ? record.console_errors : [];
  const pageErrors = Array.isArray(record?.page_errors) ? record.page_errors : [];
  return consoleErrors.length === 0 && pageErrors.length === 0;
}

let refined = 0;
for (const record of report.records) {
  if (record?.kind !== 'tracked') continue;
  if (!routeEventuallyUsesAuthGate(record?.route)) continue;
  if (finalPathname(record?.final_url) !== '/login.html') continue;
  if (record?.judgement === 'protected') continue;
  if (!onlyExpectedDegradedLoginNoise(record)) continue;

  record.judgement = 'login-gated';
  record.anonymous_login_gate = true;
  record.reasons = ['degraded anonymous route correctly reached the login boundary; raw auth/data-plane failures remain preserved in report.json'];
  refined += 1;
}

const counts = report.records.reduce((acc, row) => {
  const key = String(row?.judgement || 'unknown');
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
report.counts = counts;
report.degraded_login_gate_count = refined;
report.certification_eligible = false;
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const bad = report.records.filter((row) => row.judgement === 'broken' || row.judgement === 'warn');
const md = [
  '# Full live visual audit',
  '',
  `Generated: ${report.generated_at}`,
  'Fixture mode: DEGRADED — anonymous/perimeter evidence only',
  'Certification eligible: no',
  `Tracked HTML pages: ${report.tracked_html_count}`,
  `Contextual variants: ${report.contextual_route_count}`,
  `Screenshots: ${report.total_screenshots}`,
  `Expected login-gated routes: ${refined}`,
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
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const cards = report.records.map((row) => `<article class="card ${escapeHtml(row.judgement)}"><a href="${escapeHtml(row.screenshot)}"><img src="${escapeHtml(row.screenshot)}" loading="lazy" alt="${escapeHtml(row.label)}"></a><div class="copy"><b>${escapeHtml(String(row.judgement).toUpperCase())}</b><code>${escapeHtml(row.route)}</code><span>${escapeHtml(row.title)}</span><small>HTTP ${escapeHtml(row.status)} · overflow ${escapeHtml(row.horizontal_overflow_px)}px · loading ${escapeHtml(row.stale_loading_count)}</small><p>${escapeHtml((row.reasons || []).join('; '))}</p></div></article>`).join('\n');
fs.writeFileSync(galleryPath, `<!doctype html><meta charset="utf-8"><title>Kalenel visual audit</title><style>body{font-family:system-ui;margin:20px;background:#eee;color:#111}.summary{position:sticky;top:0;background:#111;color:#fff;padding:12px 16px;border-radius:14px;z-index:2}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:16px}.card{background:#fff;border:3px solid #bbb;border-radius:14px;overflow:hidden}.card.broken{border-color:#c00}.card.warn{border-color:#d78b00}.card.protected{border-color:#4682b4}.card.login-gated{border-color:#2e8b57}.card img{width:100%;height:300px;object-fit:cover;object-position:top;display:block;background:#ddd}.copy{padding:12px;display:grid;gap:6px}.copy code{white-space:normal;overflow-wrap:anywhere}.copy p{margin:0;color:#555}</style><div class="summary">${report.total_screenshots} screenshots · ${report.tracked_html_count} tracked HTML · degraded=yes · login-gated=${refined} · ${escapeHtml(JSON.stringify(counts))}</div><div class="grid">${cards}</div>`);

console.log(`RESULT=DEGRADED_LOGIN_GATE_REFINED login_gated=${refined} broken=${counts.broken || 0} warn=${counts.warn || 0} protected=${counts.protected || 0} pass=${counts.pass || 0}`);
