const text = value => String(value ?? "").trim();

const DESPINOZA_SOURCE_PRODUCT_IDS = new Set([
  "6a975ec45d07cc05a702a491",
  "6a9742c08816f2362104d5cc",
]);
const DESPINOZA_NATIVE_TEXT_ID = "7b14de2d-815d-a93b-cdd3-69d9c2cb3e2f";
const DESPINOZA_STATIC_TEXT_URL = "https://pfy-prod-image-storage.s3.us-east-2.amazonaws.com/28211792/fbb5f9e7-fd95-41e0-bc93-c0ab427306d8";
const DESPINOZA_STATIC_TEXT_WIDTH = 4096;
const GENERIC_IGNORED_ARTWORK_IDS = new Set(["5941187eb8e7e37b3f0e62e5"]); // generated text_layer.svg, not reusable Printify artwork

// Routing estimate only: Canada's 2026 MFN customs tariff for cotton T-shirts
// (HS 6109.10) is 18%. Apply it only to the known fixed Prague Gildan 5000
// source when shipping to Canada. It is never added to the customer's charge.
export const CANADA_COTTON_TEE_IMPORT_DUTY_BPS = 1800;
export function estimatedImportAllowanceCentsPerUnit(country, blueprintId, providerId, eurUnitCostCents) {
  const destination = text(country).toUpperCase();
  const blueprint = Number(blueprintId);
  const provider = Number(providerId);
  const cost = Math.max(0, Math.round(Number(eurUnitCostCents) || 0));
  if (destination === "CA" && blueprint === 6 && provider === 30 && cost > 0) {
    return Math.ceil(cost * CANADA_COTTON_TEE_IMPORT_DUTY_BPS / 10000);
  }
  return 0;
}


export const SHIPPING_METHODS = Object.freeze([
  Object.freeze({ name: "economy", code: 4 }),
  Object.freeze({ name: "standard", code: 1 }),
  Object.freeze({ name: "priority", code: 2 }),
  Object.freeze({ name: "express", code: 3 }),
]);

function shippingCents(raw) {
  if (raw === null || raw === undefined || raw === "" || typeof raw === "boolean") return Number.NaN;
  const cents = Number(raw);
  return Number.isFinite(cents) && cents >= 0 ? Math.round(cents) : Number.NaN;
}

function addShippingCandidate(out, name, code, raw) {
  const cents = shippingCents(raw);
  if (Number.isFinite(cents)) out.push({ name, code, cents });
}

export function cheapestShippingQuote(quote) {
  const valid = [];
  addShippingCandidate(valid, "economy", 4, quote?.economy);
  addShippingCandidate(valid, "standard", 1, quote?.standard);

  const priority = shippingCents(quote?.priority);
  const transitionalExpress = shippingCents(quote?.express);
  const printifyExpress = shippingCents(quote?.printify_express);

  if (Number.isFinite(priority)) {
    valid.push({ name: "priority", code: 2, cents: priority });
  } else if (Number.isFinite(transitionalExpress) && !Number.isFinite(printifyExpress)) {
    valid.push({ name: "priority", code: 2, cents: transitionalExpress });
  }

  if (Number.isFinite(printifyExpress)) {
    valid.push({ name: "express", code: 3, cents: printifyExpress });
  } else if (Number.isFinite(priority) && Number.isFinite(transitionalExpress)) {
    valid.push({ name: "express", code: 3, cents: transitionalExpress });
  }

  valid.sort((a, b) => a.cents - b.cents || a.code - b.code);
  return valid[0] || null;
}

export function catalogProviderVariant(payload, variantId) {
  const rows = Array.isArray(payload?.variants) ? payload.variants : (Array.isArray(payload) ? payload : []);
  return rows.find(variant => Number(variant?.id) === Number(variantId)) || null;
}

