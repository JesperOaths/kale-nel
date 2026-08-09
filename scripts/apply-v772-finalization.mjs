#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function assertDiffWhitespaceClean() {
  // Many long-lived HTML files use CRLF. Tell Git that CR is the line terminator rather than
  // trailing whitespace, while still rejecting actual spaces/tabs added at end of changed lines.
  const config = spawnSync('git', ['config', 'core.whitespace', 'cr-at-eol'], { encoding: 'utf8' });
  if (config.status !== 0) throw new Error(`Failed to configure CRLF-aware whitespace check: ${config.stderr || config.stdout || ''}`);
  const check = spawnSync('git', ['diff', '--check'], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`git diff --check failed:\n${check.stdout || ''}${check.stderr || ''}`);
  console.log('git diff --check PASS with CRLF recognized as end-of-line');
}

const TARGET = 'v772';
const CURRENT = fs.readFileSync('VERSION', 'utf8').trim();
if (CURRENT !== 'v771') throw new Error(`Expected VERSION v771 before v772 apply, got ${CURRENT}`);

const removedArtifacts = [
  'ADMIN_ADMINHTML_BODY_20260801.html',
  'admin-dev.html',
  'admin_v60_orig.html',
  'index_v60_orig.html',
  'klaverjas_quick_stats_v593.html',
  'paardenrace_art_export.html',
  'paardenrace_art_preview.html',
  'probe.html',
  'scorer_v60_orig.html',
];

for (const file of removedArtifacts) {
  if (!fs.existsSync(file)) throw new Error(`Expected residue artifact missing before cleanup: ${file}`);
  fs.unlinkSync(file);
  console.log(`removed ${file}`);
}

let index = fs.readFileSync('index.html', 'utf8');
const typoMatches = index.match(/Snelheids poging/g) || [];
if (typoMatches.length !== 2) throw new Error(`Expected exactly two raw homepage 'Snelheids poging' labels, found ${typoMatches.length}`);
index = index.replaceAll('Snelheids poging', 'Snelheidspoging');
fs.writeFileSync('index.html', index, 'utf8');
console.log('fixed both homepage Snelheidspoging labels');

