import { readdirSync, readFileSync } from 'node:fs';

const evidencePattern = /^LIVE_WRITE_MATRIX.*\.(md|txt)$/i;
const forbiddenText = ['â€”', 'â€“', 'â€™', 'â€œ', 'â€', 'ï»¿'];
let failed = false;

for (const name of readdirSync('.')) {
  if (!evidencePattern.test(name)) continue;
  const bytes = readFileSync(name);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    console.error(`${name}: UTF-8 BOM detected`);
    failed = true;
  }
  const text = bytes.toString('utf8');
  for (const marker of forbiddenText) {
    if (text.includes(marker)) {
      console.error(`${name}: mojibake marker detected: ${marker}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('Live-write matrix evidence encoding regression ok.');