#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const index = read('shop/index.html');
const directCommerce = read('shop/direct-commerce-v832.js');
const manualCheckout = read('shop/manual-checkout-v825.js');
const storefrontPolish = read('shop/storefront-polish-v832.js');
const storefrontCss = read('shop/storefront-polish-v832.css');
const productPreviews = read('shop/product-preview-overrides.js');
const galleryFixes = read('shop/gallery-fixes-v832.js');
const mockupTransparency = read('shop/mockup-transparency-v832.js');
const collectionMedia = read('shop/collection-media-v831.js');
const lightbox = read('shop/image-lightbox-v832.js');
const adminPage = read('admin_shop_orders.html');
const adminNav = read('admin-topnav.js');
const checkoutEdge = read('supabase/functions/shop-manual-checkout-v832/index.ts');
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
const deployWorkflow = read('.github/workflows/deploy-shop-fixes-v829.yml');
const store = read('shop/store.js');
const refresh = read('shop/live-catalog-refresh-v818.js');

// v832 is the user-facing media/pricing revision. The legacy UI shell remains,
// but catalog and checkout authority are v832 and all frontend assets are cache-busted.
assert.match(index, /direct-commerce-v832\.js/);
assert.match(index, /manual-checkout-v825\.js/);
assert.match(index, /version-watermark[^>]*>v832</);
assert.match(index, /20260915-storefront-v832-r3/);
assert.match(index, /storefront-polish-v832\.css/);
assert.match(index, /storefront-polish-v832\.js/);
assert.match(index, /product-preview-overrides\.js/);
assert.match(index, /gallery-fixes-v832\.js/);
assert.match(index, /mockup-transparency-v832\.js/);
assert.match(index, /collection-media-v831\.js/);
assert.match(index, /image-lightbox-v832\.js/);
assert.match(index, /live-catalog-refresh-v818\.js/);
assert.doesNotMatch(index, /direct-commerce-v828\.js|mockup-background-v830\.js|image-lightbox-v830\.js/);
assert.doesNotMatch(index, /shop-runtime-v819\.js|catalog-recovery-v822\.js|payment-readiness-v824\.js|shopify-checkout-v817\.js/);

// Browser bridge routes the public catalog to the hardened direct Printify endpoint
// and the checkout UI to the new server-side cost-based checkout authority.
assert.match(directCommerce, /shop-catalog-v828/);
assert.match(directCommerce, /shop-manual-checkout-v832/);
assert.match(directCommerce, /X-Kalenel-Catalog-Authority/);
assert.match(directCommerce, /printify-direct-v832/);
assert.match(directCommerce, /pricing:'fulfillment-cost-plus-5-rounded-up'/);
assert.match(directCommerce, /artworkFirstGallery:true/);
assert.match(directCommerce, /wholeEuroPricing:true/);
assert.match(directCommerce, /usesShopifyCatalogApi:false/);
assert.match(directCommerce, /usesShopifyPriceApi:false/);
assert.doesNotMatch(directCommerce, /shop-manual-checkout-v828|shop-price-v818|shop-catalog-v822/);

// Artwork is now the actual first/primary image. Original Printify artwork PNGs win;
// local v5 previews are only a temporary fallback while an older cache is refreshing.
assert.match(productPreviews, /serverArtwork/);
assert.match(productPreviews, /product\.mockups\s*=\s*\[serverArtwork, \.\.\.rest\]/);
assert.match(productPreviews, /product\.image\s*=\s*serverArtwork\.image/);
assert.match(productPreviews, /label:\s*'Artwork fallback'/);
assert.match(productPreviews, /product\.mockups\s*=\s*\[artworkView, \.\.\.rest\]/);
assert.match(productPreviews, /placement:\s*'first'/);
assert.match(productPreviews, /prefersOriginalArtworkPng:\s*true/);
assert.match(productPreviews, /primaryImageIsArtwork:\s*true/);
assert.match(productPreviews, /hydrangea-front-v5\.webp/);
assert.match(productPreviews, /dragonfly-front-v5\.webp/);
assert.match(storefrontPolish, /product\.image=views\[0\]\.image/);
assert.match(storefrontPolish, /artworkPrimaryImage:true/);
assert.match(storefrontPolish, /transparentProductMedia:true/);
assert.doesNotMatch(storefrontPolish, /garmentPrimaryImage|primaryGarment/);

