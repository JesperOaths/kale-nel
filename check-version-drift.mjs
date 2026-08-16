#!/usr/bin/env node
/* GEJAST version drift checker.
   Fails when active frontend files contain a hardcoded v### that is older/newer than root VERSION.
   Keep Made by Bruis labels and runtime cache-busters aligned. */
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
const versionPattern = /(?:\?v\d+|GEJAST_PAGE_VERSION\s*=\s*['"]v\d+['"]|VERSION\s*:\s*['"]v\d+['"]|v\d+\s*[^\w\r\n<>]{0,12}\s*Made by Bruis)/gi;

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

function isAllowedVersionDrift(rel, found){
  if (found !== 'v762') return false;
  return rel === 'admin.html'
    || rel === 'cloudflare/workers/admin-gate/static/admin.html'
    || rel === 'scripts/test-admin-static-assets-html-handling.mjs'
    || rel === 'scripts/test-admin-worker-gate.mjs';
}

const offenders = [];
for (const file of walk(root)) {
  const rel = path.relative(root, file).replaceAll('\\','/');
  if (isArchivedFile(rel)) continue;
  if (ignoredFiles.has(path.basename(file))) continue;
  if (!activeExt.has(path.extname(file).toLowerCase())) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(versionPattern)) {
    const found = normalizeVersion(match[0]);
    if (found && found !== rootVersion && !isAllowedVersionDrift(rel, found)) {
      offenders.push({ file: rel, found, text: match[0] });
    }
  }
}

if (offenders.length) {
  console.error(`Version drift found. Root VERSION is ${rootVersion}.`);
  for (const item of offenders) {
    console.error(`- ${item.file}: ${item.text} -> ${item.found}`);
  }
  process.exit(1);
}
console.log(`No version drift found. Root VERSION is ${rootVersion}.`);
