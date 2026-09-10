#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const index = read('shop/index.html');
const manualCheckout = read('shop/manual-checkout-v825.js');
const adminPage = read('admin_shop_orders.html');
const adminNav = read('admin-topnav.js');
const checkoutEdge = read('supabase/functions/shop-manual-checkout-v825/index.ts');
const statusEdge = read('supabase/functions/shop-order-status-v825/index.ts');
const adminEdge = read('supabase/functions/shop-admin-orders-v825/index.ts');
const webhookEdge = read('supabase/functions/shop-printify-webhook-v825/index.ts');
const migration = read('supabase/migrations/20260910070731_shop_manual_payment_v825.sql');
const idempotencyMigration = read('supabase/migrations/20260910070905_shop_checkout_idempotency_v825.sql');
const liveShopCheck = read('check-live-shop.mjs');
const liveHealthWorkflow = read('.github/workflows/live-deployment-health.yml');
const store = read('shop/store.js');
const runtime = read('shop/shop-runtime-v819.js');
const recovery = read('shop/catalog-recovery-v822.js');
const previewOverrides = read('shop/product-preview-overrides.js');
const mockupBackground = read('shop/mockup-background-v819.js');
const lightbox = read('shop/image-lightbox-v820.js');
const frontLightboxFit = read('shop/front-lightbox-fit-v821.js');
const refresh = read('shop/live-catalog-refresh-v818.js');

const JELLYFISH_FRONT = 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/jellyfish-front-artwork.png?v=1788453508';

// v825 switches the customer checkout owner from Shopify/card readiness to a
// server-priced manual-transfer order flow. Legacy catalog/display code stays intact.
assert.match(index, /manual-checkout-v825\.js/);
assert.match(index, /version-watermark[^>]*>v825</);
assert.match(index, /20260910-shop-manual-v825/);
assert.doesNotMatch(index, /payment-readiness-v824\.js/);
assert.doesNotMatch(index, /shopify-checkout-v817\.js/);
assert.match(index, /shop-runtime-v819\.js/);
assert.match(index, /catalog-recovery-v822\.js/);
assert.match(index, /mockup-background-v819\.js/);
assert.match(index, /image-lightbox-v820\.js/);
assert.match(index, /front-lightbox-fit-v821\.js/);
assert.match(index, /live-catalog-refresh-v818\.js/);

// Buyer flow must create server-side Pending orders, retain the cart on errors,
// use a capability token only in POST bodies, and restrict payment links to the
// intended providers.
assert.match(manualCheckout, /shop-manual-checkout-v825/);
assert.match(manualCheckout, /shop-order-status-v825/);
assert.match(manualCheckout, /method:\s*'POST'/);
assert.match(manualCheckout, /order_id/);
assert.match(manualCheckout, /token/);
assert.match(manualCheckout, /bunq\.me/);
assert.match(manualCheckout, /tikkie\.me/);
assert.doesNotMatch(manualCheckout, /stripe/i);
assert.doesNotMatch(manualCheckout, /shopify-checkout-v817/i);

// Checkout Edge Function owns pricing/shipping and notification server-side.
assert.match(checkoutEdge, /status:\s*"pending"/);
assert.match(checkoutEdge, /shop_payment_settings/);
assert.match(checkoutEdge, /payment_reference/);
assert.match(checkoutEdge, /idempotency_key/);
assert.match(checkoutEdge, /PRINTIFY_BASE/);
assert.match(checkoutEdge, /shipping/);
assert.match(checkoutEdge, /RESEND_API_KEY/);
assert.match(checkoutEdge, /confirmation_token_hash/);
assert.doesNotMatch(checkoutEdge, /STRIPE_SECRET|stripe\.com/i);

// Status capability is POST-only. GET is health-only, preventing the secret token
// from appearing in URLs, browser history or referrer logs.
assert.match(statusEdge, /url\.searchParams\.get\("health"\)===\s*"1"/);
assert.match(statusEdge, /req\.method!=="POST"/);
assert.match(statusEdge, /confirmation_token_hash/);
assert.match(statusEdge, /Referrer-Policy/);
assert.doesNotMatch(statusEdge, /searchParams\.get\("token"\)/);

