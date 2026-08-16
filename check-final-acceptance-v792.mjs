#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const artifact = JSON.parse(fs.readFileSync('final-acceptance-v792.json', 'utf8'));
const version = fs.readFileSync('VERSION', 'utf8').trim();
const gameplay = JSON.parse(fs.readFileSync('gameplay-acceptance.json', 'utf8'));

assert.equal(artifact.schema_version, 1, 'unsupported final acceptance schema');
assert.equal(version, 'v792', 'repository VERSION must remain v792');
assert.equal(artifact.site_version, version, 'final acceptance must certify the checked-in VERSION');
assert.equal(artifact.status, 'PASS', 'FINAL ACCEPTANCE must fail closed unless explicitly PASS');
assert.equal(artifact.issue, 131, 'final acceptance must remain tied to issue #131');
assert.match(artifact.evidence_baseline_main_sha, /^[0-9a-f]{40}$/, 'baseline main SHA must be exact');

assert.equal(artifact.truthfulness_policy?.unknown_limits_are_not_invented, true, 'unknown limits must not be invented');
assert.equal(artifact.truthfulness_policy?.third_party_interactive_auth_is_not_faked, true, 'third-party auth must not be faked');
assert.equal(artifact.truthfulness_policy?.no_duplicate_push_was_sent_for_final_certification, true, 'final certification must not duplicate user push');

for (let i = 1; i <= 12; i += 1) {
  const criterion = artifact.criteria?.[String(i)];
  assert(criterion, `criterion ${i} missing`);
  assert.equal(criterion.status, 'PASS', `criterion ${i} is not PASS`);
  assert(String(criterion.summary || '').trim().length >= 20, `criterion ${i} lacks meaningful evidence summary`);
}

for (const gameId of ['pikken', 'paardenrace']) {
  const certified = artifact.player_contracts?.[gameId];
  const tracked = gameplay.games.find((game) => game.id === gameId)?.player_contract;
  assert(certified, `${gameId} final contract missing`);
  assert.equal(certified.minimum, 2, `${gameId} minimum must remain grounded at 2`);
  assert.equal(certified.maximum, null, `${gameId} maximum must remain unknown rather than invented`);
  assert.equal(certified.maximum_status, 'not_enforced_or_proven', `${gameId} maximum status must be explicit`);
  assert.deepEqual(certified.representative_live_stress_counts, [2, 4, 8], `${gameId} representative stress matrix drifted`);
  assert.equal(tracked?.minimum, 2, `${gameId} gameplay acceptance minimum drifted`);
  assert.equal(tracked?.maximum, null, `${gameId} gameplay acceptance has invented a maximum`);
}

const browser = artifact.authoritative_runs?.live_browser;
assert.equal(browser?.run_id, 31924553809, 'authoritative live browser run changed without recertification');
assert.equal(browser?.attempt, 4, 'authoritative successful browser attempt changed without recertification');
for (const marker of [
  'RESULT=V792_LIVE_BROWSER_MULTI_CONTEXT_PASS',
  'RESULT=V792_PIKKEN_PLAY_TO_COMPLETION_PASS',
  'RESULT=V792_PAARDENRACE_PLAY_TO_COMPLETION_PASS',
  'RESULT=V792_LIVE_GAME_COMPLETION_CERTIFICATION_PASS',
  'RESULT=V792_FINAL_LIVE_BROWSER_CERTIFICATION_PASS',
]) assert(browser.markers?.includes(marker), `missing live browser evidence marker ${marker}`);

assert.equal(artifact.authoritative_runs?.account_journey?.run_id, 31922510300, 'account certification run missing');
assert.equal(artifact.authoritative_runs?.account_journey?.conclusion, 'success', 'account certification is not successful');

