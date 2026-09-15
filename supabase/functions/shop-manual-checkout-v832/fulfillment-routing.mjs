const text = value => String(value ?? "").trim();
const clean = value => text(value).replace(/\s+/g, " ");

export const SHIPPING_METHODS = Object.freeze([
  Object.freeze({ name: "economy", code: 4 }),
  Object.freeze({ name: "standard", code: 1 }),
  Object.freeze({ name: "priority", code: 2 }),
  Object.freeze({ name: "express", code: 3 }),
]);

export function cheapestShippingQuote(quote) {
  const valid = SHIPPING_METHODS
    .map(method => {
      const raw = quote?.[method.name];
      return { ...method, cents: raw === null || raw === undefined || raw === "" || typeof raw === "boolean" ? Number.NaN : Number(raw) };
    })
    .filter(method => Number.isFinite(method.cents) && method.cents >= 0)
    .map(method => ({ ...method, cents: Math.round(method.cents) }))
    .sort((a, b) => a.cents - b.cents || a.code - b.code);
  return valid[0] || null;
}

function optionMap(product) {
  const map = new Map();
  for (const option of Array.isArray(product?.options) ? product.options : []) {
    const type = text(option?.type).toLowerCase();
    for (const value of Array.isArray(option?.values) ? option.values : []) {
      map.set(String(value?.id), { type, value: clean(value?.title) });
    }
  }
  return map;
}

function optionValues(product, variant) {
  const map = optionMap(product);
  return (Array.isArray(variant?.options) ? variant.options : [])
    .map(id => map.get(String(id)))
    .filter(Boolean);
}

function normalizedOption(product, variant, type) {
  return text(optionValues(product, variant).find(option => option.type === type)?.value).toLowerCase();
}

export function artworkSignature(product, variantId) {
  const wanted = Number(variantId);
  const entries = [];
  for (const area of Array.isArray(product?.print_areas) ? product.print_areas : []) {
    const variantIds = Array.isArray(area?.variant_ids) ? area.variant_ids.map(Number) : [];
    if (variantIds.length && !variantIds.includes(wanted)) continue;
    for (const placeholder of Array.isArray(area?.placeholders) ? area.placeholders : []) {
      const position = text(placeholder?.position).toLowerCase();
      for (const image of Array.isArray(placeholder?.images) ? placeholder.images : []) {
        const id = text(image?.id);
        if (position && id) entries.push(`${position}:${id}`);
      }
    }
  }
  return [...new Set(entries)].sort().join("|");
}

function validId(value, min = 1, max = 100) {
  const id = text(value);
  return id.length >= min && id.length <= max && /^[A-Za-z0-9_-]+$/.test(id) ? id : "";
}

export function parseFulfillmentMappings(raw) {
  if (!text(raw)) return [];
  let payload;
  try {
    payload = JSON.parse(text(raw));
  } catch {
    throw new Error("PRINTIFY_FULFILLMENT_MAPPINGS is not valid JSON");
  }
  if (Number(payload?.version) !== 1 || !Array.isArray(payload?.mappings)) {
    throw new Error("PRINTIFY_FULFILLMENT_MAPPINGS must use version 1 with a mappings array");
  }
  if (payload.mappings.length > 100) throw new Error("Too many Printify fulfillment mappings");

  return payload.mappings.map((mapping, index) => {
    const source = mapping?.source || {};
    const target = mapping?.target || {};
    const approvalId = validId(mapping?.approval_id, 3, 100);
    const countries = [...new Set((Array.isArray(mapping?.countries) ? mapping.countries : [])
      .map(country => text(country).toUpperCase())
      .filter(country => /^[A-Z]{2}$/.test(country)))];
    const normalized = {
      approval_id: approvalId,
      approved: mapping?.approved === true,
      countries,
      source: {
        product_id: validId(source?.product_id, 8, 80),
        variant_id: Number(source?.variant_id),
        blueprint_id: Number(source?.blueprint_id),
        print_provider_id: Number(source?.print_provider_id),
      },
      target: {
        product_id: validId(target?.product_id, 8, 80),
        variant_id: Number(target?.variant_id),
        blueprint_id: Number(target?.blueprint_id),
        print_provider_id: Number(target?.print_provider_id),
      },
    };
    const ids = [normalized.source.variant_id, normalized.source.blueprint_id, normalized.source.print_provider_id,
      normalized.target.variant_id, normalized.target.blueprint_id, normalized.target.print_provider_id];
    if (!normalized.approved || !approvalId || !countries.length || !normalized.source.product_id || !normalized.target.product_id || ids.some(id => !Number.isInteger(id) || id <= 0)) {
      throw new Error(`Invalid approved Printify fulfillment mapping at index ${index}`);
    }
    if (normalized.source.product_id === normalized.target.product_id && normalized.source.variant_id === normalized.target.variant_id) {
      throw new Error(`Printify fulfillment mapping ${approvalId} does not change the fulfillment route`);
    }
    return Object.freeze(normalized);
  });
}

