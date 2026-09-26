import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  buildFulfillmentPlans,
  cheapestShippingQuote,
  chooseCheapestFulfillment,
  estimatedImportAllowanceCentsPerUnit,
  parseFulfillmentMappings,
  validateMappedCandidate,
} from "./fulfillment-routing.mjs";
import { fxAuditSnapshot, PRINTIFY_SOURCE_CURRENCY, resolveUsdEurRate, usdCentsToEurCents } from "../_shared/shop-fx.mjs";

const PRINTIFY_V1 = "https://api.printify.com/v1";
const PRINTIFY_V2 = "https://api.printify.com/v2";
const MAX_ITEMS = 20;
const MAX_QTY = 10;
const MAX_FULFILLMENT_PLANS = 64;
const CHOICE_PROVIDER_ID = 99;
const US_QUOTE_ONLY_PHONE = "+12025550123"; // fictitious NANP 555 number; quote-only and never persisted
const ALLOWED_ORIGINS = new Set(["https://kalenel.nl", "https://www.kalenel.nl", "https://jesperoaths.github.io"]);
const EU = new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"]);
const text = (v: unknown) => String(v ?? "").trim();
const clean = (v: unknown) => text(v).replace(/\s+/g, " ");

function cors(req: Request) {
  const origin = text(req.headers.get("origin"));
  const allow = ALLOWED_ORIGINS.has(origin) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin) ? origin : "https://kalenel.nl";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
}
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors(req) });
function normalizeCountry(v: unknown) { return text(v || "NL").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2); }
function strictCountry(v: unknown) {
  const raw = text(v);
  const code = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (/^[A-Z]{2}$/.test(code)) return code;
  const aliases: Record<string, string> = {
    "UNITED KINGDOM": "GB", "GREAT BRITAIN": "GB", "ENGLAND": "GB",
    "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US", "USA": "US",
    "CZECH REPUBLIC": "CZ", "CZECHIA": "CZ", "NETHERLANDS": "NL",
    "GERMANY": "DE", "FRANCE": "FR", "CANADA": "CA", "AUSTRALIA": "AU",
  };
  return aliases[raw.toUpperCase()] || "";
}

