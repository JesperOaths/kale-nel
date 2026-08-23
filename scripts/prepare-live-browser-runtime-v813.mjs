#!/usr/bin/env node
import fs from 'node:fs';

const sourcePath = 'scripts/final-cert-live-browser-v792.mjs';
const runtimePath = 'scripts/.generated-final-cert-live-browser-system-chrome.mjs';
const workflowPath = '.github/workflows/final-certification-live-browser-v792.yml';
const chrome = String(process.env.GEJAST_SYSTEM_CHROME || '').trim();
const releaseVersion = fs.readFileSync('VERSION', 'utf8').trim();
const workflowText = fs.readFileSync(workflowPath, 'utf8');
const configText = fs.readFileSync('gejast-config.js', 'utf8');

if (!chrome) throw new Error('GEJAST_SYSTEM_CHROME is required');
if (!fs.existsSync(chrome)) throw new Error(`Configured system Chrome does not exist: ${chrome}`);
if (!/^v\d+$/.test(releaseVersion)) throw new Error(`Invalid checked-in VERSION: ${releaseVersion || 'empty'}`);
if (!workflowText.includes('token1="$(openssl rand -hex 24)"') || !workflowText.includes('token2="$(openssl rand -hex 24)"')) {
  throw new Error('Final certification fixtures must generate production-format 48-hex session tokens');
}
if (!workflowText.includes('[[ "$token1" =~ ^[0-9a-f]{48}$ ]]') || !workflowText.includes('[[ "$token2" =~ ^[0-9a-f]{48}$ ]]')) {
  throw new Error('Final certification fixture token format assertions are missing');
}
if (!configText.includes("return /^[0-9a-f]{48}$/i.test(token);")) {
  throw new Error('Browser session parser contract changed; update final certification fixtures before running acceptance');
}

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

// The historical campaign waited a fixed 900 ms and could navigate away while the
// asynchronous fail-closed auth gate was still validating the disposable session.
// Wait for the gate itself so route acceptance proves authentication instead of racing it.
const navAnchor = "  const response = await page.goto(new URL(route, BASE).toString(), { waitUntil: 'domcontentloaded', timeout });";
const navMatches = runtime.split(navAnchor).length - 1;
if (navMatches !== 1) {
  throw new Error(`Expected exactly one historical navigation anchor in ${sourcePath}; found ${navMatches}`);
}
runtime = runtime.replace(navAnchor, "  const preNavToken = await page.evaluate(() => { try { return localStorage.getItem('jas_session_token_v11') || sessionStorage.getItem('jas_session_token_v11') || localStorage.getItem('jas_session_token_v10') || sessionStorage.getItem('jas_session_token_v10') || ''; } catch (_) { return ''; } }).catch(() => '');\n  const response = await page.goto(new URL(route, BASE).toString(), { waitUntil: 'domcontentloaded', timeout });");

const authAnchor = "  await page.waitForTimeout(900);\n  if (/login\\.html/i.test(page.url())) throw new Error(`${label} unexpectedly redirected to login`);";
const authMatches = runtime.split(authAnchor).length - 1;
if (authMatches !== 1) {
  throw new Error(`Expected exactly one historical auth-wait anchor in ${sourcePath}; found ${authMatches}`);
}
const authReplacement = "  await page.waitForFunction(() => document.documentElement.getAttribute('data-gejast-auth-state') === 'authenticated' || /login\\.html/i.test(location.pathname), undefined, { timeout });\n  if (/login\\.html/i.test(page.url())) {\n    const postNavTokenPresent = await page.evaluate(() => { try { return !!(localStorage.getItem('jas_session_token_v11') || sessionStorage.getItem('jas_session_token_v11') || localStorage.getItem('jas_session_token_v10') || sessionStorage.getItem('jas_session_token_v10')); } catch (_) { return false; } }).catch(() => false);\n    let directProbe = 'not-run';\n    if (preNavToken) {\n      try { const state = await rpc('account_public_state_v687', { session_token: preNavToken, session_token_input: preNavToken, site_scope_input: siteScope }); directProbe = `ok=${state?.ok === true};scope=${String(state?.site_scope || '') || 'missing'}`; }\n      catch (error) { directProbe = `error=${safe(error)}`; }\n    }\n    throw new Error(`${label} unexpectedly redirected to login (token_before=${!!preNavToken}; token_after=${postNavTokenPresent}; direct_probe=${directProbe})`);\n  }\n  const authState = await page.locator('html').getAttribute('data-gejast-auth-state');\n  if (authState !== 'authenticated') throw new Error(`${label} auth gate did not authenticate; state=${authState || 'missing'}`);\n  await page.waitForTimeout(200);";
runtime = runtime.replace(authAnchor, authReplacement);

if (!runtime.includes('executablePath:')) throw new Error('System Chrome runtime patch did not apply');
if (!runtime.includes(`includes(${JSON.stringify(releaseVersion)})`)) throw new Error('Current release watermark runtime patch did not apply');
if (!runtime.includes('direct_probe=')) throw new Error('Auth-gate diagnostic runtime patch did not apply');
fs.writeFileSync(runtimePath, runtime, 'utf8');
console.log(`Prepared deterministic system Chrome runtime for ${releaseVersion}: ${runtimePath}`);
console.log('RESULT=LIVE_BROWSER_SYSTEM_CHROME_RUNTIME_PASS');
