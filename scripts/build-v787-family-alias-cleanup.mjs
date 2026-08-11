#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const aliases = [
  ['familie/index.html','GEJAST Familie','../index.html?scope=family'],
  ['familie/login.html','Doorsturen…','../login.html?scope=family'],
  ['familie/scorer.html','Doorsturen…','../scorer.html?scope=family'],
  ['familie/leaderboard.html','Doorsturen…','../leaderboard.html?scope=family']
];

for (const [path,title,target] of aliases) {
  const html = `<!doctype html><html lang="nl"><head><meta charset="UTF-8"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet,max-image-preview:none"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta http-equiv="refresh" content="0; url=${target}"><title>${title}</title><script>window.GEJAST_PAGE_VERSION='v787';location.replace('${target}');</script></head><body><a href="${target}">Doorgaan</a><div class="site-credit-watermark" data-version-watermark>v787 - Made by Bruis</div></body></html>\n`;
  fs.writeFileSync(path, html);
}

fs.writeFileSync('VERSION','v787\n');
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
checklist.site_version='v787';
fs.writeFileSync('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');

const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
readiness.last_updated='2026-08-11';
readiness.site_version='live v786 / release candidate v787';
readiness.deployment_identity=readiness.deployment_identity||{};
readiness.deployment_identity.live_version='v786';
readiness.deployment_identity.release_candidate_version='v787';
readiness.deployment_identity.note='v787 release candidate: four Family redirect aliases are runtime-light redirect-only wrappers preserving exact family-scope destinations; live v786 remains authoritative until post-merge public proof. No production write is required.';
fs.writeFileSync('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

execFileSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});

const guard=`#!/usr/bin/env node
import fs from 'node:fs';
const root=fs.readFileSync('VERSION','utf8').trim();
const rootN=Number(root.match(/^v(\\d+)$/)?.[1]||0);
const failures=[];
if(rootN<787) failures.push('v787 Family alias guard requires VERSION >= v787');
const aliases=[
  ['familie/index.html','../index.html?scope=family'],
  ['familie/login.html','../login.html?scope=family'],
  ['familie/scorer.html','../scorer.html?scope=family'],
  ['familie/leaderboard.html','../leaderboard.html?scope=family']
];
for(const [path,target] of aliases){
  const text=fs.readFileSync(path,'utf8');
  if(/<script\\s+[^>]*src=/i.test(text)) failures.push(path+' must not load external scripts');
  if(/<link\\s+[^>]*href=/i.test(text)) failures.push(path+' must not load external styles/resources');
  if(!text.includes("location.replace('"+target+"')")) failures.push(path+' must preserve JS redirect to '+target);
  if(!text.includes('http-equiv="refresh" content="0; url='+target+'"')) failures.push(path+' must preserve non-JS redirect fallback to '+target);
  if(!text.includes('href="'+target+'"')) failures.push(path+' must preserve visible fallback link to '+target);
  if(/gejast-config\\.js|gejast-scope-hardening\\.js|gejast-v725-repair\\.js|gejast-site-announcements\\.js/i.test(text)) failures.push(path+' must not bootstrap normal runtime before redirect');
}
for(const path of ['scripts/build-v787-family-alias-cleanup.mjs','.github/workflows/v787-family-alias-cleanup.yml']) if(fs.existsSync(path)) failures.push('temporary v787 builder residue remains: '+path);
if(failures.length){console.error('v787 Family redirect alias regression failed:');for(const f of failures) console.error('- '+f);process.exit(1);}
console.log('v787 Family redirect aliases PASS: four wrappers are runtime-light, preserve exact family-scope destinations, and retain JS + meta-refresh + visible-link fallbacks.');
`;
fs.writeFileSync('check-family-redirect-alias-v787.mjs',guard);

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const cmd='node check-family-redirect-alias-v787.mjs';
if(!String(pkg.scripts?.['verify:static']||'').includes(cmd)) pkg.scripts['verify:static'] += ' && '+cmd;
fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');

fs.rmSync('scripts/build-v787-family-alias-cleanup.mjs',{force:true});
fs.rmSync('.github/workflows/v787-family-alias-cleanup.yml',{force:true});

execFileSync('npm',['run','verify'],{stdio:'inherit'});
execFileSync('git',['diff','--check'],{stdio:'inherit'});
console.log('V787_CANDIDATE_BUILD=PASS');