async function printify(base: string, token: string, path: string, init: RequestInit = {}, timeoutMs = 10000) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "Kalenel-Delivery-Preview/8.33", ...(init.headers || {}) },
      });
      const raw = await res.text();
      let payload: any = null;
      try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
      if (res.ok) return payload;

      const message = `Printify ${res.status}: ${text(payload?.message || payload?.error || raw).slice(0, 250)}`;
      if (attempt < 2 && (res.status === 429 || res.status >= 500)) {
        lastError = new Error(message);
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }
      throw new Error(message);
    } catch (error) {
      lastError = error;
      const transient = error instanceof DOMException && error.name === "AbortError"
        || error instanceof TypeError;
      if (attempt < 2 && transient) {
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Printify request failed");
}
const printifyV1 = (token: string, path: string, init: RequestInit = {}, timeoutMs = 10000) => printify(PRINTIFY_V1, token, path, init, timeoutMs);
const printifyV2 = (token: string, path: string, timeoutMs = 6500) => printify(PRINTIFY_V2, token, path, {}, timeoutMs);

async function resolvePrintifyToken(sb: any) {
  const envToken = text(Deno.env.get("PRINTIFY_API_TOKEN"));
  if (envToken) return envToken;
  const { data, error } = await sb.rpc("get_printify_api_token_v815a");
  if (error || !text(data)) throw new Error("Printify token unavailable");
  return text(data);
}

function cachedShopId(payload: any, resolvedProducts: any[] = []) {
  const resolvedIds = [...new Set(
    resolvedProducts
      .map((product: any) => Number(product?.shopId ?? product?.shop_id))
      .filter((value: number) => Number.isFinite(value))
  )];
  if (resolvedIds.length === 1) return resolvedIds[0];
  if (resolvedIds.length > 1) throw new Error("Selected products span multiple Printify shops");

  const legacy = Number(payload?.shop?.id ?? payload?.shopId ?? payload?.shop_id);
  if (Number.isFinite(legacy)) return legacy;

  const shops = Array.isArray(payload?.shops) ? payload.shops : [];
  const shopIds = [...new Set(shops.map((shop: any) => Number(shop?.id)).filter((value: number) => Number.isFinite(value)))];
  if (shopIds.length === 1) return shopIds[0];

  const productIds = [...new Set(
    (Array.isArray(payload?.products) ? payload.products : [])
      .map((product: any) => Number(product?.shopId ?? product?.shop_id))
      .filter((value: number) => Number.isFinite(value))
  )];
  if (productIds.length === 1) return productIds[0];
  throw new Error("Printify shop id unavailable");
}

function cachedResolution(payload: any, item: any) {
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const sku = text(item?.sku);
  const requestedProductId = text(item?.product_id || item?.productId);
  const requestedVariantId = text(item?.variant_id || item?.variantId);
  if (requestedProductId && requestedVariantId) {
    const product = products.find((p: any) => text(p?.id) === requestedProductId);
    const variant = (Array.isArray(product?.variants) ? product.variants : []).find((v: any) => text(v?.id) === requestedVariantId);
    if (product && variant) return { product, variant };
  }
  if (sku) {
    for (const product of products) {
      const variant = (Array.isArray(product?.variants) ? product.variants : []).find((v: any) => text(v?.sku) === sku);
      if (variant) return { product, variant };
    }
  }
  const name = clean(item?.name).toLowerCase();
  const size = clean(item?.size).toUpperCase();
  const product = products.find((p: any) => clean(p?.name).toLowerCase() === name);
  if (!product) return null;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variant = variants.find((v: any) => text(v?.size).toUpperCase() === size) || null;
  return variant ? { product, variant } : null;
}

function optionMap(product: any) {
  const map = new Map<string, { type: string; value: string }>();
  for (const option of Array.isArray(product?.options) ? product.options : []) {
    const type = text(option?.type).toLowerCase();
    for (const value of Array.isArray(option?.values) ? option.values : []) map.set(String(value?.id), { type, value: text(value?.title) });
  }
  return map;
}
function optionValues(product: any, variant: any) {
  const map = optionMap(product);
  return (Array.isArray(variant?.options) ? variant.options : []).map((id: unknown) => map.get(String(id))).filter(Boolean) as { type: string; value: string }[];
}
function colorFromVariant(product: any, variant: any) {
  return text(optionValues(product, variant).find(x => x.type === "color")?.value);
}
function isToteProduct(product: any) {
  return /\btote\b/i.test(text(product?.title));
}
function isCustomerVariantAllowed(product: any, variant: any) {
  const color = colorFromVariant(product, variant);
  if (isToteProduct(product)) return /^(?:black|white)$/i.test(color);
  return !color || /^white$/i.test(color);
}

function dbMappingPayload(rows: any[]) {
  return {
    version: 1,
    mappings: (Array.isArray(rows) ? rows : []).map(row => ({
      approval_id: row.approval_id,
      approved: row.approved === true,
      countries: row.countries,
      estimated_import_cents_per_unit: row.estimated_import_cents_per_unit,
      source: {
        product_id: row.source_product_id,
        variant_id: row.source_variant_id,
        blueprint_id: row.source_blueprint_id,
        print_provider_id: row.source_print_provider_id,
      },
      target: {
        product_id: row.target_product_id,
        variant_id: row.target_variant_id,
        blueprint_id: row.target_blueprint_id,
        print_provider_id: row.target_print_provider_id,
      },
    })),
  };
}

function regionName(code: string) {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; }
  catch { return code; }
}
function choiceRegion(country: string) {
  if (EU.has(country)) return `${regionName(country)} / EU`;
  if (country === "GB") return "United Kingdom";
  if (country === "CA") return "Canada";
  if (country === "AU" || country === "NZ") return "Australia / New Zealand region";
  if (country === "US") return "United States";
  return regionName(country);
}

