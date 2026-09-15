#!/usr/bin/env node
import assert from 'node:assert/strict';

const SHOP_URL = 'https://kalenel.nl/shop/';
const ASSET_VERSION = '20260915-storefront-v831';
const DIRECT_BRIDGE_URL = `https://kalenel.nl/shop/direct-commerce-v828.js?v=${ASSET_VERSION}`;
const POLISH_URL = `https://kalenel.nl/shop/storefront-polish-v831.js?v=${ASSET_VERSION}`;
const COLLECTION_MEDIA_URL = `https://kalenel.nl/shop/collection-media-v831.js?v=${ASSET_VERSION}`;
const PREVIEWS_URL = `https://kalenel.nl/shop/product-preview-overrides.js?v=${ASSET_VERSION}`;
const LIGHTBOX_URL = `https://kalenel.nl/shop/image-lightbox-v830.js?v=${ASSET_VERSION}`;
const BACKGROUND_URL = `https://kalenel.nl/shop/mockup-background-v830.js?v=${ASSET_VERSION}`;
const CATALOG_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-catalog-v828';
const CATALOG_HEALTH_URL = `${CATALOG_URL}?health=1`;
const CHECKOUT_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-manual-checkout-v828';
const CONNECTION_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-production-connection-v828';
const STATUS_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-order-status-v825?health=1';
const ADMIN_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-admin-orders-v825';
const WEBHOOK_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-printify-webhook-v825';
const TIMEOUT_MS = Number(process.env.GEJAST_SHOP_TIMEOUT_MS || 20000);
const MIN_PRODUCTS = Number(process.env.GEJAST_SHOP_MIN_PRODUCTS || 20);

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'User-Agent': 'GEJAST-Live-Shop-Health/1.5',
        'Cache-Control': 'no-cache',
        ...(options.headers || {})
      }
    });
    return { response, elapsed: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function catalog() {
  const { response, elapsed } = await fetchWithTimeout(CATALOG_URL);
  assert.equal(response.status, 200, `shop-catalog-v828 must return HTTP 200, got ${response.status}`);
  const payload = await response.json();
  assert.equal(payload?.source, 'printify-direct-v828', 'catalog must identify Printify as its direct source');
  assert.ok(Array.isArray(payload?.products), 'catalog must return products[]');
  assert.ok(payload.products.length >= MIN_PRODUCTS, `catalog returned only ${payload.products.length} products`);

  const names = new Set(payload.products.map(product => String(product?.name || '').trim().toLowerCase()));
  for (const expected of ['coral', 'hydrangea', 'wild carrot', 'jellyfish']) {
    assert.ok(names.has(expected), `catalog missing ${expected}`);
  }
  assert.ok([...names].some(name => name.includes('despinoza')), 'catalog missing Despinoza merch');

  const counts = { normal: 0, boxy: 0, merch: 0 };
  const skus = new Set();
  for (const product of payload.products) {
    const collection = String(product?.collection || '');
    if (collection in counts) counts[collection] += 1;
    assert.ok(Number(product?.price || 0) > 0, `product ${product?.name} has invalid price`);
    assert.equal(Number.isInteger(Number(product?.price)), true, `${product?.name} display price must be a whole euro`);
    assert.ok(Array.isArray(product?.variants) && product.variants.length > 0, `product ${product?.name} has no variants`);
    assert.ok(Array.isArray(product?.mockups) && product.mockups.length > 0, `product ${product?.name} has no mockups`);
    assert.ok(Array.isArray(product?.sizes) && product.sizes.length > 0, `product ${product?.name} has no sizes`);

    for (const variant of product.variants) {
      assert.match(String(variant?.color || ''), /^white$/i, `${product?.name} exposed a non-white variant`);
      assert.ok(String(variant?.sku || '').trim(), `${product?.name} has a blank variant SKU`);
      assert.ok(!skus.has(String(variant.sku)), `duplicate variant SKU ${variant.sku}`);
      skus.add(String(variant.sku));
      assert.ok(Number(variant?.price || 0) > 0, `${product?.name} variant ${variant?.id} has invalid price`);
      assert.equal(Number.isInteger(Number(variant.price)), true, `${product?.name} variant ${variant?.id} price must be a whole euro`);
    }
  }

  assert.ok(counts.normal > 0, 'catalog has no Classic products');
  assert.ok(counts.boxy > 0, 'catalog has no Oversized Boxy products');
  assert.ok(counts.merch > 0, 'catalog has no Merch products');
  console.log(`shop-catalog-v828: HTTP 200, products=${payload.products.length}, variants=${skus.size}, classic=${counts.normal}, boxy=${counts.boxy}, merch=${counts.merch}, ${elapsed}ms`);
  return payload;
}

async function health(url, label, expectedMode) {
  const { response, elapsed } = await fetchWithTimeout(url, { method: 'GET' });
  assert.equal(response.status, 200, `${label} health must return HTTP 200, got ${response.status}`);
  const payload = await response.json();
  assert.equal(payload?.ok, true, `${label} health must report ok=true`);
  assert.equal(payload?.mode, expectedMode, `${label} returned unexpected mode ${payload?.mode}`);
  console.log(`${label}: health PASS, ${elapsed}ms`);
  return payload;
}

async function textAsset(url, label) {
  const { response } = await fetchWithTimeout(url);
  assert.equal(response.status, 200, `${label} must return HTTP 200, got ${response.status}`);
  return response.text();
}

// Deliberately read-only: never POST checkout, verify payment, submit an order,
// mutate prices, or simulate a webhook.
const { response: pageResponse, elapsed: pageElapsed } = await fetchWithTimeout(`${SHOP_URL}?v=${ASSET_VERSION}`);
assert.equal(pageResponse.status, 200, `Live shop page must return HTTP 200, got ${pageResponse.status}`);
const html = await pageResponse.text();
assert.match(html, /version-watermark[^>]*>v831</, 'Live shop must expose v831 watermark');
assert.match(html, /direct-commerce-v828\.js\?v=20260915-storefront-v831/, 'Live shop must load direct commerce with the v831 cache key');
assert.match(html, /manual-checkout-v825\.js\?v=20260915-storefront-v831/, 'Live shop must retain hardened manual checkout');
assert.match(html, /storefront-polish-v831\.js\?v=20260915-storefront-v831/, 'Live shop must load v831 storefront policy');
assert.match(html, /product-preview-overrides\.js\?v=20260915-storefront-v831/, 'Live shop must restore artwork details');
assert.match(html, /collection-media-v831\.js\?v=20260915-storefront-v831/, 'Live shop must load collection media normalization');
assert.match(html, /image-lightbox-v830\.js\?v=20260915-storefront-v831/, 'Live shop must retain whole-garment lightbox');
assert.match(html, /mockup-background-v830\.js\?v=20260915-storefront-v831/, 'Live shop must retain safe mockup background matcher');
assert.doesNotMatch(html, /storefront-polish-v830\.(?:css|js)/, 'Old v830 storefront presentation layer must not remain active');
assert.doesNotMatch(html, /image-lightbox-v820\.js|mockup-background-v819\.js|front-lightbox-fit-v821\.js/, 'Legacy image handlers must not be active');
assert.doesNotMatch(html, />[^<]*Printify[^<]*</i, 'Public shop must not expose supplier branding');
assert.doesNotMatch(html, /shop-runtime-v819\.js|catalog-recovery-v822\.js|payment-readiness-v824\.js|shopify-checkout-v817\.js/, 'Legacy commerce handlers must not be active');
console.log(`shop page: HTTP 200, v831 present, ${pageElapsed}ms`);

const bridge = await textAsset(DIRECT_BRIDGE_URL, 'direct-commerce-v828.js');
assert.match(bridge, /shop-catalog-v828/, 'bridge must use v828 catalog');
assert.match(bridge, /shop-manual-checkout-v828/, 'bridge must use v828 checkout');
assert.match(bridge, /usesShopifyCatalogApi:\s*false/, 'bridge must declare Shopify catalog API disabled');
assert.match(bridge, /usesShopifyPriceApi:\s*false/, 'bridge must declare Shopify price API disabled');
assert.doesNotMatch(bridge, /shop-price-v818|shop-catalog-v822/, 'bridge must not call legacy catalog/price endpoints');
assert.match(bridge, /wholeEuro/, 'bridge must normalize displayed item prices upward to whole euros');

const previews = await textAsset(PREVIEWS_URL, 'product-preview-overrides.js');
assert.match(previews, /hydrangea-front-v5\.webp/, 'Hydrangea artwork preview must be restored');
assert.match(previews, /dragonfly-front-v5\.webp/, 'Dragonfly artwork preview must be restored');
assert.match(previews, /label:\s*'Artwork detail'/, 'restored preview must be labelled as artwork detail');
assert.match(previews, /placement:\s*'after-primary-garment'/, 'artwork must sit after the primary garment view');
assert.match(previews, /preservesGarmentPrimaryImage:\s*true/, 'artwork restore must not replace the shirt/cart image');

const polish = await textAsset(POLISH_URL, 'storefront-polish-v831.js');
assert.match(polish, /wholeEuroPricing:\s*true/, 'storefront policy must enforce whole-euro pricing');
assert.match(polish, /artworkDetailsRestored:\s*true/, 'storefront policy must retain restored artwork details');
assert.match(polish, /garmentPrimaryImage:\s*true/, 'storefront policy must keep garment as product primary image');
assert.match(polish, /Shipping is calculated from your delivery address/, 'checkout copy must remain customer-facing');
assert.doesNotMatch(polish, /price shown in the browser is never trusted/i, 'storefront policy must not expose engineering trust language');

const collectionMedia = await textAsset(COLLECTION_MEDIA_URL, 'collection-media-v831.js');
assert.match(collectionMedia, /TARGET\s*=\s*\[222, 214, 202, 255\]/, 'collection cards must use the beige image backdrop');
assert.match(collectionMedia, /function floodOuterBackground/, 'collection media must isolate connected outer white');
assert.match(collectionMedia, /function largestForegroundBox/, 'collection media must find and crop the actual shirt');
assert.match(collectionMedia, /preservesWhiteGarment:\s*true/, 'collection media must preserve white shirt fill');
assert.match(collectionMedia, /cropsToLargestGarment:\s*true/, 'collection media must scale the shirt consistently');

const lightbox = await textAsset(LIGHTBOX_URL, 'image-lightbox-v830.js');
assert.match(lightbox, /object-fit:contain!important/, 'lightbox must fit the complete garment');
assert.match(lightbox, /function fit\(\)/, 'lightbox must provide a deterministic fit reset');
assert.match(lightbox, /EXCLUDE_FROM_EXPANDED_RE/, 'lightbox must keep artwork/detail slides out of expanded garment navigation');

const background = await textAsset(BACKGROUND_URL, 'mockup-background-v830.js');
assert.match(background, /centralHits\s*>=\s*4/, 'background matcher must reject center leakage into garments');
assert.match(background, /preserved-detail/, 'background matcher must preserve collar/tag detail images');

await catalog();
const catalogHealth = await health(CATALOG_HEALTH_URL, 'shop-catalog-v828', 'printify-direct-catalog-v828');
assert.equal(catalogHealth?.usesShopifyApi, false, 'catalog health must report no Shopify API use');
assert.equal(catalogHealth?.whiteVariantsOnly, true, 'catalog health must report white-only variants');
const checkoutHealth = await health(CHECKOUT_URL, 'shop-manual-checkout-v828', 'manual-payment-v828');
assert.equal(checkoutHealth?.sends_to_production, false, 'customer checkout must not send orders to production');
assert.ok(Number(checkoutHealth?.cached_products || 0) >= MIN_PRODUCTS, 'checkout must see the cached catalog');
assert.equal(checkoutHealth?.payment_configured, true, 'manual payment must be configured');
assert.equal(checkoutHealth?.email_configured, true, 'buyer confirmation email must be configured');
await health(CONNECTION_URL, 'shop-production-connection-v828', 'production-connection-v828');
await health(STATUS_URL, 'shop-order-status-v825', 'order-status-v825');
await health(ADMIN_URL, 'shop-admin-orders-v825', 'admin-orders-v825');
await health(WEBHOOK_URL, 'shop-printify-webhook-v825', 'printify-webhook-v825');

console.log('RESULT=V831_LIVE_SHOP_MEDIA_PASS');
