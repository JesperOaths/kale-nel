#!/usr/bin/env node
import assert from 'node:assert/strict';

const SHOP_URL = 'https://kalenel.nl/shop/';
const ASSET_VERSION = '20260916-storefront-v833-r1';
const DIRECT_BRIDGE_URL = `https://kalenel.nl/shop/direct-commerce-v832.js?v=${ASSET_VERSION}`;
const DELIVERY_UI_URL = 'https://kalenel.nl/shop/delivery-estimate-v833.js?v=20260916-delivery-v833-r1';
const POLISH_URL = `https://kalenel.nl/shop/storefront-polish-v832.js?v=${ASSET_VERSION}`;
const POLISH_CSS_URL = `https://kalenel.nl/shop/storefront-polish-v832.css?v=${ASSET_VERSION}`;
const COLLECTION_MEDIA_URL = `https://kalenel.nl/shop/collection-media-v831.js?v=${ASSET_VERSION}`;
const PREVIEWS_URL = `https://kalenel.nl/shop/product-preview-overrides.js?v=${ASSET_VERSION}`;
const GALLERY_URL = `https://kalenel.nl/shop/gallery-fixes-v832.js?v=${ASSET_VERSION}`;
const TRANSPARENCY_URL = `https://kalenel.nl/shop/mockup-transparency-v832.js?v=${ASSET_VERSION}`;
const LIGHTBOX_URL = `https://kalenel.nl/shop/image-lightbox-v832.js?v=${ASSET_VERSION}`;
const CATALOG_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-catalog-v828';
const CATALOG_HEALTH_URL = `${CATALOG_URL}?health=1`;
const CHECKOUT_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-manual-checkout-v832';
const CONNECTION_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-production-connection-v828';
const STATUS_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-order-status-v825?health=1';
const ADMIN_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-admin-orders-v825';
const WEBHOOK_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-printify-webhook-v825';
const TIMEOUT_MS = Number(process.env.GEJAST_SHOP_TIMEOUT_MS || 20000);
const MIN_PRODUCTS = Number(process.env.GEJAST_SHOP_MIN_PRODUCTS || 20);
const CATALOG_ATTEMPTS = Number(process.env.GEJAST_SHOP_CATALOG_ATTEMPTS || 8);
const CATALOG_RETRY_MS = Number(process.env.GEJAST_SHOP_CATALOG_RETRY_MS || 4000);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
        'User-Agent': 'GEJAST-Live-Shop-Health/1.7',
        'Cache-Control': 'no-cache',
        ...(options.headers || {})
      }
    });
    return { response, elapsed: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function catalogReady(payload) {
  if (payload?.source !== 'printify-direct-v832') return false;
  if (!Array.isArray(payload?.products) || payload.products.length < MIN_PRODUCTS) return false;
  return payload.products.every(product =>
    Array.isArray(product?.mockups) &&
    product.mockups.length > 0 &&
    /artwork/i.test(String(product.mockups[0]?.label || ''))
  );
}

async function catalog() {
  let payload = null;
  let response = null;
  let elapsed = 0;
  for (let attempt = 1; attempt <= CATALOG_ATTEMPTS; attempt += 1) {
    const result = await fetchWithTimeout(`${CATALOG_URL}?refresh_probe=${Date.now()}-${attempt}`);
    response = result.response;
    elapsed = result.elapsed;
    if (response.status === 200) {
      payload = await response.json();
      if (catalogReady(payload)) break;
    } else {
      payload = null;
    }
    if (attempt < CATALOG_ATTEMPTS) await sleep(CATALOG_RETRY_MS);
  }

  assert.equal(response?.status, 200, `shop-catalog-v828 must return HTTP 200, got ${response?.status}`);
  assert.equal(payload?.source, 'printify-direct-v832', `catalog must identify v832 direct Printify source, got ${payload?.source}`);
  assert.ok(Array.isArray(payload?.products), 'catalog must return products[]');
  assert.ok(payload.products.length >= MIN_PRODUCTS, `catalog returned only ${payload.products.length} products`);

  const names = new Set(payload.products.map(product => String(product?.name || '').trim().toLowerCase()));
  for (const expected of ['coral', 'hydrangea', 'wild carrot', 'jellyfish']) {
    assert.ok(names.has(expected), `catalog missing ${expected}`);
  }
  assert.ok([...names].some(name => name.includes('despinoza')), 'catalog missing Despinoza merch');

  const counts = { normal: 0, boxy: 0, merch: 0 };
  const skus = new Set();
  const missingArtwork = [];
  for (const product of payload.products) {
    const collection = String(product?.collection || '');
    if (collection in counts) counts[collection] += 1;
    assert.ok(Number(product?.price || 0) > 0, `product ${product?.name} has invalid price`);
    assert.equal(Number.isInteger(Number(product?.price)), true, `${product?.name} display price must be a whole euro`);
    assert.ok(Array.isArray(product?.variants) && product.variants.length > 0, `product ${product?.name} has no variants`);
    assert.ok(Array.isArray(product?.mockups) && product.mockups.length > 0, `product ${product?.name} has no media`);
    assert.ok(Array.isArray(product?.sizes) && product.sizes.length > 0, `product ${product?.name} has no sizes`);
    if (!/artwork/i.test(String(product.mockups[0]?.label || ''))) missingArtwork.push(String(product?.name || product?.id || 'unknown'));
    const mediaUrls = product.mockups.map(view => String(view?.image || '')).filter(Boolean);
    assert.equal(new Set(mediaUrls).size, mediaUrls.length, `${product?.name} must not contain duplicate image URLs`);
    assert.equal(product.mockups.filter(view => /artwork/i.test(String(view?.label || ''))).length, 1, `${product?.name} must contain exactly one artwork slide`);
    assert.equal(String(product?.image || ''), String(product.mockups[0]?.image || ''), `${product?.name} primary image must be first artwork image`);

    const variantPrices = [];
    for (const variant of product.variants) {
      assert.match(String(variant?.color || ''), /^white$/i, `${product?.name} exposed a non-white variant`);
      assert.ok(String(variant?.sku || '').trim(), `${product?.name} has a blank variant SKU`);
      assert.ok(!skus.has(String(variant.sku)), `duplicate variant SKU ${variant.sku}`);
      skus.add(String(variant.sku));
      assert.ok(Number(variant?.price || 0) > 0, `${product?.name} variant ${variant?.id} has invalid price`);
      assert.equal(Number.isInteger(Number(variant.price)), true, `${product?.name} variant ${variant?.id} price must be a whole euro`);
      if (variant?.is_available !== false && variant?.is_enabled !== false) variantPrices.push(Number(variant.price));
    }
    if (variantPrices.length) assert.equal(Number(product.price), Math.min(...variantPrices), `${product?.name} product price must be the minimum available cost+€5 variant price`);
  }

  assert.deepEqual(missingArtwork, [], `every clothing article must have artwork first; missing: ${missingArtwork.join(', ')}`);
  assert.ok(counts.normal > 0, 'catalog has no Classic products');
  assert.ok(counts.boxy > 0, 'catalog has no Oversized Boxy products');
  assert.ok(counts.merch > 0, 'catalog has no Merch products');
  console.log(`shop-catalog-v832: HTTP 200, products=${payload.products.length}, variants=${skus.size}, classic=${counts.normal}, boxy=${counts.boxy}, merch=${counts.merch}, ${elapsed}ms`);
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

// Deliberately read-only: never POST checkout, delivery preview, verify payment,
// submit an order, mutate prices, or simulate a webhook. Delivery preview behavior
// is covered separately by its route-level smoke tests; this check verifies wiring.
const { response: pageResponse, elapsed: pageElapsed } = await fetchWithTimeout(`${SHOP_URL}?v=${ASSET_VERSION}`);
assert.equal(pageResponse.status, 200, `Live shop page must return HTTP 200, got ${pageResponse.status}`);
const html = await pageResponse.text();
assert.match(html, /version-watermark[^>]*>v833</, 'Live shop must expose v833 watermark');
assert.match(html, /direct-commerce-v832\.js\?v=20260916-storefront-v833-r1/, 'Live shop must load the v833-busted direct commerce bridge');
assert.match(html, /manual-checkout-v825\.js\?v=20260916-storefront-v833-r1/, 'Live shop must retain hardened checkout UI shell');
assert.match(html, /storefront-polish-v832\.js\?v=20260916-storefront-v833-r1/, 'Live shop must load artwork-primary storefront policy');
assert.match(html, /storefront-polish-v832\.css\?v=20260916-storefront-v833-r1/, 'Live shop must load transparent media CSS');
assert.match(html, /product-preview-overrides\.js\?v=20260916-storefront-v833-r1/, 'Live shop must load artwork-first compatibility layer');
assert.match(html, /gallery-fixes-v832\.js\?v=20260916-storefront-v833-r1/, 'Live shop must load exact carousel repair');
assert.match(html, /mockup-transparency-v832\.js\?v=20260916-storefront-v833-r1/, 'Live shop must load safe background transparency processor');
assert.match(html, /collection-media-v831\.js\?v=20260916-storefront-v833-r1/, 'Live shop must retain collection media normalization');
assert.match(html, /image-lightbox-v832\.js\?v=20260916-storefront-v833-r1/, 'Live shop must load full-view lightbox');
assert.doesNotMatch(html, /direct-commerce-v828\.js|mockup-background-v830\.js|image-lightbox-v830\.js/, 'old active media/commerce handlers must not remain in the live page');
assert.doesNotMatch(html, />[^<]*Printify[^<]*</i, 'Public shop shell must not expose supplier branding');
console.log(`shop page: HTTP 200, v833 present, ${pageElapsed}ms`);

const bridge = await textAsset(DIRECT_BRIDGE_URL, 'direct-commerce-v832.js');
assert.match(bridge, /shop-catalog-v828/, 'bridge must use direct catalog endpoint');
assert.match(bridge, /shop-manual-checkout-v832/, 'bridge must route checkout to v832 authority');
assert.match(bridge, /delivery-estimate-v833\.js/, 'bridge must load the v833 delivery estimate UI');
assert.match(bridge, /shop-delivery-preview-v833/, 'bridge must declare the v833 delivery preview authority');
assert.match(bridge, /pricing:'fulfillment-cost-plus-5-rounded-up'/, 'bridge must declare cost+€5 pricing');
assert.match(bridge, /artworkFirstGallery:true/, 'bridge must declare artwork-first gallery');
assert.match(bridge, /usesShopifyCatalogApi:false/, 'bridge must declare Shopify catalog API disabled');
assert.match(bridge, /usesShopifyPriceApi:false/, 'bridge must declare Shopify price API disabled');

const deliveryUi = await textAsset(DELIVERY_UI_URL, 'delivery-estimate-v833.js');
assert.match(deliveryUi, /Ships from/, 'checkout delivery panel must show fulfillment origin');
assert.match(deliveryUi, /Estimated arrival/, 'checkout delivery panel must show estimated arrival');
assert.match(deliveryUi, /business days after payment verification/, 'arrival estimate must start after payment verification');
assert.match(deliveryUi, /may_arrive_separately/, 'checkout delivery panel must warn about split fulfillment');
assert.match(deliveryUi, /Refresh estimate/, 'delivery estimate must be refreshable without blocking checkout');

const previews = await textAsset(PREVIEWS_URL, 'product-preview-overrides.js');
assert.match(previews, /prefersOriginalArtworkPng:\s*true/, 'original Printify artwork PNG must be preferred');
assert.match(previews, /placement:\s*'first'/, 'artwork must be first');
assert.match(previews, /primaryImageIsArtwork:\s*true/, 'artwork must be primary image');

const polish = await textAsset(POLISH_URL, 'storefront-polish-v832.js');
assert.match(polish, /artworkPrimaryImage:true/, 'storefront policy must keep artwork primary');
assert.match(polish, /product\.image=views\[0\]\.image/, 'storefront policy must use first gallery image as primary');
assert.match(polish, /Shipping is calculated from your delivery address/, 'checkout copy must remain customer-facing');

const polishCss = await textAsset(POLISH_CSS_URL, 'storefront-polish-v832.css');
assert.match(polishCss, /\.mockup img[\s\S]*background:\s*transparent !important/, 'product media pixels must display transparently');

const gallery = await textAsset(GALLERY_URL, 'gallery-fixes-v832.js');
assert.match(gallery, /flex:0 0 100%!important/, 'each gallery slide must occupy exactly one viewport');
assert.match(gallery, /scroll-snap-stop:always!important/, 'gallery slides must snap individually');
assert.match(gallery, /partialNextSlide:false/, 'gallery policy must forbid partial next-slide peeking');

const transparency = await textAsset(TRANSPARENCY_URL, 'mockup-transparency-v832.js');
assert.match(transparency, /function subjectSpans/, 'transparency processor must protect white garment spans');
assert.match(transparency, /data\[index\*4\+3\]=0/, 'studio background must become alpha transparent');
assert.match(transparency, /preservesWhiteGarments:true/, 'white garments must be preserved');
assert.match(transparency, /tagViewIncluded:true/, 'tag image must be included in transparency processing');
assert.match(transparency, /safeFallbackToOriginal:true/, 'unsafe transparency output must fall back to the original image');
assert.match(transparency, /noOneSidedSpanBridge:true/, 'foreground span bridging must not preserve bars beyond the garment');

const collectionMedia = await textAsset(COLLECTION_MEDIA_URL, 'collection-media-v831.js');
assert.match(collectionMedia, /preservesWhiteGarment:\s*true/, 'collection media must preserve white shirt fill');
assert.match(collectionMedia, /cropsToLargestGarment:\s*true/, 'collection media must scale collection shirts consistently');

const lightbox = await textAsset(LIGHTBOX_URL, 'image-lightbox-v832.js');
assert.match(lightbox, /position:absolute!important/, 'Fit must use absolute contained image positioning');
assert.match(lightbox, /inset:var\(--lb-pad-y\) var\(--lb-pad-x\)!important/, 'Fit must keep controlled lightbox padding');
assert.match(lightbox, /width:calc\(100% - var\(--lb-pad-x\) - var\(--lb-pad-x\)\)!important/, 'Fit must not overflow the media frame horizontally');
assert.match(lightbox, /height:calc\(100% - var\(--lb-pad-y\) - var\(--lb-pad-y\)\)!important/, 'Fit must not overflow the media frame vertically');
assert.match(lightbox, /fitMode:'media-contained'/, 'lightbox must advertise contained media fit');
assert.match(lightbox, /allGalleryImages:true/, 'lightbox must include artwork and tag views in gallery order');
assert.doesNotMatch(lightbox, /EXCLUDE_FROM_EXPANDED_RE/, 'lightbox must not silently omit artwork/detail views');

const liveCatalog = await catalog();
const hydrangea = liveCatalog.products.find(product => /^hydrangea$/i.test(String(product?.name || '').trim()));
assert.ok(hydrangea, 'Hydrangea product must exist');
console.log(`Hydrangea live price: €${hydrangea.price}`);

const catalogHealth = await health(CATALOG_HEALTH_URL, 'shop-catalog-v828', 'printify-direct-catalog-v832');
assert.equal(catalogHealth?.usesShopifyApi, false, 'catalog health must report no Shopify API use');
assert.equal(catalogHealth?.whiteVariantsOnly, true, 'catalog health must report white-only variants');
assert.equal(catalogHealth?.pricing, 'fulfillment-cost-plus-5-rounded-up', 'catalog health must report cost+€5 pricing');
assert.equal(catalogHealth?.pricingBase, 'printify-variant-cost', 'catalog must price from Printify production cost');
assert.equal(catalogHealth?.marginEuros, 5, 'catalog margin must be exactly €5');
assert.equal(catalogHealth?.rounding, 'whole-euro-ceiling', 'catalog must round upward to whole euros');
assert.equal(catalogHealth?.artworkFirst, true, 'catalog health must report artwork-first media');

const checkoutHealth = await health(CHECKOUT_URL, 'shop-manual-checkout-v832', 'manual-payment-v832');
assert.equal(checkoutHealth?.pricing, 'fulfillment-cost-plus-5-rounded-up', 'checkout must use same cost+€5 pricing authority');
assert.equal(checkoutHealth?.pricingBase, 'printify-variant-cost', 'checkout must reprice from fresh Printify production cost');
assert.equal(checkoutHealth?.marginEuros, 5, 'checkout margin must be exactly €5');
assert.equal(checkoutHealth?.rounding, 'whole-euro-ceiling', 'checkout must round upward to whole euros');
assert.equal(checkoutHealth?.sends_to_production, false, 'customer checkout must not send orders to production');
assert.ok(Number(checkoutHealth?.cached_products || 0) >= MIN_PRODUCTS, 'checkout must see the cached catalog');
assert.equal(checkoutHealth?.payment_configured, true, 'manual payment must be configured');
assert.equal(checkoutHealth?.email_configured, true, 'buyer confirmation email must be configured');

await health(CONNECTION_URL, 'shop-production-connection-v828', 'production-connection-v828');
await health(STATUS_URL, 'shop-order-status-v825', 'order-status-v825');
await health(ADMIN_URL, 'shop-admin-orders-v825', 'admin-orders-v825');
await health(WEBHOOK_URL, 'shop-printify-webhook-v825', 'printify-webhook-v825');

console.log('RESULT=V833_DELIVERY_ESTIMATE_PASS');