async function providerOrigin(token: string, providerId: number, destinationCountry: string) {
  if (providerId === CHOICE_PROVIDER_ID) {
    return {
      provider_id: providerId,
      provider: "Bruis production network",
      country_code: null,
      label: `Our production network — we will try to prepare your order in or near ${choiceRegion(destinationCountry)}; if no nearby location is available, we may send it internationally`,
      exact: false,
    };
  }
  try {
    const provider = await printifyV1(token, `/catalog/print_providers/${providerId}.json`, {}, 6500);
    const loc = provider?.location || {};
    const city = clean(loc?.city);
    const region = clean(loc?.region);
    const countryCode = strictCountry(loc?.country);
    const country = countryCode ? regionName(countryCode) : "";
    const place = [city, region && region !== city ? region : "", country].filter(Boolean).join(", ");
    return {
      provider_id: providerId,
      provider: "Bruis production partner",
      city: city || null,
      region: region || null,
      country_code: countryCode || null,
      label: place || "Bruis production location",
      exact: !!place,
    };
  } catch {
    return { provider_id: providerId, provider: "Bruis production partner", label: "Production location temporarily unavailable", exact: false };
  }
}

function quoteCentsForCode(quote: any, code: number) {
  const raw = code === 4 ? quote?.economy
    : code === 1 ? quote?.standard
    : code === 2 ? (quote?.priority ?? quote?.express)
    : code === 3 ? (quote?.printify_express ?? quote?.express)
    : null;
  const cents = Number(raw);
  return Number.isFinite(cents) && cents >= 0 ? Math.round(cents) : null;
}

async function shippingBreakdown(token: string, shopId: string, selected: any, addressTo: any, fx: any, origins: any[]) {
  const groups = new Map<number, any[]>();
  for (const candidate of selected.plan.candidates) {
    const providerId = Number(candidate?.print_provider_id);
    if (!Number.isInteger(providerId)) continue;
    if (!groups.has(providerId)) groups.set(providerId, []);
    groups.get(providerId)!.push(candidate);
  }
  const originMap = new Map(origins.map(origin => [Number(origin?.provider_id), origin]));
  const breakdown = await Promise.all([...groups.entries()].map(async ([providerId, candidates]) => {
    const lineItems = candidates.map((candidate: any, index: number) => ({
      product_id: candidate.product_id,
      variant_id: candidate.variant_id,
      quantity: candidate.quantity,
      external_id: `breakdown-${providerId}-${index + 1}`,
    }));
    const quote = await printifyV1(token, `/shops/${shopId}/orders/shipping.json`, {
      method: "POST",
      body: JSON.stringify({ line_items: lineItems, address_to: addressTo }),
    }, 8500);
    const sourceCents = quoteCentsForCode(quote, Number(selected.shipping.code)) ?? cheapestShippingQuote(quote)?.cents;
    if (!Number.isFinite(Number(sourceCents))) throw new Error("Shipping breakdown unavailable");
    const origin = originMap.get(providerId) || {};
    return {
      provider_id: providerId,
      provider: origin.provider || "Bruis production partner",
      origin: origin.label || null,
      country_code: origin.country_code || null,
      shipping_cents: usdCentsToEurCents(Number(sourceCents), fx),
      shipping_source_cents: Number(sourceCents),
      items: candidates.map((candidate: any) => ({
        name: clean(candidate.item_name) || "Shirt",
        size: clean(candidate.item_size) || null,
        quantity: Math.max(1, Math.round(Number(candidate.quantity || 1))),
      })),
    };
  }));
  const convertedTotal = breakdown.reduce((sum, group) => sum + Number(group.shipping_cents || 0), 0);
  const roundingDelta = Math.round(Number(selected.shipping.cents || 0) - convertedTotal);
  if (breakdown.length && roundingDelta) {
    breakdown[breakdown.length - 1].shipping_cents += roundingDelta;
    breakdown[breakdown.length - 1].fx_rounding_adjustment_cents = roundingDelta;
  }
  return breakdown;
}

