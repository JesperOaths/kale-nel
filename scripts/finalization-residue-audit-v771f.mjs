#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache', 'dist', 'coverage']);
const TEXT_EXT = /\.(?:html|js|mjs|cjs|json|md|css|yml|yaml|txt|sql|ps1|sh)$/i;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.DS_Store')) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(abs, out);
    } else if (entry.isFile() && TEXT_EXT.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

const allTextFiles = walk(root).sort();
const allSource = new Map();
for (const file of allTextFiles) {
  try { allSource.set(file, fs.readFileSync(path.join(root, file), 'utf8')); } catch (_) {}
}
const rootFiles = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
const htmlFiles = rootFiles.filter((f) => f.endsWith('.html'));
const rootSource = new Map(htmlFiles.map((f) => [f, allSource.get(f) || '']));

function localTarget(raw) {
  const value = String(raw || '').trim();
  if (!value || value === '#' || /^javascript:/i.test(value) || /^(?:https?:|mailto:|tel:|data:|blob:|\/\/)/i.test(value)) return null;
  const cleaned = value.split('#')[0].split('?')[0].replace(/^\.\//, '');
  if (!cleaned || cleaned.startsWith('/') || cleaned.startsWith('../')) return null;
  return cleaned;
}

function withoutExecutableBlocks(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, ' ');
}

function visibleText(html) {
  return withoutExecutableBlocks(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function repoMentions(filename) {
  const refs = [];
  for (const [file, text] of allSource) {
    if (file === filename) continue;
    if (text.includes(filename)) refs.push(file);
  }
  return refs;
}

const incomingHtml = new Map(htmlFiles.map((f) => [f, []]));
const repoRefs = new Map(htmlFiles.map((f) => [f, repoMentions(f)]));
const deadAnchors = [];
const missingMeta = [];
const duplicateStaticIds = [];
const unfinished = [];
const mojibake = [];
const suspiciousCopy = [];

for (const file of htmlFiles) {
  const html = rootSource.get(file) || '';
  const attrRe = /\b(?:href|src|action)\s*=\s*["']([^"']*)["']/gi;
  let m;
  while ((m = attrRe.exec(html))) {
    const raw = m[1];
    if (raw === '' || raw === '#' || /^javascript:void\s*\(0\)/i.test(raw)) deadAnchors.push({ file, value: raw || '(empty)' });
    const target = localTarget(raw);
    if (target && incomingHtml.has(target)) incomingHtml.get(target).push(file);
  }

  const staticMarkup = withoutExecutableBlocks(html);
  const ids = [...staticMarkup.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((x) => x[1]);
  const seen = new Set();
  const dup = [...new Set(ids.filter((id) => seen.has(id) || !seen.add(id)))];
  if (dup.length) duplicateStaticIds.push({ file, ids: dup });

  const misses = [];
  if (!/<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(html)) misses.push('html[lang]');
  if (!/<title>[^<]+<\/title>/i.test(html)) misses.push('title');
  if (!/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html)) misses.push('viewport');
  if (misses.length) missingMeta.push({ file, missing: misses });

  const visible = visibleText(html);
  const unfinishedPatterns = [
    /\bTODO\b/i, /\bFIXME\b/i, /\bTBD\b/i, /coming soon/i, /under construction/i,
    /work in progress/i, /binnenkort beschikbaar/i, /nog te bouwen/i, /niet ge[iï]mplementeerd/i,
  ];
  const hit = unfinishedPatterns.find((re) => re.test(visible));
  if (hit) unfinished.push({ file, marker: String(hit) });

  const badEncoding = ['�', 'Ã', 'Â', 'â€', 'ðŸ'];
  const enc = badEncoding.find((token) => visible.includes(token));
  if (enc) mojibake.push({ file, marker: enc });

  if (/Snelheids poging/i.test(visible)) suspiciousCopy.push({ file, text: 'Snelheids poging' });
}

const specialRoots = new Set(['index.html', 'admin.html', 'login.html', '404.html']);
const htmlOrphans = htmlFiles.filter((f) => !specialRoots.has(f) && (incomingHtml.get(f) || []).length === 0);
const repoUnreferenced = htmlFiles.filter((f) => !specialRoots.has(f) && (repoRefs.get(f) || []).length === 0);
const fullyUnreferenced = htmlFiles.filter((f) => !specialRoots.has(f) && (incomingHtml.get(f) || []).length === 0 && (repoRefs.get(f) || []).length === 0);

const suspiciousNames = htmlFiles.filter((f) => /(?:^|[-_.])(backup|copy|old|test|debug|tmp|temp|prototype|draft|legacy|unused|archive|bak)(?:[-_.]|$)/i.test(f));
const strongArtifactPattern = /^(?:ADMIN_ADMINHTML_BODY_\d+|(?:index|scorer|admin)_v\d+_orig|klaverjas_(?:live|quick_stats)_v\d+(?:_repo)?|.*_art_(?:export|preview)|probe|push_beta_test|admin-dev)\.html$/i;
const highConfidenceResidue = fullyUnreferenced.filter((f) => strongArtifactPattern.test(f));

const monitoredCorpus = [...allSource.entries()]
  .filter(([f]) => /(?:^|\/)(?:check-|beta-|LIVE_|README|FINAL|PRODUCTION)/i.test(f))
  .map(([, text]) => text)
  .join('\n');
const unmentionedByChecks = htmlFiles.filter((f) => !monitoredCorpus.includes(f));

const repoReferenceSummary = htmlOrphans.map((file) => ({
  file,
  repo_ref_count: (repoRefs.get(file) || []).length,
  refs: (repoRefs.get(file) || []).slice(0, 8),
})).sort((a, b) => a.repo_ref_count - b.repo_ref_count || a.file.localeCompare(b.file));

const report = {
  root_html_count: htmlFiles.length,
  html_orphan_count: htmlOrphans.length,
  repo_unreferenced_html_count: repoUnreferenced.length,
  fully_unreferenced_html_count: fullyUnreferenced.length,
  high_confidence_residue_count: highConfidenceResidue.length,
  suspicious_filename_count: suspiciousNames.length,
  dead_anchor_count: deadAnchors.length,
  duplicate_static_id_page_count: duplicateStaticIds.length,
  missing_meta_page_count: missingMeta.length,
  unfinished_visible_marker_count: unfinished.length,
  mojibake_page_count: mojibake.length,
  suspicious_copy_count: suspiciousCopy.length,
  unmentioned_by_check_corpus_count: unmentionedByChecks.length,
};

console.log('FINALIZATION_RESIDUE_AUDIT_V771F_REFINED');
console.log(JSON.stringify(report, null, 2));

function printGroup(label, rows) {
  console.log(`\n## ${label} (${rows.length})`);
  if (!rows.length) return console.log('(none)');
  for (const row of rows) console.log(typeof row === 'string' ? `- ${row}` : `- ${JSON.stringify(row)}`);
}

printGroup('HIGH_CONFIDENCE_RESIDUE', highConfidenceResidue);
printGroup('FULLY_UNREFERENCED_ROOT_HTML', fullyUnreferenced);
printGroup('HTML_ORPHANS_WITH_REPO_REFERENCE_COUNTS', repoReferenceSummary);
printGroup('SUSPICIOUS_ROOT_FILENAMES', suspiciousNames);
printGroup('DEAD_OR_EMPTY_ANCHORS', deadAnchors);
printGroup('DUPLICATE_STATIC_IDS', duplicateStaticIds);
printGroup('MISSING_BASIC_META', missingMeta);
printGroup('VISIBLE_UNFINISHED_MARKERS', unfinished);
printGroup('MOJIBAKE', mojibake);
printGroup('SUSPICIOUS_COPY', suspiciousCopy);
printGroup('ROOT_HTML_UNMENTIONED_BY_CHECK_CORPUS', unmentionedByChecks);

console.log('\nAudit only: no repository or production data was mutated by this script.');
