#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const targetVersion = 'v790';
const liveCommit = 'a1d9d542f21e8c32eaa1b117a044e2198b659c85';

function write(path, text){ fs.writeFileSync(path, text, 'utf8'); }

// Narrow gameplay repair: preserve normal 2<3<4<5<6<pik ordering and add only
// the approved conversion that becomes legal once the current regular count is >=5.
const livePath = 'gejast-pikken-live.js';
let live = fs.readFileSync(livePath,'utf8');
const oldBidBlock = `    const idx=order.indexOf(f);\n    order.slice(Math.max(idx+1,0)).forEach((x)=>add(c,x));`;
const newBidBlock = `    const idx=order.indexOf(f);\n    if(f!==1 && c>=5) add(2,1);\n    order.slice(Math.max(idx+1,0)).forEach((x)=>add(c,x));`;
if (!live.includes(newBidBlock)) {
  if (!live.includes(oldBidBlock)) throw new Error('Pikken legalOptions owner changed; refusing blind patch');
  live = live.replace(oldBidBlock,newBidBlock);
  write(livePath,live);
}

const guard = `#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\\d+)$/)?.[1]||0);
assert.ok(versionNumber>=790,'Pikken pik-conversion invariant requires frontend v790+');
const source=fs.readFileSync('gejast-pikken-live.js','utf8');
assert.match(source,/const order=\\[2,3,4,5,6,1\\];/,'Pikken face order must remain 2<3<4<5<6<pik');
assert.match(source,/if\\(f!==1 && c>=5\\) add\\(2,1\\);/,'Pikken must expose 2 x pik once at least 5 regular is bid');
const start=source.indexOf('function legalOptions(bid,total){');
const end=source.indexOf('\\n  function clearParticipantAndReturn',start);
assert.ok(start>=0&&end>start,'Pikken legalOptions owner missing');
const legalOptions=vm.runInNewContext('('+source.slice(start,end).trim()+')');
const key=(x)=>x.c+':'+x.f;
const base=legalOptions(null,12);
assert.deepEqual(base.slice(0,6).map(x=>x.label),['1 x 2','1 x 3','1 x 4','1 x 5','1 x 6','1 x pik'],'base bid ordering changed');
const below=legalOptions({count:4,face:6},12).map(key);
assert.equal(below.includes('2:1'),false,'2 x pik must not unlock below 5 regular');
const threshold=legalOptions({count:5,face:6},12).map(key);
assert.equal(threshold.filter(x=>x==='2:1').length,1,'5 regular must unlock exactly one 2 x pik option');
const above=legalOptions({count:6,face:2},12).map(key);
assert.equal(above.filter(x=>x==='2:1').length,1,'6+ regular must retain the legal 2 x pik conversion');
const pikBid=legalOptions({count:5,face:1},12).map(key);
assert.equal(pikBid.includes('2:1'),false,'pik-to-lower-pik must not be generated');
assert.match(source,/api\\.placeBid\\(gameId,Number\\(bid\\.count\\),Number\\(bid\\.face\\)\\)/,'selected bid must still use the established scoped bid contract');
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
assert.equal(checklist.site_version,version,'live-write checklist must follow release version');
assert.deepEqual(checklist.items,[],'Pikken frontend repair must not arm production writes');
console.log('Pikken v790 bid-conversion regression PASS: base order preserved; 2 x pik unlocks at 5 regular only; write targets remain unarmed.');
`;
write('check-pikken-pik-conversion-v790.mjs',guard);

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const guardCmd='node check-pikken-pik-conversion-v790.mjs';
if(!pkg.scripts['verify:static'].includes(guardCmd)) pkg.scripts['verify:static'] += ' && '+guardCmd;
write('package.json',JSON.stringify(pkg,null,2)+'\n');

write('VERSION',targetVersion+'\n');

const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
checklist.site_version=targetVersion;
checklist.items=[];
write('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');

const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
readiness.site_version='live v789 / release candidate '+targetVersion;
readiness.last_updated='2026-08-13';
readiness.deployment_identity.live_version='v789';
readiness.deployment_identity.frontend_release_merge=liveCommit;
readiness.deployment_identity.repository_head_at_audit=liveCommit;
readiness.deployment_identity.release_candidate_version=targetVersion;
const candidateEvidence='v790 candidate: Pikken live bidding preserves normal 2<3<4<5<6<pik ordering and adds only the approved 2 x pik conversion once a regular bid reaches at least 5; no backend schema, dice-loss owner, Drinks units, admin perimeter or production-write target changes.';
if(!readiness.deployment_identity.evidence.includes(candidateEvidence)) readiness.deployment_identity.evidence.push(candidateEvidence);
const staticIntegrity=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticIntegrity && !String(staticIntegrity.evidence).includes('v790 protects')) staticIntegrity.evidence += ' v790 protects the Pikken special bid conversion: 2 x pik is unavailable below 5 regular, becomes available at 5+ regular, and the established face order and scoped bid RPC remain unchanged.';
write('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

const sync=spawnSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});
if(sync.status!==0) process.exit(sync.status||1);
console.log('PREP_V790=PASS');
