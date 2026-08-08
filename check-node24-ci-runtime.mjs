#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const requiredNode24 = [
  '.github/workflows/dependency-security.yml',
  '.github/workflows/verify.yml',
  '.github/workflows/live-deployment-health.yml',
];
const productionException = '.github/workflows/web-push-dispatcher.yml';
const failures = [];

for (const file of requiredNode24) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('actions/setup-node@v5')) failures.push(`${file} must use actions/setup-node@v5`);
  if (!/node-version:\s*['"]24['"]/.test(text)) failures.push(`${file} must pin node-version: '24'`);
}

for (const name of fs.readdirSync('.github/workflows')) {
  if (!/\.ya?ml$/i.test(name)) continue;
  const file = path.join('.github/workflows', name).replaceAll('\\', '/');
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/node-version:\s*['"]?(\d+)(?:\.\d+)?['"]?/g)) {
    const major = Number(match[1]);
    if (Number.isFinite(major) && major < 24 && file !== productionException) {
      failures.push(`${file} contains unsupported ${match[0]}`);
    }
  }
}

const dispatcher = fs.readFileSync(productionException, 'utf8');
if (!/node-version:\s*['"]20['"]/.test(dispatcher)) {
  failures.push(`${productionException} production exception must remain explicitly pinned to Node 20 until its isolated migration is approved`);
}

if (failures.length) {
  console.error('Node 24 CI runtime policy failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Node 24 CI runtime policy PASS; production web-push dispatcher remains isolated on Node 20.');
