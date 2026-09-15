#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const index = read('shop/index.html');
const directCommerce = read('shop/direct-commerce-v828.js');
const manualCheckout = read('shop/manual-checkout-v825.js');
const storefrontPolish = read('shop/storefront-polish-v830.js');
const storefrontCss = read('shop/storefront-polish-v830.css');
const adminPage = read('admin_shop_orders.html');
const adminNav = read('admin-topnav.js');
const checkoutEdge = read('supabase/functions/shop-manual-checkout-v828/index.ts');
const catalogEdge = read('supabase/functions/shop-catalog-v828/index.ts');
const connectionEdge = read('supabase/functions/shop-production-connection-v828/index.ts');
const statusEdge = read('supabase/functions/shop-order-status-v825/index.ts');
const adminEdge = read('supabase/functions/shop-admin-orders-v825/index.ts');
const webhookEdge = read('supabase/functions/shop-printify-webhook-v825/index.ts');
const migration = read('supabase/migrations/20260910070731_shop_manual_payment_v825.sql');
const idempotencyMigration = read('supabase/migrations/20260910070905_shop_checkout_idempotency_v825.sql');
const paymentAmountMigration = read('supabase/migrations/20260910103800_shop_admin_payment_amount_v826.sql');
const directMigration = read('supabase/migrations/20260910183000_shop_printify_direct_v828.sql');
const liveShopCheck = read('check-live-shop.mjs');
const liveHealthWorkflow = read('.github/workflows/live-deployment-health.yml');
const store = read('shop/store.js');
const mockupBackground = read('shop/mockup-background-v830.js');
const lightbox = read('shop/image-lightbox-v830.js');
const refresh = read('shop/live-catalog-refresh-v818.js');

// v830 keeps the hardened v828 direct-Printify commerce boundary while adding a
// garment-first gallery, safe white-shirt media handling and professional copy.
assert.match(index, /direct-commerce-v828\.js/);
assert.match(index, /manual-checkout-v825\.js/);
assert.match(index, /version-watermark[^>]*>v830</);
assert.match(index, /20260915-storefront-v830/);
assert.match(index, /storefront-polish-v830\.css/);
assert.match(index, /storefront-polish-v830\.js/);
assert.match(index, /mockup-background-v830\.js/);
assert.match(index, /image-lightbox-v830\.js/);
assert.match(index, /live-catalog-refresh-v818\.js/);
assert.doesNotMatch(index, /product-preview-overrides\.js|front-detail-overrides-v817\.js/);
assert.doesNotMatch(index, /mockup-background-v819\.js|image-lightbox-v820\.js|front-lightbox-fit-v821\.js/);
assert.doesNotMatch(index, /payment-readiness-v824\.js/);
assert.doesNotMatch(index, /shopify-checkout-v817\.js/);
assert.doesNotMatch(index, /shop-runtime-v819\.js/);
assert.doesNotMatch(index, /catalog-recovery-v822\.js/);

// The browser bridge must use only the direct Printify catalog and v828 checkout,
// must never inject standalone artwork as a product view, and must normalize every
// present/future item price to a whole euro before it reaches the UI.
assert.match(directCommerce, /shop-catalog-v828/);
assert.match(directCommerce, /shop-manual-checkout-v828/);
assert.match(directCommerce, /X-Kalenel-Catalog-Authority/);
assert.match(directCommerce, /printify-direct-v828/);
assert.match(directCommerce, /const wholeEuro/);
assert.match(directCommerce, /wholeEuroPricing:\s*true/);
assert.match(directCommerce, /garmentFirstGallery:\s*true/);
assert.match(directCommerce, /usesShopifyCatalogApi:\s*false/);
assert.match(directCommerce, /usesShopifyPriceApi:\s*false/);
assert.doesNotMatch(directCommerce, /shop-price-v818|shop-catalog-v822/);
assert.doesNotMatch(directCommerce, /FRONT_PREVIEWS|frontPreviewFor|jellyfish-front-(?:artwork|v7)/i);

// Buyer UI remains capability-token based and server-priced. The v830 polish
// layer replaces internal implementation language with concise customer copy.
assert.match(manualCheckout, /shop-manual-checkout-v825/);
assert.match(manualCheckout, /shop-order-status-v825/);
assert.match(manualCheckout, /method:\s*'POST'/);
assert.match(manualCheckout, /order_id/);
assert.match(manualCheckout, /confirmation_token/);
assert.match(manualCheckout, /bunq\.me/);
assert.match(manualCheckout, /tikkie\.me/);
assert.doesNotMatch(manualCheckout, /stripe/i);
assert.doesNotMatch(manualCheckout, /shopify-checkout-v817/i);
assert.match(storefrontPolish, /wholeEuroPricing:\s*true/);
assert.match(storefrontPolish, /garmentFirstGallery:\s*true/);
assert.match(storefrontPolish, /customerCopyPolish:\s*true/);
assert.match(storefrontPolish, /Shipping is calculated from your delivery address/);
assert.match(storefrontPolish, /Continue to payment/);
assert.match(storefrontPolish, /Order received/);
assert.doesNotMatch(storefrontPolish, /price shown in the browser is never trusted/i);

