#!/usr/bin/env node
// Keep the refreshed storefront catalog complete while preserving alphabetical
// display order, with animal designs in their separate A-Z section.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const snapshotJs = read('shop/catalog-last-good.js');
const marker = 'window.BRUIS_CATALOG_LAST_GOOD=';
const start = snapshotJs.indexOf(marker);
const end = snapshotJs.lastIndexOf(';})();');
assert.ok(start >= 0 && end > start, 'generated first-paint snapshot must exist');
const snapshot = JSON.parse(snapshotJs.slice(start + marker.length, end));
assert.ok(Array.isArray(snapshot.products) && snapshot.products.length >= 63,
  'first-paint snapshot must include at least the 63 live products from 2026-10-14');
assert.ok(Date.parse(snapshot.generatedAt) >= Date.parse('2026-10-14T06:00:00Z'),
  'first-paint snapshot must not be the obsolete October 1 version');

const mustShow = ['Balloon Flower', 'Black Bat Flower', 'Chilean Bellflower',
  'Ghost Orchid', 'Green Bells of Ireland', 'Monkshood', 'Red Kangaroo Paw',
  'Shooting Star', 'White Freesia', 'Yellow Mariposa Lily'];
const names = new Set(snapshot.products.map(product => String(product.name || '')));
const ids = new Set(snapshot.products.map(product => String(product.id || '')));
assert.equal(ids.size, snapshot.products.length, 'snapshot must not duplicate IDs');
for (const name of mustShow) assert.ok(names.has(name), 'missing new shirt: ' + name);
for (const product of snapshot.products) {
  assert.ok(Number(product.price) > 0, 'missing price: ' + product.name);
  assert.ok(product.mockups?.length && product.variants?.length, 'missing media or variants: ' + product.name);
}

const store = read('shop/store.js');
const sortStart = store.indexOf('function productCreatedMs(');
const sortEnd = store.indexOf('async function loadLiveCatalog(', sortStart);
assert.ok(sortStart >= 0 && sortEnd > sortStart, 'new-arrival sorting functions must exist');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(store.slice(sortStart, sortEnd) +
  ';this.pick = sortProductsForDisplay; this.age = productCreatedMs;', ctx);
const sample = snapshot.products.filter(p => mustShow.includes(p.name));
const actual = Array.from(ctx.pick(sample));
const expected = [...sample].sort((a,b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
assert.deepEqual(actual.map(p => p.name), expected.map(p => p.name),
  'restored botanical shirts must be sorted alphabetically, not newest-first');
assert.deepEqual(Array.from(ctx.pick(snapshot.products)).map(p => p.name),
  [...snapshot.products].sort((a,b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).map(p => p.name),
  'sorting all 63 products must remain alphabetical regardless of creation or price');
assert.match(store, /const animalList = fullList[\s\S]*?\.filter\(isAnimalDesign\)[\s\S]*?localeCompare/,
  'animal design section must remain alphabetically sorted');
assert.doesNotMatch(store, /productSortMode|data-shop-sort|price-asc/,
  'store must not support alternative sorting modes');

const html = read('shop/index.html');
const css = read('shop/styles.css');
const refresh = read('shop/live-catalog-refresh-v818.js');
assert.doesNotMatch(html, /data-shop-sort|Newest first|Price: low to high/,
  'storefront must not expose a sorting control');
assert.match(html, /20261016-bruis-23-euro-r1/, 'HTML must cache-bust the €23 snapshot without removing alphabetical catalog');
assert.match(html, /20261014-alphabetical-r2/, 'HTML must cache-bust alphabetical storefront logic/styles');
assert.ok(css.includes('.product-new-label'), 'new shirts need visible markers');
assert.ok(refresh.includes('checkCatalog({ force: true })'),
  'first page visit must immediately check the live catalog');
console.log('Shop catalog A-Z regression passed: ' + snapshot.products.length + ' products, ' + mustShow.length + ' restored shirts.');
