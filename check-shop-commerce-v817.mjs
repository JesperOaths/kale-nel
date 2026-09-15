#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const index = read('shop/index.html');
const directCommerce = read('shop/direct-commerce-v828.js');
const manualCheckout = read('shop/manual-checkout-v825.js');
const storefrontPolish = read('shop/storefront-polish-v831.js');
const storefrontCss = read('shop/storefront-polish-v831.css');
const productPreviews = read('shop/product-preview-overrides.js');
const collectionMedia = read('shop/collection-media-v831.js');
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

// v831 retains the hardened v828 commerce boundary and v830 whole-shirt lightbox,
// while restoring artwork detail slides and giving all three collection shirts the
// same beige field without recolouring the white garment itself.
assert.match(index, /direct-commerce-v828\.js/);
assert.match(index, /manual-checkout-v825\.js/);
assert.match(index, /version-watermark[^>]*>v831</);
assert.match(index, /20260915-storefront-v831/);
assert.match(index, /storefront-polish-v831\.css/);
assert.match(index, /storefront-polish-v831\.js/);
assert.match(index, /product-preview-overrides\.js/);
assert.match(index, /collection-media-v831\.js/);
assert.match(index, /mockup-background-v830\.js/);
assert.match(index, /image-lightbox-v830\.js/);
assert.match(index, /live-catalog-refresh-v818\.js/);
assert.doesNotMatch(index, /storefront-polish-v830\.(?:css|js)/);
assert.doesNotMatch(index, /mockup-background-v819\.js|image-lightbox-v820\.js|front-lightbox-fit-v821\.js/);
assert.doesNotMatch(index, /payment-readiness-v824\.js/);
assert.doesNotMatch(index, /shopify-checkout-v817\.js/);
assert.doesNotMatch(index, /shop-runtime-v819\.js/);
assert.doesNotMatch(index, /catalog-recovery-v822\.js/);

// The browser bridge remains direct-Printify and whole-euro. Artwork restoration
// is deliberately a presentation decorator, not a catalog/price authority change.
assert.match(directCommerce, /shop-catalog-v828/);
assert.match(directCommerce, /shop-manual-checkout-v828/);
assert.match(directCommerce, /X-Kalenel-Catalog-Authority/);
assert.match(directCommerce, /printify-direct-v828/);
assert.match(directCommerce, /const wholeEuro/);
assert.match(directCommerce, /wholeEuroPricing:\s*true/);
assert.match(directCommerce, /usesShopifyCatalogApi:\s*false/);
assert.match(directCommerce, /usesShopifyPriceApi:\s*false/);
assert.doesNotMatch(directCommerce, /shop-price-v818|shop-catalog-v822/);

// Artwork details are restored after the primary shirt image. The product/cart
// primary image remains a garment, so transparent artwork details never replace it.
assert.match(productPreviews, /hydrangea-front-v5\.webp/);
assert.match(productPreviews, /dragonfly-front-v5\.webp/);
assert.match(productPreviews, /label:\s*'Artwork detail'/);
assert.match(productPreviews, /product\.mockups\s*=\s*\[views\[0\], artworkView, \.\.\.views\.slice\(1\)\]/);
assert.match(productPreviews, /product\.image\s*=\s*views\[0\]\.image/);
assert.match(productPreviews, /placement:\s*'after-primary-garment'/);
assert.match(storefrontPolish, /artworkDetailsRestored:\s*true/);
assert.match(storefrontPolish, /garmentPrimaryImage:\s*true/);
assert.doesNotMatch(storefrontPolish, /product\.mockups\s*=\s*garmentViews/);

// Buyer UI remains capability-token based and server-priced. The polish layer
// keeps customer copy concise and non-technical.
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
assert.match(storefrontPolish, /customerCopyPolish:\s*true/);
assert.match(storefrontPolish, /Shipping is calculated from your delivery address/);
assert.match(storefrontPolish, /Continue to payment/);
assert.match(storefrontPolish, /Order received/);
assert.doesNotMatch(storefrontPolish, /price shown in the browser is never trusted/i);

// v828 checkout resolves the exact product/variant, rechecks availability and
// authoritative price, quotes shipping and creates only a Pending local order.
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

