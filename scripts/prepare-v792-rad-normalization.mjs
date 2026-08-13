#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const targetVersion='v792';
const liveVersion='v791';
const liveReleaseMerge='03b8b09f9fb8fcb8c649b62bc899f186c06a7b0d';
const mainAtStart='af33bb50144d0e3bb311b09ebbd60458235f40fb';

assert.equal(fs.readFileSync('VERSION','utf8').trim(),liveVersion,'v792 prep must start from v791');

const radPath='rad.html';
let rad=fs.readFileSync(radPath,'utf8');
const totalAnchor='  function totalChance(){ return SEGMENTS.reduce((s,x)=>s+x.chance,0); }';
assert.ok(rad.includes(totalAnchor),'Rad totalChance owner changed; refusing blind patch');
const helpers="\n  function chancePct(seg){ return (Number(seg?.chance||0)/totalChance())*100; }\n  function chanceLabel(seg){ return chancePct(seg).toLocaleString('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'; }";
if(!rad.includes('function chancePct(seg)')) rad=rad.replace(totalAnchor,totalAnchor+helpers);

const canvasBefore="wrapText(seg.label+` (${seg.chance}%)`, r-26, 0, 200, 22);";
const canvasAfter="wrapText(seg.label+` (${chanceLabel(seg)})`, r-26, 0, 200, 22);";
assert.ok(rad.includes(canvasBefore)||rad.includes(canvasAfter),'Rad canvas probability label owner changed');
rad=rad.replace(canvasBefore,canvasAfter);

const resultBefore="Kans: ${seg.chance}%";
const resultAfter="Kans: ${chanceLabel(seg)}";
assert.ok(rad.includes(resultBefore)||rad.includes(resultAfter),'Rad result probability label owner changed');
rad=rad.replace(resultBefore,resultAfter);

const legendBefore='<strong>${seg.chance}%</strong>';
const legendAfter='<strong>${chanceLabel(seg)}</strong>';
assert.ok(rad.includes(legendBefore)||rad.includes(legendAfter),'Rad legend probability label owner changed');
rad=rad.replace(legendBefore,legendAfter);
fs.writeFileSync(radPath,rad,'utf8');

const pkgPath='package.json';
const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
const radGuard='node check-rad-probability-validity-v792.mjs';
if(!pkg.scripts['verify:static'].includes(radGuard)) pkg.scripts['verify:static'] += ' && '+radGuard;
fs.writeFileSync(pkgPath,JSON.stringify(pkg,null,2)+'\n','utf8');

fs.writeFileSync('VERSION',targetVersion+'\n','utf8');

const checklistPath='beta-live-write-checklist.json';
const checklist=JSON.parse(fs.readFileSync(checklistPath,'utf8'));
checklist.site_version=targetVersion;
assert.deepEqual(checklist.items,[],'v792 Rad display repair must not arm production writes');
fs.writeFileSync(checklistPath,JSON.stringify(checklist,null,2)+'\n','utf8');

const readinessPath='beta-readiness.json';
const readiness=JSON.parse(fs.readFileSync(readinessPath,'utf8'));
readiness.site_version=`live ${liveVersion} / release candidate ${targetVersion}`;
readiness.last_updated='2026-08-13';
readiness.deployment_identity.live_version=liveVersion;
readiness.deployment_identity.frontend_release_merge=liveReleaseMerge;
readiness.deployment_identity.repository_head_at_audit=mainAtStart;
readiness.deployment_identity.release_candidate_version=targetVersion;
const evidence='v792 candidate: Caute Rad keeps the existing weighted wheel behavior but displays each segment chance as its normalized share of total wheel weight; canvas, result and legend use the same Dutch one-decimal probability label, and the permanent regression is wired into npm verification.';
if(!readiness.deployment_identity.evidence.includes(evidence)) readiness.deployment_identity.evidence.push(evidence);
const staticIntegrity=(readiness.baseline_checks||[]).find((x)=>x.id==='static_integrity');
if(staticIntegrity&&!String(staticIntegrity.evidence).includes('v792 protects')) staticIntegrity.evidence += ' v792 protects Caute Rad probability validity: raw wheel weights are never presented as percentages, normalized displayed probabilities sum to 100%, and the regression is part of verify:static.';
fs.writeFileSync(readinessPath,JSON.stringify(readiness,null,2)+'\n','utf8');

const sync=spawnSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});
if(sync.status!==0) process.exit(sync.status||1);

// Temporary release-prep machinery must not survive in the product tree.
for(const path of ['scripts/prepare-v792-rad-normalization.mjs','.github/workflows/v792-rad-normalization-prep.yml']){
  try{fs.rmSync(path);}catch(error){if(error?.code!=='ENOENT') throw error;}
}

// Version synchronization touches existing lines. Some carried historical trailing spaces that become
// new diff errors solely because the version token changed. Clean exactly those reported touched lines;
// do not perform a broad formatting rewrite.
function cleanTouchedLineWhitespace(){
  const first=spawnSync('git',['diff','--check'],{encoding:'utf8'});
  if(first.status===0) return;
  const output=`${first.stdout||''}${first.stderr||''}`;
  const matches=[...output.matchAll(/^(.+?):(\d+): trailing whitespace\.$/gm)];
  const residual=output.replace(/^.+?:\d+: trailing whitespace\.\n(?:\+.*\n)?/gm,'').trim();
  assert.ok(matches.length>0,`diff integrity failed for a reason other than touched-line whitespace:\n${output}`);
  assert.equal(residual,'',`diff integrity has non-whitespace errors:\n${residual}`);
  const byFile=new Map();
  for(const match of matches){
    const path=match[1];
    const line=Number(match[2]);
    if(!byFile.has(path)) byFile.set(path,new Set());
    byFile.get(path).add(line);
  }
  for(const [path,lineNos] of byFile){
    const text=fs.readFileSync(path,'utf8');
    const hadFinalNewline=text.endsWith('\n');
    const lines=text.split('\n');
    for(const lineNo of lineNos){
      const index=lineNo-1;
      assert.ok(index>=0&&index<lines.length,`${path}:${lineNo} is outside file bounds`);
      lines[index]=lines[index].replace(/[ \t]+$/,'');
    }
    let cleaned=lines.join('\n');
    if(hadFinalNewline&&!cleaned.endsWith('\n')) cleaned+='\n';
    fs.writeFileSync(path,cleaned,'utf8');
  }
  const after=spawnSync('git',['diff','--check'],{encoding:'utf8'});
  if(after.status!==0){
    process.stderr.write(after.stdout||'');
    process.stderr.write(after.stderr||'');
    process.exit(after.status||1);
  }
  console.log(`Touched-line whitespace cleanup PASS. Files=${byFile.size}; lines=${matches.length}.`);
}
cleanTouchedLineWhitespace();

console.log('PREP_V792_RAD_NORMALIZATION=PASS');