export function directOrderPrintAreas(product, variantId) {
  const wanted = Number(variantId);
  const output = {};
  let reusableImageCount = 0;
  for (const area of Array.isArray(product?.print_areas) ? product.print_areas : []) {
    const variantIds = Array.isArray(area?.variant_ids) ? area.variant_ids.map(Number) : [];
    if (variantIds.length && !variantIds.includes(wanted)) continue;
    for (const placeholder of Array.isArray(area?.placeholders) ? area.placeholders : []) {
      const position = text(placeholder?.position).toLowerCase();
      if (!position) continue;
      const rendered = [];
      for (const image of Array.isArray(placeholder?.images) ? placeholder.images : []) {
        const id = text(image?.id);
        if (GENERIC_IGNORED_ARTWORK_IDS.has(id)) continue;
        const x = Number(image?.x), y = Number(image?.y), rawScale = Number(image?.scale), angle = Number(image?.angle || 0);
        if (![x,y,rawScale,angle].every(Number.isFinite) || rawScale <= 0) return null;
        if (id === DESPINOZA_NATIVE_TEXT_ID && DESPINOZA_SOURCE_PRODUCT_IDS.has(text(product?.id))) {
          const nativeWidth = Number(image?.width);
          const scale = Number.isFinite(nativeWidth) && nativeWidth > 0
            ? rawScale * nativeWidth / DESPINOZA_STATIC_TEXT_WIDTH
            : rawScale * 953.80004 / DESPINOZA_STATIC_TEXT_WIDTH;
          rendered.push({ src: DESPINOZA_STATIC_TEXT_URL, x, y, scale, angle });
          reusableImageCount += 1;
          continue;
        }
        const src = text(image?.src);
        if (id && !src) return null;
        if (!src) continue;
        let parsed;
        try {
          parsed = new URL(src);
          if (parsed.protocol !== "https:") return null;
        } catch {
          return null;
        }
        rendered.push({ src, x, y, scale: rawScale, angle });
        reusableImageCount += 1;
      }
      if (rendered.length) {
        if (!Array.isArray(output[position])) output[position] = [];
        output[position].push(...rendered);
      }
    }
  }
  return reusableImageCount > 0 ? output : null;
}

export function validateDirectProviderRoute(route, country, sourceProduct, sourceVariant, providerVariant) {
  const destination = text(country).toUpperCase();
  if (!route?.approved || !Array.isArray(route?.countries) || !route.countries.includes(destination)) {
    return { ok: false, reason: "country_not_approved" };
  }
  const sourceChecks = text(route?.source_product_id) === text(sourceProduct?.id)
    && Number(route?.source_variant_id) === Number(sourceVariant?.id)
    && Number(route?.source_blueprint_id) === Number(sourceProduct?.blueprint_id)
    && Number(route?.source_print_provider_id) === Number(sourceProduct?.print_provider_id);
  if (!sourceChecks) return { ok: false, reason: "approved_identity_mismatch" };
  const targetProviderId = Number(route?.target_print_provider_id);
  if (!Number.isInteger(targetProviderId) || targetProviderId <= 0 || targetProviderId === Number(sourceProduct?.print_provider_id)) {
    return { ok: false, reason: "target_provider_invalid" };
  }
  if (!providerVariant || Number(providerVariant?.id) !== Number(sourceVariant?.id)) {
    return { ok: false, reason: "target_variant_unavailable" };
  }
  const printAreas = directOrderPrintAreas(sourceProduct, sourceVariant?.id);
  if (!printAreas) return { ok: false, reason: "source_artwork_not_order_reusable" };
  // target_cost_usd_cents is already the approved provider cost snapshot.
  // Do not add the historical source→target delta to today's source cost again:
  // that double-counts provider drift and can change retail prices solely based
  // on which provider a design was originally attached to.
  const snapshotCost = Math.round(Number(route?.target_cost_usd_cents));
  const cost = Number.isFinite(snapshotCost) ? snapshotCost : 0;
  if (!Number.isFinite(cost) || cost <= 0) return { ok: false, reason: "target_cost_snapshot_unavailable" };
  return {
    ok: true,
    cost_cents: Math.round(cost),
    print_areas: printAreas,
    estimated_import_cents_per_unit: Math.max(0, Math.round(Number(route?.estimated_import_cents_per_unit || 0))),
  };
}


function candidateUnitScore(candidate) {
  return Number(candidate?.cost_cents || 0) + Math.max(0, Number(candidate?.estimated_import_cents_per_unit || 0));
}

