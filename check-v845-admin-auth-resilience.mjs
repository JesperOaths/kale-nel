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

for(const source of [admin,adminJs,claims,perfume]){
  assert.match(source,/functions\/v1\/admin-auth-v845/);
  assert.doesNotMatch(source,/rest\/v1\/rpc\/admin_login/);
}
assert.match(edge,/SUPABASE_SERVICE_ROLE_KEY/);
assert.match(edge,/sb\.rpc\("admin_login"/);
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
