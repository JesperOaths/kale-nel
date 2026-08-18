import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ACTIVE_ROOTS = [
  'assets/js',
  'games/beerpong',
  'games/bussen',
  'games/kingsen',
  'games/mexen',
  'Games/Hoger-Lager',
  'Games/Paardenrace',
];
const ROOT_HTML = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
  .map((entry) => entry.name);

const historicalParts = new Set([
  'backup', 'backups', 'archive', 'archives', 'historical', 'history',
  'legacy', 'old', 'snapshot', 'snapshots', 'rollback', 'rollbacks',
]);

const diagnostics = [];
const warnings = [];
const files = [];

function posix(rel) {
  return rel.split(path.sep).join('/');
}

function walk(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return;
  const st = fs.statSync(full);
  if (st.isFile()) {
    files.push(posix(rel));
    return;
  }
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    walk(path.join(rel, entry.name));
  }
}

for (const rel of ROOT_HTML) walk(rel);
for (const rel of ACTIVE_ROOTS) walk(rel);

const activeFiles = [...new Set(files)].sort();
const htmlFiles = activeFiles.filter((file) => file.endsWith('.html'));

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function report(file, text, index, message) {
  diagnostics.push(`${file}:${lineOf(text, index)}: ${message}`);
}

function warn(file, text, index, message) {
  warnings.push(`${file}:${lineOf(text, index)}: ${message}`);
}

function stripUrl(raw) {
  return raw.trim().replace(/^['"]|['"]$/g, '').split('#')[0].split('?')[0];
}

function isDynamicOrExternal(raw) {
  const value = raw.trim();
  if (!value || value === '#' || /[{}<>]|\$\{|<%/.test(value)) return true;
  if (/^(?:https?:|mailto:|tel:|data:|blob:|javascript:|about:|chrome:)/i.test(value)) return true;
  if (value.startsWith('//')) return true;
  return false;
}

function resolveLocal(fromFile, raw) {
  const clean = stripUrl(raw);
  if (!clean) return null;
  const rel = clean.startsWith('/')
    ? clean.replace(/^\/+/, '')
    : posix(path.join(path.dirname(fromFile), clean));
  const normalized = posix(path.normalize(rel)).replace(/^\.\//, '');
  if (normalized.startsWith('../')) return null;
  return normalized;
}

function candidatePaths(rel) {
  const out = [rel];
  if (rel.endsWith('/')) out.push(`${rel}index.html`);
  if (!path.posix.extname(rel)) {
    out.push(`${rel}.html`);
    out.push(`${rel}/index.html`);
  }
  return [...new Set(out)];
}

function fileLooking(raw, attr, tag) {
  const clean = stripUrl(raw);
  if (!clean || clean === '/') return false;
  if (tag === 'script' && attr === 'src') return true;
  if (tag === 'link' && attr === 'href') return true;
  if (['img','source','video','audio','track','iframe'].includes(tag) && attr === 'src') return true;
  return /\.(?:html?|m?js|css|json|svg|png|jpe?g|webp|gif|ico|avif|woff2?|ttf|mp3|ogg|wav|mp4|webm|pdf)$/i.test(clean);
}

for (const file of htmlFiles) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');

  // Duplicate literal IDs are always invalid HTML and make DOM lookup ambiguous.
  const ids = new Map();
  for (const match of text.matchAll(/\bid\s*=\s*(["'])([^"']+)\1/gi)) {
    const id = match[2];
    if (!ids.has(id)) ids.set(id, []);
    ids.get(id).push(match.index ?? 0);
  }
  for (const [id, positions] of ids) {
    if (positions.length > 1) {
      report(file, text, positions[1], `duplicate id=${JSON.stringify(id)} (${positions.length} occurrences)`);
    }
  }

  // Validate static local href/src attributes that clearly name a repository file.
  const attrRe = /<([a-zA-Z0-9-]+)\b[^>]*?\b(href|src)\s*=\s*(["'])([^"']+)\3[^>]*>/g;
  for (const match of text.matchAll(attrRe)) {
    const tag = match[1].toLowerCase();
    const attr = match[2].toLowerCase();
    const raw = match[4];
    if (isDynamicOrExternal(raw) || !fileLooking(raw, attr, tag)) continue;
    const rel = resolveLocal(file, raw);
    if (!rel) continue;
    const candidates = candidatePaths(rel);
    if (!candidates.some((p) => fs.existsSync(path.join(ROOT, p)))) {
      report(file, text, match.index ?? 0, `${tag}[${attr}] references missing local target ${JSON.stringify(raw)} -> ${rel}`);
    }
    const parts = rel.split('/').map((part) => part.toLowerCase());
    if (parts.some((part) => historicalParts.has(part))) {
      report(file, text, match.index ?? 0, `${tag}[${attr}] points into historical mirror path ${JSON.stringify(raw)}`);
    }
  }

  // Insecure external resources can be blocked or expose mixed-content traffic.
  for (const match of text.matchAll(/\b(?:href|src)\s*=\s*(["'])(http:\/\/[^"']+)\1/gi)) {
    const url = match[2];
    if (!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(url)) {
      report(file, text, match.index ?? 0, `insecure external HTTP reference ${JSON.stringify(url)}`);
    }
  }

  // Keep this informational because modern browsers imply noopener for _blank,
  // but surface older markup that is worth tightening when touched.
  for (const match of text.matchAll(/<a\b[^>]*\btarget\s*=\s*(["'])_blank\1[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel\s*=\s*(["'])[^"']*\bnoopener\b[^"']*\1/i.test(tag)) {
      warn(file, text, match.index ?? 0, 'target="_blank" link omits explicit rel="noopener"');
    }
  }
}

// Active runtime source should not call known retired endpoints or historical mirrors.
const runtimeFiles = activeFiles.filter((file) => /\.(?:html|m?js|css)$/i.test(file));
const forbiddenEndpointPatterns = [
  { re: /\/manual-entries(?:\/|\?|["'`]|$)/i, label: 'retired /manual-entries endpoint' },
  { re: /\/order-status\/(?:[^\s"'`]*)/i, label: 'retired /order-status/ endpoint' },
];
for (const file of runtimeFiles) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const { re, label } of forbiddenEndpointPatterns) {
    const match = re.exec(text);
    if (match) report(file, text, match.index, `active runtime contains ${label}: ${JSON.stringify(match[0])}`);
  }
}

console.log(`AUDITED_ACTIVE_FILES=${activeFiles.length}`);
console.log(`AUDITED_HTML_FILES=${htmlFiles.length}`);
for (const item of warnings) console.log(`WARNING ${item}`);
console.log(`WARNINGS=${warnings.length}`);
if (diagnostics.length) {
  for (const item of diagnostics) console.error(`ERROR ${item}`);
  console.error(`STATIC_INTEGRITY_ERRORS=${diagnostics.length}`);
  process.exit(1);
}
console.log('STATIC_INTEGRITY_ERRORS=0');
console.log('RESULT=V813_STATIC_INTEGRITY_PASS');