function planFromCandidates(candidates) {
  let productionCents = 0;
  let importCents = 0;
  let mappedCount = 0;
  const providerIds = [];
  for (const candidate of candidates) {
    const quantity = Number(candidate?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Invalid fulfillment candidate quantity");
    const cost = Number(candidate?.cost_cents);
    if (!Number.isFinite(cost) || cost <= 0) throw new Error("Invalid fulfillment candidate cost");
    const importPerUnit = Math.max(0, Math.round(Number(candidate?.estimated_import_cents_per_unit || 0)));
    productionCents += cost * quantity;
    importCents += importPerUnit * quantity;
    mappedCount += candidate?.mapping_approval_id ? 1 : 0;
    const providerId = Number(candidate?.print_provider_id);
    if (Number.isInteger(providerId) && providerId > 0 && !providerIds.includes(providerId)) providerIds.push(providerId);
  }
  providerIds.sort((a, b) => a - b);
  return {
    candidates: [...candidates],
    production_cents: productionCents,
    estimated_import_cents: importCents,
    mapped_count: mappedCount,
    provider_ids: providerIds,
    provider_groups: providerIds.length,
  };
}

function candidateKey(candidate) {
  if (candidate?.direct_provider === true) {
    return `direct:${Number(candidate?.blueprint_id)}:${Number(candidate?.print_provider_id)}:${Number(candidate?.variant_id)}:${text(candidate?.mapping_approval_id)}`;
  }
  return `product:${text(candidate?.product_id)}:${Number(candidate?.variant_id)}:${text(candidate?.mapping_approval_id)}`;
}

function cheapestCandidate(candidates) {
  return [...candidates].sort((a, b) => candidateUnitScore(a) - candidateUnitScore(b) || candidateKey(a).localeCompare(candidateKey(b)))[0];
}

export function buildFulfillmentPlans(candidateGroups, maxPlans = 64) {
  if (!Number.isInteger(maxPlans) || maxPlans < 1) throw new Error("Invalid fulfillment plan limit");
  for (const group of candidateGroups) {
    if (!Array.isArray(group) || !group.length) throw new Error("No safe fulfillment candidate for a cart item");
  }
  if (!candidateGroups.length) return [];

  let combinationCount = 1;
  for (const group of candidateGroups) {
    combinationCount *= group.length;
    if (combinationCount > maxPlans) break;
  }
  if (combinationCount <= maxPlans) {
    let combinations = [[]];
    for (const group of candidateGroups) combinations = combinations.flatMap(plan => group.map(candidate => [...plan, candidate]));
    return combinations.map(planFromCandidates);
  }

  const plans = [];
  const seen = new Set();
  const add = candidates => {
    if (plans.length >= maxPlans) return;
    const key = candidates.map(candidateKey).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    plans.push(planFromCandidates(candidates));
  };

  const baseline = candidateGroups.map(group => group[0]);
  const cheapest = candidateGroups.map(group => cheapestCandidate(group));
  const mappedPreferred = candidateGroups.map(group => {
    const mapped = group.filter(candidate => !!candidate?.mapping_approval_id);
    return mapped.length ? cheapestCandidate(mapped) : group[0];
  });
  add(baseline);
  add(cheapest);
  add(mappedPreferred);

  const providers = [...new Set(candidateGroups.flatMap(group => group.map(candidate => Number(candidate?.print_provider_id)).filter(id => Number.isInteger(id) && id > 0)))].sort((a, b) => a - b);
  for (const providerId of providers) {
    add(candidateGroups.map(group => {
      const providerCandidates = group.filter(candidate => Number(candidate?.print_provider_id) === providerId);
      return providerCandidates.length ? cheapestCandidate(providerCandidates) : group[0];
    }));
  }

  for (let index = 0; index < candidateGroups.length && plans.length < maxPlans; index += 1) {
    for (const candidate of candidateGroups[index].slice(1)) {
      const next = [...baseline];
      next[index] = candidate;
      add(next);
      if (plans.length >= maxPlans) break;
    }
  }
  for (let index = 0; index < candidateGroups.length && plans.length < maxPlans; index += 1) {
    for (const candidate of candidateGroups[index]) {
      if (candidateKey(candidate) === candidateKey(mappedPreferred[index])) continue;
      const next = [...mappedPreferred];
      next[index] = candidate;
      add(next);
      if (plans.length >= maxPlans) break;
    }
  }
  return plans;
}

const EU_DESTINATIONS = new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"]);

function preVatShippingCents(result) {
  const explicit = Number(result?.shipping?.pre_vat_cents);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const fallback = Number(result?.shipping?.cents);
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : Number.POSITIVE_INFINITY;
}

function preVatRouteTotal(result) {
  return Number(result?.plan?.production_cents || 0)
    + preVatShippingCents(result)
    + Number(result?.plan?.estimated_import_cents || 0);
}

export function chooseCheapestFulfillment(results, destinationCountry = "") {
  const valid = (Array.isArray(results) ? results : []).filter(result => result?.shipping && Number.isFinite(result?.plan?.production_cents));
  const euDestination = EU_DESTINATIONS.has(text(destinationCountry).toUpperCase());
  valid.sort((a, b) => {
    const aShipping = preVatShippingCents(a);
    const bShipping = preVatShippingCents(b);
    const aTotal = preVatRouteTotal(a);
    const bTotal = preVatRouteTotal(b);
    return (euDestination ? aShipping - bShipping : aTotal - bTotal)
      || (euDestination ? aTotal - bTotal : aShipping - bShipping)
      || Number(a.plan.provider_groups || 0) - Number(b.plan.provider_groups || 0)
      || a.plan.mapped_count - b.plan.mapped_count
      || String(a.route_key || "").localeCompare(String(b.route_key || ""));
  });
  return valid[0] || null;
}
