#!/usr/bin/env node
/* GEJAST active JavaScript syntax checker.
   Runs node --check over active .js/.mjs files and skips archives/build output. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.vercel', 'coverage', 'tmp', 'temp', 'patch_bundles', 'repo', 'mnt']);
const ignoredFiles = new Set(['check-active-js-syntax.mjs']);
const activeExt = new Set(['.js', '.mjs']);

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

function isArchivedFile(file) {
  const name = path.basename(file);
  if (/^gejast-v\d+-repair\.js$/i.test(name) && !/^gejast-v725-repair\.js$/i.test(name)) return true;
  if (/_(?:v\d+|orig)\.js$/i.test(name)) return true;
  return false;
}

function rel(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

const files = walk(root).filter((file) => (
  activeExt.has(path.extname(file).toLowerCase()) &&
  !ignoredFiles.has(path.basename(file)) &&
  !isArchivedFile(file)
));

const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push({ file: rel(file), stderr: result.stderr || result.stdout || '' });
  }
}

if (failures.length) {
  console.error(`Active JavaScript syntax check failed for ${failures.length} file(s).`);
  for (const failure of failures) {
    console.error(`- ${failure.file}`);
    if (failure.stderr.trim()) console.error(failure.stderr.trim());
  }
  process.exit(1);
}

console.log(`Active JavaScript syntax ok. Files checked=${files.length}.`);
