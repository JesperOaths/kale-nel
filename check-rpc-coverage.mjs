#!/usr/bin/env node
/* GEJAST active RPC coverage checker.
   Reports frontend RPC names that do not have a committed SQL function definition. */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const activeExt = new Set(['.html', '.js', '.mjs']);
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.vercel', 'coverage', 'tmp', 'temp', 'patch_bundles', 'repo', 'mnt']);
const ignoredFiles = new Set(['check-rpc-coverage.mjs']);

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
function rel(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}
function isArchivedFile(file) {
  const name = path.basename(file);
  if (/_(?:v\d+|orig)\.html$/i.test(name)) return true;
  if (/^gejast-v\d+-repair\.js$/i.test(name) && !/^gejast-v725-repair\.js$/i.test(name)) return true;
  if (/^README_v\d+/i.test(name) || /^PATCH_NOTES_v\d+/i.test(name)) return true;
  return false;
}
function add(map, key, file) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(rel(file));
}

const files = walk(root);
const frontendFiles = files.filter((file) => activeExt.has(path.extname(file).toLowerCase()) && !ignoredFiles.has(path.basename(file)) && !isArchivedFile(file));
const sqlFiles = files.filter((file) => file.endsWith('.sql'));
const rpcRefs = new Map();
const sqlDefs = new Map();

for (const file of frontendFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\.rpc\s*\(\s*['"`]([A-Za-z0-9_]+)['"`]/g)) add(rpcRefs, match[1], file);
  for (const match of text.matchAll(/\/rpc\/([A-Za-z0-9_]+)/g)) add(rpcRefs, match[1], file);
  for (const match of text.matchAll(/rpcDirect\s*\(\s*['"`]([A-Za-z0-9_]+)['"`]/g)) add(rpcRefs, match[1], file);
}
for (const file of sqlFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([A-Za-z0-9_]+)/gi)) add(sqlDefs, match[1], file);
}

const missing = [...rpcRefs.keys()].filter((name) => !sqlDefs.has(name)).sort();
if (missing.length) {
  console.error(`Missing committed SQL definitions for ${missing.length} active frontend RPC(s):`);
  for (const name of missing) {
    console.error(`- ${name}`);
    for (const file of [...rpcRefs.get(name)].sort()) console.error(`  used by ${file}`);
  }
  process.exit(1);
}

console.log(`RPC coverage ok. Frontend RPCs=${rpcRefs.size}; SQL functions=${sqlDefs.size}.`);
