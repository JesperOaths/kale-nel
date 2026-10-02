#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { applyPrintifyVatReserveEurCents, CLASSIC_SHIRT_RETAIL_CENTS, parseEcbUsdRate, PRINTIFY_VAT_RESERVE_BPS, retailEurCentsFromUsdCost, retailEurCentsFromUsdCostAfterVat, stableClassicShirtRetailEurCents, usdCentsToEurCents } from './supabase/functions/_shared/shop-fx.mjs';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const sitePageVersion = read('VERSION').trim();
assert.match(sitePageVersion,/^v\d+$/,'root VERSION must remain a simple v### page identity');
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
const bunqProductionEdge = read('supabase/functions/shop-bunq-production-v1/index.ts');
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
const cancelDeleteMigration = read('supabase/migrations/20260927040500_shop_order_retroactive_cancel_delete.sql');
const bunqFundingMigration = read('supabase/migrations/20260927024500_shop_bunq_production_funding_v1.sql');
const liveShopCheck = read('check-live-shop.mjs');
const liveHealthWorkflow = read('.github/workflows/live-deployment-health.yml');
const deployWorkflow = read('.github/workflows/deploy-shop-fixes-v829.yml');
const store = read('shop/store.js');
const catalogLastGood = read('shop/catalog-last-good.js');
const refresh = read('shop/live-catalog-refresh-v818.js');
const legacyRefresh = read('shop/live-catalog-refresh-v817.js');

