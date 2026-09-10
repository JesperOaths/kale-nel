#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const index=read('shop/index.html');
const directAdapter=read('shop/direct-catalog-v827.js');
const manualCheckout=read('shop/manual-checkout-v827.js');
const mockupBackground=read('shop/mockup-background-v827.js');
const shopUi=read('shop/shop-ui-v827.js');
const store=read('shop/store.js');
const lightbox=read('shop/image-lightbox-v820.js');
const refresh=read('shop/live-catalog-refresh-v818.js');
const adminPage=read('admin_shop_orders.html');
const connectionPage=read('admin_shop_connection.html');
const adminNav=read('admin-topnav.js');
const catalogEdge=read('supabase/functions/shop-catalog-v827/index.ts');
const checkoutEdge=read('supabase/functions/shop-manual-checkout-v827/index.ts');
const connectionEdge=read('supabase/functions/shop-production-connection-v827/index.ts');
const statusEdge=read('supabase/functions/shop-order-status-v825/index.ts');
const adminEdge=read('supabase/functions/shop-admin-orders-v825/index.ts');
const webhookEdge=read('supabase/functions/shop-printify-webhook-v825/index.ts');
const migration=read('supabase/migrations/20260910070731_shop_manual_payment_v825.sql');
const idempotencyMigration=read('supabase/migrations/20260910070905_shop_checkout_idempotency_v825.sql');
const paymentAmountMigration=read('supabase/migrations/20260910103800_shop_admin_payment_amount_v826.sql');
const connectionMigration=read('supabase/migrations/20260910140500_shop_production_connection_v827.sql');
const liveShopCheck=read('check-live-shop.mjs');
const liveHealthWorkflow=read('.github/workflows/live-deployment-health.yml');

// v827 active storefront: direct catalog + manual transfer, with the retired
// Shopify catalog/checkout layers completely absent from the page load graph.
assert.match(index,/version-watermark[^>]*>v827</);
for(const active of ['direct-catalog-v827.js','mockup-background-v827.js','manual-checkout-v827.js','image-lightbox-v820.js','shop-ui-v827.js','live-catalog-refresh-v818.js']) assert.ok(index.includes(active),`missing active shop layer ${active}`);
for(const retired of ['shop-runtime-v819.js','catalog-recovery-v822.js','product-preview-overrides.js','manual-checkout-v825.js','front-lightbox-fit-v821.js','front-detail-overrides-v817.js','payment-readiness-v824.js','shopify-checkout-v817.js']) assert.ok(!index.includes(retired),`retired layer still active: ${retired}`);
assert.doesNotMatch(index,/\b(?:Printify|Shopify)\b/i);

// Catalog requests are redirected to the new direct server source and never fall
// through to the retired commerce endpoints. Bundled direct-image data remains the
// safe fallback when the private production connection is unavailable.
assert.match(directAdapter,/shop-catalog-v827/);
assert.match(directAdapter,/images\.printify\.com/);
assert.match(directAdapter,/Math\.ceil/);
assert.match(directAdapter,/jellyfish/i);
assert.match(directAdapter,/mockups\s*=\s*mockups\.slice\(1\)/);
assert.match(directAdapter,/Never fall through to the retired commerce catalog/);
assert.doesNotMatch(directAdapter,/cdn\.shopify\.com|myshopify\.com/i);

// Direct server catalog uses production product mockups/variants, rounds every
// public variant price upward to whole euros and explicitly declares no Shopify use.
assert.match(catalogEdge,/PRINTIFY_BASE/);
assert.match(catalogEdge,/uses_shopify:\s*false/);
assert.match(catalogEdge,/images\.printify\.com/);
assert.match(catalogEdge,/Math\.ceil\(n\s*\/\s*100\)/);
assert.match(catalogEdge,/media\s*=\s*media\.slice\(1\)/);
assert.doesNotMatch(catalogEdge,/SHOPIFY_DOMAIN|myshopify\.com|cdn\.shopify\.com/i);

// Buyer flow uses server-side Pending orders, POST-only capability tokens and
// supplier-neutral customer text. Server pricing is rounded identically to the UI.
assert.match(manualCheckout,/shop-manual-checkout-v827/);
assert.match(manualCheckout,/shop-order-status-v825/);
assert.match(manualCheckout,/method:'POST'/);
assert.match(manualCheckout,/bunq\.me/);
assert.match(manualCheckout,/tikkie\.me/);
assert.match(manualCheckout,/Create pending order/);
assert.doesNotMatch(manualCheckout,/cdn\.shopify\.com|myshopify\.com/i);
assert.match(checkoutEdge,/status:\s*"pending"/);
assert.match(checkoutEdge,/uses_shopify:\s*false/);
assert.match(checkoutEdge,/Math\.ceil\(sourcePrice\s*\/\s*100\)\s*\*\s*100/);
assert.match(checkoutEdge,/orders\/shipping\.json/);
assert.match(checkoutEdge,/confirmation_token_hash/);
assert.match(checkoutEdge,/checkout_idempotency_key/);
assert.match(checkoutEdge,/RESEND_API_KEY/);
assert.doesNotMatch(checkoutEdge,/SHOPIFY_DOMAIN|myshopify\.com|cdn\.shopify\.com|STRIPE_SECRET|stripe\.com/i);

