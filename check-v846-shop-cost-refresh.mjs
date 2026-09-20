#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const edge=read('supabase/functions/shop-admin-analytics-v843/index.ts');
const page=read('admin_shop_analytics.html');

assert.match(edge,/PRINTIFY_FETCH_TIMEOUT_MS = 9000/);
assert.match(edge,/AbortController/);
assert.match(edge,/production_cost_refresh_timeout/);
assert.match(edge,/action === "refresh_costs" \|\| action === "refresh_costs_only"/);
assert.match(edge,/duration_ms/);
assert.match(edge,/history_rows_added/);
assert.match(edge,/if \(action === "dashboard"\)/);
assert.doesNotMatch(edge,/currentCostSnapshot\(sb, action === "refresh_costs"/);
assert.match(edge,/Promise\.all\(\[fxPromise, shopIdPromise, liveProductsPromise\]\)/);

assert.match(page,/async function refreshCosts\(\)/);
assert.match(page,/refresh_costs_only/);
assert.match(page,/timeout_ms:20000/);
assert.match(page,/Refreshing costs…/);
assert.match(page,/background analytics refresh failed/);
assert.match(page,/button\.dataset\.busy='1'/);
assert.match(page,/if\(data\)\{/, 'cost refresh must not fail when initial analytics data is absent');
assert.match(page,/The previous cost snapshot has been kept/);
assert.doesNotMatch(page,/load\('refresh_costs'\)/);

console.log('v846 fast bounded shop cost refresh checks passed');
