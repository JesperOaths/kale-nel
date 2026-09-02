#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const index = read('shop/index.html');
const store = read('shop/store.js');
const checkout = read('shop/shopify-checkout-v818.js');
const refresh = read('shop/live-catalog-refresh-v818.js');
const edge = read('supabase/functions/shop-catalog/index.ts');

assert.equal(read('VERSION').trim(), 'v818');
assert.match(index, /collection-merch-despinoza\.png/);
assert.match(index, /shopify-checkout-v818\.js/);
assert.match(index, /live-catalog-refresh-v818\.js/);
assert.match(index, /version-watermark[^>]*>v818</);

const merchImage = fs.readFileSync('shop/assets/collection-merch-despinoza.png');
assert.equal(
  crypto.createHash('sha256').update(merchImage).digest('hex'),
  '230ee9f150e1c65e14185fac1691a04e67788c53dacb6625be7d83c6cfbf2b1b',
  'Merch collection image must remain the exact supplied PNG'
);

for (const filename of [
  'dogwood-front-artwork.png',
  'snowdrop-front-artwork.png',
  'despinoza-dd-front-artwork.png',
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
assert.match(refresh, /POLL_MS\s*=\s*30\s*\*\s*1000/);
assert.match(edge, /REFRESH_MS\s*=\s*60\s*\*\s*1000/);
assert.match(edge, /private, no-store, max-age=0/);
assert.match(edge, /EdgeRuntime\.waitUntil\(refreshPromise\)/, 'Stale catalog refresh must not block cached responses');
assert.match(edge, /productTitle\.includes\("despinoza"\).*return "merch"/s);
assert.match(edge, /oversized\|boxy/);

console.log('Shop commerce v818 contract passed.');
