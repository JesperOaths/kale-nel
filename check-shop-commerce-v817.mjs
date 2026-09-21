#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parseEcbUsdRate, retailEurCentsFromUsdCost, usdCentsToEurCents } from './supabase/functions/_shared/shop-fx.mjs';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const index = read('shop/index.html');
const directCommerce = read('shop/direct-commerce-v832.js');
const deliveryEstimate = read('shop/delivery-estimate-v833.js');
const manualCheckout = read('shop/manual-checkout-v825.js');
const shopAnalytics = read('shop/shop-analytics-v841.js');
const customerFacingCheckout = read('shop/customer-facing-checkout-v837.js');
const storefrontPolish = read('shop/storefront-polish-v832.js');
const toteHandleColor = read('shop/tote-handle-color-v839.js');
const storefrontCss = read('shop/storefront-polish-v832.css');
const styles = read('shop/styles.css');
const productPreviews = read('shop/product-preview-overrides.js');
const galleryFixes = read('shop/gallery-fixes-v832.js');
const mockupTransparency = read('shop/mockup-transparency-v832.js');
const collectionMedia = read('shop/collection-media-v831.js');
const lightbox = read('shop/image-lightbox-v832.js');
const adminPage = read('admin_shop_orders.html');
const adminAnalyticsPage = read('admin_shop_analytics.html');
const adminNav = read('admin-topnav.js');
const checkoutEdge = read('supabase/functions/shop-manual-checkout-v832/index.ts');
const fulfillmentRouting = read('supabase/functions/shop-manual-checkout-v832/fulfillment-routing.mjs');
const deliveryPreviewEdge = read('supabase/functions/shop-delivery-preview-v833/index.ts');
const deliveryPreviewRouting = read('supabase/functions/shop-delivery-preview-v833/fulfillment-routing.mjs');
const catalogEdge = read('supabase/functions/shop-catalog-v828/index.ts');
const fxShared = read('supabase/functions/_shared/shop-fx.mjs');
const obsoletePriceRule = read('supabase/functions/shop-price-rule-v819/index.ts');
const connectionEdge = read('supabase/functions/shop-production-connection-v828/index.ts');
const statusEdge = read('supabase/functions/shop-order-status-v825/index.ts');
const adminEdge = read('supabase/functions/shop-admin-orders-v825/index.ts');
const adminAnalyticsEdge = read('supabase/functions/shop-admin-analytics-v843/index.ts');
const analyticsSchema = read('GEJAST_v841_shop_analytics.sql');
const analyticsSecurityV842 = read('supabase/migrations/20260920130000_shop_admin_security_intelligence_v842.sql');
const analyticsGrowthV843 = read('supabase/functions/_shared/shop-admin-growth-v843.mjs');
const analyticsGrowthSchemaV843 = read('supabase/migrations/20260920154000_shop_admin_growth_intelligence_v843.sql');
const adminGrowthUiV843 = read('admin-shop-growth-v843.js');
const webhookEdge = read('supabase/functions/shop-printify-webhook-v825/index.ts');
const migration = read('supabase/migrations/20260910070731_shop_manual_payment_v825.sql');
const idempotencyMigration = read('supabase/migrations/20260910070905_shop_checkout_idempotency_v825.sql');
const paymentAmountMigration = read('supabase/migrations/20260910103800_shop_admin_payment_amount_v826.sql');
const directMigration = read('supabase/migrations/20260910183000_shop_printify_direct_v828.sql');
const fxMigration = read('supabase/migrations/20260916014900_shop_usd_eur_fx_v834.sql');
const liveShopCheck = read('check-live-shop.mjs');
const liveHealthWorkflow = read('.github/workflows/live-deployment-health.yml');
const deployWorkflow = read('.github/workflows/deploy-shop-fixes-v829.yml');
const store = read('shop/store.js');
const refresh = read('shop/live-catalog-refresh-v818.js');