// v839 keeps the Bruis checkout behavior and adds exact tote handle-color selection,
// uses a VAT-reserved production cost + €5 shirt margin, and exposes a final total
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
assert.ok(index.includes(`GEJAST_PAGE_VERSION='${sitePageVersion}'`),'shop page declaration must follow root VERSION rather than feature-release provenance');
assert.ok(index.includes(`>${sitePageVersion} - Made by Bruis</span>`),'shop visible watermark must follow root VERSION rather than feature-release provenance');
assert.match(index, /data-animal-filter/);
assert.match(index, /data-animal-section/);
const regularGridPos = index.indexOf('data-products');
const animalFilterPos = index.indexOf('data-animal-filter-bar');
const animalSectionPos = index.indexOf('data-animal-section');
assert.ok(regularGridPos >= 0 && animalFilterPos > regularGridPos && animalSectionPos > animalFilterPos, 'animal toggle must sit after the non-animal grid and immediately before the animal section');
assert.match(store, /bruisCatalogLastGoodV2/, 'pricing-policy changes must invalidate stale browser catalog caches');
assert.match(store, /CLASSIC_SHIRT_PRICE_BY_SIZE/, 'browser rendering must normalize classic-shirt prices even if a stale upstream snapshot drifts');
assert.match(store, /S:24, M:24, L:24, XL:24, '2XL':26, '3XL':30, '4XL':30, '5XL':30/, 'browser classic-shirt schedule must match server canonical pricing');
assert.match(store, /price: baseKey === '6' && variantPrices\.length \? Math\.min/, 'classic-shirt card price must derive from normalized canonical variant prices');
assert.doesNotMatch(store, /bruisCatalogLastGoodV1/, 'old browser catalog cache key must not remain active');
assert.match(index, /catalog-last-good\.js\?v=20261002-stable-pricing-r7/, 'fallback catalog asset must be cache-busted after canonical pricing repair');
assert.match(index, /store\.js\?v=20261002-static-first-r11/, 'store runtime must publish the resilient deterministic static-first revision');
assert.match(index, /live-catalog-refresh-v818\.js\?v=20261002-cross-tab-r6/, 'shop must publish the current hard-throttled cross-tab refresh revision');
assert.match(refresh, /__BRUIS_LIVE_CATALOG_REFRESH_V818_R5__/, 'live catalog reconciliation must be singleton-guarded inside a tab');
assert.match(refresh, /POLL_MS = 30 \* 60 \* 1000/, 'live catalog reconciliation must remain low-frequency');
assert.match(refresh, /SHARED_MIN_REFRESH_MS = 20 \* 60 \* 1000/, 'multiple tabs must share a long refresh lease');
assert.match(refresh, /navigator\.onLine === false/, 'offline storefronts must not generate live catalog traffic');
assert.match(store, /function staticCatalogSnapshot\(\)/, 'storefront must expose a deterministic local snapshot normalizer');
assert.match(store, /const synchronousStaticCatalog = staticCatalogSnapshot\(\)/, 'storefront must materialize the static catalog synchronously before any live request');
assert.match(store, /applyInitialCatalog\(\{ products:synchronousStaticCatalog, source:'static-snapshot-sync' \}\)/, 'static catalog must render synchronously without waiting for Supabase');
assert.match(store, /function readCartSafe\(\)/, 'corrupt browser cart state must not abort the storefront before the static catalog renders');
assert.match(store, /localStorage\.removeItem\(cartKey\)/, 'invalid saved cart JSON must be discarded safely');
assert.match(store, /cache: 'default'/, 'background catalog reconciliation must allow browser HTTP caching instead of forcing no-store');
assert.match(refresh, /const POLL_MS = 30 \* 60 \* 1000;/, 'live catalog reconciliation must not poll more often than every 30 minutes');
assert.match(refresh, /const FIRST_POLL_MS = 15 \* 60 \* 1000;/, 'live catalog reconciliation must stay well off initial render');
assert.match(refresh, /const SHARED_MIN_REFRESH_MS = 20 \* 60 \* 1000;/, 'multiple shop tabs must share a long refresh floor');
assert.doesNotMatch(legacyRefresh, /POLL_MS = 30 \* 1000/, 'legacy v817 refresher must never retain the old 30-second Supabase poll');
assert.match(legacyRefresh, /POLL_MS = 30 \* 60 \* 1000/, 'legacy v817 refresher must be harmless even when stale HTML still loads it');
assert.match(legacyRefresh, /FIRST_POLL_MS = 15 \* 60 \* 1000/, 'legacy v817 refresher must stay off first paint');
assert.match(catalogEdge, /const MEMORY_ROW_TTL_MS = 30 \* 60_000;/, 'catalog edge function must keep the large catalog row hot in-isolate for thirty minutes');
assert.match(catalogEdge, /max-age=300, s-maxage=300, stale-while-revalidate=1800/, 'catalog responses must use browser + shared-cache freshness with stale-while-revalidate to absorb stale-tab polling');
assert.match(store, /ANIMAL_DESIGN_NAMES/);
assert.match(store, /let showAnimalDesigns = true/);
assert.match(store, /function isAnimalDesign\(product\)/);
assert.match(store, /data-subject-kind/);
assert.match(store, /animalList\.map\(product => productCardHtml/);
assert.match(store, /const animalList = fullList[\s\S]*?\.filter\(isAnimalDesign\)[\s\S]*?localeCompare/, 'animal designs must sort alphabetically by name instead of by price');
assert.match(styles, /\.animal-designs-section/);
assert.match(styles, /\.animal-filter-switch/);
assert.match(styles, /\.product-grid\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/, 'desktop product sections must use six half-card tracks so incomplete rows can stagger beneath the gaps above');
assert.match(styles, /\.product-grid > \.product-card[\s\S]*grid-column:\s*span 2/, 'normal desktop cards must span two half-card tracks');
assert.match(styles, /last-child:nth-child\(3n \+ 1\)[\s\S]*grid-column:\s*3 \/ span 2/, 'a one-item desktop last row must be exactly centered');
assert.match(styles, /nth-last-child\(2\):nth-child\(3n \+ 1\)[\s\S]*grid-column:\s*2 \/ span 2/, 'the first of two remaining desktop products must sit beneath the first gap of the row above');
assert.match(styles, /last-child:nth-child\(3n \+ 2\)[\s\S]*grid-column:\s*4 \/ span 2/, 'the second of two remaining desktop products must sit beneath the second gap of the row above');
assert.match(styles, /last-child:nth-child\(2n \+ 1\)[\s\S]*grid-column:\s*1 \/ -1[\s\S]*justify-self:\s*center/, 'a single tablet last-row item must be centered');
assert.match(styles, /@media \(min-width: 901px\)/, 'exact desktop incomplete-row placement must be scoped to desktop');
assert.match(styles, /@media \(max-width: 900px\)[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/, 'tablet product rows must use two columns');
assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.product-grid \{ grid-template-columns: 1fr; \}/, 'mobile product rows must collapse to one column');
assert.match(index, /data-open-size-guide/);
assert.match(index, /data-size-guide-panel/);
assert.match(index, /data-size-guide-overlay/);
assert.match(index, /data-size-guide-visual/);
assert.match(store, /size-guide-classic\.svg/);
assert.doesNotMatch(store, /size-guide-boxy\.svg/, 'boxy size guide must not be part of the active storefront');
assert.match(store, /function openSizeGuide\(\)/);
assert.match(store, /function closeSizeGuide\(\)/);
assert.match(index, /20260916-storefront-v837-r1/);
assert.match(index, /shop-analytics-v841\.js\?v=20260920-shop-analytics-v841-r1/);
assert.match(index, /20260926-delivery-v871-r1/);
assert.match(index, /20260916-storefront-v837-r2/);
assert.match(index, /20260926-checkout-v871-r1/);
assert.match(index, /storefront-polish-v832\.css/);
assert.match(index, /storefront-polish-v832\.js/);
assert.match(index, /product-preview-overrides\.js/);
assert.match(index, /gallery-fixes-v832\.js/);
assert.match(index, /mockup-transparency-v832\.js/);
assert.match(index, /collection-media-v831\.js/);
assert.doesNotMatch(index, /data-collection="boxy"/, 'storefront must expose only normal and merch collections');
assert.match(index, /data-collection="normal"/);
assert.match(index, /data-collection="merch"/);
assert.doesNotMatch(store, /label:\s*'Oversized Boxy'/);
assert.match(store, /label:\s*'Normal'/);
assert.match(index, /image-lightbox-v832\.js/);
assert.match(index, /live-catalog-refresh-v818\.js\?v=20261002-cross-tab-r6/, 'storefront must publish the hard-throttled cross-tab live-catalog watcher');
assert.doesNotMatch(index, /catalog-data\.js/, 'retired hand-maintained catalog-data fallback must not load');
assert.match(index, /catalog-last-good\.js\?v=20261002-stable-pricing-r7/, 'storefront must preload the current generated last-known-good catalog before store.js');
assert.match(store, /shop-catalog-v828/, 'storefront must retain the live Printify-backed catalog authority');
assert.match(store, /source: 'static-snapshot'/, 'generated catalog snapshot must be the deterministic first-paint source');
assert.doesNotMatch(store, /result\?\.source === 'cache'[\s\S]*?refreshLiveCatalog/, 'initial render must not immediately hit Supabase for a valid browser cache');
assert.match(store, /BRUIS_CATALOG_LAST_GOOD/, 'storefront must have a generated read-only last-good rendering fallback');
assert.match(store, /source: 'static-snapshot'/, 'deployment snapshot must be labelled separately from live/cache authority');
assert.doesNotMatch(store, /refreshLiveCatalog\(1\)\.then\(replaceCatalogFromLive\)/, 'initial storefront bootstrap must not duplicate the dedicated background live-catalog watcher');
assert.match(refresh, /window\.setTimeout\(checkCatalog, FIRST_POLL_MS\)/, 'live reconciliation must be owned by the bounded background watcher');
assert.doesNotMatch(store, /catalog\.json/, 'storefront must not revive legacy JSON catalog fallbacks');
assert.match(catalogLastGood, /window\.BRUIS_CATALOG_LAST_GOOD=/, 'generated last-good snapshot must expose the dedicated immutable browser object');
const snapshotMatch=catalogLastGood.match(/window\.BRUIS_CATALOG_LAST_GOOD=(\{.*\});\}\)\(\);/s);
assert.ok(snapshotMatch,'generated catalog snapshot payload must remain parseable');
const snapshot=JSON.parse(snapshotMatch[1]);
assert.ok(Array.isArray(snapshot.products)&&snapshot.products.length>=20,'last-good snapshot must contain a useful complete storefront surface');
assert.equal(snapshot.source,'shop_catalog_cache_v828','last-good snapshot provenance must point to the authoritative v828 cache');
assert.match(store, /baseLabel:\s*publicBaseLabel\(raw\.baseLabel, baseKey\)/, 'storefront must sanitize supplier base labels before display');
assert.match(store, /function publicBaseLabel\(value, baseKey\)/, 'storefront must retain customer-facing base-label sanitizer');
assert.doesNotMatch(index, /Gildan|Comfort Colors/i, 'public shop HTML must not expose third-party T-shirt branding');
assert.doesNotMatch(store, /Gildan|Comfort Colors/i, 'public storefront runtime must not contain third-party T-shirt branding');
assert.doesNotMatch(index, /direct-commerce-v828\.js|mockup-background-v830\.js|image-lightbox-v830\.js/);
assert.doesNotMatch(index, /shop-runtime-v819\.js|catalog-recovery-v822\.js|payment-readiness-v824\.js|shopify-checkout-v817\.js/);

