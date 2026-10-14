#!/usr/bin/env node
// Prevent new Printify shirts from disappearing behind an outdated first-paint
// catalog or an alphabetically sorted collection.
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
const ctx = { productSortMode: 'newest' };
vm.createContext(ctx);
vm.runInContext(store.slice(sortStart, sortEnd) +
  '\\nthis.pick = sortProductsForDisplay; this.age = productCreatedMs;', ctx);
const sample = snapshot.products.filter(p => mustShow.includes(p.name));
const actual = Array.from(ctx.pick(sample));
const expected = [...sample].sort((a, b) =>
  parseInt(b.id.slice(0, 8), 16) - parseInt(a.id.slice(0, 8), 16));
assert.deepEqual(actual.map(p => p.id), expected.map(p => p.id),
  'newest-first must use creation timestamps, not recent edits');
ctx.productSortMode = 'name';
assert.deepEqual(Array.from(ctx.pick(sample)).map(p => p.name),
  [...sample].map(p => p.name).sort((a,b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
  'name sort must remain available');

const html = read('shop/index.html');
const css = read('shop/styles.css');
const refresh = read('shop/live-catalog-refresh-v818.js');
assert.match(html, /data-shop-sort/, 'storefront must expose the sorting control');
assert.match(html, /20261014-live-63-r1/, 'HTML must cache-bust the new catalog snapshot');
assert.match(html, /20261014-new-arrivals-r1/, 'HTML must cache-bust storefront logic/styles');
assert.match(css, /\\.product-new-label/, 'new shirts need visible markers');
assert.match(refresh, /checkCatalog\\(\\{ force: true \\}\\)/,
  'first page visit must immediately check the live catalog');
console.log('Shop new-arrivals regression passed: ' + snapshot.products.length + ' products, ' + mustShow.length + ' restored shirts.');
