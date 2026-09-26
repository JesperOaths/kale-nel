#!/usr/bin/env node
import assert from 'node:assert/strict';

const SHOP_URL = 'https://kalenel.nl/shop/';
const ASSET_VERSION = '20260916-storefront-v837-r1';
const SHOP_V869_VERSION = '20260926-storefront-v869-r2';
const DIRECT_V869_VERSION = '20260926-storefront-v869-r3';
const TRANSPARENCY_V869_VERSION = '20260926-storefront-v869-r3';
const STYLES_V869_VERSION = '20260926-storefront-v869-r5';
const COLLECTION_MEDIA_VERSION = '20260921-storefront-v857-r1';
const DIRECT_BRIDGE_URL = `https://kalenel.nl/shop/direct-commerce-v832.js?v=${DIRECT_V869_VERSION}`;
const DELIVERY_UI_URL = 'https://kalenel.nl/shop/delivery-estimate-v833.js?v=20260926-delivery-v871-r1';
const MANUAL_CHECKOUT_UI_URL = 'https://kalenel.nl/shop/manual-checkout-v825.js?v=20260926-checkout-v871-r1';
const SHOP_ANALYTICS_URL = 'https://kalenel.nl/shop/shop-analytics-v841.js?v=20260920-shop-analytics-v841-r1';
const CUSTOMER_UI_URL = 'https://kalenel.nl/shop/customer-facing-checkout-v837.js?v=20260916-storefront-v837-r2';
const POLISH_URL = `https://kalenel.nl/shop/storefront-polish-v832.js?v=${ASSET_VERSION}`;
const POLISH_CSS_URL = `https://kalenel.nl/shop/storefront-polish-v832.css?v=${SHOP_V869_VERSION}`;
const COLLECTION_MEDIA_URL = `https://kalenel.nl/shop/collection-media-v831.js?v=${COLLECTION_MEDIA_VERSION}`;
const PREVIEWS_URL = `https://kalenel.nl/shop/product-preview-overrides.js?v=${ASSET_VERSION}`;
const GALLERY_URL = `https://kalenel.nl/shop/gallery-fixes-v832.js?v=${SHOP_V869_VERSION}`;
const TRANSPARENCY_URL = `https://kalenel.nl/shop/mockup-transparency-v832.js?v=${TRANSPARENCY_V869_VERSION}`;
const LIGHTBOX_URL = `https://kalenel.nl/shop/image-lightbox-v832.js?v=${ASSET_VERSION}`;
const STYLES_URL = `https://kalenel.nl/shop/styles.css?v=${STYLES_V869_VERSION}`;
const CATALOG_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-catalog-v828';
const CATALOG_HEALTH_URL = `${CATALOG_URL}?health=1`;
const CHECKOUT_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-manual-checkout-v832';
const DELIVERY_PREVIEW_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-delivery-preview-v833';
const CONNECTION_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-production-connection-v828';
const STATUS_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-order-status-v825?health=1';
const ADMIN_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-admin-orders-v825';
const ADMIN_ANALYTICS_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-admin-analytics-v843';
const ADMIN_AUTH_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/admin-auth-v845';
const SHOP_OPS_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-ops-v847';
const ADMIN_EXPORT_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-admin-export-v847';
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
        'User-Agent': 'GEJAST-Live-Shop-Health/1.8',
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
  if (payload?.source !== 'printify-live-v851') return false;
  if (payload?.catalogSelection !== 'all-readable-printify-shops-v851') return false;
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
  assert.equal(payload?.source, 'printify-live-v851', `catalog must identify the live Printify source, got ${payload?.source}`);
  assert.equal(payload?.catalogSelection, 'all-readable-printify-shops-v851', `catalog must mirror all readable Printify shops, got ${payload?.catalogSelection}`);
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
    if(!/\btote\b/i.test(String(product?.name || product?.baseLabel || ''))) assert.ok(Array.isArray(product?.sizes) && product.sizes.length > 0, `product ${product?.name} has no sizes`);
    if (!/artwork/i.test(String(product.mockups[0]?.label || ''))) missingArtwork.push(String(product?.name || product?.id || 'unknown'));
    const mediaUrls = product.mockups.map(view => String(view?.image || '')).filter(Boolean);
    assert.equal(new Set(mediaUrls).size, mediaUrls.length, `${product?.name} must not contain duplicate image URLs`);
    assert.equal(product.mockups.filter(view => /artwork/i.test(String(view?.label || ''))).length, 1, `${product?.name} must contain exactly one artwork slide`);
    assert.equal(String(product?.image || ''), String(product.mockups[0]?.image || ''), `${product?.name} primary image must be first artwork image`);

    const variantPrices = [];
    for (const variant of product.variants) {
      const tote = /\btote\b/i.test(String(product?.name || product?.baseLabel || ''));
      if(tote) assert.match(String(variant?.color || ''), /^(?:black|white)$/i, `${product?.name} exposed an unsupported tote handle color`);
      else assert.match(String(variant?.color || ''), /^white$/i, `${product?.name} exposed a non-white clothing variant`);
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


// Production-safe validation is allowed only through checkout's validation_only
// mode. It exercises fresh Printify pricing/shipping without creating an order,
// sending email, requesting payment, or submitting anything to production.
const { response: pageResponse, elapsed: pageElapsed } = await fetchWithTimeout(`${SHOP_URL}?v=${ASSET_VERSION}`);
assert.equal(pageResponse.status, 200, `Live shop page must return HTTP 200, got ${pageResponse.status}`);
const html = await pageResponse.text();
assert.match(html, /version-watermark[^>]*>v871</, 'Live shop must expose v871 watermark');
assert.match(html, /direct-commerce-v832\\.js\\?v=20260926-storefront-v869-r3/, 'Live shop must retain the direct commerce bridge');
assert.match(html, /store\\.js\\?v=20260926-storefront-v869-r2/, 'Live shop must load the current default-on animal-filter storefront runtime');
assert.match(html, /styles\\.css\\?v=20260926-storefront-v869-r5/, 'Live shop must load the staggered incomplete-row layout stylesheet');
assert.match(html, /data-animal-filter checked/, 'Live shop must show animal designs by default');
assert.match(html, /data-animal-section/, 'Live shop must keep animal designs in a separate trailing section');
const liveRegularGridPos = html.indexOf('data-products');
const liveAnimalFilterPos = html.indexOf('data-animal-filter-bar');
const liveAnimalSectionPos = html.indexOf('data-animal-section');
assert.ok(liveRegularGridPos >= 0 && liveAnimalFilterPos > liveRegularGridPos && liveAnimalSectionPos > liveAnimalFilterPos, 'live animal toggle must sit between the non-animal and animal sections');
assert.match(html, /data-open-size-guide/, 'Live shop must expose the cart-adjacent size chart control');
assert.match(html, /data-size-guide-panel/, 'Live shop must include the contextual size chart modal');
assert.match(html, /data-size-guide-overlay/, 'Live shop must include the full-screen size chart backdrop');
assert.match(html, /data-size-guide-visual/, 'Live shop must include the measurement illustration region');
assert.doesNotMatch(html, /catalog-data\.js/, 'Live shop must not load the retired static catalog fallback');
assert.match(html, /tote-handle-color-v839\.js\?v=20260916-storefront-v839-r1/, 'Live shop must load tote handle-color behavior');
assert.match(html, /delivery-estimate-v833\.js\?v=20260926-delivery-v871-r1/, 'Live shop must load the current delivery estimate UI');
assert.match(html, /manual-checkout-v825\.js\?v=20260926-checkout-v871-r1/, 'Live shop must retain hardened checkout UI shell');
assert.match(html, /customer-facing-checkout-v837\.js\?v=20260916-storefront-v837-r2/, 'Live shop must load v837 customer-facing checkout totals/copy layer');
assert.match(html, /storefront-polish-v832\.js\?v=20260916-storefront-v837-r1/, 'Live shop must load artwork-primary storefront policy');
assert.match(html, /storefront-polish-v832\\.css\\?v=20260926-storefront-v869-r2/, 'Live shop must load transparent media CSS');
assert.match(html, /product-preview-overrides\.js\?v=20260916-storefront-v837-r1/, 'Live shop must load artwork-first compatibility layer');
assert.match(html, /gallery-fixes-v832\\.js\\?v=20260926-storefront-v869-r2/, 'Live shop must load exact carousel repair');
assert.match(html, /mockup-transparency-v832\\.js\\?v=20260926-storefront-v869-r3/, 'Live shop must load safe background transparency processor');
assert.match(html, /collection-media-v831\.js\?v=20260921-storefront-v857-r1/, 'Live shop must retain current collection media normalization');
assert.match(html, /image-lightbox-v832\.js\?v=20260916-storefront-v837-r1/, 'Live shop must load full-view lightbox');
assert.doesNotMatch(html, /direct-commerce-v828\.js|mockup-background-v830\.js|image-lightbox-v830\.js/, 'old active media/commerce handlers must not remain in the live page');
assert.doesNotMatch(html, />[^<]*(?:Printify|factor(?:y|ies))[^<]*</i, 'Public shop shell must not expose supplier/factory wording');
console.log(`shop page: HTTP 200, v871 present, ${pageElapsed}ms`);

const toteUi = await textAsset('https://kalenel.nl/shop/tote-handle-color-v839.js?v=20260916-storefront-v839-r1', 'tote-handle-color-v839.js');
assert.match(toteUi, /Handle color/, 'tote selector must be Handle color');
assert.match(toteUi, /Black.*White|White.*Black/s, 'tote selector must expose Black and White');
assert.match(toteUi, /variantBoundMockups:\s*true/, 'tote gallery must use selected-variant mockups');
assert.match(toteUi, /sharedArtworkFirst:\s*true/, 'tote gallery must keep the artwork as slide one for every handle color');
assert.match(toteUi, /exactVariantSelection:\s*true/, 'tote cart must use the exact selected variant');

const bridge = await textAsset(DIRECT_BRIDGE_URL, 'direct-commerce-v832.js');
assert.match(bridge, /shop-catalog-v828/, 'bridge must use direct catalog endpoint');
assert.match(bridge, /shop-manual-checkout-v832/, 'bridge must route checkout to v832 authority');
assert.match(bridge, /delivery-estimate-v833\.js/, 'bridge must load the v833 delivery estimate UI');
assert.match(bridge, /shop-delivery-preview-v833/, 'bridge must declare the v833 delivery preview authority');
assert.match(bridge, /pricing:'production-cost-plus-size-margin-rounded-up'/, 'bridge must declare size-aware production-cost pricing');
assert.match(bridge, /artworkFirstGallery:true/, 'bridge must declare artwork-first gallery');
assert.match(bridge, /usesShopifyCatalogApi:false/, 'bridge must declare Shopify catalog API disabled');
assert.match(bridge, /usesShopifyPriceApi:false/, 'bridge must declare Shopify price API disabled');


const analyticsUi = await textAsset(SHOP_ANALYTICS_URL, 'shop-analytics-v841.js');
assert.match(analyticsUi, /gejast_visitor_id_v2/, 'shop analytics must reuse the site visitor identity');
assert.match(analyticsUi, /product_view/, 'shop analytics must track product views');
assert.match(analyticsUi, /add_to_cart/, 'shop analytics must track cart additions');
assert.match(analyticsUi, /checkout_start/, 'shop analytics must track checkout starts');
assert.match(analyticsUi, /order_created/, 'shop analytics must track created orders');

const manualCheckoutUi = await textAsset(MANUAL_CHECKOUT_UI_URL, 'manual-checkout-v825.js');
assert.match(manualCheckoutUi, /bruis:order-created/, 'checkout must emit the v841 order-created analytics event');
assert.match(manualCheckoutUi, /async function postCheckoutWithRetry\(payload\)/, 'live checkout UI must retry transient failures idempotently');
assert.match(manualCheckoutUi, /syncPhoneRequirement/, 'checkout UI must dynamically require phone for US delivery');
assert.match(manualCheckoutUi, /Phone \(required for US delivery\)/, 'checkout UI must explain why the US phone is required');
assert.match(manualCheckoutUi, /A phone number is required for delivery to the United States/, 'checkout UI must stop a US order without a phone');

const deliveryUi = await textAsset(DELIVERY_UI_URL, 'delivery-estimate-v833.js');
assert.match(deliveryUi, /Prepared in/, 'checkout delivery panel must show production location');
assert.match(deliveryUi, /Estimated arrival/, 'checkout delivery panel must show estimated arrival');
assert.match(deliveryUi, /business days after payment verification/, 'arrival estimate must start after payment verification');
assert.match(deliveryUi, /may_arrive_separately/, 'checkout delivery panel must warn about split fulfillment');
assert.match(deliveryUi, /Refresh estimate/, 'delivery estimate must be refreshable without blocking checkout');
assert.match(deliveryUi, /async function fetchPreview\(payload\)/, 'live delivery UI must retry transient quote failures');
assert.doesNotMatch(deliveryUi, /printify|factor(?:y|ies)/i, 'delivery UI must remain customer-facing and supplier-neutral');

const customerUi = await textAsset(CUSTOMER_UI_URL, 'customer-facing-checkout-v837.js');
assert.match(customerUi, /Total incl\. shipping/, 'checkout must expose a shipping-inclusive grand total');
assert.match(customerUi, /Products \$\{money\(subtotal\)\} \+ shipping \$\{money\(shipping\)\}/, 'grand total must show products plus shipping');
assert.match(customerUi, /supplierBrandingHidden:\s*true/, 'customer-facing layer must declare supplier branding hidden');
assert.match(customerUi, /replace\(\/\\bPrintify\\b\/gi, 'Bruis'\)/, 'legacy supplier name must be rewritten for customers');
assert.match(customerUi, /production locations/, 'factory wording must be rewritten to production locations');

const previews = await textAsset(PREVIEWS_URL, 'product-preview-overrides.js');
assert.match(previews, /prefersOriginalArtworkPng:\s*true/, 'original artwork PNG must be preferred');
assert.match(previews, /placement:\s*'first'/, 'artwork must be first');
assert.match(previews, /primaryImageIsArtwork:\s*true/, 'artwork must be primary image');

const polish = await textAsset(POLISH_URL, 'storefront-polish-v832.js');
assert.match(polish, /artworkPrimaryImage:true/, 'storefront policy must keep artwork primary');
assert.match(polish, /product\.image=views\[0\]\.image/, 'storefront policy must use first gallery image as primary');
assert.match(polish, /Shipping is calculated from your delivery address/, 'checkout copy must remain customer-facing');
assert.doesNotMatch(polish, /printify|factor(?:y|ies)/i, 'storefront customer copy must remain supplier-neutral');

const polishCss = await textAsset(POLISH_CSS_URL, 'storefront-polish-v832.css');
assert.match(polishCss, /\.mockup img[\s\S]*background:\s*transparent !important/, 'product media pixels must display transparently');
assert.match(polishCss, /--shop-image-backdrop:\s*transparent/, 'active media backdrop must be transparent');

const baseStyles = await textAsset(STYLES_URL, 'styles.css');
assert.match(baseStyles, /\.product-grid\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/, 'live desktop product sections must use six half-card tracks');
assert.match(baseStyles, /\.product-grid > \.product-card[\s\S]*grid-column:\s*span 2/, 'live normal product cards must span two half-card tracks');
assert.match(baseStyles, /last-child:nth-child\(3n \+ 1\)[\s\S]*grid-column:\s*3 \/ span 2/, 'live one-item desktop last rows must be centered');
assert.match(baseStyles, /nth-last-child\(2\):nth-child\(3n \+ 1\)[\s\S]*grid-column:\s*2 \/ span 2/, 'live first of two remaining products must sit beneath the first preceding gap');
assert.match(baseStyles, /last-child:nth-child\(3n \+ 2\)[\s\S]*grid-column:\s*4 \/ span 2/, 'live second of two remaining products must sit beneath the second preceding gap');
assert.match(baseStyles, /\.mockup-rail\s*\{[\s\S]*background:\s*transparent/, 'live product rails must be transparent');
assert.match(baseStyles, /\.cart-line img[^{]*\{[^}]*background:\s*transparent/, 'live cart product thumbnails must be transparent');

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
assert.match(transparency, /function cropBounds/, 'mockup transparency must crop empty transparent whitespace');
assert.match(transparency, /cropsTransparentWhitespace:true/, 'mockup policy must declare transparent-whitespace cropping');
assert.match(transparency, /eager:true/, 'mockups must be processed immediately rather than on scroll');
assert.doesNotMatch(transparency, /new IntersectionObserver/, 'mockup cleanup must not wait for viewport visibility');

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
const dispuutShirtIds = new Set(['6a975ec45d07cc05a702a491','6a9742c08816f2362104d5cc']);
const dispuutShirts = liveCatalog.products.filter(product => dispuutShirtIds.has(String(product?.id || '').trim()));
assert.equal(dispuutShirts.length, 2, 'both approved Despinoza shirt products must exist');
for (const product of dispuutShirts) {
  const back = (Array.isArray(product?.mockups) ? product.mockups : []).find(item => String(item?.label || '').toLowerCase() === 'back');
  assert.ok(back?.image, `${product.name} must expose a back mockup`);
  assert.match(String(back.image), /[?&]kv=\d+/, `${product.name} back mockup must be cache-busted by product updated_at`);
}
const hydrangea = liveCatalog.products.find(product => /^hydrangea$/i.test(String(product?.name || '').trim()));
assert.ok(hydrangea, 'Hydrangea product must exist');
console.log(`Hydrangea live price: €${hydrangea.price}`);

const availableVariant = (product, wantedSize) => (Array.isArray(product?.variants) ? product.variants : [])
  .find(variant => variant?.is_available !== false && variant?.is_enabled !== false && String(variant?.size || '').trim().toUpperCase() === wantedSize);
const standardVariant = availableVariant(hydrangea, 'M');
assert.ok(standardVariant, 'Hydrangea must expose an available M variant for checkout smoke tests');
const largeProduct = liveCatalog.products.find(product =>
  /^crown imperial$/i.test(String(product?.name || '').trim()) &&
  !!availableVariant(product, '3XL')
) || liveCatalog.products.find(product =>
  String(product?.id || '') !== String(hydrangea?.id || '') &&
  !/\btote\b/i.test(String(product?.name || product?.baseLabel || '')) &&
  !!availableVariant(product, '3XL')
);
assert.ok(largeProduct, 'catalog must expose an available 3XL clothing variant for large-size checkout validation');
const largeVariant = availableVariant(largeProduct, '3XL');

const smokeCustomer = {
  name: 'Kalenel Checkout Test',
  email: 'checkout-test@example.invalid',
  phone: '',
  address1: 'Museumstraat 1',
  address2: '',
  zip: '1071 XX',
  city: 'Amsterdam',
  region: 'Noord-Holland',
  country: 'NL'
};
const smokeItems = [
  {
    product_id: String(hydrangea.id),
    variant_id: String(standardVariant.id),
    name: String(hydrangea.name),
    size: String(standardVariant.size || 'M'),
    sku: String(standardVariant.sku || ''),
    qty: 1
  },
  {
    product_id: String(largeProduct.id),
    variant_id: String(largeVariant.id),
    name: String(largeProduct.name),
    size: String(largeVariant.size || '3XL'),
    sku: String(largeVariant.sku || ''),
    qty: 1
  }
];

async function postValidation(url, payload, label) {
  let last = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { response, elapsed } = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://kalenel.nl' },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body?.ok) {
        console.log(`${label}: HTTP ${response.status}, ${elapsed}ms`);
        return body;
      }
      last = `HTTP ${response.status}: ${JSON.stringify(body).slice(0, 400)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 2) await sleep(1200);
  }
  assert.fail(`${label} failed: ${last}`);
}

const deliverySmoke = await postValidation(
  DELIVERY_PREVIEW_URL,
  { customer: smokeCustomer, items: smokeItems },
  'shop-delivery-preview-v833 production smoke'
);
assert.ok(Number(deliverySmoke.shipping_cents) > 0, 'delivery smoke must return a positive shipping quote');
assert.ok(String(deliverySmoke.shipping_method || '').trim(), 'delivery smoke must return a shipping method');

const checkoutSmoke = await postValidation(
  CHECKOUT_URL,
  { customer: smokeCustomer, items: smokeItems, validation_only: true },
  'shop-manual-checkout-v832 validation-only smoke'
);
assert.equal(checkoutSmoke.validation_only, true, 'checkout smoke must remain non-ordering');
const expectedSmokeSubtotal = Math.round((Number(standardVariant.price) + Number(largeVariant.price)) * 100);
assert.equal(Number(checkoutSmoke.subtotal_cents), expectedSmokeSubtotal, 'checkout authority must match live catalog pricing for M + 3XL');
assert.ok(Number(checkoutSmoke.shipping_cents) > 0, 'checkout smoke must obtain shipping');
assert.equal(Number(checkoutSmoke.total_cents), Number(checkoutSmoke.subtotal_cents) + Number(checkoutSmoke.shipping_cents), 'checkout total must equal products plus shipping');

// v870 regression: Dogwood and Hydrangea both have a validated EU provider-30
// route. A Netherlands order must remain one parcel instead of silently
// stacking two base shipping charges.
const dogwood = liveCatalog.products.find(product => /^dogwood$/i.test(String(product?.name || '').trim()));
assert.ok(dogwood, 'Dogwood product must exist for EU consolidation smoke test');
const dogwoodM = availableVariant(dogwood, 'M');
assert.ok(dogwoodM, 'Dogwood must expose an available M variant');
const hydrangeaM = availableVariant(hydrangea, 'M');
assert.ok(hydrangeaM, 'Hydrangea must expose an available M variant');

const euPairItems = [
  {
    product_id: String(dogwood.id),
    variant_id: String(dogwoodM.id),
    name: String(dogwood.name),
    size: String(dogwoodM.size || 'M'),
    sku: String(dogwoodM.sku || ''),
    qty: 1
  },
  {
    product_id: String(hydrangea.id),
    variant_id: String(hydrangeaM.id),
    name: String(hydrangea.name),
    size: String(hydrangeaM.size || 'M'),
    sku: String(hydrangeaM.sku || ''),
    qty: 1
  }
];

const euPairDelivery = await postValidation(
  DELIVERY_PREVIEW_URL,
  { customer: smokeCustomer, items: euPairItems },
  'EU Dogwood + Hydrangea consolidation smoke'
);
assert.equal(Number(euPairDelivery.provider_groups), 1, 'Dogwood + Hydrangea NL/EU order must use one fulfillment provider');
assert.equal(euPairDelivery.shipping_stacks, false, 'Dogwood + Hydrangea NL/EU order must not stack shipping');
assert.equal(euPairDelivery.may_arrive_separately, false, 'Dogwood + Hydrangea NL/EU order must remain one parcel');
assert.equal(Array.isArray(euPairDelivery.shipping_breakdown) ? euPairDelivery.shipping_breakdown.length : 0, 1, 'Dogwood + Hydrangea NL/EU shipping must have one breakdown group');

const euPairCheckout = await postValidation(
  CHECKOUT_URL,
  { customer: smokeCustomer, items: euPairItems, validation_only: true },
  'EU Dogwood + Hydrangea checkout consolidation smoke'
);
assert.equal(euPairCheckout.validation_only, true, 'EU pair checkout test must remain non-ordering');
assert.equal(Number(euPairCheckout.shipping_cents), Number(euPairDelivery.shipping_cents), 'checkout and delivery preview must agree on consolidated EU shipping');

const catalogHealth = await health(CATALOG_HEALTH_URL, 'shop-catalog-v828', 'bruis-direct-catalog-v838');
assert.equal(catalogHealth?.usesShopifyApi, false, 'catalog health must report no Shopify API use');
assert.equal(catalogHealth?.whiteVariantsOnly, false, 'catalog health must report the tote color exception');
assert.deepEqual(catalogHealth?.toteHandleColors, ['Black', 'White'], 'catalog health must expose exactly Black and White tote handle colors');
assert.equal(catalogHealth?.pricing, 'production-cost-plus-size-margin-rounded-up', 'catalog health must report size-aware production-cost pricing');
assert.equal(catalogHealth?.pricingBase, 'production-cost', 'catalog must price from converted production cost');
assert.deepEqual(catalogHealth?.marginEuros, { standard: 5, threeXlPlus: 7 }, 'catalog margin must be €5 standard and €7 for 3XL+');
assert.equal(catalogHealth?.rounding, 'whole-euro-ceiling', 'catalog must round upward to whole euros');
assert.equal(catalogHealth?.artworkFirst, true, 'catalog health must report artwork-first media');

const checkoutHealth = await health(CHECKOUT_URL, 'shop-manual-checkout-v832', 'manual-payment-v832');
assert.equal(checkoutHealth?.pricing, 'production-cost-plus-size-margin-rounded-up', 'checkout must use the same size-aware pricing authority');
assert.equal(checkoutHealth?.pricingBase, 'production-cost', 'checkout must reprice from fresh production cost');
assert.deepEqual(checkoutHealth?.marginEuros, { standard: 5, threeXlPlus: 7 }, 'checkout margin must be €5 standard and €7 for 3XL+');
assert.equal(checkoutHealth?.rounding, 'whole-euro-ceiling', 'checkout must round upward to whole euros');
assert.equal(checkoutHealth?.sends_to_production, false, 'customer checkout must not send orders to production');
assert.equal(checkoutHealth?.fulfillment_routing, 'validated-approved-regional-plus-canonical', 'checkout must evaluate validated approved regional routes alongside canonical products');
assert.ok(Number(checkoutHealth?.approved_regional_mappings || 0) > 0, 'checkout must report active approved regional fulfillment mappings');
assert.ok(Number(checkoutHealth?.cached_products || 0) >= MIN_PRODUCTS, 'checkout must see the cached catalog');
assert.equal(checkoutHealth?.payment_configured, true, 'manual payment must be configured');
assert.equal(checkoutHealth?.email_configured, true, 'buyer confirmation email must be configured');

await health(CONNECTION_URL, 'shop-production-connection-v828', 'production-connection-v828');
await health(STATUS_URL, 'shop-order-status-v825', 'order-status-v825');
await health(ADMIN_URL, 'shop-admin-orders-v825', 'admin-orders-v825');
await health(ADMIN_ANALYTICS_URL, 'shop-admin-analytics-v843', 'shop-admin-analytics-v843');
await health(ADMIN_AUTH_URL, 'admin-auth-v845', 'admin-auth-v845');
await health(SHOP_OPS_URL, 'shop-ops-v847', 'shop-ops-v847');
await health(ADMIN_EXPORT_URL, 'shop-admin-export-v847', 'shop-admin-export-v847');
await health(WEBHOOK_URL, 'shop-printify-webhook-v825', 'printify-webhook-v825');

console.log('RESULT=V839_BRUIS_SHOP_PASS');