// Browser bridge routes the public catalog to the hardened Bruis catalog endpoint,
// checkout to the cost-based authority, and injects the non-blocking delivery panel.
assert.match(directCommerce, /shop-catalog-v828/);
assert.match(directCommerce, /shop-manual-checkout-v832/);
assert.match(directCommerce, /delivery-estimate-v833\.js/);
assert.match(directCommerce, /shop-delivery-preview-v833/);
assert.match(directCommerce, /legacyFetchBridge:false/);
assert.doesNotMatch(directCommerce, /window\.fetch\s*=/, 'active commerce helper must not intercept network requests');
assert.match(directCommerce, /pricing:'shirt-production-cost-plus-max-printify-vat-plus-size-margin-rounded-up'/);
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
assert.match(checkoutEdge, /function cachedShopId/, 'checkout must resolve current per-product Printify shop ids');
assert.match(deliveryPreviewEdge, /function cachedShopId/, 'delivery preview must resolve current per-product Printify shop ids');
assert.match(checkoutEdge, /validation_only/, 'checkout must expose a non-ordering production validation path');
assert.match(catalogEdge, /gildanRouteSafeCostCeilings/, 'catalog must price Gildan variants against the most expensive approved hybrid provider');
assert.match(catalogEdge, /stableClassicShirtRetailEurCents/, 'classic-shirt catalog prices must use the FX-stable canonical schedule');
assert.match(checkoutEdge, /stableClassicShirtRetailEurCents/, 'checkout must use the same FX-stable classic-shirt schedule');
assert.deepEqual(CLASSIC_SHIRT_RETAIL_CENTS, { S:2400, M:2400, L:2400, XL:2400, '2XL':2600, '3XL':3000, '4XL':3000, '5XL':3000 });
assert.equal(stableClassicShirtRetailEurCents(1693, 0.8851124093, 'M', 500, 700), 2400, 'minor FX movement must not push standard classic shirts from €24 to €25');
assert.equal(stableClassicShirtRetailEurCents(1864, 0.8851124093, '2XL', 500, 700), 2600, '2XL classic shirts must remain €26 at current provider-pair cost');
assert.equal(stableClassicShirtRetailEurCents(2050, 0.8851124093, '4XL', 500, 700), 3000, '4XL classic shirts must remain €30 within the configured tolerance');
assert.match(catalogEdge, /source_variant_id,source_cost_usd_cents,target_cost_usd_cents/, 'classic-shirt catalog pricing must use the canonical provider-pair snapshots');
assert.match(catalogEdge, /routeSafeCostCeilings\.get\(String\(variant\?\.id/, 'classic-shirt price lookup must be variant-based rather than product-id-based');
assert.match(catalogEdge, /canonicalRouteCost > 0 \? canonicalRouteCost : Math\.round\(Number\(variant\?\.cost\)/, 'canonical classic-shirt provider-pair cost must override product-specific source-provider cost when available');
assert.doesNotMatch(catalogEdge, /deltaAdjusted|current\s*\+\s*delta/, 'catalog pricing must never add a historical provider delta to a current product cost');
assert.match(checkoutEdge, /const itemProviderRoutes = providerRoutes\.filter/, 'checkout must resolve the same provider pair for each classic-shirt variant');
assert.match(checkoutEdge, /routeSnapshotCosts[\s\S]*?source_cost_usd_cents[\s\S]*?target_cost_usd_cents/, 'checkout must price classic shirts from the canonical provider-pair snapshots');
assert.doesNotMatch(fulfillmentRouting, /deltaAdjusted/, 'checkout routing must not double-count historical provider deltas');
assert.doesNotMatch(deliveryPreviewRouting, /deltaAdjusted/, 'delivery preview routing must not double-count historical provider deltas');
assert.match(checkoutEdge, /routeSafeRawUsdCost/, 'checkout must preserve the advertised shirt margin across hybrid provider changes');
assert.match(checkoutEdge, /\.from\("shop_provider_routes_v1"\)/, 'checkout must evaluate approved direct-provider routes');
assert.match(deliveryPreviewEdge, /\.from\("shop_provider_routes_v1"\)/, 'delivery preview must evaluate the same direct-provider routes');
assert.match(checkoutEdge, /\.eq\("approved", true\)/, 'checkout direct-provider routes must require explicit approval');
assert.match(deliveryPreviewEdge, /\.eq\("approved", true\)/, 'preview direct-provider routes must require explicit approval');
assert.match(checkoutEdge, /validateDirectProviderRoute\(/, 'checkout must validate direct provider identity, variant and reusable artwork');
assert.match(deliveryPreviewEdge, /validateDirectProviderRoute\(/, 'preview must validate the same direct provider route');
assert.match(checkoutEdge, /clone-free-direct-provider-plus-canonical/, 'checkout must advertise clone-free routing');
assert.doesNotMatch(checkoutEdge, /shop_fulfillment_mappings/, 'checkout must not depend on hidden Printify product mappings');
assert.doesNotMatch(deliveryPreviewEdge, /shop_fulfillment_mappings/, 'preview must not depend on hidden Printify product mappings');
assert.match(deliveryPreviewEdge, /for \(let attempt = 1; attempt <= 2; attempt \+= 1\)/, 'server-side Printify quote calls must retry transient stream failures');
assert.match(checkoutEdge, /for \(let attempt = 1; attempt <= 2; attempt \+= 1\)/, 'checkout Printify reads and quote calls must retry transient stream failures');
assert.match(deliveryPreviewEdge, /fallback:\s*true/, 'nonessential shipping-breakdown failures must not discard a valid shipping total');
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

// Delivery authority keeps one canonical product per design and quotes
// approved alternate providers directly by blueprint/provider/variant.
assert.match(deliveryPreviewEdge, /CHOICE_PROVIDER_ID = 99/);
assert.match(deliveryPreviewEdge, /shop_provider_routes_v1/);
assert.match(deliveryPreviewEdge, /validateDirectProviderRoute/);
assert.match(deliveryPreviewEdge, /direct_provider/);
assert.match(deliveryPreviewEdge, /chooseCheapestFulfillment/);
assert.match(deliveryPreviewEdge, /catalog\/print_providers/);
assert.match(deliveryPreviewEdge, /printifyV2/);
assert.match(deliveryPreviewEdge, /Bruis production network/);
assert.match(deliveryPreviewEdge, /fallback_min_business_days/);
assert.match(deliveryPreviewEdge, /exact_for_selected_route/);
assert.match(deliveryPreviewEdge, /strictCountry/);
assert.match(deliveryPreviewRouting, /function validateDirectProviderRoute/);
assert.match(deliveryPreviewRouting, /source_artwork_not_order_reusable/);
assert.match(deliveryPreviewRouting, /target_cost_snapshot_unavailable/);
assert.match(deliveryPreviewRouting, /function chooseCheapestFulfillment/);
assert.doesNotMatch(deliveryPreviewEdge, /shop_fulfillment_mappings/);

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
assert.match(storefrontCss, /--shop-image-backdrop:\s*transparent/, 'active media backdrop must itself be transparent');
assert.match(storefrontCss, /\.mockup img[\s\S]*background:\s*transparent !important/);
assert.match(galleryFixes, /\.mockup-rail\{[\s\S]*background:transparent!important/, 'gallery rail must not reintroduce a beige image field');
assert.match(directCommerce, /\.mockup-rail\{background:transparent!important/, 'commerce bridge must preserve transparent media rails');
assert.match(directCommerce, /\.cart-line img\{object-fit:contain!important;background:transparent!important/, 'cart shirt thumbnails must remain transparent');
assert.match(styles, /\.mockup-rail\s*\{[\s\S]*background:\s*transparent/, 'base product rail must be transparent');
assert.match(styles, /\.cart-line img[^{]*\{[^}]*background:\s*transparent/, 'base cart shirt thumbnail must be transparent');
assert.match(mockupTransparency, /function subjectSpans/);
assert.match(mockupTransparency, /function applyTransparency/);
assert.match(mockupTransparency, /data\[index\*4\+3\]=0/);
assert.match(mockupTransparency, /preservesWhiteGarments:true/);
assert.match(mockupTransparency, /tagViewIncluded:true/);
assert.match(mockupTransparency, /allProductMockups:true/);
assert.match(mockupTransparency, /safeFallbackToOriginal:true/);
assert.match(mockupTransparency, /noOneSidedSpanBridge:true/);
assert.match(mockupTransparency, /function outputLooksSafe/);
assert.match(mockupTransparency, /function cropBounds/, 'transparent whitespace must be cropped after background removal');
assert.match(mockupTransparency, /cropsTransparentWhitespace:true/, 'transparency policy must declare whitespace cropping');
assert.match(mockupTransparency, /eager:true/, 'all rendered mockups must start processing without waiting for scroll');
assert.match(mockupTransparency, /MAX_CONCURRENT=4/, 'eager processing must remain concurrency bounded');
assert.doesNotMatch(mockupTransparency, /new IntersectionObserver/, 'mockup processing must not be gated on viewport visibility');
assert.match(mockupTransparency, /const isRaster=url=>\/\^https\?:\/i\.test\(url\)/, 'transparency processor must accept trusted extensionless catalog image URLs');
assert.match(mockupTransparency, /createImageBitmap\(blob\)/, 'browser image decoding must decide supported image formats instead of URL suffixes or MIME metadata');
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
assert.equal(PRINTIFY_VAT_RESERVE_BPS, 2700);
assert.equal(applyPrintifyVatReserveEurCents(1439), 1828);
assert.equal(retailEurCentsFromUsdCostAfterVat(1661, ecbSample.usd_eur, 500), 2400);
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

// Catalog pricing is derived from fulfillment cost, not retail price.
// Classic blueprint-6 shirts use the route-safe provider-pair cost plus the stable
// size schedule with a small tolerance against FX noise; other shirts retain the
// VAT-reserved cost+margin path. Non-shirt products keep cost+margin pricing.
// Original front artwork from print_areas is inserted before generated garment mockups.
assert.match(catalogEdge, /const MARGIN_CENTS = 500/);
assert.match(catalogEdge, /const LARGE_SIZE_MARGIN_CENTS = 700/);
assert.match(catalogEdge, /marginEurCentsForSize/);
assert.match(catalogEdge, /resolveUsdEurRate/);
assert.match(catalogEdge, /retailEurCentsFromUsdCostAfterVat/);
assert.match(catalogEdge, /const routeSafeRawUsdCost =/);
assert.match(catalogEdge, /String\(product\?\.blueprint_id \|\| ""\) === "6"[\s\S]*?stableClassicShirtRetailEurCents\([\s\S]*?routeSafeRawUsdCost,[\s\S]*?fx/);
assert.match(catalogEdge, /isShirtProduct\(product\)[\s\S]*?retailEurCentsFromUsdCostAfterVat/);
assert.match(catalogEdge, /retailEurCentsFromUsdCost\([\s\S]*?routeSafeRawUsdCost/);
assert.match(catalogEdge, /sourceCurrency:\s*"USD"/);
assert.match(catalogEdge, /displayCurrency:\s*"EUR"/);
assert.doesNotMatch(catalogEdge, /priceEuros\(variant\?\.price\)/);
assert.match(catalogEdge, /function artworkFor/);
assert.match(catalogEdge, /product\?\.print_areas/);
assert.match(catalogEdge, /label:\s*"Artwork PNG"/);
assert.match(catalogEdge, /const mockups = \[\.\.\.artwork, \.\.\.garment\]/);
assert.match(catalogEdge, /source:\s*"printify-live-v851"/);
assert.match(catalogEdge, /mode:\s*"bruis-direct-catalog-v838"/);
assert.match(catalogEdge, /pricing:\s*"shirt-production-cost-plus-max-printify-vat-plus-size-margin-rounded-up"/);
assert.match(catalogEdge, /pricingBase:\s*"production-cost-plus-printify-vat-reserve"/);
assert.match(catalogEdge, /threeXlPlus:\s*LARGE_SIZE_MARGIN_CENTS \/ 100/);
assert.match(catalogEdge, /rounding:\s*"whole-euro-ceiling"/);
assert.match(catalogEdge, /artworkFirst:\s*true/);
assert.match(catalogEdge, /whiteVariantsOnly:\s*false/);
assert.match(catalogEdge, /toteHandleColors:\s*\["Black", "White"\]/);
assert.match(catalogEdge, /isPublicVariant/);
assert.match(catalogEdge, /HIDDEN_PUBLIC_PRODUCT_IDS/, 'catalog must use explicit retirement ids instead of the upstream publishing flag');
assert.match(catalogEdge, /6ab0fa9a0b770861f80da032/, 'retired Bearded Dragon alternate artwork must remain hidden');
assert.doesNotMatch(catalogEdge, /entry\.product\?\.visible\s*!==\s*false/, 'custom Bruis storefront must not require Printify sales-channel publication');
assert.match(catalogEdge, /const deduped = new Map/, 'catalog must collapse duplicate design/base records');
assert.match(catalogEdge, /products:\s*publicProducts/, 'catalog response must use the deduplicated public article set');
assert.match(catalogEdge, /variantIds/);
assert.match(catalogEdge, /EdgeRuntime\.waitUntil/);
assert.match(catalogEdge, /function versionedMockupUrl/);
assert.match(catalogEdge, /url\.searchParams\.set\("kv", String\(stamp\)\)/);
assert.match(catalogEdge, /versionedMockupUrl\(text\(image\?\.src\), product\?\.updated_at\)/);
assert.match(catalogEdge, /get_printify_api_token_v815a/);
assert.doesNotMatch(catalogEdge, /shop-price-v818|shop-catalog-v822|cdn\.shopify\.com/);

// Checkout re-fetches the exact selected supplier product/variant and applies the
// same size-tiered cost+margin rounded-up rule server-side, so the displayed and charged prices
// cannot diverge. Customer checkout still only creates a Pending local order.
assert.match(checkoutEdge, /mode:\s*"manual-payment-v832"/);
assert.match(checkoutEdge, /pricing:\s*"shirt-production-cost-plus-max-printify-vat-plus-size-margin-rounded-up"/);
assert.match(checkoutEdge, /pricingBase:\s*"production-cost-plus-printify-vat-reserve"/);
assert.match(checkoutEdge, /threeXlPlus:\s*LARGE_SIZE_MARGIN_CENTS \/ 100/);
assert.match(checkoutEdge, /rounding:\s*"whole-euro-ceiling"/);
assert.match(checkoutEdge, /const MARGIN_CENTS = 500/);
assert.match(checkoutEdge, /const LARGE_SIZE_MARGIN_CENTS = 700/);
assert.match(checkoutEdge, /marginEurCentsForSize/);
assert.match(checkoutEdge, /resolveUsdEurRate/);
assert.match(checkoutEdge, /retailEurCentsFromUsdCost/);
assert.match(checkoutEdge, /marginEurCentsForSize\(variantSize, MARGIN_CENTS, LARGE_SIZE_MARGIN_CENTS\)/);
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
assert.match(checkoutEdge, /shop_provider_routes_v1/);
assert.match(checkoutEdge, /validateDirectProviderRoute/);
assert.match(checkoutEdge, /buildFulfillmentPlans/);
assert.match(checkoutEdge, /chooseCheapestFulfillment/);
assert.match(checkoutEdge, /mapWithConcurrency\(plans, 4/, 'checkout shipping quotes must be bounded-concurrent to avoid slow sequential stream timeouts');
assert.match(deliveryPreviewEdge, /mapWithConcurrency\(plans, 4/, 'delivery preview shipping quotes must be bounded-concurrent to avoid slow sequential stream timeouts');
assert.match(manualCheckout, /attempt<=3/, 'customer checkout must retry transient network failures three times');
assert.match(deliveryEstimate, /attempt<=3/, 'delivery preview must retry transient network failures three times');
assert.match(checkoutEdge, /direct_provider/);
assert.match(checkoutEdge, /catalog_printify_product_id/);
assert.match(fulfillmentRouting, /function cheapestShippingQuote/);
assert.match(fulfillmentRouting, /a\.cents - b\.cents/);
assert.match(fulfillmentRouting, /function validateDirectProviderRoute/);
assert.match(fulfillmentRouting, /source_artwork_not_order_reusable/);
assert.match(fulfillmentRouting, /target_cost_snapshot_unavailable/);
assert.match(fulfillmentRouting, /preVatRouteTotal/);
assert.doesNotMatch(checkoutEdge, /let shippingMethod = "standard"/);
assert.match(checkoutEdge, /payment_reference/);
assert.match(checkoutEdge, /checkout_idempotency_key/);
assert.match(checkoutEdge, /RESEND_API_KEY/);
assert.match(checkoutEdge, /sends_to_production:\s*false/);
assert.doesNotMatch(checkoutEdge, /send_to_production\.json|STRIPE_SECRET|stripe\.com/i);

// Buyer UI remains capability-token based and customer-facing.
assert.match(manualCheckout, /shop-manual-checkout-v832/);
assert.match(manualCheckout, /async function postCheckoutWithRetry\(payload\)/, 'checkout UI must retry transient failures using the same idempotency attempt');
assert.match(deliveryEstimate, /async function fetchPreview\(payload\)/, 'delivery UI must retry transient quote failures');
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
assert.match(adminPage, /admin-session-sync\.js/, 'order admin must load the loop-safe session runtime');
assert.match(adminPage, /loadPromise/, 'order admin list refreshes must be deduplicated');
assert.match(adminPage, /actionInFlight/, 'order admin must not rerender while verify/reject/submit actions are in flight');
assert.match(adminPage, /Payment for \$\{row\.payment_reference\} verified/, 'successful verification must be visibly acknowledged');
assert.match(adminPage, /submit_printify/);
assert.match(adminEdge, /resolveCurrentProductionItems/, 'production submit must revalidate the selected direct-provider route at send time');
assert.match(adminEdge, /shop_provider_routes_v1/, 'production must use the approved direct-provider route table');
assert.match(adminEdge, /\.eq\("approval_id",approvalId\)/, 'production must pin the exact provider route chosen and quoted at checkout');
assert.match(adminEdge, /changed after checkout\. Revalidate shipping before production/, 'production must fail closed instead of silently switching to an unquoted route');
assert.match(adminEdge, /print_provider_id:Number\(providerRoute\.target_print_provider_id\)/, 'production must submit the selected provider directly in the order line item');
assert.match(adminEdge, /blueprint_id:Number\(providerRoute\.source_blueprint_id\)/, 'production must submit the canonical blueprint directly');
assert.match(adminEdge, /print_areas:printAreas/, 'production must submit reusable artwork directly without a duplicate product');
assert.match(adminEdge, /p\?\.errors\?\.reason\|\|p\?\.error\|\|p\?\.message/, 'Printify hold reason must win over generic Operation failed text');
assert.match(adminEdge, /\["pending","on-hold","payment-not-received","has-issues"\]/, 'pre-production Printify statuses must remain paid, not production');
assert.match(adminEdge, /production_notified_at:null/, 'false local production state must clear the premature production notification claim');
assert.match(adminPage, /Production funding — bunq/);
assert.match(adminPage, /bunqApiKey/);
assert.match(adminPage, /shop-bunq-production-v1/);
assert.match(adminPage, /This exact bunq card is saved as the production partner's default payment card/);
assert.match(adminPage, /bunqOnlyConfirmed/);
assert.match(adminPage, /bunqManualApprovalConfirmed/);
assert.match(adminPage, /I approved in bunq — complete production/);
assert.match(adminPage, /production-account balance is not usable/);
assert.match(adminPage, /const canRelease=\(bunqReady\(\)\|\|awaitingBunq\|\|readyForBunqCharge\)&&!!o\.payment_verified_at&&hasEnoughPayment\(o\)/, 'new production requests require bunq readiness while in-progress bunq charge states remain resumable');
assert.match(adminPage, /if\(!bunqReady\(\)&&!\['ready_for_bunq_charge','awaiting_bunq_approval'\]\.includes\(row\.production_charge_state\)\)/, 'submit handler must block new production requests when bunq funding is not ready');
assert.match(adminEdge, /prepareBunqFunding/);
assert.match(adminEdge, /awaiting_bunq_approval/);
assert.match(adminEdge, /production_charge_state/);
assert.match(bunqProductionEdge, /bunq_manual_approval_confirmed/);
assert.match(adminEdge, /action:"prepare_charge"/);
assert.match(adminEdge, /if\(!bunqFunding\.ok\)/, 'Printify send must be blocked when bunq funding preflight fails');
assert.match(bunqProductionEdge, /POST \/installation|\/installation/);
assert.match(bunqProductionEdge, /\/device-server/);
assert.match(bunqProductionEdge, /\/session-server/);
assert.match(bunqProductionEdge, /primary_account_numbers/);
assert.match(bunqProductionEdge, /action==="prepare_charge"/);
assert.match(bunqProductionEdge, /printify_bunq_only_confirmed/);
assert.match(bunqFundingMigration, /printify_bunq_only_confirmed/);
assert.match(bunqProductionEdge, /shop_bunq_set_secret_v1/);
assert.match(bunqProductionEdge, /production_funding_snapshot/);
assert.doesNotMatch(bunqProductionEdge, /console\.log\([^\n]*(apiKey|privatePem|installationToken)/i, 'bunq credentials must never be logged');
assert.match(bunqFundingMigration, /shop_bunq_production_settings_v1/);
assert.match(bunqFundingMigration, /production_charge_requested_at/);
assert.match(bunqFundingMigration, /bunq_manual_approval_confirmed/);
assert.match(bunqFundingMigration, /shop_bunq_production_events_v1/);
assert.match(bunqFundingMigration, /enable row level security/);
assert.match(bunqFundingMigration, /revoke all on table public\.shop_bunq_production_settings_v1 from public, anon, authenticated/);
assert.match(bunqFundingMigration, /revoke all on function public\.shop_bunq_get_secret_v1\(text\) from public, anon, authenticated/);
assert.match(deployWorkflow, /supabase\/functions\/shop-bunq-production-v1\/\*\*/);
assert.match(deployWorkflow, /deploy_function shop-bunq-production-v1/);
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
assert.match(adminEdge, /route\?\.type==="direct_provider"/, 'production must support direct provider orders without product clones');
assert.match(adminEdge, /DESPINOZA_STATIC_TEXT_URL/, 'Despinoza direct orders must replace non-portable native text with static artwork');
assert.doesNotMatch(adminEdge, /\.from\("shop_fulfillment_mappings"\)/, 'production must not depend on clone mappings');
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

assert.match(refresh, /POLL_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/, 'background full-catalog reconciliation must remain at thirty minutes');
assert.match(refresh, /FIRST_POLL_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/, 'first live reconciliation must wait fifteen minutes so static first paint stays independent of Supabase');
assert.match(refresh, /SHARED_MIN_REFRESH_MS\s*=\s*20\s*\*\s*60\s*\*\s*1000/, 'focus/visibility refreshes must share a twenty-minute cross-tab floor');
assert.match(refresh, /SHARED_CHECK_KEY/, 'catalog refreshes must coordinate across tabs rather than multiplying with each open storefront');
assert.doesNotMatch(refresh, /checkCatalog\(true\)/, 'no timer/focus path may bypass the shared refresh floor');
assert.match(catalogEdge, /CACHE_FRESH_MS\s*=\s*60\s*\*\s*60_000/, 'server catalog freshness window must keep a valid catalog off the critical refresh path for one hour');
assert.match(catalogEdge, /REFRESH_FAILURE_COOLDOWN_MS\s*=\s*30\s*\*\s*60_000/, 'failed upstream refreshes must back off for thirty minutes instead of retrying on every stale request');
assert.match(catalogEdge, /refreshFailureCooldown/, 'catalog scheduling must expose and honor failed-refresh cooldown state');
assert.match(catalogEdge, /MEMORY_ROW_TTL_MS\s*=\s*30\s*\*\s*60_000/, 'catalog Edge Function must keep the large JSONB row in-isolate for thirty minutes');
assert.match(catalogEdge, /if\(memoryCatalogRow && Date\.now\(\)-memoryCatalogLoadedAt < MEMORY_ROW_TTL_MS\) return memoryCatalogRow/, 'warm Edge isolates must avoid repeatedly reading the same large catalog row');
assert.match(catalogEdge, /if\(memoryCatalogRow\) return memoryCatalogRow/, 'a previously loaded catalog must remain an availability fallback when PostgREST\/direct DB is under pressure');
assert.match(catalogEdge, /max-age=300, s-maxage=300, stale-while-revalidate=1800/, 'public catalog responses must permit browser/shared-cache reuse and stale-while-revalidate');
assert.match(store, /source: 'static-snapshot'/, 'generated static catalog must be the deterministic first-paint source');
assert.doesNotMatch(store, /result\?\.source === 'cache'[\s\S]*?refreshLiveCatalog/, 'initial render must never immediately call Supabase merely because browser cache exists');
assert.doesNotMatch(refresh, /window\.location\.reload/);
assert.match(store, /const wholeEuro/);
assert.match(store, /price:\s*baseKey === '6' && variantPrices\.length \? Math\.min\(\.\.\.variantPrices\) : wholeEuro\(raw\.price\)/, 'classic-shirt cards must use normalized canonical variant prices while other products keep whole-euro normalization');

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
assert.match(liveShopCheck, /20260926-delivery-v871-r1/);
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
assert.match(liveShopCheck, /Production-safe validation is allowed only through checkout's validation_only/);
assert.match(liveShopCheck, /validation_only:\s*true/, 'live checkout POSTs must be explicitly non-ordering validation smoke tests');
assert.match(liveShopCheck, /Production-safe validation is allowed only through checkout's validation_only/, 'live health must document its non-ordering POST boundary');

// Customer-visible shop copy must not expose supplier/factory wording. Internal
// commerce metadata may name an integration/pricing mechanism, but it must never
// inject that supplier wording into rendered text, labels, titles or HTML.
assert.doesNotMatch([index, deliveryEstimate, manualCheckout, storefrontPolish, store].join('\n'), /printify|factor(?:y|ies)/i);
assert.doesNotMatch(directCommerce, /(?:textContent|innerHTML|insertAdjacentHTML|setAttribute)\s*[^;\n]*(?:printify|factor(?:y|ies))/i, 'commerce bridge must not render supplier/factory wording into the customer UI');
assert.match(storefrontCss + styles, /position:\s*fixed/);
assert.match(styles, /\.cart-button[\s\S]*z-index:\s*1200/);
assert.doesNotMatch(catalogEdge, /MIN_RETAIL_CENTS/);
assert.doesNotMatch(checkoutEdge, /MIN_RETAIL_CENTS/);

console.log('Shop commerce v839 tote-handle-color + Bruis-copy + shipping-total + sticky-cart + cost-plus-5 contract passed.');

assert.match(collectionMedia, /removesLegacyTopLabels:true/);
assert.match(styles, /hide legacy text baked into the normal collection artwork/);

assert.match(adminPage, /Reject \/ not paid/);
assert.match(adminPage, /Delete order/);
assert.match(adminPage, /Cancel order/);
assert.match(adminPage, /reject_order/);
assert.match(adminPage, /cancel_order/);
assert.match(adminPage, /delete_order/);
assert.match(adminPage, /data-filter="canceled"/);
assert.match(adminEdge, /action==="cancel_order"/);
assert.match(adminEdge, /\/cancel\.json/);
assert.match(adminEdge, /\["on-hold","payment-not-received"\]/, 'Printify cancellation must be limited to documented pre-production statuses');
assert.match(adminEdge, /financial_records_preserved:true/);
assert.match(cancelDeleteMigration, /add column if not exists canceled_at timestamptz/);
assert.match(cancelDeleteMigration, /alter column order_id drop not null/);
assert.match(cancelDeleteMigration, /on delete set null/);
assert.match(adminPage, /reject-email-before-delete/);
assert.match(adminEdge, /rejection_notified_at/);
assert.match(adminEdge, /rejection_email_failed/);
assert.match(adminEdge, /delete_not_allowed/);
assert.match(adminEdge, /sendEmail\(working\.customer_email/);

assert.match(adminPage, /Production email:/);
assert.match(adminPage, /printify-production-email-v1/);
assert.match(adminEdge, /production_notified_at/);
assert.match(adminEdge, /Your payment is confirmed/);
assert.match(adminEdge, /is now in production/);
assert.match(webhookEdge, /production_notified_at/);
assert.match(webhookEdge, /printify-production-email-v1/);
