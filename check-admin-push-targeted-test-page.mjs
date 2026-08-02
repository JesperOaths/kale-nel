import { readFileSync } from 'node:fs';

const html = readFileSync('admin_push_targeted_test.html', 'utf8');
const sql = readFileSync('GEJAST_v755j_targeted_push_security_hardening.sql', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function includes(value, message) {
  assert(html.includes(value), message);
}
function notIncludes(value, message) {
  assert(!html.includes(value), message);
}
function match(pattern, message) {
  assert(pattern.test(html), message);
}

includes('admin-session-sync.js?v761', 'targeted page must use admin-session-sync.js');
includes('window.GEJAST_ADMIN_SESSION.requirePage', 'targeted page must require protected inner admin page session');
includes('window.GEJAST_ADMIN_SESSION.validate', 'targeted page must validate existing inner admin token');
includes("const TARGET_SUBSCRIPTION_ID = 357;", 'targeted page must hard-code subscription 357');
includes("const TARGET_SCOPE = 'friends';", 'targeted page must hard-code friends scope');
includes("const TARGET_URL = './push_beta_test.html?push_test=targeted';", 'targeted page must hard-code requested target URL');
includes("const RPC_NAME = 'admin_queue_targeted_web_push_test_v763';", 'targeted page must call only the admin queue RPC');
includes('Validate only', 'targeted page must expose a validate-only button');
includes('Queue exactly one job — does not send', 'targeted page must expose clearly labelled queue-only button');
includes('confirmInput.value.trim() !== String(TARGET_SUBSCRIPTION_ID)', 'targeted page must require typed 357 confirmation before queueing');
includes('dry_run: !!dryRun', 'targeted page must pass dry_run explicitly');
includes('await callQueueRpc(true)', 'validation must call dry_run=true');
includes('await callQueueRpc(false)', 'queue action must call dry_run=false');
includes('queuedThisLoad = true', 'successful queue must disable further queueing for the page load');
includes('admin_session_token: token', 'RPC payload must use the inner admin token');

notIncludes('console.log', 'targeted page must not log token/RPC data');
notIncludes('console.error', 'targeted page must not log token/RPC diagnostics');
notIncludes('claim_web_push_jobs', 'targeted page must not call dispatcher claim RPCs');
notIncludes('mark_web_push_job', 'targeted page must not call dispatcher mark RPCs');
notIncludes('requeue_web_push_job', 'targeted page must not call dispatcher requeue RPCs');
notIncludes('workflow_dispatch', 'targeted page must not start GitHub workflow dispatch');
notIncludes('github.com', 'targeted page must not call GitHub');
notIncludes('/actions/', 'targeted page must not link or call GitHub Actions');
notIncludes('endpoint', 'targeted page must not reference endpoint material');
notIncludes('p256dh', 'targeted page must not reference p256dh material');
notIncludes('auth_key', 'targeted page must not reference auth key material');
notIncludes('VAPID', 'targeted page must not reference VAPID material');
notIncludes('WEB_PUSH', 'targeted page must not reference dispatcher/VAPID env names');

match(/const\s+safe\s*=\s*\{[\s\S]*?ok:[\s\S]*?queued_count:[\s\S]*?job_id:[\s\S]*?target_subscription_id:[\s\S]*?site_scope:[\s\S]*?\};/, 'sanitized output must be limited to approved fields');
assert(!/resultBox\.textContent\s*=\s*JSON\.stringify\(data/.test(html), 'targeted page must not render raw RPC data');

assert(/dry_run\s+boolean\s+default\s+true/.test(sql), 'queue RPC default dry_run=true must remain explicit in SQL');
assert(/if\s+dry_run\s+then[\s\S]*?'queued_count',\s+0/.test(sql), 'queue RPC dry_run=true must create zero rows');
assert(/'dry_run',\s+false[\s\S]*?'queued_count',\s+1[\s\S]*?'job_id',\s+v_job_id[\s\S]*?'target_subscription_id',\s+v_sub\.id[\s\S]*?'trigger_kind',\s+'admin_targeted_test'[\s\S]*?'status',\s+'queued'/.test(sql), 'queue RPC dry_run=false must return durable queued admin_targeted_test row metadata');
assert(/ADMIN_TARGETED_TEST_ALREADY_OPEN/.test(sql), 'queue RPC must reject duplicate open targeted jobs');
assert(/admin_session_invalid/.test(sql), 'queue RPC must reject invalid inner admin session');
assert(/j\.trigger_kind\s+=\s+'admin_targeted_test'/.test(sql), 'targeted claim must only claim admin_targeted_test rows');
assert(/coalesce\(j\.trigger_kind, ''\)\s+<>\s+'admin_targeted_test'/.test(sql), 'normal scheduled claim must exclude admin_targeted_test rows');

console.log('admin targeted push queue page regression ok');
