#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const index = read('shop/index.html');
const store = read('shop/store.js');
const checkout = read('shop/shopify-checkout-v817.js');
const runtime = read('shop/shop-runtime-v819.js');
const mockupBackground = read('shop/mockup-background-v819.js');
const lightbox = read('shop/image-lightbox-v820.js');
const frontLightboxFit = read('shop/front-lightbox-fit-v821.js');
const refresh = read('shop/live-catalog-refresh-v818.js');
const catalogEdge = read('supabase/functions/shop-catalog/index.ts');
const priceEdge = read('supabase/functions/shop-price-v818/index.ts');
const priceRule = read('supabase/functions/shop-price-rule-v819/index.ts');
const priceRuleState = read('supabase/migrations/20260902160835_shop_price_rule_state_v819.sql');

// Root VERSION remains the certified global site baseline. The shop itself carries
// a local frontend watermark/cache bump because this change is scoped to /shop/.
assert.equal(read('VERSION').trim(), 'v817');
assert.match(index, /collection-merch-despinoza\.png/);
assert.match(index, /shop-runtime-v819\.js/);
assert.match(index, /mockup-background-v819\.js/);
assert.match(index, /image-lightbox-v820\.js/);
assert.match(index, /front-lightbox-fit-v821\.js/);
assert.match(index, /shopify-checkout-v817\.js/);
assert.match(index, /live-catalog-refresh-v818\.js/);
assert.match(index, /version-watermark[^>]*>v821</);

const merchImage = fs.readFileSync('shop/assets/collection-merch-despinoza.png');
assert.equal(
  crypto.createHash('sha256').update(merchImage).digest('hex'),
  '230ee9f150e1c65e14185fac1691a04e67788c53dacb6625be7d83c6cfbf2b1b',
  'Merch collection image must remain the exact supplied PNG'
);

for (const filename of [
  'coral-front-artwork.png',
  'orchid-front-artwork.png',
  'honeysuckle-front-artwork.png',
  'horseshoe-crab-front-artwork.png',
  'lily-front-artwork.png',
  'magnolia-front-artwork.png',
  'monstera-front-artwork.png',
  'daffodil-front-artwork.png',
  'seahorse-front-artwork.png',
  'seaweed-front-artwork.png'
]) {
  assert.ok(checkout.includes(filename), `Missing uploaded front artwork mapping: ${filename}`);
}

assert.match(store, /toFixed\(2\)/, 'Prices must preserve exact cents');
assert.doesNotMatch(store, /price:\s*Math\.ceil/, 'Product prices must not be rounded up');
assert.match(checkout, /n75mh8-bu\.myshopify\.com/);
assert.match(checkout, /\/cart\/\$\{lines\.join\(','\)\}/, 'Checkout must use exact Shopify variant cart lines');