function customsNotice(destination: string, origins: any[]) {
  const originCountries = [...new Set(origins.map(origin => strictCountry(origin?.country_code)).filter(Boolean))];
  const unknownOrigin = origins.some(origin => origin?.exact !== true || !strictCountry(origin?.country_code));
  const crosses = originCountries.some(origin => origin !== destination && !(EU.has(origin) && EU.has(destination)));
  if (originCountries.includes("GB") && EU.has(destination)) return "Import-cost warning: this route ships from the United Kingdom into the EU. Import VAT, customs duties where applicable, and carrier handling fees may be charged on arrival; these costs are not included in shipping.";
  if (EU.has(destination) && originCountries.some(origin => !EU.has(origin))) return "Import-cost warning: this route ships into the EU from outside the EU customs area. Import VAT, customs duties where applicable, and carrier handling fees may be charged on arrival; these costs are not included in shipping.";
  if (destination === "GB" && originCountries.some(origin => EU.has(origin))) return "Import-cost warning: this route ships from the EU into the United Kingdom. UK import VAT, customs duties where applicable, and carrier handling fees may be charged on arrival; these costs are not included in shipping.";
  if (crosses) return "Import-cost warning: this route crosses a customs border. Import taxes, customs duties, and carrier handling fees may be charged by the destination country and are not included in shipping.";
  if (unknownOrigin) return "Import-cost warning: we will confirm the exact production location after ordering. If we send your order from outside your customs area, import VAT or taxes, customs duties, and carrier handling fees may apply and are not included in shipping.";
  return null;
}

function choiceDelivery(shippingMethod: string, destinationCountry: string) {
  const method = text(shippingMethod).toLowerCase();
  if (method === "express") return { from: 2, to: 3, source: "bruis-network-express", choice: true, fallback: null };
  if (method === "priority") return { from: destinationCountry === "US" ? 4 : 5, to: destinationCountry === "US" ? 10 : 12, source: "bruis-network-typical", choice: true, fallback: destinationCountry === "US" ? null : { from: 5, to: 12 } };
  if (method === "economy") return { from: 6, to: 15, source: "bruis-network-typical", choice: true, fallback: null };
  return {
    from: 4,
    to: 12,
    source: "bruis-network-local-typical",
    choice: true,
    fallback: destinationCountry === "US" ? null : { from: 12, to: 37 },
  };
}

