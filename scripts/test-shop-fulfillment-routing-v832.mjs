#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  artworkSignature,
  buildFulfillmentPlans,
  cheapestShippingQuote,
  chooseCheapestFulfillment,
  estimatedImportAllowanceCentsPerUnit,
  parseFulfillmentMappings,
  validateMappedCandidate,
} from '../supabase/functions/shop-manual-checkout-v832/fulfillment-routing.mjs';

assert.deepEqual(
  cheapestShippingQuote({ standard: 900, economy: 550, priority: 1200, express: 1500 }),
  { name: 'economy', code: 4, cents: 550 },
);
assert.deepEqual(
  cheapestShippingQuote({ standard: 700, economy: 700 }),
  { name: 'standard', code: 1, cents: 700 },
);
assert.deepEqual(
  cheapestShippingQuote({ standard: '800', express: 650.4, priority: null }),
  { name: 'priority', code: 2, cents: 650 },
  'legacy lone express must remain shipping method code 2',
);
assert.deepEqual(
  cheapestShippingQuote({ standard: 1200, express: 900, priority: 900, printify_express: 700 }),
  { name: 'express', code: 3, cents: 700 },
  'transitional printify_express must map to shipping method code 3',
);
assert.deepEqual(
  cheapestShippingQuote({ standard: 1200, priority: 900, express: 700 }),
  { name: 'express', code: 3, cents: 700 },
  'final express naming must map to code 3 when explicit priority is also present',
);
assert.deepEqual(
  cheapestShippingQuote({ standard: 1200, priority: 800 }),
  { name: 'priority', code: 2, cents: 800 },
  'priority must use shipping method code 2',
);
assert.equal(cheapestShippingQuote({ standard: -1, economy: 'nope' }), null);

assert.equal(estimatedImportAllowanceCentsPerUnit('CA', 6, 30, 1467), 265, 'Canada fixed Prague Gildan route must include the 18% customs estimate');
assert.equal(estimatedImportAllowanceCentsPerUnit('CA', 6, 27, 2157), 0, 'Canadian local production has no import allowance');
assert.equal(estimatedImportAllowanceCentsPerUnit('AU', 6, 30, 1467), 0, 'Australia must not inherit the Canada-specific estimate');
assert.equal(estimatedImportAllowanceCentsPerUnit('CA', 1382, 30, 1467), 0, 'non-Gildan products must not inherit the Gildan estimate');

const sourceProduct = {
  id: 'source-product-1', blueprint_id: 6, print_provider_id: 10,
  options: [
    { type: 'color', values: [{ id: 1, title: 'White' }] },
    { type: 'size', values: [{ id: 2, title: 'L' }] },
  ],
  variants: [{ id: 101, options: [1, 2], cost: 1800, is_enabled: true, is_available: true }],
  print_areas: [{ variant_ids: [101], placeholders: [{ position: 'front', images: [{ id: 'art-front' }] }, { position: 'back', images: [{ id: 'art-back' }] }] }],
};
const targetProduct = {
  id: 'target-product-1', blueprint_id: 6, print_provider_id: 22,
  options: sourceProduct.options,
  variants: [{ id: 202, options: [1, 2], cost: 1400, is_enabled: true, is_available: true }],
  print_areas: [{ variant_ids: [202], placeholders: [{ position: 'back', images: [{ id: 'art-back' }] }, { position: 'front', images: [{ id: 'art-front' }] }] }],
};
const mappingJson = JSON.stringify({ version: 1, mappings: [{
  approved: true,
  approval_id: 'regional-nl-20260915',
  countries: ['NL'],
  estimated_import_cents_per_unit: 250,
  source: { product_id: sourceProduct.id, variant_id: 101, blueprint_id: 6, print_provider_id: 10 },
  target: { product_id: targetProduct.id, variant_id: 202, blueprint_id: 6, print_provider_id: 22 },
}] });
const [mapping] = parseFulfillmentMappings(mappingJson);
assert.equal(mapping.estimated_import_cents_per_unit, 250);
assert.equal(artworkSignature(sourceProduct, 101), 'back:art-back|front:art-front');
assert.deepEqual(
  validateMappedCandidate(mapping, 'NL', sourceProduct, sourceProduct.variants[0], targetProduct, targetProduct.variants[0]),
  { ok: true, cost_cents: 1400, estimated_import_cents_per_unit: 250 },
);
assert.equal(validateMappedCandidate(mapping, 'BE', sourceProduct, sourceProduct.variants[0], targetProduct, targetProduct.variants[0]).reason, 'country_not_approved');
assert.equal(validateMappedCandidate(mapping, 'NL', sourceProduct, sourceProduct.variants[0], { ...targetProduct, print_provider_id: 99 }, targetProduct.variants[0]).reason, 'approved_identity_mismatch');
assert.equal(validateMappedCandidate(mapping, 'NL', sourceProduct, sourceProduct.variants[0], { ...targetProduct, print_areas: [{ variant_ids: [202], placeholders: [{ position: 'front', images: [{ id: 'different-art' }] }] }] }, targetProduct.variants[0]).reason, 'artwork_mismatch');
assert.throws(() => parseFulfillmentMappings('{bad json'), /not valid JSON/);
assert.throws(() => parseFulfillmentMappings(JSON.stringify({ version: 1, mappings: [{ ...JSON.parse(mappingJson).mappings[0], approved: false }] })), /Invalid approved/);
assert.throws(() => parseFulfillmentMappings(JSON.stringify({ version: 1, mappings: [{ ...JSON.parse(mappingJson).mappings[0], estimated_import_cents_per_unit: -1 }] })), /Invalid approved/);

