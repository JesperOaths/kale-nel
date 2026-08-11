#!/usr/bin/env node
// Temporary PR-only final audit. Read-only: no production mutations.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const expectedVersion='v787';
const failures=[];
const warnings=[];
const tracked=execFileSync('git',['ls-files'],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean);
const trackedSet=new Set(tracked);
const rootVersion=fs.readFileSync('VERSION','utf8').trim();
if(rootVersion!==expectedVersion) failures.push(`root VERSION expected ${expectedVersion}, got ${rootVersion}`);

const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
const gaps=Array.isArray(readiness.beta_gaps)?readiness.beta_gaps:[];
if(readiness.site_version!=='live v787 / current frontend release v787') failures.push('readiness is not promoted live/current v787');
if(readiness.deployment_identity?.live_version!=='v787') failures.push('readiness live_version is not v787');
if(readiness.deployment_identity?.release_candidate_version) failures.push('readiness unexpectedly retains a release candidate');
if(gaps.length!==12||gaps.some(g=>g.status!=='verified_complete')) failures.push('readiness must remain 12/12 verified_complete');
if(checklist.site_version!=='v787'||!Array.isArray(checklist.items)||checklist.items.length!==0) failures.push('live-write checklist must be v787 with zero armed items');

if(tracked.some(f=>f==='node_modules'||f.startsWith('node_modules/'))) failures.push('node_modules is tracked');
if(tracked.some(f=>f==='.env'||f.endsWith('/.env'))) failures.push('a real .env file is tracked');

const temporaryResidue=[
  'scripts/v787-live-family-alias-proof.mjs',
  '.github/workflows/v787-live-proof.yml',
  'scripts/finalize-v787-live-evidence.mjs',
  '.github/workflows/finalize-v787-live-evidence.yml',
  'scripts/v786-cross-engine-audit.mjs',
  '.github/workflows/v786-cross-engine-compat.yml',
  'V786_LIVE_FINAL_ACCEPTANCE.json',
  'V785_LIVE_FINAL_ACCEPTANCE.json'
];
for(const f of temporaryResidue) if(trackedSet.has(f)) failures.push(`historical temporary audit residue is tracked: ${f}`);

const textExt=/\.(?:html?|mjs|js|css|json|md|txt|yml|yaml|sql|toml)$/i;
const privateKey=/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/;
const secretHits=[];
for(const file of tracked){
  if(!textExt.test(file)) continue;
  let stat; try{stat=fs.statSync(file);}catch{continue;}
  if(stat.size>2_000_000) continue;
  let text; try{text=fs.readFileSync(file,'utf8');}catch{continue;}
  if(privateKey.test(text)) secretHits.push(`${file}: private-key block`);
}
if(secretHits.length) failures.push(...secretHits.map(x=>`high-confidence secret material: ${x}`));