// Exact one-slide-at-a-time carousel is implemented at the owning store layer.
// The CSS layer supplies sizing/snap only and never monkey-patches native scrolling.
assert.match(store, /left: next \* Math\.max\(1, rail\.clientWidth\)/);
assert.match(store, /Math\.round\(rail\.scrollLeft \/ Math\.max\(1, rail\.clientWidth\)\)/);
assert.match(store, /new ResizeObserver/);
assert.doesNotMatch(store, /offsetLeft - rail\.offsetLeft - 14/);
assert.match(galleryFixes, /flex:0 0 100%!important/);
assert.match(galleryFixes, /min-width:100%!important/);
assert.match(galleryFixes, /gap:0!important/);
assert.match(galleryFixes, /scroll-snap-type:x mandatory!important/);
assert.match(galleryFixes, /scroll-snap-stop:always!important/);
assert.match(galleryFixes, /does not monkey-patch/);
assert.doesNotMatch(galleryFixes, /rail\.scrollTo\s*=/);
assert.doesNotMatch(galleryFixes, /raw \+ 14/);
assert.match(galleryFixes, /partialNextSlide:false/);

// Product mockups are rendered on transparent pixels rather than a baked beige or
// white rectangle. Edge-connected studio background is made transparent while a
// row-wise subject span protects near-white garment fabric, including the tag view.
assert.match(storefrontCss, /--shop-image-backdrop:\s*#ded6ca/);
assert.match(storefrontCss, /\.mockup img[\s\S]*background:\s*transparent !important/);
assert.match(mockupTransparency, /function subjectSpans/);
assert.match(mockupTransparency, /function applyTransparency/);
assert.match(mockupTransparency, /data\[index\*4\+3\]=0/);
assert.match(mockupTransparency, /preservesWhiteGarments:true/);
assert.match(mockupTransparency, /tagViewIncluded:true/);
assert.match(mockupTransparency, /allProductMockups:true/);
assert.match(mockupTransparency, /safeFallbackToOriginal:true/);
assert.match(mockupTransparency, /noOneSidedSpanBridge:true/);
assert.match(mockupTransparency, /function outputLooksSafe/);
assert.match(mockupTransparency, /edgeOpaque>0/);
assert.doesNotMatch(mockupTransparency, /shouldPreserve|preserved-detail/);

// The expanded viewer includes the same gallery order (including artwork and tag)
// and its initial Fit state uses a full media-sized object-fit:contain box, so
// portrait transparent artwork cannot overflow the media area and get cropped.
assert.match(lightbox, /aria-modal','true'/);
assert.match(lightbox, /function fit\(\)/);
assert.match(lightbox, /data-lb-fit/);
assert.match(lightbox, /object-fit:contain!important/);
assert.match(lightbox, /position:absolute!important/);
assert.match(lightbox, /inset:var\(--lb-pad-y\) var\(--lb-pad-x\)!important/);
assert.match(lightbox, /width:calc\(100% - var\(--lb-pad-x\) - var\(--lb-pad-x\)\)!important/);
assert.match(lightbox, /height:calc\(100% - var\(--lb-pad-y\) - var\(--lb-pad-y\)\)!important/);
assert.match(lightbox, /allGalleryImages:true/);
assert.match(lightbox, /fitMode:'media-contained'/);
assert.doesNotMatch(lightbox, /EXCLUDE_FROM_EXPANDED_RE/);

// Catalog pricing is derived from Printify fulfillment cost, not retail price:
// retail = base cost + €5, rounded upward to the next whole euro. Original front
// artwork from print_areas is inserted before generated garment mockups.
assert.match(catalogEdge, /const MARGIN_CENTS = 500/);
assert.match(catalogEdge, /retailEurosFromCost/);
assert.match(catalogEdge, /Math\.ceil\(\(Math\.round\(n\) \+ MARGIN_CENTS\) \/ 100\)/);
assert.match(catalogEdge, /price:\s*retailEurosFromCost\(variant\?\.cost\)/);
assert.doesNotMatch(catalogEdge, /priceEuros\(variant\?\.price\)/);
assert.match(catalogEdge, /function artworkFor/);
assert.match(catalogEdge, /product\?\.print_areas/);
assert.match(catalogEdge, /label:\s*"Artwork PNG"/);
assert.match(catalogEdge, /const mockups = \[\.\.\.artwork, \.\.\.garment\]/);
assert.match(catalogEdge, /source:\s*"printify-direct-v832"/);
assert.match(catalogEdge, /mode:\s*"printify-direct-catalog-v832"/);
assert.match(catalogEdge, /pricing:\s*"fulfillment-cost-plus-5-rounded-up"/);
assert.match(catalogEdge, /pricingBase:\s*"printify-variant-cost"/);
assert.match(catalogEdge, /marginEuros:\s*MARGIN_CENTS \/ 100/);
assert.match(catalogEdge, /rounding:\s*"whole-euro-ceiling"/);
assert.match(catalogEdge, /artworkFirst:\s*true/);
assert.match(catalogEdge, /whiteVariantsOnly:\s*true/);
assert.match(catalogEdge, /EdgeRuntime\.waitUntil/);
assert.match(catalogEdge, /get_printify_api_token_v815a/);
assert.doesNotMatch(catalogEdge, /shop-price-v818|shop-catalog-v822|cdn\.shopify\.com/);

// Checkout re-fetches the exact selected Printify product/variant and applies the
// same cost+€5 rounded-up rule server-side, so the displayed and charged prices
// cannot diverge. Customer checkout still only creates a Pending local order.
assert.match(checkoutEdge, /mode:\s*"manual-payment-v832"/);
assert.match(checkoutEdge, /pricing:\s*"fulfillment-cost-plus-5-rounded-up"/);
assert.match(checkoutEdge, /pricingBase:\s*"printify-variant-cost"/);
assert.match(checkoutEdge, /marginEuros:\s*MARGIN_CENTS \/ 100/);
assert.match(checkoutEdge, /rounding:\s*"whole-euro-ceiling"/);
assert.match(checkoutEdge, /const MARGIN_CENTS = 500/);
assert.match(checkoutEdge, /retailCentsFromCost/);
assert.match(checkoutEdge, /Math\.ceil\(\(n \+ MARGIN_CENTS\) \/ 100\) \* 100/);
assert.match(checkoutEdge, /retailCentsFromCost\(freshVariant\?\.cost\)/);
assert.doesNotMatch(checkoutEdge, /Math\.round\(Number\(freshVariant\?\.price\)\)/);
assert.match(checkoutEdge, /shop_catalog_cache_v828/);
assert.match(checkoutEdge, /cachedResolution/);
assert.match(checkoutEdge, /freshProducts/);
assert.match(checkoutEdge, /products\/\$\{encodeURIComponent\(productId\)\}\.json/);
assert.match(checkoutEdge, /isWhiteVariant/);
assert.match(checkoutEdge, /status:\s*"pending"/);
assert.match(checkoutEdge, /orders\/shipping\.json/);
assert.match(checkoutEdge, /payment_reference/);
assert.match(checkoutEdge, /checkout_idempotency_key/);
assert.match(checkoutEdge, /RESEND_API_KEY/);
assert.match(checkoutEdge, /sends_to_production:\s*false/);
assert.doesNotMatch(checkoutEdge, /send_to_production\.json|STRIPE_SECRET|stripe\.com/i);

// Buyer UI remains capability-token based and customer-facing.
assert.match(manualCheckout, /shop-manual-checkout-v825/);
assert.match(manualCheckout, /shop-order-status-v825/);
assert.match(manualCheckout, /method:\s*'POST'/);
assert.match(manualCheckout, /confirmation_token/);
assert.match(manualCheckout, /bunq\.me/);
assert.doesNotMatch(manualCheckout, /stripe/i);
assert.doesNotMatch(manualCheckout, /FRONT_PRINT_PREVIEWS|frontPreviewFor|Front artwork/, 'checkout UI must not inject a duplicate artwork slide');
assert.match(storefrontPolish, /wholeEuroPricing:true/);
assert.match(storefrontPolish, /Shipping is calculated from your delivery address/);
assert.match(storefrontPolish, /Continue to payment/);
assert.match(storefrontPolish, /Order received/);

// Collection-card media remains independent from product transparency. It preserves
// white shirt fill while replacing the outer field and consistently crops/scales
// all three collection shirts, including the exact user-supplied Merch PNG.
assert.match(collectionMedia, /TARGET\s*=\s*\[222, 214, 202, 255\]/);
assert.match(collectionMedia, /function floodOuterBackground/);
assert.match(collectionMedia, /function largestForegroundBox/);
assert.match(collectionMedia, /cropsToLargestGarment:\s*true/);
assert.match(collectionMedia, /preservesWhiteGarment:\s*true/);
const merchImage = fs.readFileSync('shop/assets/collection-merch-despinoza.png');
assert.equal(
  crypto.createHash('sha256').update(merchImage).digest('hex'),
  '230ee9f150e1c65e14185fac1691a04e67788c53dacb6625be7d83c6cfbf2b1b',
  'Merch collection image must remain the exact supplied PNG'
);

// Existing privileged order controls and RLS boundaries remain unchanged.
assert.match(connectionEdge, /production-connection-v828/);
assert.match(connectionEdge, /set_printify_api_token_v828/);
assert.match(connectionEdge, /_require_valid_admin_session/);
assert.match(statusEdge, /confirmation_token_hash/);
assert.doesNotMatch(statusEdge, /searchParams\.get\("token"\)/);
assert.match(adminPage, /verify_payment/);
assert.match(adminPage, /submit_printify/);
assert.match(adminNav, /admin_shop_orders\.html/);
assert.match(adminEdge, /payment_not_verified/);
assert.match(adminEdge, /payment_amount_insufficient/);
assert.match(adminEdge, /send_to_production\.json/);
assert.match(webhookEdge, /shop_webhook_events/);
assert.match(webhookEdge, /canonical/);
assert.match(webhookEdge, /shipment_notified_at/);
for (const table of ['shop_orders','shop_payment_settings','shop_webhook_events']) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
}
assert.match(idempotencyMigration, /idempotency/i);
assert.match(paymentAmountMigration, /paid_amount_cents/i);
assert.match(directMigration, /shop_catalog_cache_v828/i);
assert.match(directMigration, /security definer/i);

assert.match(refresh, /POLL_MS\s*=\s*15\s*\*\s*1000/);
assert.doesNotMatch(refresh, /window\.location\.reload/);
assert.match(store, /const wholeEuro/);
assert.match(store, /price:\s*wholeEuro/);

// Main deployment check must validate the exact v832 customer assets and remain
// read-only: it may GET health/catalog data but must never create an order in CI.
assert.match(liveHealthWorkflow, /node check-live-shop\.mjs/);
assert.match(deployWorkflow, /supabase\/functions\/shop-catalog-v828\/\*\*/);
assert.match(deployWorkflow, /supabase\/functions\/shop-manual-checkout-v832\/\*\*/);
assert.match(deployWorkflow, /functions deploy \"\$function_name\"/);
assert.match(deployWorkflow, /deploy_function shop-catalog-v828/);
assert.match(deployWorkflow, /deploy_function shop-manual-checkout-v832/);
assert.doesNotMatch(deployWorkflow, /functions deploy shop-manual-checkout-v828/);
assert.match(liveShopCheck, /20260915-storefront-v832-r3/);
assert.match(liveShopCheck, /direct-commerce-v832/);
assert.match(liveShopCheck, /storefront-polish-v832/);
assert.match(liveShopCheck, /gallery-fixes-v832/);
assert.match(liveShopCheck, /mockup-transparency-v832/);
assert.match(liveShopCheck, /image-lightbox-v832/);
assert.match(liveShopCheck, /shop-catalog-v828/);
assert.match(liveShopCheck, /shop-manual-checkout-v832/);
assert.match(liveShopCheck, /RESULT=V832_ARTWORK_PRICE_TRANSPARENCY_PASS/);
assert.match(liveShopCheck, /Deliberately read-only/);
assert.doesNotMatch(liveShopCheck, /method:\s*['"]POST['"]/);

console.log('Shop commerce v832 artwork-first + cost+5 + transparent-media contract passed.');
