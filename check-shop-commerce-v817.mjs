#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const index = read('shop/index.html');
const store = read('shop/store.js');
const checkout = read('shop/shopify-checkout-v817.js');
const runtime = read('shop/shop-runtime-v819.js');
const recovery = read('shop/catalog-recovery-v822.js');
const previewOverrides = read('shop/product-preview-overrides.js');
const mockupBackground = read('shop/mockup-background-v819.js');
const lightbox = read('shop/image-lightbox-v820.js');
const frontLightboxFit = read('shop/front-lightbox-fit-v821.js');
const refresh = read('shop/live-catalog-refresh-v818.js');
const catalogEdge = read('supabase/functions/shop-catalog/index.ts');
const catalogV822 = read('supabase/functions/shop-catalog-v822/index.ts');
const priceEdge = read('supabase/functions/shop-price-v818/index.ts');
const priceRule = read('supabase/functions/shop-price-rule-v819/index.ts');
const priceRuleState = read('supabase/migrations/20260902160835_shop_price_rule_state_v819.sql');
const liveShopCheck = read('check-live-shop.mjs');
const liveHealthWorkflow = read('.github/workflows/live-deployment-health.yml');

const JELLYFISH_FRONT = 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/jellyfish-front-artwork.png?v=1788453508';

assert.equal(read('VERSION').trim(), 'v817');
assert.match(index, /collection-merch-despinoza\.png/);
assert.match(index, /shop-runtime-v819\.js/);
assert.match(index, /catalog-recovery-v822\.js/);
assert.match(index, /mockup-background-v819\.js/);
assert.match(index, /image-lightbox-v820\.js/);
assert.match(index, /front-lightbox-fit-v821\.js/);
assert.match(index, /shopify-checkout-v817\.js/);
assert.match(index, /live-catalog-refresh-v818\.js/);
assert.match(index, /version-watermark[^>]*>v823</);
assert.match(index, /20260903-shop-commerce-v823/);

const merchImage = fs.readFileSync('shop/assets/collection-merch-despinoza.png');
assert.equal(
  crypto.createHash('sha256').update(merchImage).digest('hex'),
  '230ee9f150e1c65e14185fac1691a04e67788c53dacb6625be7d83c6cfbf2b1b',
  'Merch collection image must remain the exact supplied PNG'
);

assert.match(store, /toFixed\(2\)/, 'Prices must preserve exact cents');
assert.doesNotMatch(store, /price:\s*Math\.ceil/, 'Product prices must not be rounded up');
assert.match(checkout, /n75mh8-bu\.myshopify\.com/);
assert.match(checkout, /\/cart\/\$\{lines\.join\(','\)\}/, 'Checkout must use exact Shopify variant cart lines');

// v823 pins the exact user-supplied Jellyfish artwork as front #1 across every
// storefront fallback layer so Shopify and the custom gallery cannot disagree.
for (const source of [runtime, recovery, previewOverrides]) {
  assert.ok(source.includes(JELLYFISH_FRONT), 'Every Jellyfish fallback layer must use the new Shopify-hosted front artwork');
  assert.doesNotMatch(source, /jellyfish-front-v7\.webp/, 'The old Jellyfish preview must not remain active');
}

// v822 prevents a single Edge Function/JWT/CORS failure from blanking the shop.
assert.match(recovery, /shop-catalog-v822/);
assert.match(recovery, /shop-price-v818/);
assert.match(recovery, /isLegacyCatalogRequest/);
assert.match(recovery, /normalizePriceFallback/);
assert.match(recovery, /return previousFetch\(input, init\)/);
assert.match(recovery, /BOXY_TITLES/);
assert.match(recovery, /despinoza/);
assert.match(recovery, /FRONT_PREVIEWS/);
assert.match(recovery, /wild\\s\*carrot\|queen\\s\*anne/);
assert.match(recovery, /X-Kalenel-Catalog-Authority/);