// v839 keeps the Bruis checkout behavior and adds exact tote handle-color selection,
// restores pure converted production cost + €5 pricing, and exposes a final total
// that includes the address-specific shipping quote.
assert.match(index, /direct-commerce-v832\.js/);
assert.match(index, /manual-checkout-v825\.js/);
assert.match(index, /customer-facing-checkout-v837\.js/);
assert.match(index, /tote-handle-color-v839\.js\?v=20260916-storefront-v839-r1/);
assert.match(toteHandleColor, /Handle color/);
assert.match(toteHandleColor, /variantBoundMockups:\s*true/);
assert.match(toteHandleColor, /sharedArtworkFirst:\s*true/);
assert.match(toteHandleColor, /artwork\|print file\|design png/i);
assert.match(toteHandleColor, /exactVariantSelection:\s*true/);
assert.match(index, /version-watermark[^>]*>v855</);
assert.match(index, /data-open-size-guide/);
assert.match(index, /data-size-guide-panel/);
assert.match(index, /data-size-guide-overlay/);
assert.match(index, /data-size-guide-visual/);
assert.match(store, /size-guide-classic\.svg/);
assert.match(store, /size-guide-boxy\.svg/);
assert.match(store, /function openSizeGuide\(\)/);
assert.match(store, /function closeSizeGuide\(\)/);
assert.match(index, /20260916-storefront-v837-r1/);
assert.match(index, /shop-analytics-v841\.js\?v=20260920-shop-analytics-v841-r1/);
assert.match(index, /20260916-delivery-v840-r1/);
assert.match(index, /20260916-storefront-v837-r2/);
assert.match(index, /20260921-checkout-v850-r1/);
assert.match(index, /storefront-polish-v832\.css/);
assert.match(index, /storefront-polish-v832\.js/);
assert.match(index, /product-preview-overrides\.js/);
assert.match(index, /gallery-fixes-v832\.js/);
assert.match(index, /mockup-transparency-v832\.js/);
assert.match(index, /collection-media-v831\.js/);
assert.match(index, /image-lightbox-v832\.js/);
assert.match(index, /live-catalog-refresh-v818\.js/);
assert.doesNotMatch(index, /catalog-data\.js/, 'retired static catalog fallback must not load');
assert.match(store, /shop-catalog-v828/, 'storefront must call the current Printify-backed catalog directly');
assert.doesNotMatch(store, /BRUIS_CATALOG|catalog\.json/, 'storefront must not fall back to stale static catalog data');
assert.doesNotMatch(index, /direct-commerce-v828\.js|mockup-background-v830\.js|image-lightbox-v830\.js/);
assert.doesNotMatch(index, /shop-runtime-v819\.js|catalog-recovery-v822\.js|payment-readiness-v824\.js|shopify-checkout-v817\.js/);

// Browser bridge routes the public catalog to the hardened Bruis catalog endpoint,
// checkout to the cost-based authority, and injects the non-blocking delivery panel.
assert.match(directCommerce, /shop-catalog-v828/);
assert.match(directCommerce, /shop-manual-checkout-v832/);
assert.match(directCommerce, /delivery-estimate-v833\.js/);
assert.match(directCommerce, /shop-delivery-preview-v833/);
assert.match(directCommerce, /X-Kalenel-Catalog-Authority/);
assert.match(directCommerce, /bruis-direct-v836/);
assert.match(directCommerce, /pricing:'production-cost-plus-5-rounded-up'/);
assert.match(directCommerce, /artworkFirstGallery:true/);
assert.match(directCommerce, /wholeEuroPricing:true/);
assert.match(directCommerce, /usesShopifyCatalogApi:false/);
assert.match(directCommerce, /usesShopifyPriceApi:false/);
assert.doesNotMatch(directCommerce, /shop-manual-checkout-v828|shop-price-v818|shop-catalog-v822/);


