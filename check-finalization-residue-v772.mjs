#!/usr/bin/env node
import fs from 'node:fs';

const failures=[];
const removed=[
  "ADMIN_ADMINHTML_BODY_20260801.html",
  "ADMIN_ADMINHTML_HEADERS_20260801.txt",
  "ADMIN_BROWSER_NAV_TRACE_20260801.json",
  "ADMIN_BROWSER_NAV_VARIANTS_20260801.json",
  "ADMIN_CHROMIUM_FRESH_ADMINHTML_20260801.png",
  "ADMIN_CLOUDFLARE_CONFIG_INSPECTION_20260801.json",
  "ADMIN_FIREFOX_FRESH_ADMINHTML_20260801.png",
  "ADMIN_FIREFOX_LOOP_CURL_20260801.json",
  "ADMIN_FIREFOX_LOOP_DIAGNOSIS_20260801.md",
  "ADMIN_SERVED_LOCATION_SEARCH_20260801.json",
  "ADMIN_SERVED_NAV_SEARCH_20260801.json",
  "admin-dev.html",
  "admin_v60_orig.html",
  "index_v60_orig.html",
  "klaverjas_quick_stats_v593.html",
  "paardenrace_art_export.html",
  "paardenrace_art_preview.html",
  "probe.html",
  "scorer_v60_orig.html",
  "scripts/screenshot-admin-fresh-browsers.mjs",
  "scripts/trace-admin-browser-navigation.mjs",
  "scripts/trace-admin-browser-variants.mjs",
  "scripts/trace-system-firefox-admin.mjs"
];
for(const file of removed) if(fs.existsSync(file)) failures.push('public residue artifact returned: '+file);
for(const temporary of ['scripts/apply-v772-finalization.mjs','.github/workflows/v772-apply-finalization.yml']) {
  if(fs.existsSync(temporary)) failures.push('one-time v772 builder residue returned: '+temporary);
}
const gitignore=fs.readFileSync('.gitignore','utf8');
if(!/^node_modules\/$/m.test(gitignore)) failures.push('.gitignore must keep node_modules/ excluded');
const index=fs.readFileSync('index.html','utf8');
if(!index.includes('Snelheidspoging')) failures.push('homepage must use Snelheidspoging');
if(index.includes('Snelheids poging')) failures.push('homepage still contains Snelheids poging');
const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(String(version).replace(/^v/i,''));
if(!Number.isFinite(versionNumber)||versionNumber<772) failures.push('finalization residue guard expects root VERSION >= v772, got '+version);
if(failures.length){console.error('Finalization residue v772 FAILED');failures.forEach((f)=>console.error('- '+f));process.exit(1);}
console.log('Finalization residue v772 PASS: 23 obsolete public/diagnostic artifacts absent, builder residue absent, node_modules ignored, and homepage Snelheidspoging copy is corrected.');
