#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const admin=read('admin.html');
const adminJs=read('admin.js');
const claims=read('admin_claims.html');
const perfume=read('admin-parfum.html');
const edge=read('supabase/functions/admin-auth-v845/index.ts');
const sql=read('supabase/migrations/20260920165000_admin_login_resilience_v845.sql');
const deploy=read('.github/workflows/deploy-shop-fixes-v829.yml');
const live=read('check-live-shop.mjs');
const adminWorker=read('cloudflare/workers/admin-gate/src/worker.js');

assert.match(admin,/\.\/api\/admin-auth-v845/, 'main admin login must use the same-origin Worker proxy');
assert.doesNotMatch(admin,/SUPABASE_URL}\/functions\/v1\/admin-auth-v845/, 'main admin login must not reintroduce the cross-origin auth preflight');
for(const source of [adminJs,claims,perfume]){
  assert.match(source,/functions\/v1\/admin-auth-v845/);
  assert.doesNotMatch(source,/rest\/v1\/rpc\/admin_login/);
}
assert.match(adminWorker,/SUPABASE_URL}\/functions\/v1\/admin-auth-v845/, 'the protected Worker proxy must forward auth to the Supabase edge function');
assert.match(edge,/SUPABASE_SERVICE_ROLE_KEY/);
assert.match(edge,/sb\.rpc\("admin_login"/);
assert.match(edge,/loginRpcWithTransientRetry/);
assert.match(edge,/attempt<=2/);
assert.match(edge,/authentication_service_unavailable",retryable:true/);
assert.match(admin,/beheerdatabase is tijdelijk overbelast/);
assert.match(admin,/loginButton\.disabled=true/);
assert.match(edge,/mode:"admin-auth-v845"/);
assert.match(edge,/too_many_attempts/);
assert.match(edge,/invalid_credentials/);
assert.doesNotMatch(edge,/console\.log\([^\n]*(password|totp|username)/i);

assert.match(sql,/return json_build_object\('ok', false, 'error', 'invalid_credentials'\)/);
assert.match(sql,/too_many_attempts/);
assert.match(sql,/insert into public\.admin_login_attempts\(username, success\)/);
assert.doesNotMatch(sql,/raise exception 'Ongeldige inloggegevens'/);

assert.match(deploy,/supabase\/functions\/admin-auth-v845\/\*\*/);
assert.match(deploy,/deploy_function admin-auth-v845/);
assert.match(live,/ADMIN_AUTH_URL/);
assert.match(live,/admin-auth-v845/);

console.log('v845 resilient admin login checks passed');
