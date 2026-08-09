#!/usr/bin/env node
import fs from 'node:fs';

const failures=[];
const removed=[
  "ADMIN_ADMINHTML_BODY_20260801.html",
  "admin-dev.html",
  "admin_v60_orig.html",
  "index_v60_orig.html",
  "klaverjas_quick_stats_v593.html",
  "paardenrace_art_export.html",
  "paardenrace_art_preview.html",
  "probe.html",
  "scorer_v60_orig.html"
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
if(version!=='v772') failures.push('finalization residue guard expects root VERSION v772, got '+version);
if(failures.length){console.error('Finalization residue v772 FAILED');failures.forEach((f)=>console.error('- '+f));process.exit(1);}
console.log('Finalization residue v772 PASS: 9 obsolete public artifacts absent, builder residue absent, node_modules ignored, and homepage Snelheidspoging copy is corrected.');
