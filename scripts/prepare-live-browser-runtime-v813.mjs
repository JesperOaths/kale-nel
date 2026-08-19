#!/usr/bin/env node
import fs from 'node:fs';

const sourcePath = 'scripts/final-cert-live-browser-v792.mjs';
const runtimePath = 'scripts/.generated-final-cert-live-browser-system-chrome.mjs';
const chrome = String(process.env.GEJAST_SYSTEM_CHROME || '').trim();

if (!chrome) throw new Error('GEJAST_SYSTEM_CHROME is required');
if (!fs.existsSync(chrome)) throw new Error(`Configured system Chrome does not exist: ${chrome}`);

const source = fs.readFileSync(sourcePath, 'utf8');
const anchor = 'const browser = await chromium.launch({ headless: true });';
const matches = source.split(anchor).length - 1;
if (matches !== 1) {
  throw new Error(`Expected exactly one Chromium launch anchor in ${sourcePath}; found ${matches}`);
}

const runtime = source.replace(
  anchor,
  `const browser = await chromium.launch({ headless: true, executablePath: ${JSON.stringify(chrome)} });`,
);

if (!runtime.includes('executablePath:')) throw new Error('System Chrome runtime patch did not apply');
fs.writeFileSync(runtimePath, runtime, 'utf8');
console.log(`Prepared deterministic system Chrome runtime: ${runtimePath}`);
console.log('RESULT=LIVE_BROWSER_SYSTEM_CHROME_RUNTIME_PASS');
