#!/usr/bin/env node
import fs from 'node:fs';

const version = fs.readFileSync('VERSION', 'utf8').trim();
const versionNumber = Number(version.match(/^v(\d+)$/)?.[1] || 0);
const trackerText = fs.readFileSync('beta-readiness.json', 'utf8');
const tracker = JSON.parse(trackerText);
const extended = fs.readFileSync('check-beta-readonly-extended.mjs', 'utf8');
const failures = [];

const releaseCandidateVersion = tracker.deployment_identity?.release_candidate_version || '';
const liveVersion = tracker.deployment_identity?.live_version || '';
const trackedReleaseVersion = releaseCandidateVersion || liveVersion;
if (trackedReleaseVersion !== version) failures.push(`tracker release/live version ${trackedReleaseVersion || '(missing)'} must equal root VERSION ${version}`);
if (!String(tracker.site_version || '').includes(version)) failures.push(`tracker site_version must mention ${version}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tracker.last_updated || ''))) failures.push('tracker last_updated must be YYYY-MM-DD');

if (!releaseCandidateVersion) {
  if (liveVersion !== version) failures.push(`promoted deployment live_version must equal root VERSION ${version}`);
  if (tracker.site_version !== `live ${version} / current frontend release ${version}`) failures.push(`promoted site_version must explicitly identify live/current ${version}`);
  if (!/^[0-9a-f]{40}$/i.test(String(tracker.deployment_identity?.frontend_release_merge || ''))) failures.push('promoted deployment must record a full 40-character frontend release merge SHA');
  if (!/^[0-9a-f]{40}$/i.test(String(tracker.deployment_identity?.repository_head_at_audit || ''))) failures.push('promoted deployment must record a full 40-character repository audit SHA');
  const deploymentNote = String(tracker.deployment_identity?.note || '');
  if (!deploymentNote.includes(version)) failures.push(`promoted deployment note must mention current version ${version}`);
  if (!/\bPASS\b/i.test(deploymentNote)) failures.push('promoted deployment note must record explicit PASS evidence');
}

for (const stale of ['live v761 / main','DNS does not resolve','delivery was blocked','Backend user-targeted delivery still needs','fix public admin-host exposure separately']) if (trackerText.includes(stale)) failures.push(`stale readiness claim remains: ${stale}`);

// v778 closed the unnamed-control accessibility backlog. Future readiness rewrites must preserve that durable completion evidence.
if (versionNumber >= 778) {
  const staticIntegrity = (tracker.baseline_checks || []).find((item) => item.id === 'static_integrity');
  const evidence = String(staticIntegrity?.evidence || '');
  if (!evidence.includes('70/70')) failures.push('v778+ static_integrity evidence must preserve the 70/70 accessibility closure');
  if (!/58 static/i.test(evidence)) failures.push('v778+ static_integrity evidence must preserve the 58 static-control completion');
  if (!/12 runtime-generated/i.test(evidence)) failures.push('v778+ static_integrity evidence must preserve the 12 runtime-generated-control completion');
}

// v780 added rendered-browser proof. Preserve the proof facts durably without forcing every later release note to repeat historical wording.
if (versionNumber >= 780) {
  const staticIntegrity = (tracker.baseline_checks || []).find((item) => item.id === 'static_integrity');
  const staticEvidence = String(staticIntegrity?.evidence || '');
  if (!/Chromium\/axe/i.test(staticEvidence)) failures.push('v780+ static_integrity evidence must preserve Chromium/axe rendered-accessibility coverage');
  if (!/zero violations|zero axe violations/i.test(staticEvidence)) failures.push('v780+ static_integrity evidence must preserve the zero-violation rendered result');
  if (!releaseCandidateVersion) {
    const deploymentNote = String(tracker.deployment_identity?.note || '');
    const liveRoutes = (tracker.baseline_checks || []).find((item) => item.id === 'live_routes');
    const liveEvidence = String(liveRoutes?.evidence || '');
    const promotedEvidence = [deploymentNote, staticEvidence, liveEvidence].join('\n');
    if (!/Chromium\/axe/i.test(promotedEvidence)) failures.push('v780+ promoted readiness must preserve live Chromium/axe proof');
    if (!/zero (?:total )?axe violations/i.test(promotedEvidence)) failures.push('v780+ promoted readiness must preserve zero live axe violations');
  }
}

// v781 added live mobile/runtime proof. Preserve exact owner outcomes somewhere in the durable promoted evidence, not necessarily the newest note.
if (versionNumber >= 781) {
  const staticIntegrity = (tracker.baseline_checks || []).find((item) => item.id === 'static_integrity');
  const staticEvidence = String(staticIntegrity?.evidence || '');
  if (!/mobile-sized Drinks\/Beerpong|mobile\/runtime/i.test(staticEvidence)) failures.push('v781+ static_integrity evidence must preserve the mobile/runtime accessibility baseline');
  if (!/stats-queue/i.test(staticEvidence)) failures.push('v781+ static_integrity evidence must preserve the Drinks stats-queue repair');
  if (!/aria-hidden\/inert|inert off-canvas/i.test(staticEvidence)) failures.push('v781+ static_integrity evidence must preserve the verification-float inert lifecycle');
  if (!releaseCandidateVersion) {
    const deploymentNote = String(tracker.deployment_identity?.note || '');
    const liveRoutes = (tracker.baseline_checks || []).find((item) => item.id === 'live_routes');
    const liveEvidence = String(liveRoutes?.evidence || '');
    const promotedEvidence = [deploymentNote, staticEvidence, liveEvidence].join('\n');
    if (!/isolated no-write (?:live )?mobile Chromium/i.test(promotedEvidence)) failures.push('v781+ promoted readiness must preserve isolated no-write live mobile Chromium proof');
    if (!/non-GET (?:browser traffic|requests) (?:was )?intercepted locally/i.test(promotedEvidence)) failures.push('v781+ promoted readiness must preserve write-isolation proof');
    if (!/stats-queue ReferenceError/i.test(promotedEvidence)) failures.push('v781+ promoted readiness must preserve the live Drinks runtime-error outcome');
    if (!/>=44px|44px/i.test(promotedEvidence)) failures.push('v781+ promoted readiness must preserve the live Drinks touch-size proof');
    if (!/>=24px|24px/i.test(promotedEvidence)) failures.push('v781+ promoted readiness must preserve the live Beerpong target-size proof');
    if (!/isolated no-write (?:live )?mobile Chromium/i.test(liveEvidence)) failures.push('v781+ live_routes evidence must preserve the mobile Chromium proof');
    if (!/inert\/non-focusable/i.test(liveEvidence)) failures.push('v781+ live_routes evidence must preserve the hidden-float non-focusability result');
  }
}

const gaps = new Map((tracker.beta_gaps || []).map((item) => [item.id, item]));
for (const id of [
  'real_device_push_delivery','admin_host_security','scope_isolation','analytics_observability',
  'profile_editing','secondary_game_save_flows','badge_awards','admin_mutations','drinks_create_verify_reject',
  'toepen_backend_live','boerenbridge_admin_contracts','stats_elo_predictions'
]) if (gaps.get(id)?.status !== 'verified_complete') failures.push(`${id} must be verified_complete at finalized beta readiness`);

const blocked = [...gaps.values()].filter((item) => item.status === 'blocked_external');
const permission = [...gaps.values()].filter((item) => item.status === 'needs_permission');
if (blocked.length) failures.push(`tracker unexpectedly has blocked_external gaps: ${blocked.map((item) => item.id).join(', ')}`);
if (permission.length) failures.push(`tracker unexpectedly has permission-gated gaps: ${permission.map((item) => item.id).join(', ')}`);
const completeCount = [...gaps.values()].filter((item) => item.status === 'verified_complete').length;
if (completeCount !== 12 || permission.length !== 0) failures.push(`expected finalized readiness split 12 complete / 0 permission-gated, got ${completeCount} / ${permission.length}`);

if (!extended.includes("const adminBaseUrl = process.env.GEJAST_ADMIN_BASE_URL || 'https://admin.kalenel.nl';")) failures.push('extended beta checker must target the protected admin host');
if (!extended.includes('if (response.status !== 401)')) failures.push('extended beta checker must require unauthenticated admin HTTP 401');
if (!extended.includes("{ area: 'adminObservability', path: '/admin_system_health.html', protected: true }")) failures.push('extended beta checker must mark admin observability routes protected');

if (failures.length) {
  console.error('Beta readiness current-state regression failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Beta readiness current-state regression PASS. ${version}; complete=${completeCount}; permission-gated=0; blocked=0; deployment=${releaseCandidateVersion ? 'release-candidate' : 'live-promoted'}.`);