// Product presentation fixes requested for v827.
assert.match(shopUi,/\^m\$/i);
assert.match(shopUi,/defaultSizeV827/);
assert.match(shopUi,/grid-auto-columns:\s*100%/);
assert.match(shopUi,/shop-lightbox-media/);
assert.match(shopUi,/max-width:\s*88%/);
assert.match(mockupBackground,/BRUIS_MATCH_MOCKUP_BACKGROUND/);
assert.match(mockupBackground,/ratio\s*>\s*\.985/);
assert.match(mockupBackground,/images\.printify\.com/);
assert.match(lightbox,/aria-modal', 'true'/);
assert.match(lightbox,/event\.key === 'Escape'/);
assert.match(refresh,/POLL_MS\s*=\s*15\s*\*\s*1000/);
assert.doesNotMatch(refresh,/window\.location\.reload/);
assert.match(store,/toFixed\(2\)/);

// Status capability stays POST-only.
assert.match(statusEdge,/url\.searchParams\.get\("health"\)===\s*"1"/);
assert.match(statusEdge,/req\.method!=="POST"/);
assert.match(statusEdge,/confirmation_token_hash/);
assert.match(statusEdge,/Referrer-Policy/);
assert.doesNotMatch(statusEdge,/searchParams\.get\("token"\)/);

// Admin remains a two-step payment/release workflow but exposes only neutral
// customer/admin labels. Internal provider identifiers may remain in server code.
assert.match(adminPage,/GEJAST_PAGE_VERSION='v827'/);
assert.match(adminPage,/Verify payment/);
assert.match(adminPage,/Amount actually received/);
assert.match(adminPage,/Send to production/);
assert.doesNotMatch(adminPage,/Send to Printify|Payment & Printify|released to Printify/i);
assert.match(adminNav,/admin_shop_orders\.html/);
assert.match(adminNav,/admin_shop_connection\.html/);
assert.match(adminEdge,/payment_not_verified/);
assert.match(adminEdge,/payment_amount_insufficient/);
assert.match(adminEdge,/send_to_production\.json/);
assert.match(adminEdge,/already_submitted/);
assert.match(adminEdge,/_require_valid_admin_session/);
assert.match(paymentAmountMigration,/ADD COLUMN IF NOT EXISTS paid_amount_cents integer/i);

// Private connection setup validates the admin session and stores the token only
// via service-role access to Supabase Vault. The browser never persists the token.
assert.match(connectionPage,/GEJAST_PAGE_VERSION='v827'/);
assert.match(connectionPage,/type="password"/);
assert.match(connectionPage,/shop-production-connection-v827/);
assert.doesNotMatch(connectionPage,/localStorage|sessionStorage/);
assert.doesNotMatch(connectionPage,/\b(?:Printify|Shopify)\b/i);
assert.match(connectionEdge,/_require_valid_admin_session/);
assert.match(connectionEdge,/set_printify_api_token_v827/);
assert.match(connectionEdge,/api_token/);
assert.match(connectionMigration,/security definer/i);
assert.match(connectionMigration,/vault\.create_secret/);
assert.match(connectionMigration,/vault\.update_secret/);
assert.match(connectionMigration,/revoke all on function public\.set_printify_api_token_v827\(text, text\) from public, anon, authenticated/i);
assert.match(connectionMigration,/grant execute on function public\.set_printify_api_token_v827\(text, text\) to service_role/i);

// Existing order data boundary, idempotency and shipment notification protections.
for(const table of ['shop_orders','shop_payment_settings','shop_webhook_events']) assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`,'i'));
assert.match(migration,/revoke all on table public\.shop_orders from anon, authenticated/i);
assert.match(idempotencyMigration,/idempotency/i);
assert.match(idempotencyMigration,/unique/i);
assert.match(webhookEdge,/shop_webhook_events/);
assert.match(webhookEdge,/canonical/);
assert.match(webhookEdge,/shipment_notified_at/);
assert.match(webhookEdge,/order:shipment:created/);

// Preserve the exact supplied Merch collection artwork.
const merchImage=fs.readFileSync('shop/assets/collection-merch-despinoza.png');
assert.equal(crypto.createHash('sha256').update(merchImage).digest('hex'),'230ee9f150e1c65e14185fac1691a04e67788c53dacb6625be7d83c6cfbf2b1b','Merch collection image must remain the exact supplied PNG');

// Post-merge health remains read-only and certifies the v827 architecture.
assert.match(liveHealthWorkflow,/node check-live-shop\.mjs/);
assert.match(liveShopCheck,/shop-catalog-v827/);
assert.match(liveShopCheck,/shop-manual-checkout-v827/);
assert.match(liveShopCheck,/shop-production-connection-v827/);
assert.match(liveShopCheck,/RESULT=V827_LIVE_SHOP_DIRECT_PAYMENT_PASS/);
assert.doesNotMatch(liveShopCheck,/method:\s*['"]POST['"]\s*,?\s*body/);

console.log('Shop commerce v827 direct-catalog and payment-aware approval contract passed.');