// Product mockups still use the safe v830 matcher. The collection-card matcher is
// separate: it flood-selects only connected edge white, preserves the enclosed
// white shirt, ignores smaller stray components and crops/scales the largest shirt.
assert.match(mockupBackground, /function floodBackdrop/);
assert.match(mockupBackground, /BRUIS_MATCH_MOCKUP_BACKGROUND/);
assert.match(mockupBackground, /preserved-detail/);
assert.match(mockupBackground, /centralHits\s*>=\s*4/);
assert.match(mockupBackground, /ratio\s*>\s*\.78/);
assert.match(collectionMedia, /TARGET\s*=\s*\[222, 214, 202, 255\]/);
assert.match(collectionMedia, /collection-\(\?:normal\|boxy\|merch-despinoza\)/);
assert.match(collectionMedia, /function floodOuterBackground/);
assert.match(collectionMedia, /function largestForegroundBox/);
assert.match(collectionMedia, /cropsToLargestGarment:\s*true/);
assert.match(collectionMedia, /preservesWhiteGarment:\s*true/);
assert.match(storefrontCss, /--shop-image-backdrop:\s*#ded6ca/);
assert.match(storefrontCss, /collection-image \.collection-merch-image/);
assert.match(storefrontCss, /content:\s*none !important/);

// Expanded view intentionally excludes artwork/detail images and remains a fitted
// whole-garment viewer even though artwork details are restored in the card gallery.
assert.match(lightbox, /aria-modal','true'/);
assert.match(lightbox, /event\.key === 'Escape'/);
assert.match(lightbox, /function fit\(\)/);
assert.match(lightbox, /data-lb-fit/);
assert.match(lightbox, /object-fit:contain!important/);
assert.match(lightbox, /EXCLUDE_FROM_EXPANDED_RE/);
assert.match(lightbox, /artwork\|front\\s\*print/);

// Connection and status/admin boundaries remain hardened.
assert.match(connectionEdge, /production-connection-v828/);
assert.match(connectionEdge, /apiToken\.length\s*>\s*4096/);
assert.match(connectionEdge, /set_printify_api_token_v828/);
assert.match(connectionEdge, /_require_valid_admin_session/);
assert.match(connectionEdge, /\/shops\.json/);
assert.doesNotMatch(connectionEdge, /api_token[^\n]*console|console[^\n]*apiToken/);
assert.match(statusEdge, /url\.searchParams\.get\("health"\)===\s*"1"/);
assert.match(statusEdge, /req\.method!=="POST"/);
assert.match(statusEdge, /confirmation_token_hash/);
assert.match(statusEdge, /Referrer-Policy/);
assert.doesNotMatch(statusEdge, /searchParams\.get\("token"\)/);
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

// Printify callbacks are never trusted as shipment truth.
assert.match(webhookEdge, /shop_webhook_events/);
assert.match(webhookEdge, /printify_order_id/);
assert.match(webhookEdge, /canonical/);
assert.match(webhookEdge, /shipment_notified_at/);
assert.match(webhookEdge, /RESEND_API_KEY/);
assert.match(webhookEdge, /order:shipment:created/);
assert.match(webhookEdge, /order:updated/);

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

// The exact supplied Merch PNG remains unchanged; v831 fixes presentation at run
// time so the user's source image is not degraded or replaced.
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

// Main-deployment health validates the cache-busted assets customers load and is
// deliberately read-only: it never creates checkout/production orders.
assert.match(liveHealthWorkflow, /node check-live-shop\.mjs/);
assert.match(liveShopCheck, /20260915-storefront-v831/);
assert.match(liveShopCheck, /product-preview-overrides/);
assert.match(liveShopCheck, /collection-media-v831/);
assert.match(liveShopCheck, /storefront-polish-v831/);
assert.match(liveShopCheck, /image-lightbox-v830/);
assert.match(liveShopCheck, /shop-catalog-v828/);
assert.match(liveShopCheck, /shop-manual-checkout-v828/);
assert.match(liveShopCheck, /RESULT=V831_LIVE_SHOP_MEDIA_PASS/);
assert.match(liveShopCheck, /Deliberately read-only/);
assert.doesNotMatch(liveShopCheck, /method:\s*['"]POST['"]/);

console.log('Shop commerce v831 artwork + collection media + whole-euro contract passed.');
