#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildFulfillmentPlans,
  cheapestShippingQuote,
  chooseCheapestFulfillment,
  directOrderPrintAreas,
  estimatedImportAllowanceCentsPerUnit,
  validateDirectProviderRoute,
} from '../supabase/functions/shop-manual-checkout-v832/fulfillment-routing.mjs';

assert.deepEqual(
  cheapestShippingQuote({ standard: 900, economy: 550, priority: 1200, express: 1500 }),
  { name: 'economy', code: 4, cents: 550 },
);
assert.deepEqual(
  cheapestShippingQuote({ standard: 700, economy: 700 }),
  { name: 'standard', code: 1, cents: 700 },
);
assert.equal(cheapestShippingQuote({ standard: -1, economy: 'nope' }), null);

assert.equal(estimatedImportAllowanceCentsPerUnit('CA', 6, 30, 1467), 265);
assert.equal(estimatedImportAllowanceCentsPerUnit('CA', 6, 27, 2157), 0);
assert.equal(estimatedImportAllowanceCentsPerUnit('AU', 6, 30, 1467), 0);

const sourceProduct = {
  id: 'source-product-1',
  blueprint_id: 6,
  print_provider_id: 99,
  variants: [{ id: 101, cost: 1800, is_enabled: true, is_available: true }],
  print_areas: [{
    variant_ids: [101],
    placeholders: [
      { position: 'front', images: [{ id: 'art-front', src: 'https://example.invalid/front.png', x: 0.5, y: 0.5, scale: 1, angle: 0 }] },
      { position: 'back', images: [{ id: 'art-back', src: 'https://example.invalid/back.png', x: 0.5, y: 0.5, scale: 1, angle: 0 }] },
    ],
  }],
};
const sourceVariant = sourceProduct.variants[0];
const providerVariant = { id: 101, title: 'White / L' };
const route = {
  approval_id: 'choice-to-opt-101',
  approved: true,
  countries: ['NL', 'BE'],
  source_product_id: sourceProduct.id,
  source_variant_id: 101,
  source_blueprint_id: 6,
  source_print_provider_id: 99,
  target_print_provider_id: 30,
  target_cost_usd_cents: 1500,
  cost_delta_usd_cents: -300,
  estimated_import_cents_per_unit: 0,
};

assert.deepEqual(directOrderPrintAreas(sourceProduct, 101), {
  front: [{ src: 'https://example.invalid/front.png', x: 0.5, y: 0.5, scale: 1, angle: 0 }],
  back: [{ src: 'https://example.invalid/back.png', x: 0.5, y: 0.5, scale: 1, angle: 0 }],
});
const valid = validateDirectProviderRoute(route, 'NL', sourceProduct, sourceVariant, providerVariant);
assert.equal(valid.ok, true);
assert.equal(valid.cost_cents, 1500);
assert.equal(validateDirectProviderRoute(route, 'US', sourceProduct, sourceVariant, providerVariant).reason, 'country_not_approved');
assert.equal(validateDirectProviderRoute({ ...route, target_print_provider_id: 99 }, 'NL', sourceProduct, sourceVariant, providerVariant).reason, 'target_provider_invalid');
assert.equal(validateDirectProviderRoute(route, 'NL', sourceProduct, sourceVariant, null).reason, 'target_variant_unavailable');

const baseline = {
  product_id: sourceProduct.id,
  variant_id: 101,
  quantity: 1,
  cost_cents: 1800,
  mapping_approval_id: '',
  print_provider_id: 99,
  estimated_import_cents_per_unit: 0,
};
const direct = {
  direct_provider: true,
  product_id: '',
  source_product_id: sourceProduct.id,
  variant_id: 101,
  quantity: 1,
  cost_cents: 1500,
  mapping_approval_id: route.approval_id,
  print_provider_id: 30,
  estimated_import_cents_per_unit: 0,
};
const plans = buildFulfillmentPlans([[baseline, direct]], 4);
assert.equal(plans.length, 2);
assert.ok(plans.some(plan => plan.candidates[0].direct_provider === true));

const selected = chooseCheapestFulfillment([
  { plan: plans.find(plan => !plan.candidates[0].direct_provider), shipping: { cents: 1000 }, route_key: 'canonical' },
  { plan: plans.find(plan => plan.candidates[0].direct_provider), shipping: { cents: 500 }, route_key: 'direct' },
], 'NL');
assert.equal(selected.route_key, 'direct');

const checkoutSource = readFileSync(new URL('../supabase/functions/shop-manual-checkout-v832/index.ts', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('../supabase/functions/shop-delivery-preview-v833/index.ts', import.meta.url), 'utf8');
const adminSource = readFileSync(new URL('../supabase/functions/shop-admin-orders-v825/index.ts', import.meta.url), 'utf8');

for (const source of [checkoutSource, previewSource]) {
  assert.match(source, /shop_provider_routes_v1/);
  assert.match(source, /direct_provider/);
  assert.match(source, /validateDirectProviderRoute/);
  assert.match(source, /print_provider_id/);
  assert.match(source, /blueprint_id/);
  assert.doesNotMatch(source, /shop_fulfillment_mappings/);
}
assert.match(checkoutSource, /fulfillment_routing:\s*"clone-free-direct-provider-plus-canonical"/);
assert.match(adminSource, /route\?\.type==="direct_provider"/);
assert.match(adminSource, /retired clone-based fulfillment route/);
assert.doesNotMatch(adminSource, /\.from\("shop_fulfillment_mappings"\)/);
assert.match(adminSource, /DESPINOZA_STATIC_TEXT_URL/);

console.log('Clone-free Printify provider routing tests passed.');
