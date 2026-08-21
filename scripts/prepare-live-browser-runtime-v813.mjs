#!/usr/bin/env node
import fs from 'node:fs';

const sourcePath = 'scripts/final-cert-live-browser-v792.mjs';
const runtimePath = 'scripts/.generated-final-cert-live-browser-system-chrome.mjs';
const chrome = String(process.env.GEJAST_SYSTEM_CHROME || '').trim();
const releaseVersion = fs.readFileSync('VERSION', 'utf8').trim();

if (!chrome) throw new Error('GEJAST_SYSTEM_CHROME is required');
if (!fs.existsSync(chrome)) throw new Error(`Configured system Chrome does not exist: ${chrome}`);
if (!/^v\d+$/.test(releaseVersion)) throw new Error(`Invalid checked-in VERSION: ${releaseVersion || 'empty'}`);

let runtime = fs.readFileSync(sourcePath, 'utf8');
const launchAnchor = 'const browser = await chromium.launch({ headless: true });';
const launchMatches = runtime.split(launchAnchor).length - 1;
if (launchMatches !== 1) {
  throw new Error(`Expected exactly one Chromium launch anchor in ${sourcePath}; found ${launchMatches}`);
}
runtime = runtime.replace(
  launchAnchor,
  `const browser = await chromium.launch({ headless: true, executablePath: ${JSON.stringify(chrome)} });`,
);

const watermarkAnchor = "versionText.join(' ').includes('v792')";
const watermarkMatches = runtime.split(watermarkAnchor).length - 1;
if (watermarkMatches !== 1) {
  throw new Error(`Expected exactly one historical watermark anchor in ${sourcePath}; found ${watermarkMatches}`);
}
runtime = runtime
  .replace(watermarkAnchor, `versionText.join(' ').includes(${JSON.stringify(releaseVersion)})`)
  .replace('missing v792 watermark', `missing ${releaseVersion} watermark`);

if (!runtime.includes('executablePath:')) throw new Error('System Chrome runtime patch did not apply');
if (!runtime.includes(`includes(${JSON.stringify(releaseVersion)})`)) throw new Error('Current release watermark runtime patch did not apply');
fs.writeFileSync(runtimePath, runtime, 'utf8');
console.log(`Prepared deterministic system Chrome runtime for ${releaseVersion}: ${runtimePath}`);
console.log('RESULT=LIVE_BROWSER_SYSTEM_CHROME_RUNTIME_PASS');
