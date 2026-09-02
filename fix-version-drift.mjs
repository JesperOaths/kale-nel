#!/usr/bin/env node
/* GEJAST version drift fixer.
   Rewrites active frontend hardcoded v### references to root VERSION. */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const versionPath = path.join(root, 'VERSION');
if (!fs.existsSync(versionPath)) {
  console.error('VERSION file not found at repo root.');
  process.exit(1);
}
const rootVersion = normalizeVersion(fs.readFileSync(versionPath, 'utf8'));
if (!rootVersion) {
  console.error('VERSION file does not contain a v### value.');
  process.exit(1);
}

const activeExt = new Set(['.html','.js','.mjs','.css']);
const ignoredDirs = new Set(['.git','node_modules','dist','build','.next','.vercel','coverage','tmp','temp','patch_bundles','repo','mnt']);
const ignoredFiles = new Set(['check-version-drift.mjs','fix-version-drift.mjs']);
const allowedStaticVersionFiles = new Set(['admin.html','cloudflare/workers/admin-gate/static/admin.html','scripts/test-admin-static-assets-html-handling.mjs','scripts/test-admin-worker-gate.mjs']);

function normalizeVersion(value){
  const match = String(value || '').match(/v?\s*(\d+)/i);
  return match ? `v${match[1]}` : '';
}
function walk(dir, out=[]){
  for (const entry of fs.readdirSync(dir, { withFileTypes:true })) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}
function isArchivedFile(rel){
  const base = path.basename(rel);
  if (/^gejast-v\d+-repair\.js$/i.test(base) && !base.toLowerCase().includes(rootVersion.toLowerCase())) return true;
  if (/^README_v\d+/i.test(base) || /^PATCH_NOTES_v\d+/i.test(base) || /^GEJAST_v\d+/i.test(base)) return true;
  return false;
}
function trimChangedLineEndings(before, after){
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  if (beforeLines.length !== afterLines.length) return after;
  return afterLines.map((line, index) => {
    if (line === beforeLines[index]) return line;
    return line.replace(/[ \t]+(?=\r?$)/, '');
  }).join('\n');
}

let changed = 0;
for (const file of walk(root)) {
  const rel = path.relative(root, file).replaceAll('\\','/');
  if (isArchivedFile(rel)) continue;
  if (ignoredFiles.has(path.basename(file))) continue;
  if (!activeExt.has(path.extname(file).toLowerCase())) continue;
  const before = fs.readFileSync(file, 'utf8');
  const preserveStaticV762 = allowedStaticVersionFiles.has(rel);
  let after = before
    .replace(/\?v(\d+)/gi, (match, digits) => preserveStaticV762 && digits === '762' ? match : `?${rootVersion}`)
    .replace(/(GEJAST_PAGE_VERSION\s*=\s*['"])v(\d+)(['"])/gi, (match, prefix, digits, suffix) => preserveStaticV762 && digits === '762' ? match : `${prefix}${rootVersion}${suffix}`)
    .replace(/(GEJAST_SITE_VERSION\s*=\s*['"])v(\d+)(['"])/gi, (match, prefix, digits, suffix) => preserveStaticV762 && digits === '762' ? match : `${prefix}${rootVersion}${suffix}`)
    .replace(/(VERSION\s*:\s*['"])v(\d+)(['"])/gi, (match, prefix, digits, suffix) => preserveStaticV762 && digits === '762' ? match : `${prefix}${rootVersion}${suffix}`)
    .replace(/v(\d+)\s*[^\w\r\n<>]{0,12}\s*Made by Bruis/gi, (match, digits) => preserveStaticV762 && digits === '762' ? match : `${rootVersion}  -  Made by Bruis`);
  after = trimChangedLineEndings(before, after);
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    changed += 1;
    console.log(`updated ${rel}`);
  }
}
console.log(`Version drift fixer completed. Root VERSION=${rootVersion}. Files changed=${changed}.`);
