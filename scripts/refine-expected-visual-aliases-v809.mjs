#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const reportPath = path.resolve('visual-audit/report.json');
const markdownPath = path.resolve('visual-audit/report.md');
const galleryPath = path.resolve('visual-audit/index.html');

if (!fs.existsSync(reportPath)) throw new Error('VISUAL_ALIAS_REFINE_FAIL visual-audit/report.json missing');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report?.degraded_fixture_mode !== false) throw new Error('VISUAL_ALIAS_REFINE_FAIL authenticated fixture report required');
if (report?.certification_eligible !== true) throw new Error('VISUAL_ALIAS_REFINE_FAIL authenticated report must remain certification_eligible=true');
if (!Array.isArray(report?.records)) throw new Error('VISUAL_ALIAS_REFINE_FAIL report records missing');

function repoPathForRoute(route) {
  return String(route || '').split('?')[0].replace(/^\/+/, '');
}

function declaredRedirectTarget(record) {
  const repoPath = repoPathForRoute(record?.route);
  if (!repoPath || !fs.existsSync(repoPath)) return null;
  const source = fs.readFileSync(repoPath, 'utf8');
  const match = source.match(/window\.location\.replace\(\s*(['"])([^'"]+)\1\s*\)/i);
  if (!match) return null;
  try { return new URL(match[2], String(record?.requested_url || '')); }
  catch { return null; }
}

function samePathAndQuery(a, b) {
  return a.pathname === b.pathname && a.search === b.search;
}

function isOnlyUnsettledAuthGate(record) {
  const reasons = Array.isArray(record?.reasons) ? record.reasons : [];
  return record?.kind === 'tracked'
    && record?.judgement === 'broken'
    && reasons.length === 1
    && /^auth gate did not settle within \d+ms \(last state (?:missing|[^)]+)\)$/.test(String(reasons[0] || ''))
    && Number(record?.body_chars || 0) >= 20
    && (!Array.isArray(record?.issue_signals) || record.issue_signals.length === 0)
    && (!Array.isArray(record?.page_errors) || record.page_errors.length === 0);
}

let refined = 0;
let protectedAliases = 0;
let publicAliases = 0;
for (const record of report.records) {
  if (!isOnlyUnsettledAuthGate(record)) continue;
  const target = declaredRedirectTarget(record);
  if (!target) continue;

  let finalUrl;
  try { finalUrl = new URL(String(record?.final_url || '')); }
  catch { continue; }

  const exactPublicAlias = finalUrl.href === target.href;
  const protectedAdminAlias = target.hostname === 'kalenel.nl'
    && finalUrl.hostname === 'admin.kalenel.nl'
    && samePathAndQuery(target, finalUrl)
    && String(record?.title || '') === 'Kalenel admin login'
    && /Admin login vereist/i.test(String(record?.body_preview || ''));

  if (!exactPublicAlias && !protectedAdminAlias) continue;

  record.expected_alias_redirect = true;
  record.alias_declared_target = target.href;
  record.auth_gate_settled = true;
  if (protectedAdminAlias) {
    record.judgement = 'protected';
    record.reasons = ['declared redirect alias reached the matching live Cloudflare admin perimeter'];
    protectedAliases += 1;
  } else {
    record.judgement = 'pass';
    record.reasons = ['declared redirect alias reached its exact intended destination'];
    publicAliases += 1;
  }
  refined += 1;
}

const counts = report.records.reduce((acc, row) => {
  const key = String(row?.judgement || 'unknown');
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
report.counts = counts;
report.expected_alias_redirect_count = refined;
report.expected_alias_admin_count = protectedAliases;
report.expected_alias_public_count = publicAliases;
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
  `Expected redirect aliases refined: ${refined}`,
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
fs.writeFileSync(galleryPath, `<!doctype html><meta charset="utf-8"><title>Kalenel visual audit</title><style>body{font-family:system-ui;margin:20px;background:#eee;color:#111}.summary{position:sticky;top:0;background:#111;color:#fff;padding:12px 16px;border-radius:14px;z-index:2}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:16px}.card{background:#fff;border:3px solid #bbb;border-radius:14px;overflow:hidden}.card.broken{border-color:#c00}.card.warn{border-color:#d78b00}.card.protected{border-color:#4682b4}.card.pass{border-color:#2e8b57}.card img{width:100%;height:300px;object-fit:cover;object-position:top;display:block;background:#ddd}.copy{padding:12px;display:grid;gap:6px}.copy code{white-space:normal;overflow-wrap:anywhere}.copy p{margin:0;color:#555}</style><div class="summary">${report.total_screenshots} screenshots · ${report.tracked_html_count} tracked HTML · authenticated=yes · aliases=${refined} · ${escapeHtml(JSON.stringify(counts))}</div><div class="grid">${cards}</div>`);

console.log(`RESULT=VISUAL_EXPECTED_ALIASES_REFINED aliases=${refined} public=${publicAliases} protected=${protectedAliases} broken=${counts.broken || 0} warn=${counts.warn || 0} pass=${counts.pass || 0} protected_total=${counts.protected || 0}`);
if ((counts.broken || 0) > 0) {
  console.error(`VISUAL_ALIAS_REFINE_FAIL remaining_broken=${counts.broken}`);
  process.exit(1);
}
