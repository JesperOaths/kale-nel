import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync('admin_push_targeted_test.html', 'utf8');
const staticHtml = existsSync('cloudflare/workers/admin-gate/static/admin_push_targeted_test.html')
  ? readFileSync('cloudflare/workers/admin-gate/static/admin_push_targeted_test.html', 'utf8')
  : '';
const sql = readFileSync('GEJAST_v755k_targeted_push_readiness_gate.sql', 'utf8');

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

includes('admin-session-sync.js?v790', 'targeted page must use admin-session-sync.js');
includes('window.GEJAST_ADMIN_SESSION.requirePage', 'targeted page must require protected inner admin page session');
includes('window.GEJAST_ADMIN_SESSION.validate', 'targeted page must validate existing inner admin token');
includes("const TARGET_SUBSCRIPTION_ID = 357;", 'targeted page must hard-code subscription 357');
includes("const TARGET_SCOPE = 'friends';", 'targeted page must hard-code friends scope');
includes("const TARGET_URL = './drinks_pending.html?push_test=targeted';", 'targeted page must hard-code the normal Drinks verification target URL');
notIncludes('push_beta_test.html', 'targeted page must not link notifications to the removed public beta-test console');
includes("const RPC_NAME = 'admin_queue_targeted_web_push_test_v763';", 'targeted page must call only the admin queue RPC');
includes('Refresh readiness if possible', 'targeted page must expose a bounded local readiness refresh button');
includes('Validate only', 'targeted page must expose a validate-only button');
includes('Queue exactly one job - does not send', 'targeted page must expose clearly labelled queue-only button');
includes('confirmInput.value.trim() !== String(TARGET_SUBSCRIPTION_ID)', 'targeted page must require typed 357 confirmation before queueing');
includes('dry_run: !!dryRun', 'targeted page must pass dry_run explicitly');
includes('await callQueueRpc(true)', 'validation must call dry_run=true');
includes('await callQueueRpc(false)', 'queue action must call dry_run=false');
includes('queuedThisLoad = true', 'successful queue must disable further queueing for the page load');
includes('admin_session_token: token', 'RPC payload must use the inner admin token');
includes('requestLocation:false', 'targeted page local refresh must not repeatedly request geolocation');
includes('rt.getSubscription()', 'targeted page local refresh must reuse an existing subscription only');
includes('rt.touchPresence({ subscription', 'targeted page local refresh must only touch presence after an existing subscription is found');
includes('eligible:', 'targeted page must render sanitized eligibility');
includes('blocker:', 'targeted page must render sanitized blockers');
includes('presence_state:', 'targeted page must render sanitized presence state');
includes('presence_age_seconds:', 'targeted page must render sanitized presence age');
includes('duplicate_open_count:', 'targeted page must render sanitized duplicate count');

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
notIncludes('VAPID', 'targeted page must not reference VAPID material directly');
notIncludes('WEB_PUSH_', 'targeted page must not reference dispatcher/VAPID env names');

match(/const\s+safe\s*=\s*\{[\s\S]*?ok:[\s\S]*?eligible:[\s\S]*?blocker:[\s\S]*?queued_count:[\s\S]*?job_id:[\s\S]*?target_subscription_id:[\s\S]*?site_scope:[\s\S]*?status:[\s\S]*?trigger_kind:[\s\S]*?subscription_state:[\s\S]*?presence_state:[\s\S]*?presence_age_seconds:[\s\S]*?duplicate_open_count:[\s\S]*?\};/, 'sanitized output must be limited to approved fields');
assert(!/resultBox\.textContent\s*=\s*JSON\.stringify\(data/.test(html), 'targeted page must not render raw RPC data');

if (staticHtml) {
  assert(staticHtml.includes("const TARGET_SUBSCRIPTION_ID = 357;"), 'admin Worker static asset bundle must include targeted page');
}

assert(/dry_run\s+boolean\s+default\s+true/.test(sql), 'queue RPC default dry_run=true must remain explicit in SQL');
assert(/TARGET_SUBSCRIPTION_NOT_ALLOWED/.test(sql), 'queue RPC must reject non-357 targets');
assert(/TARGET_PRESENCE_NOT_CURRENT/.test(sql), 'queue RPC must expose sanitized stale-presence blocker');
assert(/presence_age_seconds/.test(sql), 'queue RPC must expose sanitized bounded presence age');
assert(/if\s+dry_run\s+then[\s\S]*?'queued_count',\s+0/.test(sql), 'queue RPC dry_run=true must create zero rows');
assert(/'dry_run',\s+false[\s\S]*?'queued_count',\s+1[\s\S]*?'job_id',\s+v_job_id[\s\S]*?'target_subscription_id',\s+v_sub\.id[\s\S]*?'trigger_kind',\s+'admin_targeted_test'[\s\S]*?'status',\s+'queued'/.test(sql), 'queue RPC dry_run=false must return durable queued admin_targeted_test row metadata');
assert(/ADMIN_TARGETED_TEST_ALREADY_OPEN/.test(sql), 'queue RPC must reject duplicate open targeted jobs');
assert(/admin_session_invalid/.test(sql), 'queue RPC must reject invalid inner admin session');

console.log('admin targeted push queue page regression ok');