// v828 checkout resolves the selected cached SKU/variant, re-fetches only the
// exact product(s), rechecks White + availability + price, quotes shipping, and
// creates only a Pending local order. The authoritative unit price is ceiled to
// whole euros server-side, so frontend manipulation or future products cannot
// reintroduce item cents.
assert.match(checkoutEdge, /mode:\s*"manual-payment-v828"/);
assert.match(checkoutEdge, /shop_catalog_cache_v828/);
assert.match(checkoutEdge, /cachedResolution/);
assert.match(checkoutEdge, /freshProducts/);
assert.match(checkoutEdge, /products\/\$\{encodeURIComponent\(productId\)\}\.json/);
assert.match(checkoutEdge, /isWhiteVariant/);
assert.match(checkoutEdge, /status:\s*"pending"/);
assert.match(checkoutEdge, /orders\/shipping\.json/);
assert.match(checkoutEdge, /shop_payment_settings/);
assert.match(checkoutEdge, /payment_reference/);
assert.match(checkoutEdge, /checkout_idempotency_key/);
assert.match(checkoutEdge, /RESEND_API_KEY/);
assert.match(checkoutEdge, /sends_to_production:\s*false/);
assert.match(checkoutEdge, /Math\.ceil\(\(cost \+ 500\) \/ 100\) \* 100/);
assert.doesNotMatch(checkoutEdge, /send_to_production\.json/);
assert.doesNotMatch(checkoutEdge, /STRIPE_SECRET|stripe\.com/i);

// Direct catalog is server-token-only, whole-euro priced, white-variant-only,
// cached behind RLS, and refreshed asynchronously.
assert.match(catalogEdge, /shop_catalog_cache_v828/);
assert.match(catalogEdge, /EdgeRuntime\.waitUntil/);
assert.match(catalogEdge, /whiteVariantsOnly:\s*true/);
assert.match(catalogEdge, /isWhiteVariant/);
assert.match(catalogEdge, /Math\.ceil\(\(Math\.round\(n\) \+ 500\) \/ 100\)/);
assert.match(catalogEdge, /get_printify_api_token_v815a/);
assert.match(catalogEdge, /Authorization:\s*`Bearer \$\{token\}`/);
assert.doesNotMatch(catalogEdge, /shop-price-v818|shop-catalog-v822|cdn\.shopify\.com/);