// Admin payment verification and Printify release remain separate transitions.
assert.match(adminPage, /verify_payment/);
assert.match(adminPage, /submit_printify/);
assert.match(adminPage, /Verify transfer/);
assert.match(adminPage, /Send to Printify/);
assert.match(adminNav, /admin_shop_orders\.html/);
assert.match(adminEdge, /payment_not_verified/);
assert.match(adminEdge, /payment_verified_at/);
assert.match(adminEdge, /send_to_production\.json/);
assert.match(adminEdge, /already_submitted/);
assert.match(adminEdge, /printify_order_id/);
assert.match(adminEdge, /_require_valid_admin_session/);

// Printify callbacks are never trusted as shipment truth: the webhook re-fetches
// the canonical Printify order before updating tracking and claiming the one-time
// shipment email.
assert.match(webhookEdge, /shop_webhook_events/);
assert.match(webhookEdge, /printify_order_id/);
assert.match(webhookEdge, /shopId/);
assert.match(webhookEdge, /canonical/);
assert.match(webhookEdge, /shipment_notified_at/);
assert.match(webhookEdge, /RESEND_API_KEY/);
assert.match(webhookEdge, /order:shipment:created/);
assert.match(webhookEdge, /order:updated/);

// Database provenance and access boundary.
for (const table of ['shop_orders','shop_payment_settings','shop_webhook_events']) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
}
assert.match(migration, /revoke all on table public\.shop_orders from anon, authenticated/i);
assert.match(migration, /grant select, insert, update, delete on table public\.shop_orders to service_role/i);
assert.match(idempotencyMigration, /idempotency/i);
assert.match(idempotencyMigration, /unique/i);

// The exact supplied Merch and Jellyfish artwork contracts remain protected.
const merchImage = fs.readFileSync('shop/assets/collection-merch-despinoza.png');
assert.equal(
  crypto.createHash('sha256').update(merchImage).digest('hex'),
  '230ee9f150e1c65e14185fac1691a04e67788c53dacb6625be7d83c6cfbf2b1b',
  'Merch collection image must remain the exact supplied PNG'
);
for (const source of [runtime, recovery, previewOverrides]) {
  assert.ok(source.includes(JELLYFISH_FRONT), 'Every Jellyfish fallback layer must use the supplied front artwork');
  assert.doesNotMatch(source, /jellyfish-front-v7\.webp/);
}

// Existing catalog, gallery and live-refresh protections remain in force.
assert.match(store, /toFixed\(2\)/);
assert.doesNotMatch(store, /price:\s*Math\.ceil/);
assert.match(recovery, /shop-catalog-v822/);
assert.match(recovery, /shop-price-v818/);
assert.match(recovery, /return previousFetch\(input, init\)/);
assert.match(recovery, /X-Kalenel-Catalog-Authority/);
assert.match(mockupBackground, /function floodBackdrop/);
assert.match(mockupBackground, /BRUIS_MATCH_MOCKUP_BACKGROUND/);
assert.match(lightbox, /aria-modal', 'true'/);
assert.match(lightbox, /event\.key === 'Escape'/);
assert.match(frontLightboxFit, /function cropTransparentMargins/);
assert.match(frontLightboxFit, /is-front-fit-v821/);
assert.match(refresh, /POLL_MS\s*=\s*15\s*\*\s*1000/);
assert.doesNotMatch(refresh, /window\.location\.reload/);

// Main-deployment health must verify the manual-payment release without creating
// an order or touching payment/fulfillment state.
assert.match(liveHealthWorkflow, /node check-live-shop\.mjs/);
assert.match(liveShopCheck, /manual-checkout-v825/);
assert.match(liveShopCheck, /shop-manual-checkout-v825/);
assert.match(liveShopCheck, /shop-order-status-v825/);
assert.match(liveShopCheck, /shop-admin-orders-v825/);
assert.match(liveShopCheck, /shop-printify-webhook-v825/);
assert.match(liveShopCheck, /RESULT=V825_LIVE_SHOP_MANUAL_PAYMENT_PASS/);
assert.doesNotMatch(liveShopCheck, /acceptedCardBrands|verifyCardPayments|PAYMENT_QUERY/);

console.log('Shop commerce v825 manual-payment contract passed.');