const manyMappings = Array.from({ length: 448 }, (_, index) => ({
  ...JSON.parse(mappingJson).mappings[0],
  approval_id: `regional-scale-${String(index).padStart(3, '0')}`,
  source: { ...JSON.parse(mappingJson).mappings[0].source, variant_id: 1000 + index },
  target: { ...JSON.parse(mappingJson).mappings[0].target, variant_id: 2000 + index },
}));
assert.equal(parseFulfillmentMappings(JSON.stringify({ version: 1, mappings: manyMappings })).length, 448, 'regional routing catalog must support all Gildan mappings');

const baseline = {
  product_id: sourceProduct.id,
  variant_id: 101,
  quantity: 1,
  cost_cents: 1800,
  mapping_approval_id: '',
  print_provider_id: 10,
  estimated_import_cents_per_unit: 0,
};
const regional = {
  product_id: targetProduct.id,
  variant_id: 202,
  quantity: 1,
  cost_cents: 1400,
  mapping_approval_id: mapping.approval_id,
  print_provider_id: 22,
  estimated_import_cents_per_unit: mapping.estimated_import_cents_per_unit,
};
const plans = buildFulfillmentPlans([[baseline, regional]], 4);
assert.equal(plans.length, 2);
assert.equal(plans[0].provider_groups, 1);
assert.equal(plans[1].provider_groups, 1);
assert.equal(plans[1].estimated_import_cents, 250);

const boundedPlans = buildFulfillmentPlans([[baseline, regional], [baseline, regional]], 3);
assert.ok(boundedPlans.length <= 3, 'large routing spaces must stay bounded');
assert.deepEqual(boundedPlans[0].candidates.map(candidate => candidate.mapping_approval_id), ['', ''], 'bounded routing must retain the all-original fallback');
assert.ok(boundedPlans.some(plan => plan.candidates.every(candidate => candidate.mapping_approval_id === mapping.approval_id)), 'bounded routing must retain the consolidated mapped route');

const largeCartPlans = buildFulfillmentPlans(Array.from({ length: 20 }, () => [baseline, regional]), 64);
assert.ok(largeCartPlans.length <= 64, '20-line carts must not explode the routing plan space');
assert.ok(largeCartPlans.some(plan => plan.candidates.every(candidate => !candidate.mapping_approval_id)), 'large-cart routing must retain the original Printify route');
assert.ok(largeCartPlans.some(plan => plan.candidates.every(candidate => candidate.mapping_approval_id === mapping.approval_id)), 'large-cart routing must retain the fully regional route');

const selectedWithImport = chooseCheapestFulfillment([
  { plan: plans[0], shipping: { name: 'economy', code: 4, cents: 400 }, route_key: 'baseline' },
  { plan: plans[1], shipping: { name: 'standard', code: 1, cents: 650 }, route_key: 'regional' },
]);
assert.equal(selectedWithImport.route_key, 'baseline', 'verified import allowance must participate in route cost');

const selectedWithoutImport = chooseCheapestFulfillment([
  { plan: plans[0], shipping: { name: 'economy', code: 4, cents: 400 }, route_key: 'baseline' },
  { plan: { ...plans[1], estimated_import_cents: 0 }, shipping: { name: 'standard', code: 1, cents: 650 }, route_key: 'regional' },
]);
assert.equal(selectedWithoutImport.route_key, 'regional', 'production plus shipping remains the base cost when import allowance is zero');

const consolidated = chooseCheapestFulfillment([
  { plan: { production_cents: 3000, estimated_import_cents: 0, provider_groups: 2, mapped_count: 0 }, shipping: { cents: 500 }, route_key: 'split' },
  { plan: { production_cents: 3000, estimated_import_cents: 0, provider_groups: 1, mapped_count: 0 }, shipping: { cents: 500 }, route_key: 'single-provider' },
]);
assert.equal(consolidated.route_key, 'single-provider', 'equal-cost routes should prefer fewer provider groups');

console.log('Shop fulfillment routing v832 tests passed.');
