#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const index = read('shop/index.html');
const store = read('shop/store.js');
const checkout = read('shop/shopify-checkout-v817.js');
const runtime = read('shop/shop-runtime-v818.js');
const refresh = read('shop/live-catalog-refresh-v818.js');
const catalogEdge = read('supabase/functions/shop-catalog/index.ts');
const priceEdge = read('supabase/functions/shop-price-v818/index.ts');

// Root VERSION remains the certified global site baseline. The shop itself carries
// a local frontend watermark/cache bump because this change is scoped to /shop/.
assert.equal(read('VERSION').trim(), 'v817');
assert.match(index, /collection-merch-despinoza\.png/);
assert.match(index, /shop-runtime-v818\.js/);
assert.match(index, /shopify-checkout-v817\.js/);
assert.match(index, /live-catalog-refresh-v818\.js/);
assert.match(index, /version-watermark[^>]*>v818</);

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

// v818 makes Shopify Storefront the customer-facing price authority even when
// the legacy catalog cache is temporarily backed by Printify.
assert.match(runtime, /shop-price-v818/);
assert.match(runtime, /priceAuthority\s*=\s*'shopify-storefront'/);
assert.match(runtime, /const bySku = new Map\(\)/, 'Price authority must match products by SKU as a source-independent fallback');
assert.match(runtime, /variantSku\(variant\)/);
assert.match(runtime, /next\.price\s*=\s*Number\(live\.price/);
assert.match(runtime, /next\.variants\s*=\s*Array\.isArray\(live\.variants\)/);

// Listing galleries must prefer transparent assets and must not keep white JPG
// mockups alongside a known transparent PNG/WebP equivalent.
assert.match(runtime, /isTransparentAsset/);
assert.ok(runtime.includes('png|webp'), 'Transparent media filter must explicitly accept PNG and WebP');
assert.match(runtime, /assets\/product-previews\/axolotl-front-v5\.webp/);
assert.match(runtime, /assets\/product-previews\/dragonfly-front-v5\.webp/);
assert.match(runtime, /assets\/product-previews\/hydrangea-front-v5\.webp/);
assert.match(runtime, /assets\/product-previews\/jellyfish-front-v7\.webp/);
assert.match(runtime, /assets\/product-previews\/mantis-front-v5\.webp/);
assert.match(runtime, /assets\/product-previews\/thistle-front-v5\.webp/);
assert.match(runtime, /assets\/product-previews\/queen-annes-lace-front-v5\.webp/);
assert.match(runtime, /background:\s*#ded6ca/);
assert.match(runtime, /\.mockup img[\s\S]*background:\s*transparent/);

// Price/media changes refresh visibly without a hard reload, while cart lines
// retain the selected Shopify variant price instead of falling back to min price.
assert.match(refresh, /POLL_MS\s*=\s*15\s*\*\s*1000/);
assert.doesNotMatch(refresh, /window\.location\.reload/);
assert.match(refresh, /currentVariantFor/);
assert.match(refresh, /variant\?\.price\s*\|\|\s*product\.price/);
assert.match(refresh, /visibilitychange/);
assert.match(refresh, /window\.addEventListener\('focus'/);

// The direct price authority endpoint itself is Shopify-only and explicitly no-store.
assert.match(priceEdge, /SHOPIFY_DOMAIN\s*=\s*"n75mh8-bu\.myshopify\.com"/);
assert.match(priceEdge, /priceRange/);
assert.match(priceEdge, /variants\(first:\s*250\)/);
assert.match(priceEdge, /private, no-store, max-age=0/);
assert.doesNotMatch(priceEdge, /PRINTIFY/i);

// Existing catalog enrichment/cache remains safe and keeps the original product
// classification contract; it is no longer trusted as the final displayed price.
assert.match(catalogEdge, /REFRESH_MS\s*=\s*60\s*\*\s*1000/);
assert.match(catalogEdge, /private, no-store, max-age=0/);
assert.match(catalogEdge, /productTitle\.includes\("despinoza"\).*return "merch"/s);
assert.match(catalogEdge, /oversized\|boxy/);

console.log('Shop commerce v818 contract passed.');