// v830 media policy: collar/tag details are preserved rather than flood-filled,
// and any background transform that leaks into the white garment center is
// discarded. Expanded views are whole-garment first and deterministically fit.
assert.match(mockupBackground, /function floodBackdrop/);
assert.match(mockupBackground, /BRUIS_MATCH_MOCKUP_BACKGROUND/);
assert.match(mockupBackground, /preserved-detail/);
assert.match(mockupBackground, /centralHits\s*>=\s*4/);
assert.match(mockupBackground, /ratio\s*>\s*\.78/);
assert.match(lightbox, /aria-modal','true'/);
assert.match(lightbox, /event\.key === 'Escape'/);
assert.match(lightbox, /function fit\(\)/);
assert.match(lightbox, /data-lb-fit/);
assert.match(lightbox, /object-fit:contain!important/);
assert.match(lightbox, /EXCLUDE_FROM_EXPANDED_RE/);
assert.match(storefrontCss, /collection-card\[data-collection="merch"\]/);
assert.match(storefrontCss, /collection-merch-despinoza\.png/);

// Connection handler must accept current long PATs without truncation, validate
// against Printify first, and save only through the restricted Vault setter.
assert.match(connectionEdge, /production-connection-v828/);
assert.match(connectionEdge, /apiToken\.length\s*>\s*4096/);
assert.match(connectionEdge, /set_printify_api_token_v828/);
assert.match(connectionEdge, /_require_valid_admin_session/);
assert.match(connectionEdge, /\/shops\.json/);
assert.match(connectionEdge, /User-Agent/);
assert.doesNotMatch(connectionEdge, /api_token[^\n]*console|console[^\n]*apiToken/);

// Status capability remains POST-only. GET is health-only, preventing the secret
// confirmation token from appearing in URLs, browser history or referrer logs.
assert.match(statusEdge, /url\.searchParams\.get\("health"\)===\s*"1"/);
assert.match(statusEdge, /req\.method!=="POST"/);
assert.match(statusEdge, /confirmation_token_hash/);
assert.match(statusEdge, /Referrer-Policy/);
assert.doesNotMatch(statusEdge, /searchParams\.get\("token"\)/);

// Admin payment verification and production release remain separate transitions.
// We validate the action contracts, not presentation copy, so wording can evolve.
assert.match(adminPage, /GEJAST_PAGE_VERSION='v826'/);
assert.match(adminPage, /verify_payment/);
assert.match(adminPage, /submit_printify/);
assert.match(adminPage, /Amount actually received/);
assert.match(adminPage, /paid_amount_cents/);
assert.match(adminNav, /admin_shop_orders\.html/);
assert.match(adminEdge, /payment_not_verified/);
assert.match(adminEdge, /payment_verified_at/);
assert.match(adminEdge, /paid_amount_cents/);
assert.match(adminEdge, /payment_amount_insufficient/);
assert.match(adminEdge, /paidAmount<required/);
assert.match(adminEdge, /send_to_production\.json/);
assert.match(adminEdge, /already_submitted/);
assert.match(adminEdge, /printify_order_id/);
assert.match(adminEdge, /_require_valid_admin_session/);
assert.match(paymentAmountMigration, /ADD COLUMN IF NOT EXISTS paid_amount_cents integer/i);
assert.match(paymentAmountMigration, /payment_verified_at IS NOT NULL/i);

// Printify callbacks are never trusted as shipment truth: canonical order state is
// fetched again before tracking changes and the one-time shipment email claim.
assert.match(webhookEdge, /shop_webhook_events/);
assert.match(webhookEdge, /printify_order_id/);
assert.match(webhookEdge, /canonical/);
assert.match(webhookEdge, /shipment_notified_at/);
assert.match(webhookEdge, /RESEND_API_KEY/);
assert.match(webhookEdge, /order:shipment:created/);
assert.match(webhookEdge, /order:updated/);

// Database provenance and access boundaries.
for (const table of ['shop_orders','shop_payment_settings','shop_webhook_events']) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
}
assert.match(migration, /revoke all on table public\.shop_orders from anon, authenticated/i);
assert.match(migration, /grant select, insert, update, delete on table public\.shop_orders to service_role/i);
assert.match(idempotencyMigration, /idempotency/i);
assert.match(idempotencyMigration, /unique/i);
assert.match(directMigration, /create table if not exists public\.shop_catalog_cache_v828/i);
assert.match(directMigration, /alter table public\.shop_catalog_cache_v828 enable row level security/i);
assert.match(directMigration, /revoke all on table public\.shop_catalog_cache_v828 from public, anon, authenticated/i);
assert.match(directMigration, /security definer/i);
assert.match(directMigration, /_require_valid_admin_session/);
assert.match(directMigration, /length\(v_token\) > 4096/i);
assert.match(directMigration, /revoke all on function public\.set_printify_api_token_v828\(text, text\) from public, anon, authenticated/i);
assert.match(directMigration, /grant execute on function public\.set_printify_api_token_v828\(text, text\) to service_role/i);

// Exact supplied Merch image remains the source asset; presentation changes are
// CSS-only so the supplied artwork itself is not degraded or replaced.
const merchImage = fs.readFileSync('shop/assets/collection-merch-despinoza.png');
assert.equal(
  crypto.createHash('sha256').update(merchImage).digest('hex'),
  '230ee9f150e1c65e14185fac1691a04e67788c53dacb6625be7d83c6cfbf2b1b',
  'Merch collection image must remain the exact supplied PNG'
);
assert.match(refresh, /POLL_MS\s*=\s*15\s*\*\s*1000/);
assert.doesNotMatch(refresh, /window\.location\.reload/);
assert.match(store, /const wholeEuro/);
assert.match(store, /price:\s*wholeEuro/);

// Main-deployment health validates the actual cache-busted assets customers load
// and stays read-only: no fake checkout or production order is permitted in CI.
assert.match(liveHealthWorkflow, /node check-live-shop\.mjs/);
assert.match(liveShopCheck, /20260915-storefront-v830/);
assert.match(liveShopCheck, /direct-commerce-v828/);
assert.match(liveShopCheck, /storefront-polish-v830/);
assert.match(liveShopCheck, /image-lightbox-v830/);
assert.match(liveShopCheck, /mockup-background-v830/);
assert.match(liveShopCheck, /shop-catalog-v828/);
assert.match(liveShopCheck, /shop-manual-checkout-v828/);
assert.match(liveShopCheck, /RESULT=V830_LIVE_SHOP_POLISH_PASS/);
assert.match(liveShopCheck, /Deliberately read-only/);
assert.doesNotMatch(liveShopCheck, /method:\s*['"]POST['"]/);

console.log('Shop commerce v830 garment-first + whole-euro + manual-payment contract passed.');
