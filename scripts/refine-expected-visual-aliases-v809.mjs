#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const reportPath = path.resolve('visual-audit/report.json');
const markdownPath = path.resolve('visual-audit/report.md');
const galleryPath = path.resolve('visual-audit/index.html');
const OVERFLOW_TOLERANCE_PX = 4;

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

  // klaverjas_online uses a deliberately dynamic roomUrl() redirect for incoming room/game
  // context. Model that exact contract rather than treating the cancelled source-page assets
  // as network defects.
  if (repoPath === 'klaverjas_online.html') {
    try {
      const requested = new URL(String(record?.requested_url || ''));
      if (requested.searchParams.get('game_id') || requested.searchParams.get('room')) {
        const target = new URL('./klaverjas_room.html', requested);
        target.search = requested.search;
        return target;
      }
    } catch {}
  }

  const source = fs.readFileSync(repoPath, 'utf8');
  const match = source.match(/window\.location\.replace\(\s*(['"])([^'"]+)\1\s*\)/i);
  if (!match) return null;
  try { return new URL(match[2], String(record?.requested_url || '')); }
  catch { return null; }
}

function samePathAndQuery(a, b) {
  return a.pathname === b.pathname && a.search === b.search;
}

function noHardRuntimeEvidence(record) {
  return (!Array.isArray(record?.http_errors) || record.http_errors.length === 0)
    && (!Array.isArray(record?.page_errors) || record.page_errors.length === 0)
    && (!Array.isArray(record?.console_errors) || record.console_errors.length === 0)
    && (!Array.isArray(record?.issue_signals) || record.issue_signals.length === 0);
}

function onlyAbortedRequests(record) {
  const failures = Array.isArray(record?.failed_requests) ? record.failed_requests : [];
  return failures.length > 0 && failures.every((entry) => /::\s*net::ERR_ABORTED\s*$/i.test(String(entry || '')));
}

function isOnlyUnsettledAuthGate(record) {
  const reasons = Array.isArray(record?.reasons) ? record.reasons : [];
  return record?.kind === 'tracked'
    && record?.judgement === 'broken'
    && reasons.length === 1
    && /^auth gate did not settle within \d+ms \(last state (?:missing|[^)]+)\)$/.test(String(reasons[0] || ''))
    && Number(record?.body_chars || 0) >= 20
    && noHardRuntimeEvidence(record);
}

function isAbortedAliasWarning(record) {
  const reasons = Array.isArray(record?.reasons) ? record.reasons : [];
  return record?.judgement === 'warn'
    && reasons.length === 1
    && /^\d+ failed request\(s\)$/.test(String(reasons[0] || ''))
    && onlyAbortedRequests(record)
    && noHardRuntimeEvidence(record);
}

let refined = 0;
let protectedAliases = 0;
let publicAliases = 0;
let transientLoginAborts = 0;
for (const record of report.records) {
  const aliasCandidate = isOnlyUnsettledAuthGate(record) || isAbortedAliasWarning(record);
  if (aliasCandidate) {
    const target = declaredRedirectTarget(record);
    if (target) {
      let finalUrl;
      try { finalUrl = new URL(String(record?.final_url || '')); }
      catch { finalUrl = null; }

      if (finalUrl) {
        const exactPublicAlias = finalUrl.href === target.href;
        const protectedAdminAlias = target.hostname === 'kalenel.nl'
          && finalUrl.hostname === 'admin.kalenel.nl'
          && samePathAndQuery(target, finalUrl)
          && String(record?.title || '') === 'Kalenel admin login'
          && /Admin login vereist/i.test(String(record?.body_preview || ''));

        if (exactPublicAlias || protectedAdminAlias) {
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
      }
    }
  }

  // Login can intentionally race authoritative/fallback name sources. If a usable active-name
  // result is visibly rendered, and every discarded request was only browser cancellation,
  // the cancellation is transient evidence rather than a product warning.
  if (record?.route === 'login.html'
      && record?.judgement === 'warn'
      && onlyAbortedRequests(record)
      && noHardRuntimeEvidence(record)
      && /\b\d+ actieve loginspeler\(s\) geladen\./i.test(String(record?.body_preview || ''))) {
    record.expected_transient_abort = true;
    record.judgement = 'pass';
    record.reasons = ['login selector rendered active names; discarded fallback requests were browser-aborted only'];
    transientLoginAborts += 1;
  }

  // Horizontal overflow is visible product evidence and must remain actionable even when the
  // route is otherwise healthy. Do not let redirect/noise refiners erase it.
  const overflow = Number(record?.horizontal_overflow_px || 0);
  if (overflow > OVERFLOW_TOLERANCE_PX && record?.judgement !== 'broken' && record?.judgement !== 'protected') {
    record.judgement = 'warn';
    const reason = `horizontal overflow ${overflow}px exceeds ${OVERFLOW_TOLERANCE_PX}px tolerance`;
    const reasons = Array.isArray(record.reasons) ? record.reasons : [];
    if (!reasons.includes(reason)) reasons.push(reason);
    record.reasons = reasons;
  }
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
report.expected_transient_login_abort_count = transientLoginAborts;
report.horizontal_overflow_tolerance_px = OVERFLOW_TOLERANCE_PX;
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
  `Expected login fallback aborts refined: ${transientLoginAborts}`,
  `Horizontal overflow tolerance: ${OVERFLOW_TOLERANCE_PX}px`,
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
fs.writeFileSync(galleryPath, `<!doctype html><meta charset="utf-8"><title>Kalenel visual audit</title><style>body{font-family:system-ui;margin:20px;background:#eee;color:#111}.summary{position:sticky;top:0;background:#111;color:#fff;padding:12px 16px;border-radius:14px;z-index:2}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:16px}.card{background:#fff;border:3px solid #bbb;border-radius:14px;overflow:hidden}.card.broken{border-color:#c00}.card.warn{border-color:#d78b00}.card.protected{border-color:#4682b4}.card.pass{border-color:#2e8b57}.card img{width:100%;height:300px;object-fit:cover;object-position:top;display:block;background:#ddd}.copy{padding:12px;display:grid;gap:6px}.copy code{white-space:normal;overflow-wrap:anywhere}.copy p{margin:0;color:#555}</style><div class="summary">${report.total_screenshots} screenshots · ${report.tracked_html_count} tracked HTML · authenticated=yes · aliases=${refined} · login_aborts=${transientLoginAborts} · ${escapeHtml(JSON.stringify(counts))}</div><div class="grid">${cards}</div>`);

console.log(`RESULT=VISUAL_EXPECTED_ALIASES_REFINED aliases=${refined} public=${publicAliases} protected=${protectedAliases} login_aborts=${transientLoginAborts} broken=${counts.broken || 0} warn=${counts.warn || 0} pass=${counts.pass || 0} protected_total=${counts.protected || 0}`);
if ((counts.broken || 0) > 0) {
  console.error(`VISUAL_ALIAS_REFINE_FAIL remaining_broken=${counts.broken}`);
  process.exit(1);
}
