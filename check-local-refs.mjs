#!/usr/bin/env node
/* GEJAST active local reference checker.
   Verifies static local src/href references in active HTML files exist on disk. */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules', 'repo', 'mnt', 'tmp', 'temp', 'dist', 'build']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith('.html')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}
function isArchivedHtml(file) {
  return /_(?:v\d+|orig)\.html$/i.test(path.basename(file));
}
function rel(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

const missing = [];
for (const file of walk(root)) {
  if (isArchivedHtml(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  const re = /(?:src|href)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of html.matchAll(re)) {
    let ref = match[2].trim();
    if (ref.includes('${')) continue;
    if (!ref || ref.startsWith('#') || /^(https?:|mailto:|tel:|javascript:|data:|blob:)/i.test(ref)) continue;
    ref = ref.split('#')[0].split('?')[0];
    if (!ref || ref.startsWith('/')) continue;
    const target = path.resolve(path.dirname(file), ref.replace(/\//g, path.sep));
    if (!target.startsWith(root)) continue;
    if (!fs.existsSync(target)) missing.push(`${rel(file)} -> ${match[2]}`);
  }
}

if (missing.length) {
  console.error(`Missing active local references: ${missing.length}`);
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log('All active HTML static local src/href references exist.');
