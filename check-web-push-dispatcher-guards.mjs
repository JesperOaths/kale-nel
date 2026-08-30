#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const dispatcher = require('./web_push_dispatcher.js');

assert.throws(
  () => dispatcher.buildOptions({
    SUPABASE_URL: 'https://example.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'x',
    WEB_PUSH_VAPID_PUBLIC_KEY: 'x',
    WEB_PUSH_VAPID_PRIVATE_KEY: 'x',
    WEB_PUSH_REQUIRE_EXPLICIT_TARGET: 'true',
  }),
  /WEB_PUSH_TARGET_SUBSCRIPTION_ID is missing/,
  'explicit-target mode must refuse missing target subscription id',
);

const opts = dispatcher.buildOptions({
  SUPABASE_URL: 'https://example.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'x',
  WEB_PUSH_VAPID_PUBLIC_KEY: 'x',
  WEB_PUSH_VAPID_PRIVATE_KEY: 'x',
  WEB_PUSH_DRY_RUN: 'true',
  WEB_PUSH_REQUIRE_EXPLICIT_TARGET: 'true',
  WEB_PUSH_TARGET_SUBSCRIPTION_ID: '123',
  WEB_PUSH_MAX_JOBS: '1',
});
assert.equal(opts.dryRun, true, 'dry-run flag should parse');
assert.equal(opts.requireExplicitTarget, true, 'explicit target flag should parse');
assert.equal(opts.targetSubscriptionId, 123, 'target subscription id should parse');

const redacted = dispatcher.sanitizeLogText('endpoint=https://push.example/send/abc auth=shouldredact p256dh=shouldredact https://push.example/other');
assert(!redacted.includes('https://push.example'), 'log sanitizer must redact URLs');
assert(!redacted.includes('shouldredact'), 'log sanitizer must redact endpoint auth material');

const sql = fs.readFileSync('GEJAST_v755i_targeted_push_test_guard.sql', 'utf8');
assert.match(sql, /admin_check_session\(admin_session_token\)/, 'targeted queue RPC must require admin session');
assert.match(sql, /v_admin_state->>'ok'/, 'targeted queue RPC must require admin session ok=true');
assert.match(sql, /admin_session_invalid/, 'targeted queue RPC must reject invalid admin sessions that return ok=false');
assert.match(sql, /target_subscription_id_input bigint/, 'targeted queue RPC must require explicit target subscription id');
assert.match(sql, /dry_run boolean default true/, 'targeted queue RPC must default to dry run');
assert.match(sql, /where id = target_subscription_id_input/i, 'targeted queue RPC must inspect only explicit subscription');
assert.match(sql, /TARGET_PRESENCE_NOT_CURRENT/, 'targeted queue RPC must require fresh target presence');
assert.match(sql, /web_push_active_presence/, 'targeted queue RPC must verify current granted presence');

const hygieneSql = fs.readFileSync('GEJAST_v792u_web_push_dead_subscription_hygiene.sql', 'utf8');
assert.match(hygieneSql, /'claim_token', c\.claim_token/, 'scheduled claim must return its authoritative claim token');
assert.match(hygieneSql, /'claimed_by', c\.claimed_by/, 'scheduled claim must return its authoritative worker id');
assert.match(hygieneSql, /'target_subscription_id', c\.target_subscription_id/, 'scheduled claim must return target subscription id');
assert.match(hygieneSql, /disable_subscription_input[\s\S]*?is_active = CASE[\s\S]*?false/, 'current failure marker must make durable dead endpoints inactive');
assert.match(hygieneSql, /last_success_at = now\(\)[\s\S]*?failure_count = 0/, 'current success marker must refresh subscription health');
assert.match(hygieneSql, /lower\(coalesce\(j\.error_code, ''\)\) = 'endpoint_gone'/, 'reconciliation must be grounded in durable endpoint_gone evidence');
assert.match(hygieneSql, /NOT EXISTS[\s\S]*?lower\(coalesce\(s\.status, ''\)\) = 'sent'/, 'reconciliation must preserve endpoints with a later successful delivery');
assert.doesNotMatch(hygieneSql, /\b(144|357|389|487|498)\b/, 'reconciliation must not hard-code historical subscription ids');