export function validateMappedCandidate(mapping, country, sourceProduct, sourceVariant, targetProduct, targetVariant) {
  if (!mapping?.countries?.includes(text(country).toUpperCase())) return { ok: false, reason: "country_not_approved" };
  const sourceChecks = mapping.source.product_id === text(sourceProduct?.id)
    && mapping.source.variant_id === Number(sourceVariant?.id)
    && mapping.source.blueprint_id === Number(sourceProduct?.blueprint_id)
    && mapping.source.print_provider_id === Number(sourceProduct?.print_provider_id);
  const targetChecks = mapping.target.product_id === text(targetProduct?.id)
    && mapping.target.variant_id === Number(targetVariant?.id)
    && mapping.target.blueprint_id === Number(targetProduct?.blueprint_id)
    && mapping.target.print_provider_id === Number(targetProduct?.print_provider_id);
  if (!sourceChecks || !targetChecks) return { ok: false, reason: "approved_identity_mismatch" };
  if (targetVariant?.is_enabled === false || targetVariant?.is_available === false) return { ok: false, reason: "target_unavailable" };

  const sourceSize = normalizedOption(sourceProduct, sourceVariant, "size");
  const targetSize = normalizedOption(targetProduct, targetVariant, "size");
  const sourceColor = normalizedOption(sourceProduct, sourceVariant, "color");
  const targetColor = normalizedOption(targetProduct, targetVariant, "color");
  if (!sourceSize || sourceSize !== targetSize || !sourceColor || sourceColor !== targetColor) {
    return { ok: false, reason: "variant_options_mismatch" };
  }
  const sourceArtwork = artworkSignature(sourceProduct, sourceVariant?.id);
  const targetArtwork = artworkSignature(targetProduct, targetVariant?.id);
  if (!sourceArtwork || sourceArtwork !== targetArtwork) return { ok: false, reason: "artwork_mismatch" };
  const cost = Math.round(Number(targetVariant?.cost));
  if (!Number.isFinite(cost) || cost <= 0) return { ok: false, reason: "target_cost_invalid" };
  return { ok: true, cost_cents: cost };
}

export function buildFulfillmentPlans(candidateGroups, maxPlans = 64) {
  let plans = [{ candidates: [], production_cents: 0, mapped_count: 0 }];
  for (const group of candidateGroups) {
    if (!Array.isArray(group) || !group.length) throw new Error("No safe fulfillment candidate for a cart item");
    if (plans.length * group.length > maxPlans) throw new Error("Approved fulfillment mappings exceed the safe routing plan limit");
    plans = plans.flatMap(plan => group.map(candidate => ({
      candidates: [...plan.candidates, candidate],
      production_cents: plan.production_cents + Number(candidate.cost_cents) * Number(candidate.quantity),
      mapped_count: plan.mapped_count + (candidate.mapping_approval_id ? 1 : 0),
    })));
  }
  return plans;
}

export function chooseCheapestFulfillment(results) {
  const valid = (Array.isArray(results) ? results : []).filter(result => result?.shipping && Number.isFinite(result?.plan?.production_cents));
  valid.sort((a, b) => {
    const aTotal = a.plan.production_cents + a.shipping.cents;
    const bTotal = b.plan.production_cents + b.shipping.cents;
    return aTotal - bTotal
      || a.plan.mapped_count - b.plan.mapped_count
      || a.shipping.cents - b.shipping.cents
      || String(a.route_key || "").localeCompare(String(b.route_key || ""));
  });
  return valid[0] || null;
}
