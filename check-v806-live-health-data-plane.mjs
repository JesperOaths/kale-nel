#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';

const workflow = fs.readFileSync('.github/workflows/live-deployment-health.yml', 'utf8');
const probe = fs.readFileSync('check-live-data-plane.mjs', 'utf8');
const authGate = fs.readFileSync('gejast-auth-gate.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

assert.match(authGate, /\/rest\/v1\/rpc\/account_public_state_v687/, 'shipped auth gate must still ground the liveness RPC');
assert.match(authGate, /JSON\.stringify\(\{session_token:token,session_token_input:token,site_scope_input:requestedScope\(\)\}\)/, 'health probe must remain grounded in the shipped auth payload contract');
assert.match(authGate, /data&&data\.ok===true/, 'shipped auth gate must still treat ok=true as authenticated');

const dataPlaneStep = workflow.match(/- name: Verify Supabase auth data-plane liveness([\s\S]*?)(?=\n\s*- name:)/)?.[1] || '';
assert.ok(dataPlaneStep, 'main live-health workflow must expose an inspectable database-backed auth probe step');
assert.match(dataPlaneStep, /id:\s*data_plane/, 'data-plane probe must expose its true outcome for final fail-closed enforcement');
assert.match(dataPlaneStep, /continue-on-error:\s*true/, 'data-plane failure must not suppress independent live-health evidence');
assert.match(dataPlaneStep, /run: node check-live-data-plane\.mjs/, 'main live-health workflow must run the database-backed auth probe');
assert.match(workflow, /GEJAST_DATA_PLANE_TIMEOUT_MS:\s*'10000'/, 'workflow must keep each data-plane attempt bounded to 10 seconds');
assert.match(workflow, /GEJAST_DATA_PLANE_ATTEMPTS:\s*'2'/, 'ordinary deployment health must keep its two-attempt liveness policy');
assert.match(workflow, /GEJAST_DATA_PLANE_RETRY_DELAY_MS:\s*'750'/, 'workflow must use a small bounded retry delay');

const attemptedProbeCondition = "if: always() && (steps.data_plane.outcome == 'success' || steps.data_plane.outcome == 'failure')";
for (const stepName of [
  'Run primary read-only beta acceptance',
  'Run extended read-only beta acceptance',
  'Record live beta performance probe',
]) {
  const body = workflow.match(new RegExp(`- name: ${stepName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}([\\s\\S]*?)(?=\\n\\s*- name:)`))?.[1] || '';
  assert.ok(body, `${stepName} must remain present`);
  assert.ok(body.includes(attemptedProbeCondition), `${stepName} must continue after an attempted data-plane probe, including outage failure`);
}

const enforcementStep = workflow.match(/- name: Enforce Supabase auth data-plane health([\s\S]*)$/)?.[1] || '';
assert.ok(enforcementStep, 'live-health workflow must finish with explicit data-plane enforcement');
assert.match(enforcementStep, /if:\s*always\(\) && steps\.data_plane\.outcome == 'failure'/, 'final enforcement must activate only after a real probe failure');
assert.match(enforcementStep, /DATA_PLANE_HEALTH_ENFORCEMENT_FAIL/, 'final enforcement must emit an explicit failure marker');
assert.match(enforcementStep, /exit 1/, 'final enforcement must keep outage runs red');

assert.match(probe, /fs\.readFileSync\('gejast-config\.js', 'utf8'\)/, 'probe must source the deployed public project config from checked-in application config');
assert.match(probe, /SUPABASE_PUBLISHABLE_KEY/, 'probe must use the public publishable key');
assert.doesNotMatch(probe, /SERVICE_ROLE|service[_-]?role|SUPABASE_DB_URL|DATABASE_URL|\bpsql\b|execute_sql/i, 'probe must never require privileged database credentials or direct SQL');
assert.match(probe, /const rpcName = 'account_public_state_v687'/, 'probe must pin the shipped read-only auth-state RPC');
assert.doesNotMatch(probe, /rpcName\s*=\s*process\.env|GEJAST_DATA_PLANE_RPC/, 'probe RPC name must not be runtime-overridable');
assert.match(probe, /const invalidSession = '0{48}'/, 'probe must use a canonical-shaped deterministic invalid 48-hex session');
assert.match(probe, /session_token: invalidSession,[\s\S]*session_token_input: invalidSession,[\s\S]*site_scope_input: 'friends'/, 'probe payload must match the shipped auth contract and remain Friends-scoped');
assert.match(probe, /method: 'POST'/, 'RPC liveness must use the shipped POST contract');
assert.match(probe, /Authorization: `Bearer \$\{publishableKey\}`/, 'probe must authenticate only as the public publishable client');
assert.match(probe, /typeof data\.ok !== 'boolean'/, 'probe must validate the auth RPC response contract');
assert.match(probe, /if \(data\.ok === true\) throw new Error\('invalid_session_authenticated'\)/, 'health probe must fail closed if its invalid session is unexpectedly authenticated');
assert.match(probe, /timeoutMs > 15000/, 'per-attempt timeout must have a hard upper bound');
assert.match(probe, /attempts > 3/, 'shared probe retry count must have a hard upper bound of three');
assert.match(probe, /retryDelayMs > 2500/, 'shared probe retry delay must have a hard upper bound');
assert.match(probe, /DATA_PLANE_PASS rpc=\$\{rpcName\} invalid_session_rejected=true/, 'healthy data plane must emit a precise positive marker');
assert.match(probe, /DATA_PLANE_FAIL rpc=\$\{rpcName\}/, 'unhealthy data plane must emit a precise negative marker');

const mutatingSignals = [
  /create_/i, /join_/i, /save_/i, /insert/i, /update/i, /delete/i, /cleanup/i, /finish/i, /start_/i,
];
for (const signal of mutatingSignals) {
  assert.doesNotMatch(String(probe.match(/const rpcName = '([^']+)'/)?.[1] || ''), signal, `liveness RPC must not look mutating: ${signal}`);
}

assert.match(pkg.scripts?.['verify:static'] || '', /check-v806-live-health-data-plane\.mjs/, 'canonical repository verification must enforce the data-plane health contract statically');

console.log('PASS v806 live health has a caller-owned bounded read-only data-plane gate and preserves independent outage evidence');
