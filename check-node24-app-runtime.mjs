#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const failures = [];
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));

if (pkg.engines?.node !== '>=24') {
  failures.push(`package.json engines.node expected >=24, got ${pkg.engines?.node || '(missing)'}`);
}
const lockEngine = lock.packages?.['']?.engines?.node;
if (lockEngine !== '>=24') {
  failures.push(`package-lock.json root engines.node expected >=24, got ${lockEngine || '(missing)'}`);
}

const requiredNode24Workflows = [
  '.github/workflows/dependency-security.yml',
  '.github/workflows/verify.yml',
  '.github/workflows/web-push-dispatcher.yml',
  '.github/workflows/live-deployment-health.yml',
];
for (const file of requiredNode24Workflows) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('actions/setup-node@v5')) failures.push(`${file} must use actions/setup-node@v5`);
  if (!/node-version:\s*['"]24['"]/.test(text)) failures.push(`${file} must pin node-version: '24'`);
}

for (const name of fs.readdirSync('.github/workflows')) {
  if (!/\.ya?ml$/i.test(name)) continue;
  const file = path.join('.github/workflows', name);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/node-version:\s*['"]?(\d+)(?:\.\d+)?['"]?/g)) {
    const major = Number(match[1]);
    if (Number.isFinite(major) && major < 24) failures.push(`${file} contains unsupported ${match[0]}`);
  }
}

if (failures.length) {
  console.error('Node 24 application runtime policy failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Node 24 application runtime policy PASS.');
