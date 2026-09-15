#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  artworkSignature,
  buildFulfillmentPlans,
  cheapestShippingQuote,
  chooseCheapestFulfillment,
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
  source: { product_id: sourceProduct.id, variant_id: 101, blueprint_id: 6, print_provider_id: 10 },
  target: { product_id: targetProduct.id, variant_id: 202, blueprint_id: 6, print_provider_id: 22 },
}] });
const [mapping] = parseFulfillmentMappings(mappingJson);
assert.equal(artworkSignature(sourceProduct, 101), 'back:art-back|front:art-front');
assert.deepEqual(validateMappedCandidate(mapping, 'NL', sourceProduct, sourceProduct.variants[0], targetProduct, targetProduct.variants[0]), { ok: true, cost_cents: 1400 });
assert.equal(validateMappedCandidate(mapping, 'BE', sourceProduct, sourceProduct.variants[0], targetProduct, targetProduct.variants[0]).reason, 'country_not_approved');
assert.equal(validateMappedCandidate(mapping, 'NL', sourceProduct, sourceProduct.variants[0], { ...targetProduct, print_provider_id: 99 }, targetProduct.variants[0]).reason, 'approved_identity_mismatch');
assert.equal(validateMappedCandidate(mapping, 'NL', sourceProduct, sourceProduct.variants[0], { ...targetProduct, print_areas: [{ variant_ids: [202], placeholders: [{ position: 'front', images: [{ id: 'different-art' }] }] }] }, targetProduct.variants[0]).reason, 'artwork_mismatch');
assert.throws(() => parseFulfillmentMappings('{bad json'), /not valid JSON/);
assert.throws(() => parseFulfillmentMappings(JSON.stringify({ version: 1, mappings: [{ ...JSON.parse(mappingJson).mappings[0], approved: false }] })), /Invalid approved/);

const baseline = { product_id: sourceProduct.id, variant_id: 101, quantity: 1, cost_cents: 1800, mapping_approval_id: '' };
const regional = { product_id: targetProduct.id, variant_id: 202, quantity: 1, cost_cents: 1400, mapping_approval_id: mapping.approval_id };
const plans = buildFulfillmentPlans([[baseline, regional]], 4);
assert.equal(plans.length, 2);
assert.throws(() => buildFulfillmentPlans([[baseline, regional], [baseline, regional]], 3), /safe routing plan limit/);
const selected = chooseCheapestFulfillment([
  { plan: plans[0], shipping: { name: 'economy', code: 4, cents: 400 }, route_key: 'baseline' },
  { plan: plans[1], shipping: { name: 'standard', code: 1, cents: 650 }, route_key: 'regional' },
]);
assert.equal(selected.route_key, 'regional', 'production plus shipping must beat shipping-only routing');
assert.equal(selected.plan.production_cents + selected.shipping.cents, 2050);

console.log('Shop fulfillment routing v832 tests passed.');
