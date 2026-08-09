#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const requiredNode24 = [
  '.github/workflows/dependency-security.yml',
  '.github/workflows/verify.yml',
  '.github/workflows/live-deployment-health.yml',
  '.github/workflows/web-push-dispatcher.yml',
];
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
    if (Number.isFinite(major) && major < 24) failures.push(`${file} contains unsupported ${match[0]}`);
  }
}

if (failures.length) {
  console.error('Node 24 runtime policy failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Node 24 runtime policy PASS across all active workflows, including production web push.');
