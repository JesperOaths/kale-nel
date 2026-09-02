#!/usr/bin/env node
/**
 * Convert a Printify product export/API response into the static Bruis shop catalog.
 * This remains the offline/fallback path; production normally reads the live
 * server-side Printify cache through the shop-catalog Edge Function.
 *
 * Usage:
 *   node scripts/import-printify-catalog.mjs printify-products.json
 *   node scripts/import-printify-catalog.mjs product-a.json product-b.json --out shop/catalog.json
 *
 * This script never needs a Printify API token. Keep tokens out of the repo.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outPath = resolve(outFlag >= 0 ? args[outFlag + 1] : 'shop/catalog.json');
const inputPaths = args.filter((arg, index) => arg !== '--out' && index !== outFlag + 1);

if(!inputPaths.length){
  console.error('Usage: node scripts/import-printify-catalog.mjs <printify-json...> [--out shop/catalog.json]');
  process.exit(2);
}

const slug = text => String(text || 'product').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80) || 'product';
const parsePrice = value => {
  if(value == null || value === '') return null;
  const n = Number(value);
  if(!Number.isFinite(n)) return null;
  return n > 999 ? Math.round(n) / 100 : n;
};
const motifFromTitle = title => {
  const t = String(title || '').toLowerCase();
  if(/jellyfish|marine|sea|ocean/.test(t)) return ['marine','Marine'];
  if(/axolotl|aquatic|pond/.test(t)) return ['aquatic','Aquatic'];
  if(/mantis|fly|insect|beetle|moth|butterfly/.test(t)) return ['insect','Insects'];
  if(/flower|hydrangea|lace|floral|rose|poppy|petal/.test(t)) return ['floral','Flowers'];
  if(/botanical|thistle|leaf|plant|mushroom|fungi/.test(t)) return ['botanical','Botanical'];
  return ['other','Nature'];
};
const collectionFromPrintify = raw => {
  const productTitle = String(raw.title || raw.name || raw.product_title || '').trim().toLowerCase();
  if(productTitle.includes('despinoza')) return 'merch';

  const haystack = [
    raw.title,
    raw.name,
    ...(Array.isArray(raw.tags) ? raw.tags : []),
    raw.blueprint_title,
    raw.blueprint?.title,
    raw.baseLabel,
    raw.base_label,
  ].filter(Boolean).join(' ').toLowerCase();
  return /\bboxy\b/.test(haystack) || /oversized[\s-]*boxy|boxy[\s-]*oversized/.test(haystack)
    ? 'oversized-boxy'
    : 'classic';
};

function flattenProducts(payload){
  if(Array.isArray(payload)) return payload;
  if(Array.isArray(payload.products)) return payload.products;
  if(Array.isArray(payload.data)) return payload.data;
  if(payload.id || payload.title || payload.name) return [payload];
  return [];
}

function optionTitleMap(raw){
  const map = new Map();
  (raw.options || []).forEach(option => (option.values || []).forEach(value => {
    map.set(value.id, { option:String(option.name || option.title || '').toLowerCase(), title:value.title || value.name || String(value.id) });
  }));
  return map;
}

function sizesFromPrintify(raw){
  const optionMap = optionTitleMap(raw);
  const sizes = [];
  (raw.variants || []).filter(v => v.is_enabled !== false && v.is_available !== false).forEach(variant => {
    (variant.options || []).forEach(id => {
      const opt = optionMap.get(id);
      if(opt && /size/.test(opt.option) && !sizes.includes(opt.title)) sizes.push(opt.title);
    });
  });
  return sizes.length ? sizes : ['S','M','L','XL','2XL','3XL','4XL','5XL'];
}

function pricesFromPrintify(raw){
  const variantPrices = (raw.variants || [])
    .filter(v => v.is_enabled !== false && v.is_available !== false)
    .map(v => parsePrice(v.price))
    .filter(v => v != null);
  const direct = [parsePrice(raw.price), parsePrice(raw.priceMax || raw.price_max || raw.max_price)].filter(v => v != null);
  const prices = variantPrices.length ? variantPrices : direct;
  if(!prices.length) return { price:0, priceMax:0 };
  return { price:Math.min(...prices), priceMax:Math.max(...prices) };
}

function uniqueBy(items, keyFn){
  const seen = new Set();
  return items.filter(item => {
    const key = keyFn(item);
    if(!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mockupsFromPrintify(raw){
  const ranked = (raw.images || raw.mockups || []).map((image, index) => {
    const src = image?.src || image?.url || image?.image || image?.preview_url || image;
    if(!src) return null;
    const position = String(image?.position || '').toLowerCase();
    const isDefault = image?.is_default === true;
    const rank = position === 'front' && isDefault ? 0 : position === 'front' ? 1 : isDefault ? 2 : 3;
    const label = image?.label || image?.camera_label || image?.position || image?.view || `View ${index + 1}`;
    return {
      image:src,
      label:String(label).replace(/[-_]/g,' ').replace(/\b\w/g, c => c.toUpperCase()),
      rank,
      index,
    };
  }).filter(Boolean).sort((a,b) => a.rank - b.rank || a.index - b.index);
  return uniqueBy(ranked, item => item.image).slice(0,12).map(({ image, label }) => ({ image, label }));
}

function normalize(raw){
  const name = raw.title || raw.name || raw.product_title || 'Untitled shirt';
  const [type, typeLabel] = motifFromTitle(`${name} ${raw.description || ''}`);
  const prices = pricesFromPrintify(raw);
  const mockups = mockupsFromPrintify(raw);
  const baseKey = raw.blueprint_id && raw.print_provider_id ? `${raw.blueprint_id}-${raw.print_provider_id}` : String(raw.baseKey || raw.base_key || 'unknown');
  const baseLabel = raw.blueprint_title || raw.blueprint?.title || raw.print_provider_name || raw.baseLabel || raw.base_label || (baseKey === 'unknown' ? 'Base pending import' : `Base ${baseKey}`);
  return {
    id:String(raw.id || raw.external_id || slug(name)),
    name,
    type,
    typeLabel,
    collection:collectionFromPrintify(raw),
    price:prices.price,
    priceMax:prices.priceMax,
    description:raw.description || raw.body_html?.replace(/<[^>]*>/g,' ') || 'Nature-inspired shirt from the Bruis collection.',
    image:mockups[0]?.image || raw.visible_image || raw.default_image || '',
    mockups,
    sizes:sizesFromPrintify(raw),
    baseKey,
    baseLabel,
  };
}

const rawProducts = [];
for(const input of inputPaths){
  const payload = JSON.parse((await readFile(resolve(input), 'utf8')).replace(/^\uFEFF/, ''));
  rawProducts.push(...flattenProducts(payload));
}

const products = rawProducts.map(normalize).filter(product => product.name && product.mockups.length);
if(!products.length){
  console.error('No products with mockup images were found in the input JSON.');
  process.exit(1);
}

const catalog = { generatedAt:new Date().toISOString(), products };
const isJs = outPath.endsWith('.js');
const content = isJs
  ? `window.BRUIS_CATALOG = ${JSON.stringify(catalog, null, 2)};\n`
  : `${JSON.stringify(catalog, null, 2)}\n`;
await mkdir(dirname(outPath), { recursive:true });
await writeFile(outPath, content);
console.log(`Wrote ${products.length} products to ${outPath}`);