async function deliveryRange(token: string, candidate: any, shippingMethod: string, country: string) {
  const blueprintId = Number(candidate?.blueprint_id);
  const providerId = Number(candidate?.print_provider_id);
  const variantId = Number(candidate?.variant_id);
  if (providerId === CHOICE_PROVIDER_ID) return choiceDelivery(shippingMethod, country);
  if (![blueprintId, providerId, variantId].every(Number.isInteger)) return null;
  try {
    const payload = await printifyV2(token, `/catalog/blueprints/${blueprintId}/print_providers/${providerId}/shipping/${encodeURIComponent(shippingMethod)}.json`);
    const rows = (Array.isArray(payload?.data) ? payload.data : []).filter((row: any) => Number(row?.attributes?.variantId) === variantId);
    const exact = rows.find((row: any) => text(row?.attributes?.country?.code).toUpperCase() === country);
    const fallback = rows.find((row: any) => text(row?.attributes?.country?.code).toUpperCase() === "REST_OF_THE_WORLD");
    const attrs = (exact || fallback)?.attributes;
    const from = Number(attrs?.handlingTime?.from);
    const to = Number(attrs?.handlingTime?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) return null;
    return { from: Math.round(from), to: Math.round(to), source: exact ? "country-specific" : "rest-of-world", choice: false, fallback: null };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(req, { error: "server_not_configured" }, 503);
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const body = await req.json();
    const customer = body?.customer || {};
    const country = normalizeCountry(customer?.country);
    const address1 = clean(customer?.address1);
    const address2 = clean(customer?.address2).slice(0, 100);
    const city = clean(customer?.city);
    const region = clean(customer?.region).slice(0, 100);
    const zip = clean(customer?.zip).slice(0, 24);
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!address1 || !city || !zip || country.length !== 2) return json(req, { error: "delivery_address_incomplete" }, 400);
    if (!items.length || items.length > MAX_ITEMS) return json(req, { error: "invalid_cart" }, 400);

    const { data: cache, error: cacheError } = await sb.from("shop_catalog_cache_v828").select("payload").eq("id", 1).maybeSingle();
    if (cacheError || !Array.isArray(cache?.payload?.products) || !cache.payload.products.length) throw new Error("Live Printify catalog is not ready");
    const resolved = items.map((item: any) => ({ raw: item, cached: cachedResolution(cache.payload, item) }));
    if (resolved.some((row: any) => !row.cached)) throw new Error("One or more selected variants are no longer in the live catalog");
    const shopId = cachedShopId(cache.payload, resolved.map((row: any) => row.cached?.product).filter(Boolean));

    // v870: include only explicit, approved, destination-matching regional clones.
    // Every candidate is re-fetched from Printify and then validated again for
    // blueprint/provider/variant/artwork equivalence before it can be quoted.
    const sourceProductIds = [...new Set(resolved.map((row: any) => text(row.cached.product.id)).filter(Boolean))];
    const { data: mappingRows, error: mappingError } = await sb
      .from("shop_fulfillment_mappings")
      .select("approval_id,approved,countries,source_product_id,source_variant_id,source_blueprint_id,source_print_provider_id,target_product_id,target_variant_id,target_blueprint_id,target_print_provider_id,estimated_import_cents_per_unit")
      .eq("approved", true)
      .contains("countries", [country])
      .in("source_product_id", sourceProductIds);
    if (mappingError) console.warn("Approved regional fulfillment mappings unavailable", mappingError.message);
    const mappings: any[] = mappingError
      ? []
      : parseFulfillmentMappings(JSON.stringify(dbMappingPayload(mappingRows || [])));
    const eligibleMappings = mappings.filter((mapping: any) => mapping.countries.includes(country) && resolved.some((row: any) =>
      mapping.source.product_id === text(row.cached.product.id) && mapping.source.variant_id === Number(row.cached.variant.id)
    ));

    const printifyToken = await resolvePrintifyToken(sb);
    const fx = await resolveUsdEurRate(sb);
    const freshProducts = new Map<string, any>();
    const sourceEntries = await Promise.all(sourceProductIds.map(async productId => {
      if (!/^[a-zA-Z0-9_-]{8,80}$/.test(productId)) throw new Error("Invalid Printify product id");
      return [productId, await printifyV1(printifyToken, `/shops/${shopId}/products/${encodeURIComponent(productId)}.json`)] as const;
    }));
    sourceEntries.forEach(([productId, product]) => freshProducts.set(productId, product));
    const regionalTargetProductIds = [...new Set(eligibleMappings.map((mapping: any) => text(mapping.target.product_id)).filter(Boolean))];
    await Promise.all(regionalTargetProductIds.map(async productId => {
      if (freshProducts.has(productId) || !/^[a-zA-Z0-9_-]{8,80}$/.test(productId)) return;
      try {
        freshProducts.set(productId, await printifyV1(printifyToken, `/shops/${shopId}/products/${encodeURIComponent(productId)}.json`));
      } catch (error) {
        console.warn("Ignoring unavailable approved regional Printify target", productId, error instanceof Error ? error.message.slice(0, 180) : "unknown");
      }
    }));

    const candidateGroups: any[][] = [];
    for (const row of resolved) {
      const raw = row.raw;
      const productId = text(row.cached.product.id);
      const freshProduct = freshProducts.get(productId);
      const variantId = Number(row.cached.variant.id);
      const freshVariant = (Array.isArray(freshProduct?.variants) ? freshProduct.variants : []).find((v: any) => Number(v?.id) === variantId);
      const qtyRaw = Number(raw?.qty || 0);
      const qty = Math.floor(qtyRaw);
      if (!Number.isFinite(qtyRaw) || qty < 1 || qty > MAX_QTY) throw new Error("Invalid quantity");
      if (!freshVariant || freshVariant?.is_enabled === false || freshVariant?.is_available === false || !isCustomerVariantAllowed(freshProduct, freshVariant)) throw new Error(`Selected variant is unavailable: ${clean(row.cached.product.name)}`);
      const sourceCost = Math.round(Number(freshVariant?.cost));
      if (!Number.isFinite(sourceCost) || sourceCost <= 0) throw new Error(`Invalid authoritative production cost: ${clean(row.cached.product.name)}`);
      const cost = usdCentsToEurCents(sourceCost, fx);
      const color = colorFromVariant(freshProduct, freshVariant) || "White";
      const itemLabel = isToteProduct(freshProduct) ? `${color} handles` : clean(row.cached.variant.size);

      const candidates: any[] = [{
        product_id: productId,
        variant_id: variantId,
        quantity: qty,
        cost_cents: cost,
        source_cost_cents: sourceCost,
        source_currency: PRINTIFY_SOURCE_CURRENCY,
        mapping_approval_id: "",
        blueprint_id: Number(freshProduct?.blueprint_id),
        print_provider_id: Number(freshProduct?.print_provider_id),
        estimated_import_cents_per_unit: estimatedImportAllowanceCentsPerUnit(
          country, Number(freshProduct?.blueprint_id), Number(freshProduct?.print_provider_id), cost,
        ),
        item_name: clean(row.cached.product.name),
        item_size: itemLabel,
      }];
      for (const mapping of eligibleMappings.filter((entry: any) => entry.source.product_id === productId && entry.source.variant_id === variantId)) {
        const targetProduct = freshProducts.get(mapping.target.product_id);
        const targetVariant = (Array.isArray(targetProduct?.variants) ? targetProduct.variants : []).find((variant: any) => Number(variant?.id) === mapping.target.variant_id);
        const validation = validateMappedCandidate(mapping, country, freshProduct, freshVariant, targetProduct, targetVariant);
        if (!validation.ok) continue;
        candidates.push({
          product_id: mapping.target.product_id,
          variant_id: mapping.target.variant_id,
          quantity: qty,
          cost_cents: usdCentsToEurCents(validation.cost_cents, fx),
          source_cost_cents: validation.cost_cents,
          source_currency: PRINTIFY_SOURCE_CURRENCY,
          mapping_approval_id: mapping.approval_id,
          blueprint_id: mapping.target.blueprint_id,
          print_provider_id: mapping.target.print_provider_id,
          estimated_import_cents_per_unit: validation.estimated_import_cents_per_unit || 0,
          item_name: clean(row.cached.product.name),
          item_size: itemLabel,
        });
      }
      candidateGroups.push(candidates);
    }

    const addressTo = { first_name: "Checkout", last_name: "Estimate", email: "checkout@kalenel.nl", phone: country === "US" ? US_QUOTE_ONLY_PHONE : "", country, region, address1, address2, city, zip };
    const plans = buildFulfillmentPlans(candidateGroups, MAX_FULFILLMENT_PLANS);
    const quotedPlans: any[] = [];
    for (const plan of plans) {
      const lineItems = plan.candidates.map((candidate: any, idx: number) => ({ product_id: candidate.product_id, variant_id: candidate.variant_id, quantity: candidate.quantity, external_id: `estimate-${idx + 1}` }));
      try {
        const quote = await printifyV1(printifyToken, `/shops/${shopId}/orders/shipping.json`, { method: "POST", body: JSON.stringify({ line_items: lineItems, address_to: addressTo }) }, 8500);
        const sourceShipping = cheapestShippingQuote(quote);
        if (sourceShipping) {
          const shipping = {
            ...sourceShipping,
            cents: usdCentsToEurCents(sourceShipping.cents, fx),
            source_cents: sourceShipping.cents,
            source_currency: PRINTIFY_SOURCE_CURRENCY,
          };
          quotedPlans.push({ plan, shipping, route_key: lineItems.map((item: any) => `${item.product_id}:${item.variant_id}`).join("|") });
        }
      } catch {}
    }
    const selected = chooseCheapestFulfillment(quotedPlans);
    if (!selected) throw new Error("No shipping method available for this address");

    const uniqueProviders = [...new Set(selected.plan.candidates.map((candidate: any) => Number(candidate.print_provider_id)).filter(Number.isInteger))];
    const [origins, rawRanges] = await Promise.all([
      Promise.all(uniqueProviders.map(providerId => providerOrigin(printifyToken, providerId, country))),
      Promise.all(selected.plan.candidates.map((candidate: any) => deliveryRange(printifyToken, candidate, selected.shipping.name, country))),
    ]);
    let shipping_breakdown: any[] = [];
    try {
      shipping_breakdown = await shippingBreakdown(printifyToken, shopId, selected, addressTo, fx, origins);
    } catch {
      shipping_breakdown = [{
        provider_id: null,
        provider: "Bruis production network",
        origin: null,
        country_code: null,
        shipping_cents: Number(selected.shipping.cents || 0),
        shipping_source_cents: Number(selected.shipping.source_cents || 0),
        items: selected.plan.candidates.map((candidate: any) => ({
          name: clean(candidate.item_name) || "Item",
          size: clean(candidate.item_size) || null,
          quantity: Math.max(1, Math.round(Number(candidate.quantity || 1))),
        })),
        fallback: true,
      }];
    }
    const customs_notice = customsNotice(country, origins);
    const ranges = rawRanges.filter(Boolean) as { from: number; to: number; source: string; choice?: boolean; fallback?: { from: number; to: number } | null }[];
    const complete = ranges.length === selected.plan.candidates.length;
    const hasChoice = ranges.some(range => range.choice);
    const choiceFallback = ranges.find(range => range.choice && range.fallback)?.fallback || null;
    const delivery = complete ? {
      min_business_days: Math.max(...ranges.map(range => range.from)),
      max_business_days: Math.max(...ranges.map(range => range.to)),
      exact_for_selected_route: !hasChoice,
      estimate_type: hasChoice ? "bruis-network-typical-local-route" : "bruis-route-specific",
      fallback_min_business_days: choiceFallback?.from ?? null,
      fallback_max_business_days: choiceFallback?.to ?? null,
    } : {
      min_business_days: null,
      max_business_days: null,
      exact_for_selected_route: false,
      estimate_type: "incomplete",
      fallback_min_business_days: null,
      fallback_max_business_days: null,
    };

    const note = complete
      ? hasChoice
        ? choiceFallback
          ? `We will try to prepare your order nearby. The ${delivery.min_business_days}–${delivery.max_business_days} business-day range is the typical local estimate; if nearby production is unavailable, international delivery can take roughly ${choiceFallback.from}–${choiceFallback.to} business days. Estimates are not guaranteed.`
          : `We will assign the production location after the order is placed. The shown range is a typical estimate for the selected shipping method and is not guaranteed.`
        : "Estimated business-day range for the route we selected. Delays can still occur."
      : "We do not have a complete route-specific delivery range yet. The estimate can update when we assign the production location.";

    return json(req, {
      ok: true,
      shipping_cents: selected.shipping.cents,
      shipping_source_cents: Math.max(0, Math.round(Number(selected.shipping.source_cents || 0))),
      shipping_source_currency: PRINTIFY_SOURCE_CURRENCY,
      estimated_import_cents: Math.max(0, Math.round(Number(selected.plan.estimated_import_cents || 0))),
      fx: fxAuditSnapshot(fx),
      shipping_method: selected.shipping.name,
      shipping_method_code: selected.shipping.code,
      origins,
      shipping_breakdown,
      customs_notice,
      shipping_stacks: shipping_breakdown.length > 1,
      provider_groups: Number(selected.plan.provider_groups || uniqueProviders.length || 1),
      may_arrive_separately: Number(selected.plan.provider_groups || 1) > 1,
      delivery,
      note,
    });
  } catch (error) {
    const detail = text(error instanceof Error ? error.message : error).slice(0, 350);
    console.error("shop-delivery-preview-v833 failed", error instanceof Error ? `${error.name}: ${detail}` : detail);
    return json(req, { error: "delivery_preview_failed", detail: "We could not calculate shipping right now. Please try again." }, 502);
  }
});