// US shipping quotes require a phone. Preview uses a fictitious quote-only number
// that is never stored; real checkout requires the customer's own phone.
assert.match(deliveryPreviewEdge, /US_QUOTE_ONLY_PHONE = "\+12025550123"/);
assert.match(deliveryPreviewEdge, /phone: country === "US" \? US_QUOTE_ONLY_PHONE : ""/);
assert.match(checkoutEdge, /phone_required_for_destination/);
assert.match(checkoutEdge, /country === "US" && phone\.replace\(\/\\D\/g, ""\)\.length < 7/);
assert.match(manualCheckout, /data-manual-phone-label/);
assert.match(manualCheckout, /Phone \(required for US delivery\)/);
assert.match(manualCheckout, /bruis:order-created/);
assert.match(shopAnalytics, /gejast_visitor_id_v2/);
assert.match(shopAnalytics, /product_view/);
assert.match(shopAnalytics, /add_to_cart/);
assert.match(shopAnalytics, /remove_from_cart/);
assert.match(shopAnalytics, /cart_open/);
assert.match(shopAnalytics, /checkout_start/);
assert.match(shopAnalytics, /checkout_submit/);
assert.match(shopAnalytics, /order_created/);
assert.match(manualCheckout, /syncPhoneRequirement/);
assert.match(manualCheckout, /A phone number is required for delivery to the United States/);