fs.writeFileSync('VERSION', `${TARGET}\n`, 'utf8');
const versionFix = spawnSync(process.execPath, ['fix-version-drift.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
process.stdout.write(versionFix.stdout || '');
process.stderr.write(versionFix.stderr || '');
if (versionFix.status !== 0) throw new Error(`fix-version-drift.mjs failed with status ${versionFix.status}`);

const checklistPath = 'beta-live-write-checklist.json';
const checklist = JSON.parse(fs.readFileSync(checklistPath, 'utf8'));
if ((checklist.items || []).length !== 0) throw new Error('Refusing v772 release while beta live-write checklist is not empty');
checklist.site_version = TARGET;
fs.writeFileSync(checklistPath, `${JSON.stringify(checklist, null, 2)}\n`, 'utf8');

const readinessPath = 'beta-readiness.json';
const readiness = JSON.parse(fs.readFileSync(readinessPath, 'utf8'));
if (readiness.deployment_identity?.live_version !== 'v771') {
  throw new Error(`Expected readiness live_version v771 before release candidate, got ${readiness.deployment_identity?.live_version}`);
}
readiness.site_version = 'release candidate v772 / live v771';
readiness.last_updated = '2026-08-09';
readiness.deployment_identity.release_candidate_version = TARGET;
readiness.deployment_identity.note = 'v772 release candidate: mechanical version alignment plus removal of nine runtime-unreferenced public residue artifacts and homepage Snelheidspoging copy fix. Live remains v771 until post-merge deployment proof promotes this candidate.';
fs.writeFileSync(readinessPath, `${JSON.stringify(readiness, null, 2)}\n`, 'utf8');

const readinessGuardPath = 'check-beta-readiness-current-v770d.mjs';
let readinessGuard = fs.readFileSync(readinessGuardPath, 'utf8');
const oldReadinessCheck = "if (tracker.deployment_identity?.live_version !== version) failures.push(`tracker live_version ${tracker.deployment_identity?.live_version || '(missing)'} must equal root VERSION ${version}`);";
const newReadinessCheck = "const trackedReleaseVersion = tracker.deployment_identity?.release_candidate_version || tracker.deployment_identity?.live_version;\nif (trackedReleaseVersion !== version) failures.push(`tracker release/live version ${trackedReleaseVersion || '(missing)'} must equal root VERSION ${version}`);";
if (!readinessGuard.includes(oldReadinessCheck)) throw new Error('Current readiness version assertion did not match expected v771 form');
readinessGuard = readinessGuard.replace(oldReadinessCheck, newReadinessCheck);
fs.writeFileSync(readinessGuardPath, readinessGuard, 'utf8');

const liveSafetyPath = 'check-live-write-safety-v770e.mjs';
let liveSafety = fs.readFileSync(liveSafetyPath, 'utf8');
if (!liveSafety.includes("if(checklist.site_version!=='v771')")) throw new Error('Live-write safety checklist version assertion did not match v771');
liveSafety = liveSafety.replace("if(checklist.site_version!=='v771')", "if(checklist.site_version!=='v772')");
liveSafety = liveSafety.replace('live-write checklist must target v771', 'live-write checklist must target v772');
fs.writeFileSync(liveSafetyPath, liveSafety, 'utf8');

const finalGuardPath = 'check-finalization-residue-v772.mjs';
const finalGuard = `#!/usr/bin/env node\nimport fs from 'node:fs';\n\nconst failures=[];\nconst removed=${JSON.stringify(removedArtifacts, null, 2)};\nfor(const file of removed) if(fs.existsSync(file)) failures.push('public residue artifact returned: '+file);\nconst index=fs.readFileSync('index.html','utf8');\nif(!index.includes('Snelheidspoging')) failures.push('homepage must use Snelheidspoging');\nif(index.includes('Snelheids poging')) failures.push('homepage still contains Snelheids poging');\nconst version=fs.readFileSync('VERSION','utf8').trim();\nif(version!=='v772') failures.push('finalization residue guard expects root VERSION v772, got '+version);\nif(failures.length){console.error('Finalization residue v772 FAILED');failures.forEach((f)=>console.error('- '+f));process.exit(1);}\nconsole.log('Finalization residue v772 PASS: 9 obsolete public artifacts absent and homepage Snelheidspoging copy is corrected.');\n`;
fs.writeFileSync(finalGuardPath, finalGuard, 'utf8');

const homeGuardPath = 'check-homepage-root-fixes.mjs';
let homeGuard = fs.readFileSync(homeGuardPath, 'utf8');
if (!homeGuard.includes("import './check-finalization-residue-v772.mjs';")) {
  homeGuard = homeGuard.replace("import fs from 'node:fs';", "import fs from 'node:fs';\nimport './check-finalization-residue-v772.mjs';");
}
fs.writeFileSync(homeGuardPath, homeGuard, 'utf8');

const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (!pkg.scripts?.['verify:static']) throw new Error('package verify:static missing');
if (!pkg.scripts['verify:static'].includes('check-finalization-residue-v772.mjs')) {
  pkg.scripts['verify:static'] += ' && node check-finalization-residue-v772.mjs';
}
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

for (const temporary of [
  'scripts/finalization-residue-audit-v771f.mjs',
  '.github/workflows/v771f-finalization-residue-audit.yml',
  'scripts/apply-v772-finalization.mjs',
  '.github/workflows/v772-apply-finalization.yml',
]) {
  if (fs.existsSync(temporary)) {
    fs.unlinkSync(temporary);
    console.log(`removed temporary ${temporary}`);
  }
}

assertDiffWhitespaceClean();
console.log('v772 finalization release candidate prepared.');