// Shopify Storefront remains the final customer-facing price authority even when
// the legacy catalog cache is temporarily backed by Printify.
assert.match(runtime, /shop-price-v818/);
assert.match(runtime, /priceAuthority\s*=\s*'shopify-storefront'/);
assert.match(runtime, /const bySku = new Map\(\)/, 'Price authority must match products by SKU as a source-independent fallback');
assert.match(runtime, /variantSku\(variant\)/);
assert.match(runtime, /next\.price\s*=\s*Number\(live\.price/);
assert.match(runtime, /next\.variants\s*=\s*Array\.isArray\(live\.variants\)/);

// v819 restores the full gallery. Transparent/front artwork is ordered first,
// while all remaining live Shopify and catalog mockups are retained afterwards.
assert.match(runtime, /isTransparentAsset/);
assert.ok(runtime.includes('png|webp'), 'Transparent media ordering must explicitly recognize PNG and WebP');
assert.match(runtime, /\.\.\.live,[\s\S]*\.\.\.catalog/, 'Gallery must include both live Shopify and catalog mockups');
assert.match(runtime, /Number\(b\.transparent\)\s*-\s*Number\(a\.transparent\)/, 'Transparent artwork must sort before other mockups');
assert.doesNotMatch(runtime, /\.filter\(item\s*=>\s*item\.transparent\)/, 'Non-transparent mockups must not be hidden');
assert.match(runtime, /assets\/product-previews\/axolotl-front-v5\.webp/);
assert.match(runtime, /assets\/product-previews\/dragonfly-front-v5\.webp/);
assert.match(runtime, /assets\/product-previews\/hydrangea-front-v5\.webp/);
assert.match(runtime, /assets\/product-previews\/jellyfish-front-v7\.webp/);
assert.match(runtime, /assets\/product-previews\/mantis-front-v5\.webp/);
assert.match(runtime, /assets\/product-previews\/thistle-front-v5\.webp/);
assert.match(runtime, /assets\/product-previews\/queen-annes-lace-front-v5\.webp/);
assert.match(runtime, /background:\s*#ded6ca/);
assert.match(runtime, /\.mockup img[\s\S]*background:\s*transparent/);

// JPEG mockups with a flat light studio background are matched to the exact same
// #ded6ca artwork backdrop using conservative border-connected segmentation.
// Unsafe/complex photo backgrounds are preserved rather than tinting garments.
assert.match(mockupBackground, /BACKDROP\s*=\s*'#ded6ca'/);
assert.match(mockupBackground, /TARGET\s*=\s*\[222,\s*214,\s*202\]/);
assert.match(mockupBackground, /function floodBackdrop/);
assert.match(mockupBackground, /stats\.lightness < 185 \|\| stats\.spread > 24 \|\| stats\.sigma > 12/);
assert.match(mockupBackground, /ratio < 0\.08 \|\| ratio > 0\.88/);
assert.match(mockupBackground, /BRUIS_MATCH_MOCKUP_BACKGROUND/);
assert.match(mockupBackground, /IntersectionObserver/);
assert.match(mockupBackground, /MutationObserver/);

// v820 product images expand from the clicked card into a full-window lightbox,
// keep the complete product gallery enlarged, and collapse back when dismissed.
assert.match(lightbox, /\.product-card \.mockup img/);
assert.match(lightbox, /role', 'dialog'/);
assert.match(lightbox, /aria-modal', 'true'/);
assert.match(lightbox, /stageTransformFrom/);
assert.match(lightbox, /getBoundingClientRect/);
assert.match(lightbox, /--lb-dx/);
assert.match(lightbox, /--lb-sx/);
assert.match(lightbox, /transform:\s*translate\(-50%, -50%\).*scale\(var\(--lb-sx\), var\(--lb-sy\)\)/s);
assert.match(lightbox, /target === active\.overlay/);
assert.match(lightbox, /event\.key === 'Escape'/);
assert.match(lightbox, /event\.key === 'ArrowLeft'/);
assert.match(lightbox, /event\.key === 'ArrowRight'/);
assert.match(lightbox, /SWIPE_THRESHOLD\s*=\s*56/);
assert.match(lightbox, /pointerdown/);
assert.match(lightbox, /pointermove/);
assert.match(lightbox, /pointerup/);
assert.match(lightbox, /pointercancel/);
assert.match(lightbox, /window\.BRUIS_MATCH_MOCKUP_BACKGROUND/);
assert.match(lightbox, /function syncCardGallery/);
assert.match(lightbox, /rail\.scrollLeft/);
assert.match(lightbox, /shop-lightbox-open/);
assert.match(lightbox, /overflow:\s*hidden\s*!important/);
assert.match(lightbox, /width:\s*min\(94vw, 1180px\)/);
assert.match(lightbox, /height:\s*min\(91vh, 940px\)/);
assert.match(lightbox, /background:\s*#ded6ca/);
assert.match(lightbox, /prefers-reduced-motion/);

// v821 fits the first/front image to its visible artwork instead of merely centering
// a potentially padded transparent canvas. The source/listing image is not modified.
assert.match(frontLightboxFit, /function cropTransparentMargins/);
assert.match(frontLightboxFit, /ALPHA_THRESHOLD\s*=\s*8/);
assert.match(frontLightboxFit, /createImageBitmap/);
assert.match(frontLightboxFit, /minX\s*=\s*width/);
assert.match(frontLightboxFit, /maxX\s*=\s*-1/);
assert.match(frontLightboxFit, /occupiedWidth/);
assert.match(frontLightboxFit, /occupiedHeight/);
assert.match(frontLightboxFit, /output\.toBlob\(resolve, 'image\/png'\)/);
assert.match(frontLightboxFit, /isFirstImage/);
assert.match(frontLightboxFit, /is-front-fit-v821/);
assert.match(frontLightboxFit, /object-position:\s*50% 50%/);
assert.match(frontLightboxFit, /object-fit:\s*contain/);
assert.match(frontLightboxFit, /MutationObserver/);
assert.doesNotMatch(frontLightboxFit, /querySelectorAll\('\.mockup img'\)/, 'v821 popup fitting must not rewrite listing thumbnails');

// Price/media changes refresh visibly without a hard reload, while cart lines
// retain the selected Shopify variant price instead of falling back to min price.
assert.match(refresh, /POLL_MS\s*=\s*15\s*\*\s*1000/);
assert.doesNotMatch(refresh, /window\.location\.reload/);
assert.match(refresh, /currentVariantFor/);
assert.match(refresh, /variant\?\.price\s*\|\|\s*product\.price/);
assert.match(refresh, /visibilitychange/);
assert.match(refresh, /window\.addEventListener\('focus'/);

// The direct customer-facing price authority endpoint is Shopify-only and no-store.
assert.match(priceEdge, /SHOPIFY_DOMAIN\s*=\s*"n75mh8-bu\.myshopify\.com"/);
assert.match(priceEdge, /priceRange/);
assert.match(priceEdge, /variants\(first:\s*250\)/);
assert.match(priceEdge, /private, no-store, max-age=0/);
assert.doesNotMatch(priceEdge, /PRINTIFY/i);

// v819 also keeps the intended upstream Printify rule in source control: retail
// price equals Printify fulfillment cost + exactly €5, with service-only state.
assert.match(priceRule, /MARGIN_CENTS\s*=\s*500/);
assert.match(priceRule, /Math\.round\(cost\)\s*\+\s*MARGIN_CENTS/);
assert.match(priceRule, /variants:\s*true/);
assert.match(priceRule, /get_printify_api_token_v815a/);
assert.match(priceRuleState, /alter table public\.shop_price_rule_state enable row level security/);
assert.match(priceRuleState, /revoke all on table public\.shop_price_rule_state from public, anon, authenticated/);
assert.match(priceRuleState, /grant all on table public\.shop_price_rule_state to service_role/);

// Existing catalog enrichment/cache remains safe and keeps the original product
// classification contract; it is no longer trusted as the final displayed price.
assert.match(catalogEdge, /REFRESH_MS\s*=\s*60\s*\*\s*1000/);
assert.match(catalogEdge, /private, no-store, max-age=0/);
assert.match(catalogEdge, /productTitle\.includes\("despinoza"\).*return "merch"/s);
assert.match(catalogEdge, /oversized\|boxy/);

console.log('Shop commerce v821 contract passed.');