const admin = artifact.authoritative_runs?.admin_outer_auth_boundary;
assert.equal(admin?.run_id, 31929136927, 'live admin outer-boundary run missing');
assert.equal(admin?.marker, 'RESULT=V792_LIVE_ADMIN_OUTER_AUTH_BOUNDARY_PASS', 'live admin auth marker missing');
assert.equal(admin?.interactive_github_credential_step, 'external_third_party_not_automated', 'interactive GitHub auth must not be misrepresented as automated');

const push = artifact.push_evidence;
assert.equal(push?.provider_delivery_job_id, 120, 'exact provider delivery proof must remain job 120');
assert.equal(push?.provider_delivery_status, 'sent', 'provider delivery proof is not sent');
assert.equal(push?.provider_message_id_present, true, 'provider message id proof missing');
assert.equal(push?.attempt_count, 1, 'provider delivery attempt count changed');
assert.equal(push?.additional_push_sent_for_final_certification, false, 'final certification must not send a duplicate push');
assert.equal(push?.latest_hygiene_migration, 'gejast_v792u_web_push_dead_subscription_hygiene', 'push hygiene migration proof missing');
assert.equal(push?.open_jobs_after_reconciliation, 0, 'push queue must be reconciled empty at certification');
assert.equal(push?.proven_dead_subscriptions_still_claimable, 0, 'proven-dead endpoints must not remain claimable');

const prod = artifact.production_state;
assert.equal(prod?.latest_migration, 'gejast_v792u_web_push_dead_subscription_hygiene', 'final production migration drifted');
assert.equal(prod?.uncovered_public_foreign_keys, 0, 'public foreign-key coverage regressed');
assert.equal(prod?.standalone_duplicate_index_groups, 0, 'duplicate structural index groups regressed');
assert.equal(prod?.disposable_certification_residue, 0, 'disposable certification residue must be zero');
assert.equal(prod?.dev_activation_named_functions, 0, 'dev activation helper must remain removed');
assert.equal(prod?.invalid_admin_session_fails_closed, true, 'invalid admin sessions must fail closed');
assert.equal(prod?.admin_browser_mutators_unguarded, 0, 'browser-executable admin mutators must all be guarded');

const edge = artifact.edge_and_governance;
assert.equal(edge?.cloudflare_worker?.build, 'v763', 'live Worker build proof drifted');
assert.equal(edge?.cloudflare_worker?.live_https_redirect_proven, true, 'HTTPS redirect proof missing');
assert.equal(edge?.cloudflare_worker?.free_tier_only, true, 'Cloudflare certification must remain free-tier only');
assert.equal(edge?.rulesets?.main_pr_ci_gate_id, 20899009, 'main governance ruleset id drifted');
assert.equal(edge?.rulesets?.main_pr_required, true, 'main must require pull requests');
assert.deepEqual(edge?.rulesets?.required_checks, ['verify', 'audit'], 'required main checks drifted');
assert.equal(edge?.rulesets?.strict_status_checks, true, 'required checks must remain strict');
assert.equal(edge?.rulesets?.deletion_non_fast_forward_ruleset_id, 14810246, 'recovery/protection ruleset id drifted');
assert.equal(edge?.rulesets?.emergency_recovery_bypass_preserved, true, 'emergency recovery bypass proof missing');

const baseline = artifact.baseline_exact_main_checks;
assert.equal(baseline?.sha, artifact.evidence_baseline_main_sha, 'baseline exact-main SHA mismatch');
for (const name of ['verify', 'audit', 'live_health', 'pages_build', 'pages_deploy', 'pages_report']) {
  assert.equal(baseline?.[name], 'success', `baseline exact-main ${name} is not green`);
}

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.match(packageJson.scripts?.['verify:static'] || '', /check-final-acceptance-v792\.mjs/, 'canonical verify:static must enforce final acceptance');

console.log('FINAL ACCEPTANCE v792 artifact is internally consistent and fail-closed.');
console.log('RESULT=V792_FINAL_ACCEPTANCE_STATIC_PASS');