// Delivery preview must be address-aware, non-blocking, and explicit about the
// payment-verification delay and possible split fulfillment.
assert.match(deliveryEstimate, /shop-delivery-preview-v833/);
assert.match(deliveryEstimate, /Prepared in/);
assert.match(deliveryEstimate, /Estimated arrival/);
assert.match(deliveryEstimate, /business days after payment verification/);
assert.match(deliveryEstimate, /may_arrive_separately/);
assert.match(deliveryEstimate, /Calculate delivery/);
assert.match(deliveryEstimate, /Refresh estimate/);
assert.match(deliveryEstimate, /delivery_address_incomplete|addressReady/);
assert.match(deliveryEstimate, /Import-cost warning/);
assert.match(deliveryEstimate, /United Kingdom into the EU/);
assert.match(deliveryEstimate, /EU customs area/);
assert.match(deliveryEstimate, /carrier handling fees/);
assert.match(deliveryEstimate, /Where your shipping fee comes from/);
assert.match(deliveryEstimate, /Stacked shipping/);
assert.match(deliveryEstimate, /one base charge plus a smaller additional-item charge/);
assert.match(deliveryPreviewEdge, /shipping_breakdown/);
assert.match(deliveryPreviewEdge, /customs_notice/);
assert.match(deliveryPreviewEdge, /shippingBreakdown/);
assert.match(deliveryPreviewEdge, /roundingDelta/);
assert.match(deliveryPreviewEdge, /fx_rounding_adjustment_cents/);
assert.match(deliveryPreviewEdge, /\"UNITED KINGDOM\": \"GB\"/);
assert.match(manualCheckout, /UK↔EU/);
assert.match(manualCheckout, /Stacked shipping/);

// v837 customer-facing checkout layer must show the address-specific shipping total
// at the bottom and rewrite any legacy supplier/factory wording before it is visible.
assert.match(customerFacingCheckout, /Total incl\. shipping/);
assert.match(customerFacingCheckout, /Products \$\{money\(subtotal\)\} \+ shipping \$\{money\(shipping\)\}/);
assert.match(customerFacingCheckout, /shippingInclusiveTotal:\s*true/);
assert.match(customerFacingCheckout, /supplierBrandingHidden:\s*true/);
assert.match(customerFacingCheckout, /replace\(\/\\bPrintify\\b\/gi, 'Bruis'\)/);
assert.match(customerFacingCheckout, /replace\(\/\\bfactories\\b\/gi, 'production locations'\)/);
assert.match(customerFacingCheckout, /replace\(\/\\bfactory\\b\/gi, 'production location'\)/);

// Delivery authority now quotes the customer's canonical selected product and lets
// the supplier's native routing own provider selection. The legacy regional mapping
// parser remains tested in the shared routing helper, but preview mappings stay inert.
assert.match(deliveryPreviewEdge, /CHOICE_PROVIDER_ID = 99/);
assert.match(deliveryPreviewEdge, /const mappings:\s*any\[\]\s*=\s*\[\]/);
assert.match(deliveryPreviewEdge, /native routing owns provider selection/);
assert.match(deliveryPreviewEdge, /chooseCheapestFulfillment/);
assert.match(deliveryPreviewEdge, /catalog\/print_providers/);
assert.match(deliveryPreviewEdge, /printifyV2/);
assert.match(deliveryPreviewEdge, /Bruis production network/);
assert.match(deliveryPreviewEdge, /fallback_min_business_days/);
assert.match(deliveryPreviewEdge, /exact_for_selected_route/);
assert.match(deliveryPreviewEdge, /strictCountry/);
assert.match(deliveryPreviewRouting, /function validateMappedCandidate/);
assert.match(deliveryPreviewRouting, /variant_options_mismatch/);
assert.match(deliveryPreviewRouting, /artwork_mismatch/);
assert.match(deliveryPreviewRouting, /function chooseCheapestFulfillment/);

// Artwork is now the actual first/primary image. Original supplier artwork PNGs win;
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

// Supplier API money fields are USD cents. Every customer-facing EUR amount and
// every fulfillment score is converted server-side before the €5 margin or totals
// are applied; raw USD source amounts and the exact FX snapshot remain auditable.
const ecbSample = parseEcbUsdRate("<Cube time='2026-09-15'><Cube currency='USD' rate='1.1539'/></Cube>");
assert.equal(ecbSample.eur_usd, 1.1539);
assert.equal(ecbSample.usd_eur, 0.8666262241);
assert.equal(usdCentsToEurCents(1661, ecbSample.usd_eur), 1439);
assert.equal(retailEurCentsFromUsdCost(1661, ecbSample.usd_eur, 500), 2000);
assert.equal(retailEurCentsFromUsdCost(1661, ecbSample.usd_eur, 500, 2300), 2300);
assert.equal(usdCentsToEurCents(1039, ecbSample.usd_eur), 900);
assert.match(fxShared, /shop_fx_rates/);
assert.match(fxShared, /eurofxref-daily\.xml/);
assert.match(fxShared, /MAX_OBSERVED_AGE_MS/);
assert.match(fxMigration, /fx_snapshot jsonb/);
assert.match(fxMigration, /shipping_source_currency text/);
assert.match(fxMigration, /shipping_source_cents integer/);
assert.match(deliveryPreviewEdge, /usdCentsToEurCents/);
assert.match(deliveryPreviewEdge, /shipping_source_cents/);
assert.match(deliveryPreviewEdge, /fxAuditSnapshot/);

// The obsolete mutating endpoint must remain a non-writing tombstone so it cannot be redeployed accidentally.
assert.match(obsoletePriceRule, /endpoint_disabled/);
assert.match(obsoletePriceRule, /status: 410/);
assert.match(obsoletePriceRule, /shop-catalog-v828/);
assert.doesNotMatch(obsoletePriceRule, /createClient|PRINTIFY_BASE|pricedVariants|method:\s*["']PUT["']/);

// Catalog pricing is derived from fulfillment cost, not retail price:
// retail = base cost + €5, rounded upward to the next whole euro. Original front
// artwork from print_areas is inserted before generated garment mockups.
assert.match(catalogEdge, /const MARGIN_CENTS = 500/);
assert.match(catalogEdge, /resolveUsdEurRate/);
assert.match(catalogEdge, /retailEurCentsFromUsdCost/);
assert.match(catalogEdge, /price:\s*retailEurCentsFromUsdCost\(variant\?\.cost, fx, MARGIN_CENTS\) \/ 100/);
assert.match(catalogEdge, /sourceCurrency:\s*"USD"/);
assert.match(catalogEdge, /displayCurrency:\s*"EUR"/);
assert.doesNotMatch(catalogEdge, /priceEuros\(variant\?\.price\)/);
assert.match(catalogEdge, /function artworkFor/);
assert.match(catalogEdge, /product\?\.print_areas/);
assert.match(catalogEdge, /label:\s*"Artwork PNG"/);
assert.match(catalogEdge, /const mockups = \[\.\.\.artwork, \.\.\.garment\]/);
assert.match(catalogEdge, /source:\s*"printify-live-v851"/);
assert.match(catalogEdge, /mode:\s*"bruis-direct-catalog-v838"/);
assert.match(catalogEdge, /pricing:\s*"production-cost-plus-5-rounded-up"/);
assert.match(catalogEdge, /pricingBase:\s*"production-cost"/);
assert.match(catalogEdge, /marginEuros:\s*MARGIN_CENTS \/ 100/);
assert.match(catalogEdge, /rounding:\s*"whole-euro-ceiling"/);
assert.match(catalogEdge, /artworkFirst:\s*true/);
assert.match(catalogEdge, /whiteVariantsOnly:\s*false/);
assert.match(catalogEdge, /toteHandleColors:\s*\["Black", "White"\]/);
assert.match(catalogEdge, /isPublicVariant/);
assert.match(catalogEdge, /variantIds/);
assert.match(catalogEdge, /EdgeRuntime\.waitUntil/);
assert.match(catalogEdge, /function versionedMockupUrl/);
assert.match(catalogEdge, /url\.searchParams\.set\("kv", String\(stamp\)\)/);
assert.match(catalogEdge, /versionedMockupUrl\(text\(image\?\.src\), product\?\.updated_at\)/);
assert.match(catalogEdge, /get_printify_api_token_v815a/);
assert.doesNotMatch(catalogEdge, /shop-price-v818|shop-catalog-v822|cdn\.shopify\.com/);

// Checkout re-fetches the exact selected supplier product/variant and applies the
// same cost+€5 rounded-up rule server-side, so the displayed and charged prices
// cannot diverge. Customer checkout still only creates a Pending local order.
assert.match(checkoutEdge, /mode:\s*"manual-payment-v832"/);
assert.match(checkoutEdge, /pricing:\s*"production-cost-plus-5-rounded-up"/);
assert.match(checkoutEdge, /pricingBase:\s*"production-cost"/);
assert.match(checkoutEdge, /marginEuros:\s*MARGIN_CENTS \/ 100/);
assert.match(checkoutEdge, /rounding:\s*"whole-euro-ceiling"/);
assert.match(checkoutEdge, /const MARGIN_CENTS = 500/);
assert.match(checkoutEdge, /resolveUsdEurRate/);
assert.match(checkoutEdge, /retailEurCentsFromUsdCost/);
assert.match(checkoutEdge, /retailEurCentsFromUsdCost\(freshVariant\?\.cost, fx, MARGIN_CENTS\)/);
assert.match(checkoutEdge, /usdCentsToEurCents/);
assert.match(checkoutEdge, /shipping_source_cents/);
assert.match(checkoutEdge, /fx_snapshot:\s*fxAuditSnapshot\(fx\)/);
assert.doesNotMatch(checkoutEdge, /Math\.round\(Number\(freshVariant\?\.price\)\)/);
assert.match(checkoutEdge, /shop_catalog_cache_v828/);
assert.match(checkoutEdge, /cachedResolution/);
assert.match(checkoutEdge, /freshProducts/);
assert.match(checkoutEdge, /products\/\$\{encodeURIComponent\(productId\)\}\.json/);
assert.match(checkoutEdge, /isCustomerVariantAllowed/);
assert.match(checkoutEdge, /isToteProduct/);
assert.match(checkoutEdge, /\$\{color\} handles/);
assert.match(checkoutEdge, /status:\s*"pending"/);
assert.match(checkoutEdge, /orders\/shipping\.json/);
assert.match(checkoutEdge, /const mappings:\s*any\[\]\s*=\s*\[\]/);
assert.match(checkoutEdge, /native order routing/);
assert.match(checkoutEdge, /buildFulfillmentPlans/);
assert.match(checkoutEdge, /chooseCheapestFulfillment/);
assert.match(checkoutEdge, /approved_regional_mapping/);
assert.match(checkoutEdge, /catalog_printify_product_id/);
assert.match(fulfillmentRouting, /function cheapestShippingQuote/);
assert.match(fulfillmentRouting, /a\.cents - b\.cents/);
assert.match(fulfillmentRouting, /function validateMappedCandidate/);
assert.match(fulfillmentRouting, /variant_options_mismatch/);
assert.match(fulfillmentRouting, /artwork_mismatch/);
assert.match(fulfillmentRouting, /production_cents \+ a\.shipping\.cents/);
assert.doesNotMatch(checkoutEdge, /let shippingMethod = "standard"/);
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
assert.match(adminNav, /admin_shop_analytics\.html/);
assert.match(adminAnalyticsPage, /Shop analytics/);
assert.match(adminAnalyticsPage, /shop-admin-analytics-v843/);
assert.match(adminAnalyticsPage, /Profit & cost anatomy/);
assert.match(adminAnalyticsPage, /Business cost & income ledger/);
assert.match(adminAnalyticsPage, /Unique customers/);
assert.match(adminAnalyticsPage, /Shipping margin/);
assert.match(adminAnalyticsPage, /Fulfillment providers/);
assert.match(adminAnalyticsPage, /Paid product contribution/);
assert.match(adminAnalyticsPage, /View→cart/);
assert.match(adminAnalyticsPage, /View→paid/);
assert.match(adminAnalyticsPage, /Needs attention/);
assert.match(adminAnalyticsPage, /Customer value & cohorts/);
assert.match(adminAnalyticsPage, /Revenue attribution/);
assert.match(adminAnalyticsPage, /Frequently bought together/);
assert.match(adminAnalyticsPage, /Best sales times/);
assert.match(adminAnalyticsPage, /Admin activity audit/);
for (const marker of [
  /Business summary & period comparison/,
  /Full operating profit waterfall/,
  /Product opportunity matrix/,
  /Marketing spend, ROAS & CAC/,
  /Customer retention/,
  /Goals & forecast-to-target/,
  /Bundle suggestions/,
  /Margin simulator/,
  /Shipping leakage/,
  /Order SLA scorecard/,
  /Supplier cost & price-change alerts/,
  /FX exposure/,
  /Anomaly detection/,
  /Live shop health/,
  /Data quality/,
  /Customer geography/,
  /Hour × day heatmap/,
  /Product lifecycle trends/,
  /Business annotations/,
  /Admin security & sessions/
]) assert.match(adminAnalyticsPage, marker);
assert.match(adminAnalyticsEdge, /_require_valid_admin_session/);
assert.match(adminAnalyticsEdge, /shop_product_cost_cache_v841/);
assert.match(adminAnalyticsEdge, /shop_finance_ledger_v841/);
assert.match(adminAnalyticsEdge, /operationalBreakdown/);
assert.match(adminAnalyticsEdge, /repeat_customer_rate/);
assert.match(adminAnalyticsEdge, /known_shipping_margin_cents/);
assert.match(adminAnalyticsEdge, /shop_admin_audit_v842/);
assert.match(adminAnalyticsEdge, /intelligenceBreakdown/);
assert.match(adminAnalyticsEdge, /marginRisk/);
assert.match(adminAnalyticsEdge, /repeat_purchase_sales_cents/);
assert.match(adminAnalyticsEdge, /basket_pairs/);
assert.match(adminAnalyticsEdge, /sales_timing/);
assert.match(adminAnalyticsEdge, /attribution/);
assert.match(adminAnalyticsEdge, /order_created/);
assert.match(adminAnalyticsEdge, /buildGrowthIntelligence/);
assert.match(adminAnalyticsEdge, /recordPriceCostHistory/);
assert.match(adminAnalyticsEdge, /campaign_spend_add/);
assert.match(adminAnalyticsEdge, /goal_upsert/);
assert.match(adminAnalyticsEdge, /annotation_add/);
for (const marker of [
  /productOpportunities/,
  /retentionMetrics/,
  /slaMetrics/,
  /shippingLeakage/,
  /hour_day_heatmap/,
  /product_lifecycle/,
  /campaign_performance/,
  /country_funnel/,
  /forecast_value/,
  /supplier_cost_alerts/,
  /fx_history/,
  /data_quality/,
  /weeklyMonthlySummary/
]) assert.match(analyticsGrowthV843, marker);
for (const marker of [/shop_campaign_spend_v843/,/shop_goals_v843/,/shop_annotations_v843/,/shop_price_cost_history_v843/]) {
  assert.match(analyticsGrowthSchemaV843, marker);
}
assert.match(adminAnalyticsPage, /Export CSV/);
assert.match(adminGrowthUiV843, /campaign_spend_add/);
assert.match(adminGrowthUiV843, /goal_upsert/);
assert.match(adminGrowthUiV843, /annotation_add/);
assert.match(adminGrowthUiV843, /geoMap/);
assert.match(adminGrowthUiV843, /heatmap/);
assert.match(adminGrowthUiV843, /margin simulator|simProduct/i);
assert.match(adminGrowthUiV843, /Payment fees/);
assert.match(adminGrowthUiV843, /Refunds/);
assert.match(adminGrowthUiV843, /VAT \/ tax reserve/);
assert.match(adminEdge, /shop_admin_audit_v842/);
assert.match(analyticsSchema, /shop_finance_ledger_v841/);
assert.match(analyticsSchema, /shop_product_cost_cache_v841/);
assert.match(analyticsSchema, /revoke all on function public\.shop_admin_analytics_snapshot_v841/);
for (const table of ['site_visitors','site_visit_sessions','site_visitor_events','shop_admin_audit_v842']) {
  assert.match(analyticsSecurityV842, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
}
assert.match(analyticsSecurityV842, /revoke all on table public\.shop_admin_audit_v842 from public, anon, authenticated/i);
assert.match(analyticsSecurityV842, /grant select, insert, update, delete on table public\.shop_admin_audit_v842 to service_role/i);
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

// Main deployment check validates the v839 customer shell and all authoritative
// shop functions while remaining read-only: it never creates an order in CI.
assert.match(liveHealthWorkflow, /node check-live-shop\.mjs/);
assert.match(deployWorkflow, /supabase\/functions\/shop-catalog-v828\/\*\*/);
assert.match(deployWorkflow, /supabase\/functions\/shop-manual-checkout-v832\/\*\*/);
assert.match(deployWorkflow, /supabase\/functions\/shop-delivery-preview-v833\/\*\*/);
assert.match(deployWorkflow, /supabase\/functions\/shop-admin-analytics-v843\/\*\*/);
assert.match(deployWorkflow, /functions deploy "\$function_name"/);
assert.match(deployWorkflow, /deploy_function shop-catalog-v828/);
assert.match(deployWorkflow, /deploy_function shop-manual-checkout-v832/);
assert.match(deployWorkflow, /deploy_function shop-delivery-preview-v833/);
assert.match(deployWorkflow, /deploy_function shop-admin-analytics-v843/);
assert.doesNotMatch(deployWorkflow, /functions deploy shop-manual-checkout-v828/);
assert.doesNotMatch(catalogEdge, /jellyfish[\s\S]{0,120}media\.slice\(1\)/i);
assert.match(liveShopCheck, /20260916-storefront-v837-r1/);
assert.match(liveShopCheck, /20260916-delivery-v840-r1/);
assert.match(liveShopCheck, /customer-facing-checkout-v837/);
assert.match(liveShopCheck, /Total incl\\\. shipping|Total incl\. shipping/);
assert.match(liveShopCheck, /delivery-estimate-v833/);
assert.match(liveShopCheck, /direct-commerce-v832/);
assert.match(liveShopCheck, /storefront-polish-v832/);
assert.match(liveShopCheck, /gallery-fixes-v832/);
assert.match(liveShopCheck, /mockup-transparency-v832/);
assert.match(liveShopCheck, /image-lightbox-v832/);
assert.match(liveShopCheck, /shop-catalog-v828/);
assert.match(liveShopCheck, /shop-manual-checkout-v832/);
assert.match(liveShopCheck, /RESULT=V839_BRUIS_SHOP_PASS/);
assert.match(liveShopCheck, /Deliberately read-only/);
assert.doesNotMatch(liveShopCheck, /method:\s*['"]POST['"]/);

// Customer-facing shop sources must not expose supplier/factory wording. The v837
// compatibility layer is excluded here because it intentionally contains the old
// words only as search patterns so it can rewrite stale cached copy before display.
assert.doesNotMatch([index, directCommerce, deliveryEstimate, manualCheckout, storefrontPolish, store].join('\n'), /printify|factor(?:y|ies)/i);
assert.match(storefrontCss + styles, /position:\s*fixed/);
assert.match(styles, /\.cart-button[\s\S]*z-index:\s*1200/);
assert.doesNotMatch(catalogEdge, /MIN_RETAIL_CENTS/);
assert.doesNotMatch(checkoutEdge, /MIN_RETAIL_CENTS/);

console.log('Shop commerce v839 tote-handle-color + Bruis-copy + shipping-total + sticky-cart + cost-plus-5 contract passed.');
