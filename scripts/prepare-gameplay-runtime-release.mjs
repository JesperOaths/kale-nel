#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TARGET_NUM = 789;
const TARGET = `v${TARGET_NUM}`;
const LIVE = 'v788';

function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
  console.log(`prepared ${path}`);
}
function replaceOnce(text, pattern, replacement, label) {
  const matches = text.match(pattern);
  if (!matches) throw new Error(`Required release edit not found: ${label}`);
  const next = text.replace(pattern, replacement);
  if (next === text) throw new Error(`Release edit made no change: ${label}`);
  return next;
}

write('VERSION', `${TARGET}\n`);

let scorer = fs.readFileSync('scorer.html', 'utf8');
scorer = replaceOnce(
  scorer,
  /(\.overlay\s*\{[^{}]*?z-index:)40(;[^{}]*?\})/s,
  '$1' + '10000' + '$2',
  'Klaverjas overlay interactive stacking layer'
);
write('scorer.html', scorer);

let ladder = fs.readFileSync('pikken_ladder.html', 'utf8');
ladder = replaceOnce(
  ladder,
  /<script src="\.\/gejast-despimarkt\.js\?v\d+"><\/script>\s*<script>document\.addEventListener\('DOMContentLoaded',\(\)=>window\.GEJAST_DESPIMARKT&&window\.GEJAST_DESPIMARKT\.loadLadderPage\('pikken'\)\);<\/script>/,
  `<script src="./gejast-pikken-ladder.js?${TARGET}"></script>\n<script>document.addEventListener('DOMContentLoaded',()=>window.GEJAST_PIKKEN_LADDER&&window.GEJAST_PIKKEN_LADDER.load());</script>`,
  'Pikken-owned ladder boot'
);
write('pikken_ladder.html', ladder);

const readiness = JSON.parse(fs.readFileSync('beta-readiness.json', 'utf8'));
readiness.site_version = `live ${LIVE} / release candidate ${TARGET}`;
readiness.last_updated = '2026-08-12';
readiness.deployment_identity = readiness.deployment_identity || {};
readiness.deployment_identity.live_version = LIVE;
readiness.deployment_identity.release_candidate_version = TARGET;
readiness.deployment_identity.evidence = Array.isArray(readiness.deployment_identity.evidence) ? readiness.deployment_identity.evidence : [];
const releaseEvidence = `${TARGET} candidate: cross-browser gameplay audit identified and repairs two isolated runtime owners — Klaverjas scorer modal stacking and the Pikken ladder renderer; no backend schema, game scoring, admin perimeter, Drinks units or production write contract changed.`;
if (!readiness.deployment_identity.evidence.includes(releaseEvidence)) readiness.deployment_identity.evidence.push(releaseEvidence);
const staticIntegrity = (readiness.baseline_checks || []).find((item) => item.id === 'static_integrity');
if (staticIntegrity && !String(staticIntegrity.evidence || '').includes(`${TARGET} protects`)) {
  staticIntegrity.evidence = `${staticIntegrity.evidence} ${TARGET} protects the canonical Klaverjas scorer modal as the top interactive layer and gives the Pikken ladder its own scoped stats renderer instead of the incompatible Beurs ladder owner.`;
}
write('beta-readiness.json', JSON.stringify(readiness, null, 2) + '\n');

const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json', 'utf8'));
checklist.site_version = TARGET;
if (!Array.isArray(checklist.items) || checklist.items.length !== 0) throw new Error('Live-write checklist unexpectedly contains armed items; refusing release preparation.');
write('beta-live-write-checklist.json', JSON.stringify(checklist, null, 2) + '\n');

const checkPath = `check-gameplay-runtime-fixes-${TARGET}.mjs`;
const checkSource = `#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version = fs.readFileSync('VERSION','utf8').trim();
const versionNumber = Number(version.match(/^v(\\d+)$/)?.[1] || 0);
assert.ok(versionNumber >= ${TARGET_NUM}, 'gameplay runtime repair invariant requires frontend ${TARGET}+');

const scorer = fs.readFileSync('scorer.html','utf8');
const overlayRule = scorer.match(/\\.overlay\\s*\\{[^{}]*?z-index:(\\d+)/s);
assert.ok(overlayRule, 'Klaverjas scorer overlay stacking rule missing');
assert.ok(Number(overlayRule[1]) > 9998, 'Klaverjas overlays must sit above fixed home/game-management controls');
assert.match(scorer, /class=\\"manage-match-chip\\"/, 'Klaverjas management chip baseline disappeared');
assert.match(scorer, /class=\\"page-floating-logo\\"/, 'Klaverjas floating home control baseline disappeared');

const ladderHtml = fs.readFileSync('pikken_ladder.html','utf8');
assert.match(ladderHtml, /gejast-pikken-ladder\\.js\\?v\\d+/, 'Pikken ladder must load its game-owned renderer');
assert.match(ladderHtml, /GEJAST_PIKKEN_LADDER&&window\\.GEJAST_PIKKEN_LADDER\\.load\\(\\)/, 'Pikken ladder must boot the game-owned renderer');
assert.doesNotMatch(ladderHtml, /GEJAST_DESPIMARKT[^\\n]*loadLadderPage\\('pikken'\\)/, 'Pikken ladder must not call the incompatible Beurs ladder renderer');
for (const id of ['ladderStatus','ladderOverviewGrid','ladderStoryGrid','ladderRows','ladderHistory','ladderSectionsWrap','ladderTablesWrap','ladderFormulaNote']) assert.match(ladderHtml, new RegExp('id=[\\"\\\\\']' + id + '[\\"\\\\\']'), 'Pikken ladder DOM owner missing #' + id);

const renderer = fs.readFileSync('gejast-pikken-ladder.js','utf8');
assert.match(renderer, /callRpc\\('get_pikken_stats_scoped'/, 'Pikken ladder must use the scoped Pikken stats contract');
for (const id of ['ladderOverviewGrid','ladderStoryGrid','ladderRows','ladderHistory','ladderSectionsWrap','ladderTablesWrap','ladderFormulaNote']) assert.ok(renderer.includes(id), 'Pikken renderer does not own #' + id);
assert.match(renderer, /replace\\(\\/\\[&<>\\"'\\]\\/g/, 'Pikken renderer must HTML-escape backend labels/values');

const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
assert.equal(checklist.site_version, version, 'live-write checklist version must follow release');
assert.deepEqual(checklist.items, [], 'gameplay runtime repair must not arm production writes');

console.log('gameplay runtime repair regression PASS at ' + version + ': Klaverjas modal pointer ownership and Pikken scoped ladder rendering are protected; live writes remain unarmed.');
`;
write(checkPath, checkSource);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const guardCommand = `node ${checkPath}`;
if (!String(pkg.scripts?.['verify:static'] || '').includes(guardCommand)) {
  pkg.scripts['verify:static'] = `${pkg.scripts['verify:static']} && ${guardCommand}`;
}
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

execFileSync(process.execPath, ['fix-version-drift.mjs'], { stdio: 'inherit' });
console.log(`RELEASE_PREPARED=${TARGET}`);
