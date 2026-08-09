#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const failures = [];
const root = process.cwd();
const activeExt = new Set(['.html', '.js', '.mjs', '.css']);
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.vercel', 'coverage', 'tmp', 'temp', 'patch_bundles', 'repo', 'mnt']);
const ignoredFiles = new Set(['check-beurs-runtime-route-v770c.mjs']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function isArchived(rel) {
  const base = path.basename(rel);
  return /_(?:v\d+|orig)\.html$/i.test(base)
    || /^README_v\d+/i.test(base)
    || /^PATCH_NOTES_v\d+/i.test(base)
    || /^GEJAST_v\d+/i.test(base)
    || /(?:audit|snapshot|inventory).*\.json$/i.test(base);
}

const beurs = fs.readFileSync('beurs.html', 'utf8');
if (!beurs.includes('./gejast-despimarkt.js?v773')) failures.push('beurs.html must load gejast-despimarkt.js?v773');
if (!beurs.includes('window.GEJAST_DESPIMARKT.loadHubPage()')) failures.push('beurs.html must boot the GEJAST_DESPIMARKT hub runtime');
if (beurs.includes('gejast-beurs.js')) failures.push('beurs.html must not load stale gejast-beurs.js');
if (fs.existsSync('gejast-beurs.js')) failures.push('stale gejast-beurs.js must be removed from the active repository root');

for (const file of walk(root)) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  if (ignoredFiles.has(rel) || isArchived(rel) || !activeExt.has(path.extname(file).toLowerCase())) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('gejast-beurs.js')) failures.push(`${rel} still references stale gejast-beurs.js`);
}

if (failures.length) {
  console.error('Beurs runtime route regression failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Beurs runtime route v770c PASS: canonical despimarkt runtime only; stale beurs runtime removed.');
