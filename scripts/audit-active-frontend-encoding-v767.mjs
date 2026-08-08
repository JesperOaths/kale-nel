#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const activeExt = new Set(['.html', '.js', '.mjs', '.css']);
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.vercel', 'coverage', 'tmp', 'temp', 'patch_bundles', 'repo', 'mnt']);
const patterns = [
  { name: 'replacement-char', re: /�/g },
  { name: 'mojibake-a-circumflex', re: /â[^\s]/g },
  { name: 'mojibake-a-tilde', re: /Ã[^\s]/g },
  { name: 'mojibake-circumflex', re: /Â[^\s]/g },
  { name: 'broken-een', re: /\?\?n\b/g },
];

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
  return /_(?:v\d+|orig)\.html$/i.test(base) || /^README_v\d+/i.test(base) || /^PATCH_NOTES_v\d+/i.test(base) || /^GEJAST_v\d+/i.test(base);
}

let hits = 0;
for (const file of walk(root)) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  if (!activeExt.has(path.extname(file).toLowerCase()) || archived(rel)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { name, re } of patterns) {
      re.lastIndex = 0;
      const matches = [...line.matchAll(re)];
      if (!matches.length) continue;
      hits += matches.length;
      console.log(`${rel}:${index + 1}: ${name}: ${line.trim()}`);
    }
  });
}
console.log(`ENCODING_AUDIT_HITS=${hits}`);
