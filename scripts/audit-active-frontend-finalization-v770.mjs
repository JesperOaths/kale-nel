#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const browserExt = new Set(['.html', '.js', '.css']);
const ignoredDirs = new Set([
  '.git','node_modules','dist','build','.next','.vercel','coverage','tmp','temp',
  'patch_bundles','repo','mnt'
]);

const candidates = [
  { id:'todo', re:/\b(?:TODO|FIXME|XXX)\b/gi },
  { id:'coming-soon', re:/\b(?:coming soon|under construction|binnenkort)\b/gi },
  { id:'not-ready', re:/\b(?:not implemented|not available|nog niet beschikbaar|nog niet ge(?:ï|i)mplementeerd|werkt nog niet)\b/gi },
  { id:'other-page', re:/\b(?:andere pagina|andere scorepagina|other page)\b/gi },
  { id:'placeholder-copy', re:/\bplaceholder\b/gi },
  { id:'temporary-copy', re:/\b(?:tijdelijk|temporary)\b/gi },
  { id:'dummy-copy', re:/\b(?:dummy|lorem ipsum)\b/gi },
  { id:'hash-href', re:/href\s*=\s*["']#["']/gi },
  { id:'void-href', re:/href\s*=\s*["']javascript:void\(0\)["']/gi },
  { id:'empty-href', re:/href\s*=\s*["']\s*["']/gi },
  { id:'question-button', re:/>\s*\?\s*<\/button>/gi },
  { id:'question-link', re:/>\s*\?\s*<\/a>/gi },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes:true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function isHistorical(rel) {
  const base = path.basename(rel);
  return /_(?:v\d+|orig|backup|bak)\.(?:html|js|css)$/i.test(base)
    || /^README(?:_|\.)/i.test(base)
    || /^PATCH_NOTES_/i.test(base)
    || /^GEJAST_v\d+/i.test(base)
    || /^check-/i.test(base)
    || rel.startsWith('scripts/');
}

const hits = [];
for (const file of walk(root)) {
  const rel = path.relative(root, file).replaceAll('\\','/');
  if (!browserExt.has(path.extname(file).toLowerCase()) || isHistorical(rel)) continue;
  const lines = fs.readFileSync(file,'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const candidate of candidates) {
      candidate.re.lastIndex = 0;
      if (!candidate.re.test(line)) continue;
      hits.push({ file:rel, line:index+1, type:candidate.id, text:line.trim().slice(0,320) });
    }
  });
}

const grouped = new Map();
for (const hit of hits) {
  if (!grouped.has(hit.type)) grouped.set(hit.type, []);
  grouped.get(hit.type).push(hit);
}

console.log(`FINALIZATION_UX_CANDIDATES=${hits.length}`);
for (const [type, rows] of [...grouped.entries()].sort((a,b)=>a[0].localeCompare(b[0]))) {
  console.log(`\n## ${type} (${rows.length})`);
  for (const row of rows.slice(0,80)) console.log(`${row.file}:${row.line}: ${row.text}`);
  if (rows.length > 80) console.log(`... ${rows.length - 80} more`);
}

const priority = hits.filter((hit) => ['todo','coming-soon','not-ready','other-page','dummy-copy','question-button','question-link'].includes(hit.type));
console.log(`\nFINALIZATION_PRIORITY_CANDIDATES=${priority.length}`);
console.log(`FINALIZATION_INERT_LINK_CANDIDATES=${hits.filter((h)=>['hash-href','void-href','empty-href'].includes(h.type)).length}`);