for (const workflowPath of ['web-push-dispatcher.yml', '.github/workflows/web-push-dispatcher.yml']) {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /target_subscription_id:/, `${workflowPath} must expose explicit target input`);
  assert.match(workflow, /WEB_PUSH_REQUIRE_EXPLICIT_TARGET:/, `${workflowPath} must pass explicit-target guard`);
  assert.match(workflow, /WEB_PUSH_DRY_RUN:/, `${workflowPath} must pass dry-run guard`);
}

function runtimeOptions() {
  return {
    url: 'https://example.invalid',
    key: 'service-role-test',
    vapidPublic: 'public-test',
    vapidPrivate: 'private-test',
    vapidSubject: 'mailto:test@example.invalid',
    maxJobs: 1,
    workerId: 'github-actions-dispatcher',
    dryRun: false,
    requireExplicitTarget: false,
    targetSubscriptionId: null,
  };
}

function claimedItem() {
  return {
    job_id: 7001,
    claim_token: '00000000-0000-0000-0000-000000000001',
    claimed_by: 'dispatcher',
    target_subscription_id: 55,
    title: 'Test',
    body: 'Test body',
    target_url: './drinks_pending.html',
    endpoint: 'https://push.example.invalid/subscription',
    p256dh_key: 'p256dh-test',
    auth_key: 'auth-test',
    trigger_kind: 'generic',
  };
}

async function exerciseClaimAwareMarking({ fail = false } = {}) {
  const calls = [];
  const supabase = {
    async rpc(name, args = {}) {
      calls.push({ name, args });
      if (name === 'requeue_stale_web_push_claims_v3') return { data: { ok: true }, error: null };
      if (name === 'claim_web_push_jobs_v3') return { data: { items: [claimedItem()] }, error: null };
      if (name === 'mark_web_push_job_sent_v763' || name === 'mark_web_push_job_failed_v763') return { data: { ok: true }, error: null };
      return { data: null, error: null };
    },
  };
  const webpush = {
    async sendNotification() {
      if (fail) {
        const err = new Error('Gone');
        err.statusCode = 410;
        throw err;
      }
      return { headers: { location: 'https://provider.example.invalid/message/1' } };
    },
  };
  const instance = dispatcher.createDispatcher(runtimeOptions(), { supabase, webpush });
  await instance.run();
  return calls;
}

const successCalls = await exerciseClaimAwareMarking();
const prepareCall = successCalls.find((call) => call.name === 'prepare_web_push_display_ack_v814');
const providerCall = successCalls.find((call) => call.name === 'record_web_push_provider_sent_v814');
assert(prepareCall, 'scheduled claimed item must prepare a claim-bound display ACK capability');
assert.equal(prepareCall.args.worker_id_input, 'dispatcher', 'display ACK preparation must use the worker that actually owns the claim');
assert.equal(prepareCall.args.claim_token_input, claimedItem().claim_token, 'display ACK preparation must use the authoritative claim token');
assert(providerCall, 'provider acceptance must use the v814 claim-aware provider marker');
assert.equal(providerCall.args.worker_id_input, 'dispatcher', 'provider marker must use the worker that actually owns the claim');
assert.equal(providerCall.args.claim_token_input, claimedItem().claim_token, 'provider marker must use the authoritative claim token');
assert.equal(providerCall.args.provider_message_id_input, 'https://provider.example.invalid/message/1', 'provider marker must preserve provider message id');
assert(successCalls.indexOf(prepareCall) < successCalls.indexOf(providerCall), 'display ACK preparation must precede provider acceptance recording');
assert(!successCalls.some((call) => call.name === 'mark_web_push_job_sent_v763' || call.name === 'mark_web_push_job_sent_v3'), 'v814 provider acceptance must not finalize the job as sent before browser display ACK');

const failureCalls = await exerciseClaimAwareMarking({ fail: true });
const failedCall = failureCalls.find((call) => call.name === 'mark_web_push_job_failed_v763');
assert(failedCall, 'scheduled claimed item must use claim-aware failure marker');
assert.equal(failedCall.args.worker_id_input, 'dispatcher', 'failure marker must use the worker that actually owns the claim');
assert.equal(failedCall.args.error_code_input, 'endpoint_gone', 'HTTP 410 must remain classified as endpoint_gone');
assert.equal(failedCall.args.disable_subscription_input, true, 'HTTP 410 must disable the dead subscription');
assert(!failureCalls.some((call) => call.name === 'mark_web_push_job_failed_v3'), 'claim-aware scheduled failure must not fall back to legacy marker');

console.log('Web push dispatcher guard regression ok.');
