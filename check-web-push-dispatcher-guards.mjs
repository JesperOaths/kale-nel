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

for (const workflowPath of ['web-push-dispatcher.yml', '.github/workflows/web-push-dispatcher.yml']) {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /target_subscription_id:/, `${workflowPath} must expose explicit target input`);
  assert.match(workflow, /WEB_PUSH_REQUIRE_EXPLICIT_TARGET:/, `${workflowPath} must pass explicit-target guard`);
  assert.match(workflow, /WEB_PUSH_DRY_RUN:/, `${workflowPath} must pass dry-run guard`);
}

console.log('Web push dispatcher guard regression ok.');
