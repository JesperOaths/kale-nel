#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const index = read('shop/index.html');
const store = read('shop/store.js');
const checkoutUi = read('shop/manual-checkout-v825.js');
const lightbox = read('shop/image-lightbox-v820.js');
const directCommerce = read('shop/direct-commerce-v828.js');
const runtime = read('shop/shop-runtime-v819.js');
const recovery = read('shop/catalog-recovery-v822.js');
const previews = read('shop/product-preview-overrides.js');
const background = read('shop/mockup-background-v819.js');
const checkoutEdge = read('supabase/functions/shop-manual-checkout-v828/index.ts');
const catalogV828 = read('supabase/functions/shop-catalog-v828/index.ts');
const priceRule = read('supabase/functions/shop-price-rule-v819/index.ts');
const catalog = read('supabase/functions/shop-catalog/index.ts');
const catalogV822 = read('supabase/functions/shop-catalog-v822/index.ts');
const priceApi = read('supabase/functions/shop-price-v818/index.ts');
const adminOrders = read('admin_shop_orders.html');

// Pricing is cost + €5, then rounded upward to a whole euro everywhere a
// product price is published, returned, displayed, added to cart, or charged.
for (const source of [store, checkoutUi, catalog, catalogV822, priceApi]) {
  assert.match(source, /wholeEuro/);
}
assert.match(priceRule, /Math\.ceil\(\(Math\.round\(cost\) \+ MARGIN_CENTS\) \/ 100\) \* 100/);
assert.match(checkoutEdge, /Math\.ceil\(\(cost \+ 500\) \/ 100\) \* 100/);
assert.match(catalogV828, /Math\.ceil\(\(Math\.round\(n\) \+ 500\) \/ 100\)/);
assert.equal(Math.ceil((1661 + 500) / 100) * 100, 2200);
assert.equal(Math.ceil((1693 + 500) / 100) * 100, 2200);
assert.equal(Math.ceil((2850 + 500) / 100) * 100, 3400);
assert.match(index, /version-watermark[^>]*>v829</);
assert.match(index, /20260910-shop-fixes-v829/);

// Size M is selected when present; the first available option is the fallback.
assert.match(store, /toUpperCase\(\) === 'M'/);
assert.match(store, /index === 0/);
assert.match(checkoutUi, /find\(value => String\(value\)\.trim\(\)\.toUpperCase\(\) === 'M'\)/);

// The special Jellyfish front-artwork image is removed from every active and
// fallback gallery layer, while the remaining gallery is clipped slide-by-slide.
for (const source of [checkoutUi, directCommerce, runtime, recovery, previews]) {
  assert.doesNotMatch(source, /jellyfish-front-(?:artwork|v7)/i);
}
assert.match(catalogV828, /if \(\/jellyfish\/i[\s\S]*?media\.slice\(1\)/);
assert.match(directCommerce, /min-width:\s*100% !important/);
assert.match(directCommerce, /overflow:\s*hidden !important/);

// Lightbox opens fitted with breathing room, then supports explicit fit/zoom,
// wheel/double-click zoom, and panning only while zoomed.
assert.doesNotMatch(index, /front-lightbox-fit-v821\.js/);
assert.match(lightbox, /data-lightbox-fit/);
assert.match(lightbox, /data-lightbox-zoom-in/);
assert.match(lightbox, /function resetView/);
assert.match(lightbox, /function setZoom/);
assert.match(lightbox, /Math\.min\(4/);
assert.match(lightbox, /addEventListener\('wheel'/);
assert.match(lightbox, /addEventListener\('dblclick'/);
assert.match(lightbox, /padding:\s*clamp\(16px, 2\.5vw, 34px\)/);

// Flat studio backgrounds, including the last collar image, are flood-filled
// from the edges and encoded losslessly so #ded6ca stays exact.
assert.match(background, /const BACKDROP = '#ded6ca'/);
assert.match(background, /ratio > 0\.985/);
assert.match(background, /toBlob\(resolve, 'image\/png'\)/);
assert.match(background, /BRUIS_MATCH_MOCKUP_BACKGROUND/);

// Supplier branding is absent from all customer/admin-visible literals. Internal
// identifiers and API plumbing intentionally remain unchanged.
for (const [name, source] of [
  ['shop/index.html', index],
  ['admin_shop_orders.html', adminOrders]
]) {
  assert.doesNotMatch(source.replace(/printify_[a-z0-9_]+/gi, ''), />[^<]*printify[^<]*</i, `${name} exposes supplier branding`);
}
for (const phrase of ['Calculated securely from Printify', 'sent to Printify', 'Send to Printify', 'Payment & Printify']) {
  assert.ok(!index.includes(phrase) && !checkoutUi.includes(phrase) && !adminOrders.includes(phrase), `visible phrase remains: ${phrase}`);
}

// Pending-order failures no longer leak supplier/token internals, while the
// server still preserves address-based shipping and Pending-only creation.
assert.match(checkoutUi, /Ordering is temporarily unavailable while the production connection is being restored/);
assert.match(checkoutEdge, /resolvePrintifyToken/);
assert.match(checkoutEdge, /orders\/shipping\.json/);
assert.match(checkoutEdge, /status:\s*"pending"/);
assert.match(checkoutEdge, /subtotalCents \+ shippingCents/);

console.log('RESULT=SHOP_FIXES_V829_PASS');