const routes=[
  '/', '/index.html', '/scorer.html', '/score.html', '/klaverjas_scorer_v596_repo_ready.html',
  '/klaverjas_live.html', '/klaverjas_online.html', '/toepen.html', '/beerpong.html', '/boerenbridge.html',
  '/boerenbridge_live.html', '/pikken.html', '/pikken_live.html', '/pikken_spectator.html', '/paardenrace.html',
  '/paardenrace_live.html', '/paardenrace_spectator.html', '/drinks.html', '/drinks_add.html', '/drinks_pending.html',
  '/drinks_history.html', '/drinks_speed.html', '/despimarkt.html', '/beurs.html', '/rad.html', '/profiles.html',
  '/my_profile.html', '/login.html', '/request.html', '/activate.html', '/familie.html', '/familie/index.html',
  '/familie/login.html', '/familie/scorer.html', '/familie/leaderboard.html'
];
const routeFiles=[...new Set(routes.map(r=>r==='/'?'index.html':r.slice(1)))];
const unfinished=[];
for(const file of routeFiles){
  if(!fs.existsSync(file)){failures.push(`authoritative route file missing locally: ${file}`);continue;}
  const text=fs.readFileSync(file,'utf8');
  if(!/<title>[^<]+<\/title>/i.test(text)) failures.push(`${file}: missing non-empty <title>`);
  if(!/<html[^>]*\blang\s*=\s*["'][^"']+["']/i.test(text)) failures.push(`${file}: missing html lang`);
  if(!/<meta[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i.test(text)) failures.push(`${file}: missing viewport meta`);
  const ids=[]; const tagId=/<[^>]+\bid\s*=\s*["']([^"']+)["'][^>]*>/gi; let m;
  while((m=tagId.exec(text))) ids.push(m[1]);
  const seen=new Set(); const dup=new Set();
  for(const id of ids){if(seen.has(id))dup.add(id);seen.add(id);}
  if(dup.size) failures.push(`${file}: duplicate static ids ${[...dup].join(', ')}`);
  const markers=[...text.matchAll(/\b(?:TODO|FIXME|TBD)\b|proof needed|needs proof|repair first|placeholder/gi)].map(x=>x[0]);
  if(markers.length) unfinished.push({file,count:markers.length,samples:[...new Set(markers)].slice(0,6)});
}

const rootHtml=tracked.filter(f=>!f.includes('/')&&f.endsWith('.html'));
const readable=tracked.filter(f=>textExt.test(f)&&!f.startsWith('node_modules/'));
const corpus=new Map();
for(const f of readable){try{const s=fs.statSync(f);if(s.size<1_500_000)corpus.set(f,fs.readFileSync(f,'utf8'));}catch{}}
const orphanCandidates=[];
for(const html of rootHtml){
  let refs=0;
  for(const [file,text] of corpus){if(file!==html&&text.includes(html)){refs++;break;}}
  if(!refs&&!routeFiles.includes(html)) orphanCandidates.push(html);
}
const suspiciousNames=rootHtml.filter(f=>/(?:_orig|_preview|_export|\bprobe\b|\bdev\b|\bbackup\b|\bold\b|artifact)/i.test(f));
if(unfinished.length) warnings.push(`unfinished-marker inventory=${JSON.stringify(unfinished.slice(0,25))}`);
if(orphanCandidates.length) warnings.push(`root HTML with no literal inbound repository reference (review-only candidates)=${orphanCandidates.slice(0,40).join(', ')}`);
if(suspiciousNames.length) warnings.push(`suspicious legacy/artifact-style root HTML names=${suspiciousNames.join(', ')}`);

let pushStatus='not-checked';
try{
  const headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  if(process.env.GITHUB_TOKEN) headers.Authorization=`Bearer ${process.env.GITHUB_TOKEN}`;
  const res=await fetch('https://api.github.com/repos/JesperOaths/kale-nel/actions/workflows/web-push-dispatcher.yml/runs?per_page=1',{headers});
  if(res.ok){
    const data=await res.json(); const latest=data.workflow_runs?.[0];
    if(!latest) failures.push('push dispatcher has no visible workflow run');
    else {
      const ageHours=(Date.now()-Date.parse(latest.updated_at||latest.created_at||0))/36e5;
      pushStatus=`#${latest.run_number} ${latest.status}/${latest.conclusion} age=${ageHours.toFixed(2)}h`;
      if(latest.status!=='completed'||latest.conclusion!=='success') failures.push(`latest push dispatcher is ${latest.status}/${latest.conclusion||'none'}`);
      if(Number.isFinite(ageHours)&&ageHours>12) failures.push(`latest successful push dispatcher run is older than 12h (${ageHours.toFixed(2)}h)`);
    }
  } else warnings.push(`GitHub push workflow API returned HTTP ${res.status}; production mutation-adjacent push RPC smoke intentionally not run`);
}catch(e){warnings.push(`push workflow read failed: ${e instanceof Error?e.message:String(e)}`);}

for(const warning of warnings) console.log('FINAL_AUDIT_INFO '+warning);
console.log('FINAL_STATIC_AUDIT_SUMMARY '+JSON.stringify({version:rootVersion,trackedFiles:tracked.length,authoritativeRouteFiles:routeFiles.length,rootHtml:rootHtml.length,unfinishedMarkerFiles:unfinished.length,orphanCandidates:orphanCandidates.length,suspiciousNames:suspiciousNames.length,pushStatus,failures:failures.length}));
if(failures.length){console.error('FINAL_STATIC_AUDIT_FAIL');for(const f of failures)console.error('- '+f);process.exit(1);}
console.log('FINAL_STATIC_AUDIT=PASS');
