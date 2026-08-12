#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const failures = [];
const info = [];
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const trackedSet = new Set(tracked);
const version = fs.readFileSync('VERSION', 'utf8').trim();
if (version !== 'v787') failures.push(`VERSION expected v787, got ${version}`);

const readiness = JSON.parse(fs.readFileSync('beta-readiness.json', 'utf8'));
const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json', 'utf8'));
const gaps = Array.isArray(readiness.beta_gaps) ? readiness.beta_gaps : [];
if (readiness.site_version !== 'live v787 / current frontend release v787'
    || readiness.deployment_identity?.live_version !== 'v787'
    || readiness.deployment_identity?.release_candidate_version) {
  failures.push('readiness is not cleanly promoted live v787');
}
if (gaps.length !== 12 || gaps.some((x) => x.status !== 'verified_complete')) failures.push('readiness must remain 12/12 verified_complete');
if (checklist.site_version !== 'v787' || !Array.isArray(checklist.items) || checklist.items.length) failures.push('live-write checklist must remain v787 with zero armed items');
if (tracked.some((f) => f === 'node_modules' || f.startsWith('node_modules/'))) failures.push('node_modules is tracked');
if (tracked.some((f) => f === '.env' || f.endsWith('/.env'))) failures.push('a real .env file is tracked');

for (const file of [
  'scripts/v787-live-family-alias-proof.mjs',
  '.github/workflows/v787-live-proof.yml',
  'scripts/finalize-v787-live-evidence.mjs',
  '.github/workflows/finalize-v787-live-evidence.yml',
  'scripts/v786-cross-engine-audit.mjs',
  '.github/workflows/v786-cross-engine-compat.yml',
  'V786_LIVE_FINAL_ACCEPTANCE.json',
  'V785_LIVE_FINAL_ACCEPTANCE.json'
]) {
  if (trackedSet.has(file)) failures.push(`historical temporary residue: ${file}`);
}

const textExt = /\.(?:html?|mjs|js|css|json|md|txt|yml|yaml|sql|toml)$/i;
for (const file of tracked) {
  if (!textExt.test(file)) continue;
  try {
    const stat = fs.statSync(file);
    if (stat.size > 2_000_000) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/.test(text)) failures.push(`private-key material found in ${file}`);
  } catch {}
}

const routes = [
  '/', '/index.html', '/scorer.html', '/score.html', '/klaverjas_scorer_v596_repo_ready.html',
  '/klaverjas_live.html', '/klaverjas_online.html', '/toepen.html', '/beerpong.html', '/boerenbridge.html',
  '/boerenbridge_live.html', '/pikken.html', '/pikken_live.html', '/pikken_spectator.html', '/paardenrace.html',
  '/paardenrace_live.html', '/paardenrace_spectator.html', '/drinks.html', '/drinks_add.html', '/drinks_pending.html',
  '/drinks_history.html', '/drinks_speed.html', '/despimarkt.html', '/beurs.html', '/rad.html', '/profiles.html',
  '/my_profile.html', '/login.html', '/request.html', '/activate.html', '/familie.html', '/familie/index.html',
  '/familie/login.html', '/familie/scorer.html', '/familie/leaderboard.html'
];
const routeFiles = [...new Set(routes.map((r) => r === '/' ? 'index.html' : r.slice(1)))];
const repeatedSourceIds = [];
const unfinished = [];
for (const file of routeFiles) {
  if (!fs.existsSync(file)) { failures.push(`authoritative route file missing: ${file}`); continue; }
  const text = fs.readFileSync(file, 'utf8');
  if (!/<title>[^<]+<\/title>/i.test(text)) failures.push(`${file}: missing non-empty title`);
  if (!/<html[^>]*\blang\s*=\s*["'][^"']+["']/i.test(text)) failures.push(`${file}: missing html lang`);
  if (!/<meta[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i.test(text)) failures.push(`${file}: missing viewport meta`);

  const ids = [];
  for (const match of text.matchAll(/<[^>]+\bid\s*=\s*["']([^"']+)["'][^>]*>/gi)) ids.push(match[1]);
  const seen = new Set();
  const dup = new Set();
  for (const id of ids) { if (seen.has(id)) dup.add(id); seen.add(id); }
  if (dup.size) repeatedSourceIds.push({ file, ids: [...dup] });

  const markers = [...text.matchAll(/\b(?:TODO|FIXME|TBD)\b|proof needed|needs proof|repair first/gi)].map((x) => x[0]);
  if (markers.length) unfinished.push({ file, count: markers.length, samples: [...new Set(markers)].slice(0, 6) });
}
if (repeatedSourceIds.length) info.push(`source repeated-ID candidates (rendered DOM is authoritative)=${JSON.stringify(repeatedSourceIds)}`);
if (unfinished.length) info.push(`unfinished-marker inventory=${JSON.stringify(unfinished)}`);

const rootHtml = tracked.filter((f) => !f.includes('/') && f.endsWith('.html'));
const corpus = new Map();
for (const file of tracked.filter((f) => textExt.test(f))) {
  try {
    const stat = fs.statSync(file);
    if (stat.size < 1_500_000) corpus.set(file, fs.readFileSync(file, 'utf8'));
  } catch {}
}
const orphan = [];
for (const html of rootHtml) {
  let found = false;
  for (const [file, text] of corpus) {
    if (file !== html && text.includes(html)) { found = true; break; }
  }
  if (!found && !routeFiles.includes(html)) orphan.push(html);
}
const suspicious = rootHtml.filter((f) => /(?:_orig|_preview|_export|\bprobe\b|\bdev\b|\bbackup\b|\bold\b|artifact)/i.test(f));
if (orphan.length) info.push(`root HTML with no literal inbound reference=${orphan.slice(0, 60).join(', ')}`);
if (suspicious.length) info.push(`artifact-style root HTML names=${suspicious.join(', ')}`);

for (const line of info) console.log(`FINAL_STATIC_AUDIT_INFO ${line}`);
console.log('FINAL_STATIC_AUDIT_SUMMARY ' + JSON.stringify({
  version,
  trackedFiles: tracked.length,
  routeFiles: routeFiles.length,
  rootHtml: rootHtml.length,
  sourceDuplicateCandidates: repeatedSourceIds.length,
  unfinishedMarkerFiles: unfinished.length,
  orphanCandidates: orphan.length,
  suspiciousNames: suspicious.length,
  failures: failures.length
}));
if (failures.length) {
  console.error('FINAL_STATIC_AUDIT_FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('FINAL_STATIC_AUDIT=PASS');
