#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const rootEntries = fs.readdirSync(root, { withFileTypes: true });
const rootFiles = rootEntries.filter((e) => e.isFile()).map((e) => e.name).sort();
const htmlFiles = rootFiles.filter((f) => f.endsWith('.html'));
const textFiles = rootFiles.filter((f) => /\.(?:html|js|mjs|json|md|css)$/i.test(f));
const source = new Map(textFiles.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));

function localTarget(raw) {
  const value = String(raw || '').trim();
  if (!value || value === '#' || /^javascript:/i.test(value) || /^(?:https?:|mailto:|tel:|data:|blob:|\/\/)/i.test(value)) return null;
  const cleaned = value.split('#')[0].split('?')[0].replace(/^\.\//, '');
  if (!cleaned || cleaned.startsWith('/') || cleaned.startsWith('../')) return null;
  return cleaned;
}

function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const incoming = new Map(htmlFiles.map((f) => [f, []]));
const deadAnchors = [];
const missingMeta = [];
const duplicateIds = [];
const unfinished = [];
const mojibake = [];
const suspiciousCopy = [];

for (const file of htmlFiles) {
  const html = source.get(file) || '';
  const attrRe = /\b(?:href|src|action)\s*=\s*["']([^"']*)["']/gi;
  let m;
  while ((m = attrRe.exec(html))) {
    const raw = m[1];
    if (raw === '' || raw === '#' || /^javascript:void\s*\(0\)/i.test(raw)) deadAnchors.push({ file, value: raw || '(empty)' });
    const target = localTarget(raw);
    if (target && incoming.has(target)) incoming.get(target).push(file);
  }

  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((x) => x[1]);
  const seen = new Set();
  const dup = [...new Set(ids.filter((id) => seen.has(id) || !seen.add(id)))];
  if (dup.length) duplicateIds.push({ file, ids: dup });

  const misses = [];
  if (!/<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(html)) misses.push('html[lang]');
  if (!/<title>[^<]+<\/title>/i.test(html)) misses.push('title');
  if (!/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html)) misses.push('viewport');
  if (misses.length) missingMeta.push({ file, missing: misses });

  const visible = visibleText(html);
  const unfinishedPatterns = [
    /\bTODO\b/i,
    /\bFIXME\b/i,
    /\bTBD\b/i,
    /coming soon/i,
    /under construction/i,
    /work in progress/i,
    /binnenkort beschikbaar/i,
    /nog te bouwen/i,
    /niet ge[iï]mplementeerd/i,
  ];
  const hit = unfinishedPatterns.find((re) => re.test(visible));
  if (hit) unfinished.push({ file, marker: String(hit) });

  const badEncoding = ['�', 'Ã', 'Â', 'â€', 'ðŸ'];
  const enc = badEncoding.find((token) => visible.includes(token));
  if (enc) mojibake.push({ file, marker: enc });

  if (/Snelheids poging/i.test(visible)) suspiciousCopy.push({ file, text: 'Snelheids poging' });
}

const suspiciousNames = htmlFiles.filter((f) => /(?:^|[-_.])(backup|copy|old|test|debug|tmp|temp|prototype|draft|legacy|unused|archive|bak)(?:[-_.]|$)/i.test(f));
const specialRoots = new Set(['index.html', 'admin.html', 'login.html', '404.html']);
const orphans = htmlFiles.filter((f) => !specialRoots.has(f) && (incoming.get(f) || []).length === 0);

const monitoredCorpus = [...source.entries()]
  .filter(([f]) => /^(?:check-|beta-|LIVE_|README|FINAL|PRODUCTION)/i.test(f))
  .map(([, text]) => text)
  .join('\n');
const unmentionedByChecks = htmlFiles.filter((f) => !monitoredCorpus.includes(f));

const report = {
  root_html_count: htmlFiles.length,
  orphan_html_count: orphans.length,
  suspicious_filename_count: suspiciousNames.length,
  dead_anchor_count: deadAnchors.length,
  duplicate_id_page_count: duplicateIds.length,
  missing_meta_page_count: missingMeta.length,
  unfinished_visible_marker_count: unfinished.length,
  mojibake_page_count: mojibake.length,
  suspicious_copy_count: suspiciousCopy.length,
  unmentioned_by_check_corpus_count: unmentionedByChecks.length,
};

console.log('FINALIZATION_RESIDUE_AUDIT_V771F');
console.log(JSON.stringify(report, null, 2));

function printGroup(label, rows) {
  console.log(`\n## ${label} (${rows.length})`);
  if (!rows.length) return console.log('(none)');
  for (const row of rows) console.log(typeof row === 'string' ? `- ${row}` : `- ${JSON.stringify(row)}`);
}

printGroup('ORPHAN_ROOT_HTML', orphans);
printGroup('SUSPICIOUS_ROOT_FILENAMES', suspiciousNames);
printGroup('DEAD_OR_EMPTY_ANCHORS', deadAnchors);
printGroup('DUPLICATE_IDS', duplicateIds);
printGroup('MISSING_BASIC_META', missingMeta);
printGroup('VISIBLE_UNFINISHED_MARKERS', unfinished);
printGroup('MOJIBAKE', mojibake);
printGroup('SUSPICIOUS_COPY', suspiciousCopy);
printGroup('ROOT_HTML_UNMENTIONED_BY_CHECK_CORPUS', unmentionedByChecks);

console.log('\nAudit only: no repository or production data was mutated by this script.');
