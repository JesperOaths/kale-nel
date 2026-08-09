#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dispatcher = require('./web_push_dispatcher.js');
const webpush = require('web-push');
const supabasePkg = require('@supabase/supabase-js');

assert.equal(typeof webpush.sendNotification, 'function', 'web-push must load on Node24');
assert.equal(typeof webpush.generateVAPIDKeys, 'function', 'web-push VAPID API must load on Node24');
assert.equal(typeof supabasePkg.createClient, 'function', 'Supabase client must load on Node24');

const vapid = webpush.generateVAPIDKeys();
assert(vapid.publicKey && vapid.privateKey, 'VAPID key generation must work on Node24');
webpush.setVapidDetails('mailto:node24-proof@example.invalid', vapid.publicKey, vapid.privateKey);

function baseOptions(overrides = {}) {
  return {
    url: 'https://example.invalid',
    key: 'service-role-placeholder',
    vapidPublic: vapid.publicKey,
    vapidPrivate: vapid.privateKey,
    vapidSubject: 'mailto:node24-proof@example.invalid',
    maxJobs: 1,
    workerId: 'node24-runtime-proof',
    dryRun: false,
    requireExplicitTarget: true,
    targetSubscriptionId: 123,
    ...overrides,
  };
}

const claimedItem = {
  job_id: 77,
  claim_token: 'claim-proof',
  target_subscription_id: 123,
  endpoint: 'https://push.example.invalid/subscription',
  p256dh_key: 'proof-p256dh',
  auth_key: 'proof-auth',
  title: 'Node24 proof',
  body: 'No real notification is sent.',
  target_url: './drinks_pending.html',
  request_kind: 'generic',
};

function createRpcMock({ dryRun = false, failure = false } = {}) {
  const calls = [];
  const supabase = {
    async rpc(name, args = {}) {
      calls.push({ name, args });
      if (name === 'requeue_stale_web_push_claims_v3') return { data: { ok: true }, error: null };
      if (name === 'claim_web_push_jobs_targeted_v763') {
        return { data: { items: [structuredClone(claimedItem)] }, error: null };
      }
      if (name === 'requeue_web_push_job_dry_run_v763') return { data: { ok: true }, error: null };
      if (name === 'mark_web_push_job_sent_v763') return { data: { ok: true }, error: null };
      if (name === 'mark_web_push_job_failed_v763') return { data: { ok: true }, error: null };
      return { data: null, error: new Error(`unexpected rpc ${name}`) };
    },
  };
  let sends = 0;
  const webpushMock = {
    async sendNotification() {
      sends += 1;
      if (failure) {
        const error = new Error('Gone');
        error.statusCode = 410;
        throw error;
      }
      return { headers: { location: 'provider-proof-id' } };
    },
  };
  return { supabase, webpushMock, calls, get sends() { return sends; }, dryRun };
}

{
  const mock = createRpcMock({ dryRun: true });
  const app = dispatcher.createDispatcher(baseOptions({ dryRun: true }), {
    supabase: mock.supabase,
    webpush: mock.webpushMock,
  });
  const result = await app.run();
  assert.equal(result.total, 1);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.dryRun, 1);
  assert.equal(mock.sends, 0, 'dry-run must never call sendNotification');
  assert(mock.calls.some((call) => call.name === 'claim_web_push_jobs_targeted_v763'), 'targeted claim RPC must be used');
  assert(mock.calls.some((call) => call.name === 'requeue_web_push_job_dry_run_v763'), 'dry-run must requeue claimed job');
  assert(!mock.calls.some((call) => call.name.startsWith('mark_web_push_job_sent')), 'dry-run must not mark sent');
}

{
  const mock = createRpcMock();
  const app = dispatcher.createDispatcher(baseOptions(), {
    supabase: mock.supabase,
    webpush: mock.webpushMock,
  });
  const result = await app.run();
  assert.equal(result.total, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(mock.sends, 1);
  const sent = mock.calls.find((call) => call.name === 'mark_web_push_job_sent_v763');
  assert(sent, 'successful send must use guarded v763 sent RPC');
  assert.equal(sent.args.worker_id_input, 'node24-runtime-proof');
  assert.equal(sent.args.claim_token_input, 'claim-proof');
}

{
  const mock = createRpcMock({ failure: true });
  const app = dispatcher.createDispatcher(baseOptions(), {
    supabase: mock.supabase,
    webpush: mock.webpushMock,
  });
  const result = await app.run();
  assert.equal(result.total, 1);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  assert.equal(mock.sends, 1);
  const failed = mock.calls.find((call) => call.name === 'mark_web_push_job_failed_v763');
  assert(failed, 'failed send must use guarded v763 failure RPC');
  assert.equal(failed.args.error_code_input, 'endpoint_gone');
  assert.equal(failed.args.disable_subscription_input, true);
}

const client = supabasePkg.createClient('https://example.invalid', 'public-placeholder', { auth: { persistSession: false } });
assert(client && typeof client.rpc === 'function', 'Supabase client construction must work on Node24');

console.log(`Web push dispatcher Node24 runtime proof PASS on ${process.version}. No production RPCs or notifications used.`);