for (const source of [catalogEdge, catalogV822]) {
  assert.match(source, /SHOPIFY_DOMAIN\s*=\s*"n75mh8-bu\.myshopify\.com"/);
  assert.match(source, /products\(first:\s*100/);
  assert.match(source, /variants\(first:\s*250\)/);
  assert.match(source, /featuredImage/);
  assert.match(source, /images\(first:\s*50\)/);
  assert.match(source, /collectionFor/);
  assert.match(source, /oversized\|boxy/);
  assert.match(source, /mockups\.length > 0/);
  assert.match(source, /public, max-age=5, stale-while-revalidate=30/);
  assert.doesNotMatch(source, /createClient|SUPABASE_SERVICE_ROLE_KEY|SHOPIFY_ADMIN_ACCESS_TOKEN|PRINTIFY_API_TOKEN|PRINTIFY_BASE/);
}

// Old cached clients must also receive the direct Shopify catalog. The legacy slug
// is deliberately kept as a compatibility alias, not a database-backed cache.
assert.doesNotMatch(catalogEdge, /shop_catalog_products|shop_catalog_sync_state|get_printify_api_token/);

// Every main deployment permanently checks the actual public shop plus both catalog slugs.
assert.match(liveHealthWorkflow, /Verify live Shopify shop catalog/);
assert.match(liveHealthWorkflow, /node check-live-shop\.mjs/);
assert.match(liveShopCheck, /https:\/\/kalenel\.nl\/shop\//);
assert.match(liveShopCheck, /functions\/v1\/shop-catalog'/);
assert.match(liveShopCheck, /functions\/v1\/shop-catalog-v822'/);
assert.match(liveShopCheck, /MIN_PRODUCTS/);
assert.match(liveShopCheck, /version-watermark[^\n]*v823/);
assert.match(liveShopCheck, /jellyfish-front-artwork\.png/);
assert.match(liveShopCheck, /Jellyfish first image/);
assert.match(liveShopCheck, /RESULT=V823_LIVE_SHOP_JELLYFISH_PASS/);

// Shopify Storefront remains the final customer-facing price authority.
assert.match(runtime, /shop-price-v818/);
assert.match(runtime, /priceAuthority\s*=\s*'shopify-storefront'/);
assert.match(runtime, /const bySku = new Map\(\)/);
assert.match(runtime, /variantSku\(variant\)/);
assert.match(runtime, /next\.price\s*=\s*Number\(live\.price/);
assert.match(runtime, /next\.variants\s*=\s*Array\.isArray\(live\.variants\)/);

// v819 gallery contract remains intact.
assert.match(runtime, /isTransparentAsset/);
assert.ok(runtime.includes('png|webp'));
assert.match(runtime, /\.\.\.live,[\s\S]*\.\.\.catalog/);
assert.match(runtime, /Number\(b\.transparent\)\s*-\s*Number\(a\.transparent\)/);
assert.doesNotMatch(runtime, /\.filter\(item\s*=>\s*item\.transparent\)/);
assert.match(runtime, /background:\s*#ded6ca/);
assert.match(runtime, /\.mockup img[\s\S]*background:\s*transparent/);

// Background matching remains conservative and non-destructive.
assert.match(mockupBackground, /BACKDROP\s*=\s*'#ded6ca'/);
assert.match(mockupBackground, /TARGET\s*=\s*\[222,\s*214,\s*202\]/);
assert.match(mockupBackground, /function floodBackdrop/);
assert.match(mockupBackground, /stats\.lightness < 185 \|\| stats\.spread > 24 \|\| stats\.sigma > 12/);
assert.match(mockupBackground, /ratio < 0\.08 \|\| ratio > 0\.88/);
assert.match(mockupBackground, /BRUIS_MATCH_MOCKUP_BACKGROUND/);
assert.match(mockupBackground, /IntersectionObserver/);
assert.match(mockupBackground, /MutationObserver/);

// Lightbox behavior remains intact.
assert.match(lightbox, /\.product-card \.mockup img/);
assert.match(lightbox, /role', 'dialog'/);
assert.match(lightbox, /aria-modal', 'true'/);
assert.match(lightbox, /stageTransformFrom/);
assert.match(lightbox, /target === active\.overlay/);
assert.match(lightbox, /event\.key === 'Escape'/);
assert.match(lightbox, /event\.key === 'ArrowLeft'/);
assert.match(lightbox, /event\.key === 'ArrowRight'/);
assert.match(lightbox, /SWIPE_THRESHOLD\s*=\s*56/);
assert.match(lightbox, /pointerdown/);
assert.match(lightbox, /pointermove/);
assert.match(lightbox, /pointerup/);
assert.match(lightbox, /pointercancel/);
assert.match(lightbox, /function syncCardGallery/);
assert.match(lightbox, /shop-lightbox-open/);
assert.match(lightbox, /background:\s*#ded6ca/);
assert.match(lightbox, /prefers-reduced-motion/);

// v821 first/front popup fitting remains intact.
assert.match(frontLightboxFit, /function cropTransparentMargins/);
assert.match(frontLightboxFit, /ALPHA_THRESHOLD\s*=\s*8/);
assert.match(frontLightboxFit, /createImageBitmap/);
assert.match(frontLightboxFit, /isFirstImage/);
assert.match(frontLightboxFit, /is-front-fit-v821/);
assert.match(frontLightboxFit, /object-position:\s*50% 50%/);
assert.match(frontLightboxFit, /object-fit:\s*contain/);
assert.match(frontLightboxFit, /MutationObserver/);

// Live refresh keeps an already rendered catalog when polling fails.
assert.match(refresh, /POLL_MS\s*=\s*15\s*\*\s*1000/);
assert.doesNotMatch(refresh, /window\.location\.reload/);
assert.match(refresh, /if\(!Array\.isArray\(live\) \|\| !live\.length\) return/);
assert.match(refresh, /currentVariantFor/);
assert.match(refresh, /visibilitychange/);
assert.match(refresh, /window\.addEventListener\('focus'/);

assert.match(priceEdge, /SHOPIFY_DOMAIN\s*=\s*"n75mh8-bu\.myshopify\.com"/);
assert.match(priceEdge, /priceRange/);
assert.match(priceEdge, /variants\(first:\s*250\)/);
assert.match(priceEdge, /private, no-store, max-age=0/);
assert.doesNotMatch(priceEdge, /PRINTIFY/i);

assert.match(priceRule, /MARGIN_CENTS\s*=\s*500/);
assert.match(priceRule, /Math\.round\(cost\)\s*\+\s*MARGIN_CENTS/);
assert.match(priceRule, /variants:\s*true/);
assert.match(priceRuleState, /alter table public\.shop_price_rule_state enable row level security/);
assert.match(priceRuleState, /revoke all on table public\.shop_price_rule_state from public, anon, authenticated/);
assert.match(priceRuleState, /grant all on table public\.shop_price_rule_state to service_role/);

console.log('Shop commerce v823 Jellyfish front artwork contract passed.');
