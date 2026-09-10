#!/usr/bin/env node
import assert from 'node:assert/strict';

const SHOP_URL = 'https://kalenel.nl/shop/';
const DIRECT_BRIDGE_URL = 'https://kalenel.nl/shop/direct-commerce-v828.js';
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
        'User-Agent': 'GEJAST-Live-Shop-Health/1.2',
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
    assert.ok(Array.isArray(product?.variants) && product.variants.length > 0, `product ${product?.name} has no variants`);
    assert.ok(Array.isArray(product?.mockups) && product.mockups.length > 0, `product ${product?.name} has no mockups`);
    assert.ok(Array.isArray(product?.sizes) && product.sizes.length > 0, `product ${product?.name} has no sizes`);

    for (const variant of product.variants) {
      assert.match(String(variant?.color || ''), /^white$/i, `${product?.name} exposed a non-white variant`);
      assert.ok(String(variant?.sku || '').trim(), `${product?.name} has a blank variant SKU`);
      assert.ok(!skus.has(String(variant.sku)), `duplicate variant SKU ${variant.sku}`);
      skus.add(String(variant.sku));
      assert.ok(Number(variant?.price || 0) > 0, `${product?.name} variant ${variant?.id} has invalid price`);
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

// Deliberately read-only: never POST checkout, verify payment, submit a Printify
// order, mutate prices, or simulate a webhook.
const { response: pageResponse, elapsed: pageElapsed } = await fetchWithTimeout(SHOP_URL);
assert.equal(pageResponse.status, 200, `Live shop page must return HTTP 200, got ${pageResponse.status}`);
const html = await pageResponse.text();
assert.match(html, /version-watermark[^>]*>v828</, 'Live shop must expose v828 watermark');
assert.match(html, /direct-commerce-v828\.js\?v=20260910-shop-direct-v828/, 'Live shop must load v828 direct-commerce bridge');
assert.match(html, /manual-checkout-v825\.js\?v=20260910-shop-direct-v828/, 'Live shop must retain the hardened manual checkout UI');
assert.doesNotMatch(html, /shop-runtime-v819\.js/, 'Shopify price-authority runtime must not be loaded');
assert.doesNotMatch(html, /catalog-recovery-v822\.js/, 'v822 catalog recovery must not be loaded');
assert.doesNotMatch(html, /payment-readiness-v824\.js/, 'Old card-payment guard must not be active');
assert.doesNotMatch(html, /shopify-checkout-v817\.js/, 'Old Shopify checkout redirect must not be active');
console.log(`shop page: HTTP 200, v828 present, ${pageElapsed}ms`);

const { response: bridgeResponse } = await fetchWithTimeout(DIRECT_BRIDGE_URL);
assert.equal(bridgeResponse.status, 200, `direct-commerce-v828.js must return HTTP 200, got ${bridgeResponse.status}`);
const bridge = await bridgeResponse.text();
assert.match(bridge, /shop-catalog-v828/, 'bridge must use v828 catalog');
assert.match(bridge, /shop-manual-checkout-v828/, 'bridge must use v828 checkout');
assert.match(bridge, /usesShopifyCatalogApi:\s*false/, 'bridge must declare Shopify catalog API disabled');
assert.match(bridge, /usesShopifyPriceApi:\s*false/, 'bridge must declare Shopify price API disabled');
assert.doesNotMatch(bridge, /shop-price-v818|shop-catalog-v822/, 'bridge must not call legacy catalog/price endpoints');

await catalog();
const catalogHealth = await health(CATALOG_HEALTH_URL, 'shop-catalog-v828', 'printify-direct-catalog-v828');
assert.equal(catalogHealth?.usesShopifyApi, false, 'catalog health must report no Shopify API use');
assert.equal(catalogHealth?.whiteVariantsOnly, true, 'catalog health must report white-only variants');
const checkoutHealth = await health(CHECKOUT_URL, 'shop-manual-checkout-v828', 'manual-payment-v828');
assert.equal(checkoutHealth?.sends_to_production, false, 'customer checkout must not send orders to production');
assert.ok(Number(checkoutHealth?.cached_products || 0) >= MIN_PRODUCTS, 'checkout must see the cached Printify catalog');
assert.equal(checkoutHealth?.payment_configured, true, 'manual payment must be configured');
assert.equal(checkoutHealth?.email_configured, true, 'buyer confirmation email must be configured');
await health(CONNECTION_URL, 'shop-production-connection-v828', 'production-connection-v828');
await health(STATUS_URL, 'shop-order-status-v825', 'order-status-v825');
await health(ADMIN_URL, 'shop-admin-orders-v825', 'admin-orders-v825');
await health(WEBHOOK_URL, 'shop-printify-webhook-v825', 'printify-webhook-v825');

console.log('RESULT=V828_LIVE_SHOP_DIRECT_PRINTIFY_PASS');
