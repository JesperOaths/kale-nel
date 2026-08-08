#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const activeExt = new Set(['.html', '.js', '.css']);
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.vercel', 'coverage', 'tmp', 'temp', 'patch_bundles', 'repo', 'mnt']);
const forbidden = [/�/g, /â[^\s]/g, /Ã[^\s]/g, /Â[^\s]/g, /ï»¿/g, /\?\?n\b/g];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else out.push(path.join(dir, entry.name));
  }
  return out;
}
function archived(rel) {
  const base = path.basename(rel);
  return /_(?:v\d+|orig)\.html$/i.test(base)
    || /^README_v\d+/i.test(base)
    || /^PATCH_NOTES_v\d+/i.test(base)
    || /^GEJAST_v\d+/i.test(base);
}

const failures = [];
for (const file of walk(root)) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  if (!activeExt.has(path.extname(file).toLowerCase()) || archived(rel)) continue;
  const text = fs.readFileSync(file, 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    for (const re of forbidden) {
      re.lastIndex = 0;
      if (re.test(line)) {
        failures.push(`${rel}:${index + 1}: ${line.trim()}`);
        break;
      }
    }
  });
}

if (failures.length) {
  console.error('Active frontend encoding corruption found:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

const scorer = fs.readFileSync('scorer.html', 'utf8');
for (const suit of ['♣', '♥', '♠', '♦']) {
  if (!scorer.includes(suit)) {
    console.error(`Missing repaired suit ${suit}`);
    process.exit(1);
  }
}
if (!scorer.includes('Elke naam mag maar één keer gebruikt worden.')) {
  console.error('Repaired setup copy missing.');
  process.exit(1);
}

console.log('Active frontend encoding regression PASS.');
