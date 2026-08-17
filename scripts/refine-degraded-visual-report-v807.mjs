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

function finalPathname(finalUrl) {
  try { return new URL(String(finalUrl || '')).pathname; }
  catch { return ''; }
}

function onlyRedirectNoise(record) {
  const reasons = Array.isArray(record?.reasons) ? record.reasons : [];
  if (!reasons.every((reason) => /^\d+ failed request\(s\)$/.test(String(reason || '').trim()))) return false;

  const failedRequests = Array.isArray(record?.failed_requests) ? record.failed_requests : [];
  return failedRequests.every((request) => /:: net::ERR_ABORTED$/.test(String(request || '').trim()));
}

let refined = 0;
for (const record of report.records) {
  if (record?.kind !== 'tracked') continue;
  if (!trackedRouteUsesAuthGate(record?.route)) continue;
  if (finalPathname(record?.final_url) !== '/login.html') continue;
  if (record?.judgement === 'broken' || record?.judgement === 'protected') continue;
  if (!onlyRedirectNoise(record)) continue;

  record.judgement = 'login-gated';
  record.anonymous_login_gate = true;
  record.reasons = ['degraded anonymous route correctly redirected to login; raw failures are redirect-aborted only'];
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
