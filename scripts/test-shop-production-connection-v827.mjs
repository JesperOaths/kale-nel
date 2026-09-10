#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('admin_shop_connection.html', 'utf8');
const nav = fs.readFileSync('admin-topnav.js', 'utf8');
const edge = fs.readFileSync('supabase/functions/shop-production-connection-v827/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260910140500_shop_production_connection_v827.sql', 'utf8');

assert.match(page, /GEJAST_PAGE_VERSION='v827'/);
assert.match(page, /shop-production-connection-v827/);
assert.match(page, /autocomplete="new-password"/);
assert.match(page, /stored encrypted in Supabase Vault/i);
assert.doesNotMatch(page, /Printify|Shopify/i, 'protected connection UI must remain supplier-neutral');
assert.doesNotMatch(page, /localStorage|sessionStorage/);
assert.match(nav, /admin_shop_connection\.html/);

assert.match(edge, /_require_valid_admin_session/);
assert.match(edge, /get_printify_api_token_v815a/);
assert.match(edge, /set_printify_api_token_v827/);
assert.match(edge, /action === "save"/);
assert.match(edge, /checkToken\(apiToken\)/);
assert.match(edge, /Cache-Control": "no-store"/);
assert.doesNotMatch(edge, /return json\([^;\n]*api_token/i, 'endpoint must never return the credential');

assert.match(migration, /security definer/i);
assert.match(migration, /_require_valid_admin_session/);
assert.match(migration, /vault\.create_secret/);
assert.match(migration, /vault\.update_secret/);
assert.match(migration, /revoke all on function public\.set_printify_api_token_v827\(text, text\) from public, anon, authenticated/i);
assert.match(migration, /grant execute on function public\.set_printify_api_token_v827\(text, text\) to service_role/i);

console.log('Shop production connection v827 contract passed.');
