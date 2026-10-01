#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const sync=read('admin-session-sync.js');
const admin=read('admin.html');
const worker=read('cloudflare/workers/admin-gate/src/worker.js');
const migration=read('supabase/migrations/20260920161000_admin_trusted_device_ux_v844.sql');
const analytics=read('admin_shop_analytics.html');
const orders=read('admin_shop_orders.html');

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
assert.match(sync,/function resolveTrustedUntil\(/, 'session sync must preserve a stable trusted-device deadline');
assert.match(sync,/if \(changed\) emitUpdate\(\)/, 'session update event must fire only when the stored bundle actually changes');
assert.match(sync,/if \(hadBundle\) emitUpdate\(\)/, 'clearing an already-empty bundle must not emit a refresh event');
assert.match(orders,/admin-session-sync\.js/, 'shop orders must load the loop-safe session sync');
assert.match(orders,/let loadPromise=null/, 'shop orders must deduplicate concurrent list reloads');
assert.match(orders,/let actionInFlight=false/, 'shop orders must suppress session-triggered reloads while an admin action is running');
assert.match(orders,/Payment for \$\{row\.payment_reference\} verified/, 'payment verification must show explicit success feedback');
assert.match(orders,/Retry production charge|I approved in bunq — complete production/, 'existing Printify orders must remain retryable through the bunq approval pipeline');
assert.match(orders,/no duplicate is created|no duplicate order is created/, 'production retry must explicitly preserve idempotency');
assert.doesNotMatch(orders,/addEventListener\('gejast:admin-session-updated'/, 'orders page must not reload itself from session-update events');

assert.match(admin,/rememberDeviceInput/);
assert.match(admin,/45 dagen onthouden/);
assert.match(admin,/issueTrustedDevice/);
assert.match(admin,/Geverifieerd apparaat herkend/);
assert.match(admin,/Hub-tellers laden later opnieuw|Beheerhub is beschikbaar; tellers laden later opnieuw/);
assert.match(admin,/60000/);

assert.match(worker,/SESSION_TTL_SECONDS = 30 \* 24 \* 60 \* 60/);
assert.match(worker,/ADMIN_BUILD = 'v861-page-version-watermark'/);

assert.match(analytics,/analytics-commandbar/);
assert.match(analytics,/cost-refresh/);
assert.match(analytics,/Refresh current costs/);
assert.match(analytics,/Jump to analytics section/);
assert.match(analytics,/id="products"/);
assert.match(analytics,/id="marketing"/);
assert.match(analytics,/id="security"/);

console.log('v844 admin trusted-session and analytics readability checks passed');
