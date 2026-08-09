#!/usr/bin/env node
import fs from 'node:fs';

const version = fs.readFileSync('VERSION', 'utf8').trim();
const trackerText = fs.readFileSync('beta-readiness.json', 'utf8');
const tracker = JSON.parse(trackerText);
const extended = fs.readFileSync('check-beta-readonly-extended.mjs', 'utf8');
const failures = [];

const trackedReleaseVersion = tracker.deployment_identity?.release_candidate_version || tracker.deployment_identity?.live_version;
if (trackedReleaseVersion !== version) failures.push(`tracker release/live version ${trackedReleaseVersion || '(missing)'} must equal root VERSION ${version}`);
if (!String(tracker.site_version || '').includes(version)) failures.push(`tracker site_version must mention ${version}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tracker.last_updated || ''))) failures.push('tracker last_updated must be YYYY-MM-DD');
for (const stale of ['live v761 / main','DNS does not resolve','delivery was blocked','Backend user-targeted delivery still needs','fix public admin-host exposure separately']) if (trackerText.includes(stale)) failures.push(`stale readiness claim remains: ${stale}`);

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
console.log(`Beta readiness current-state regression PASS. ${version}; complete=${completeCount}; permission-gated=0; blocked=0.`);
