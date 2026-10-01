#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const index=read('shop/index.html');
const store=read('shop/store.js');
const checkout=read('shop/manual-checkout-v825.js');
const direct=read('shop/direct-commerce-v832.js');
const admin=read('admin_shop_orders.html');
const ops=read('supabase/functions/_shared/shop-ops-checks-v847.mjs');
const catalog=read('supabase/functions/shop-catalog-v828/index.ts');
const cleanupMigration=read('supabase/migrations/20261001081000_shop_catalog_cleanup_v874.sql');
const retireMigration=read('supabase/migrations/20261001082000_retire_legacy_shop_catalog_scheduler_v874.sql');

assert.match(admin,/GEJAST_PAGE_VERSION='v874'/);
assert.match(admin,/v874 - Made by Bruis/);
assert.doesNotMatch(admin.replaceAll('bunqPrintifyConfirmed',''),/Printify/,'protected order UI must use generic production-partner wording');

assert.match(store,/shop-catalog-v828/,'storefront must call v828 directly');
assert.match(checkout,/shop-manual-checkout-v832/,'checkout must call v832 directly');
assert.match(direct,/catalogAuthority:'shop-catalog-v828'/);
assert.match(direct,/checkoutAuthority:'shop-manual-checkout-v832'/);
assert.match(direct,/legacyFetchBridge:false/);
assert.doesNotMatch(direct,/window\.fetch\s*=/,'legacy fetch interception must stay retired');
assert.doesNotMatch(index,/shop-runtime-v818|shop-runtime-v819|catalog-recovery-v822|shopify-checkout-v817|direct-commerce-v828|payment-readiness-v824/);

for(const path of [
  'shop/shop-runtime-v818.js',
  'shop/shop-runtime-v819.js',
  'shop/catalog-recovery-v822.js',
  'shop/shopify-checkout-v817.js',
  'shop/direct-commerce-v828.js',
  'shop/payment-readiness-v824.js'
]){
  assert.equal(fs.existsSync(path),false,`${path} must remain retired`);
}

assert.match(ops,/\.update\(\{resolved_at:reconciliationAt\}\)/,'catalog checks must resolve superseded drift transitions');
assert.match(catalog,/updateLegacyCatalogProjectionDirect/);
assert.match(catalog,/last_source = 'printify'/);
assert.match(cleanupMigration,/resolved_at = now\(\)/);
assert.match(cleanupMigration,/last_source = 'printify'/);
assert.match(retireMigration,/guard_legacy_shop_catalog_sync_v874/);
assert.match(retireMigration,/new\.next_refresh_at := null/);
assert.match(retireMigration,/shopify-admin','shopify-storefront/);

for(const name of ['shop-catalog','shop-catalog-v822','shop-catalog-v827','shop-price-v818','shop-manual-checkout-v825','shop-manual-checkout-v828']){
  const body=read(`supabase/functions/${name}/index.ts`);
  assert.match(body,/endpoint_retired/,`${name} must remain a retirement stub`);
  assert.match(body,/shop-cleanup-v874/,`${name} retirement provenance missing`);
}

console.log('Shop/admin cleanup v874 regression PASS.');
console.log('RESULT=SHOP_ADMIN_CLEANUP_V874_PASS');
