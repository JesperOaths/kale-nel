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
const ignoredDirs = new Set(['.git','node_modules','dist','build','.next','.vercel','coverage','tmp','temp','patch_bundles']);
const ignoredFiles = new Set(['check-version-drift.mjs','fix-version-drift.mjs']);

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

let changed = 0;
for (const file of walk(root)) {
  if (ignoredFiles.has(path.basename(file))) continue;
  if (!activeExt.has(path.extname(file).toLowerCase())) continue;
  const before = fs.readFileSync(file, 'utf8');
  let after = before
    .replace(/\?v\d+/gi, `?${rootVersion}`)
    .replace(/(GEJAST_PAGE_VERSION\s*=\s*['"])v\d+(['"])/gi, `$1${rootVersion}$2`)
    .replace(/(GEJAST_SITE_VERSION\s*=\s*['"])v\d+(['"])/gi, `$1${rootVersion}$2`)
    .replace(/(VERSION\s*:\s*['"])v\d+(['"])/gi, `$1${rootVersion}$2`)
    .replace(/v\d+\s*[-–—.]?\s*Made by Bruis/gi, `${rootVersion}  -  Made by Bruis`);
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    changed += 1;
    console.log(`updated ${path.relative(root,file).replaceAll('\\','/')}`);
  }
}
console.log(`Version drift fixer completed. Root VERSION=${rootVersion}. Files changed=${changed}.`);
