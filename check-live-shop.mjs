#!/usr/bin/env node
import assert from 'node:assert/strict';

const SHOP_URL = 'https://kalenel.nl/shop/';
const LEGACY_CATALOG_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-catalog';
const V822_CATALOG_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-catalog-v822';
const TIMEOUT_MS = Number(process.env.GEJAST_SHOP_TIMEOUT_MS || 15000);
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
        'User-Agent': 'GEJAST-Live-Shop-Health/1.0',
        ...(options.headers || {})
      }
    });
    return { response, elapsed: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function catalog(url, label) {
  const { response, elapsed } = await fetchWithTimeout(url);
  assert.equal(response.status, 200, `${label} must return HTTP 200, got ${response.status}`);
  const payload = await response.json();
  assert.ok(Array.isArray(payload?.products), `${label} must return products[]`);
  assert.ok(payload.products.length >= MIN_PRODUCTS, `${label} returned only ${payload.products.length} products`);

  const names = new Set(payload.products.map(product => String(product?.name || '').trim().toLowerCase()));
  for (const expected of ['coral', 'hydrangea', 'wild carrot']) {
    assert.ok(names.has(expected), `${label} missing ${expected}`);
  }
  assert.ok([...names].some(name => name.includes('despinoza')), `${label} missing Despinoza merch`);

  const counts = { normal: 0, boxy: 0, merch: 0 };
  for (const product of payload.products) {
    const collection = String(product?.collection || '');
    if (collection in counts) counts[collection] += 1;
    assert.ok(Number(product?.price || 0) > 0, `${label} product ${product?.name} has invalid price`);
    assert.ok(Array.isArray(product?.variants) && product.variants.length > 0, `${label} product ${product?.name} has no variants`);
    assert.ok(Array.isArray(product?.mockups) && product.mockups.length > 0, `${label} product ${product?.name} has no mockups`);
    assert.ok(Array.isArray(product?.sizes) && product.sizes.length > 0, `${label} product ${product?.name} has no sizes`);
  }
  assert.ok(counts.normal > 0, `${label} has no Classic products`);
  assert.ok(counts.boxy > 0, `${label} has no Oversized Boxy products`);
  assert.ok(counts.merch > 0, `${label} has no Merch products`);
  console.log(`${label}: HTTP 200, products=${payload.products.length}, classic=${counts.normal}, boxy=${counts.boxy}, merch=${counts.merch}, ${elapsed}ms`);
  return payload;
}

const { response: pageResponse, elapsed: pageElapsed } = await fetchWithTimeout(SHOP_URL);
assert.equal(pageResponse.status, 200, `Live shop page must return HTTP 200, got ${pageResponse.status}`);
const html = await pageResponse.text();
assert.match(html, /version-watermark[^>]*>v822</, 'Live shop must expose v822 watermark');
assert.match(html, /catalog-recovery-v822\.js\?v=20260903-shop-commerce-v822/, 'Live shop must load v822 catalog recovery');
assert.match(html, /shopify-checkout-v817\.js/, 'Live shop must retain Shopify checkout');
console.log(`shop page: HTTP 200, v822 present, ${pageElapsed}ms`);

const legacy = await catalog(LEGACY_CATALOG_URL, 'shop-catalog');
const v822 = await catalog(V822_CATALOG_URL, 'shop-catalog-v822');
assert.equal(legacy.products.length, v822.products.length, 'legacy and v822 catalog product counts must match');

const legacyIds = new Set(legacy.products.map(product => String(product?.id || '')));
for (const product of v822.products) {
  assert.ok(legacyIds.has(String(product?.id || '')), `legacy catalog missing Shopify product id ${product?.id}`);
}

console.log('RESULT=V822_LIVE_SHOP_CATALOG_PASS');
