#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const sync=read('admin-session-sync.js');
const admin=read('admin.html');
const worker=read('cloudflare/workers/admin-gate/src/worker.js');
const migration=read('supabase/migrations/20260920161000_admin_trusted_device_ux_v844.sql');
const analytics=read('admin_shop_analytics.html');

assert.match(migration,/interval '12 hours'/);
assert.match(migration,/interval '45 days'/);
assert.match(migration,/admin_issue_trusted_device_v844/);
assert.match(migration,/admin_resume_trusted_device_v844/);
assert.match(migration,/delete from public\.admin_sessions where expires_at <= now\(\)/i);
assert.doesNotMatch(migration,/where admin_id = acct\.id or expires_at <= now\(\)/i);
assert.match(migration,/lower\(username\), attempted_at desc/i);

assert.match(sync,/admin_issue_trusted_device_v844/);
assert.match(sync,/admin_resume_trusted_device_v844/);
assert.match(sync,/randomDeviceToken/);
assert.match(sync,/resumed_from_trusted_device/);
assert.match(sync,/data\?\.ok !== true/);
assert.match(sync,/45 \* 24 \* 60 \* 60 \* 1000/);
assert.doesNotMatch(sync,/navigator\.userAgent \|\| ''[\s\S]{0,160}resolvedOptions\(\)\.timeZone/, 'stable device fingerprint must not bind to a browser version string');

assert.match(admin,/rememberDeviceInput/);
assert.match(admin,/45 dagen onthouden/);
assert.match(admin,/issueTrustedDevice/);
assert.match(admin,/Geverifieerd apparaat herkend/);
assert.match(admin,/Hub-tellers konden tijdelijk niet laden/);
assert.match(admin,/60000/);

assert.match(worker,/SESSION_TTL_SECONDS = 30 \* 24 \* 60 \* 60/);
assert.match(worker,/ADMIN_BUILD = 'v844-trusted-admin-session'/);

assert.match(analytics,/analytics-commandbar/);
assert.match(analytics,/cost-refresh/);
assert.match(analytics,/Refresh current costs/);
assert.match(analytics,/Jump to analytics section/);
assert.match(analytics,/id="products"/);
assert.match(analytics,/id="marketing"/);
assert.match(analytics,/id="security"/);

console.log('v844 admin trusted-session and analytics readability checks passed');
