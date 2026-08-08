#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const dir = '.github/workflows';
const failures = [];
let files = 0;
for (const name of fs.readdirSync(dir)) {
  if (!/\.ya?ml$/i.test(name)) continue;
  files += 1;
  const file = path.join(dir, name);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/actions\/(checkout|setup-node)@v([1-4])\b/g)) {
    failures.push(`${file}: ${match[0]}`);
  }
}
if (failures.length) {
  console.error('Deprecated GitHub action runtime pins found:');
  failures.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}
console.log(`GitHub action Node24-runtime pin regression PASS. Workflows checked=${files}.`);
