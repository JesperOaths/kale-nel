import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { fxAuditSnapshot, resolveUsdEurRate, retailEurCentsFromUsdCost } from "../_shared/shop-fx.mjs";

const PRINTIFY_BASE = "https://api.printify.com/v1";
const CACHE_FRESH_MS = 60_000;
const REFRESH_LEASE_MS = 120_000;
const MAX_PAGES = 100;
const ROUTE_PREFIX = "__KALENEL_ROUTE_";
const BOXY_TITLES = new Set(["coral", "daffodil", "dragonfly", "honeysuckle", "horseshoe crab", "seahorse", "seaweed"]);
const ALLOWED_ORIGINS = new Set(["https://kalenel.nl", "https://www.kalenel.nl", "https://jesperoaths.github.io"]);
const PUBLIC_TITLE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\baye[- ]?aye\b/i, "Aye-Aye"],
  [/\bocelot\b/i, "Banded Linsang"],
  [/\bfennec fox\b/i, "Fennec Fox"],
  [/\bhumpback whale\b/i, "Humpback Whale"],
  [/(?:\bjapanese maple\b|\bautumn maple leaf\b)/i, "Japanese Maple"],
  [/\bjerboa\b/i, "Jerboa"],
  [/\bspider crab\b/i, "Japanese Spider Crab"],
  [/\bshrimp\b/i, "Krill"],
  [/(?:\bleaf[- ]tailed gecko\b|\bleaf camouflage gecko\b|\bleaf gecko\b)/i, "Leaf-Tailed Gecko"],
  [/\bleaping seal\b|\bseal\b/i, "Leopard Seal"],
  [/\bkudu\b/i, "Kudu"],
  [/(?:\bgarden spider\b|\borb[- ]?weaver\b)/i, "Orb-Weaver"],
  [/\bhermit crab\b/i, "Pom-Pom Crab"],
  [/\bpuffer\s*fish\b/i, "Pufferfish"],
  [/\bsecretary bird\b/i, "Secretary Bird"],
  [/(?:\bmanta ray\b|\bocean stingray\b)/i, "Manta Ray"],
  [/\bbearded dragon\b/i, "Thorny Devil"],
];

const text = (value: unknown) => String(value ?? "").trim();
const MARGIN_CENTS = 500;

function publicTitle(product: any) {
  const raw = text(product?.title);
  for (const [pattern, title] of PUBLIC_TITLE_RULES) if (pattern.test(raw)) return title;
  return raw;
}

function cors(req: Request) {
  const origin = text(req.headers.get("origin"));
  const allow = ALLOWED_ORIGINS.has(origin) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)
    ? origin
    : "https://kalenel.nl";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=15, stale-while-revalidate=45",
  };
}

const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors(req) });

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("server_not_configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function printify(token: string, path: string, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${PRINTIFY_BASE}${path}`, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Kalenel-Direct-Catalog/8.50",
      },
    });
    const raw = await response.text();
    let payload: any = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
    if (!response.ok) throw new Error(`printify_${response.status}:${text(payload?.message || payload?.error || raw).slice(0, 180)}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveToken(supabase: any) {
  const envToken = text(Deno.env.get("PRINTIFY_API_TOKEN"));
  if (envToken) return envToken;
  const { data, error } = await supabase.rpc("get_printify_api_token_v815a");
  if (error || !text(data)) throw new Error("production_connection_missing");
  return text(data);
}

async function loadProducts(token: string, shopId: number) {
  const rows: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await printify(token, `/shops/${shopId}/products.json?limit=50&page=${page}`);
    const pageRows = Array.isArray(payload?.data) ? payload.data : [];
    rows.push(...pageRows);
    const lastPage = Number(payload?.last_page || 0);
    if (!pageRows.length || pageRows.length < 50 || (lastPage && page >= lastPage)) break;
  }
  return rows;
}

function sellableCatalogScore(products: any[]) {
  return products.filter((product: any) => {
    if (product?.visible === false) return false;
    if (text(product?.title).startsWith(ROUTE_PREFIX)) return false;
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const hasEnabled = variants.some((variant: any) => variant?.is_enabled !== false && variant?.is_available !== false);
    const hasMedia = (Array.isArray(product?.images) && product.images.some((image: any) => text(image?.src)))
      || (Array.isArray(product?.print_areas) && product.print_areas.length > 0);
    return hasEnabled && hasMedia;
  }).length;
}

async function firstProductPage(token: string, shopId: number) {
  const payload = await printify(token, `/shops/${shopId}/products.json?limit=50&page=1`);
  return {
    rows: Array.isArray(payload?.data) ? payload.data : [],
    lastPage: Math.max(1, Number(payload?.last_page || 1)),
  };
}

async function completeProducts(token: string, shopId: number, first: { rows: any[]; lastPage: number }) {
  if (first.lastPage <= 1) return first.rows;
  const pages = Array.from({ length: Math.min(MAX_PAGES, first.lastPage) - 1 }, (_, index) => index + 2);
  const remaining = await Promise.all(pages.map(async page => {
    const payload = await printify(token, `/shops/${shopId}/products.json?limit=50&page=${page}`);
    return Array.isArray(payload?.data) ? payload.data : [];
  }));
  return [...first.rows, ...remaining.flat()];
}

async function loadAccountProducts(token: string) {
  const shopsPayload = await printify(token, "/shops.json");
  const shops = Array.isArray(shopsPayload) ? shopsPayload : [];
  if (!shops.length) throw new Error("no_shop_available");

  const results = await Promise.allSettled(shops.map(async (shop: any) => {
    const shopId = Number(shop?.id);
    if (!Number.isFinite(shopId)) throw new Error("invalid_shop_id");
    const first = await firstProductPage(token, shopId);
    const products = await completeProducts(token, shopId, first);
    return { shop, shopId, products };
  }));

  const readable = results
    .filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled")
    .map(result => result.value);

  if (!readable.length) throw new Error("no_readable_printify_shop");

  return {
    shops: readable.map(entry => ({
      id: String(entry.shopId),
      title: text(entry.shop?.title),
      salesChannel: text(entry.shop?.sales_channel),
      productCount: entry.products.length,
    })),
    entries: readable.flatMap(entry => entry.products.map((product: any) => ({
      shop: entry.shop,
      shopId: entry.shopId,
      product,
    }))),
  };
}

type ResolvedOption = { name: string; type: string; value: string };
function optionMap(product: any) {
  const map = new Map<string, ResolvedOption>();
  for (const option of Array.isArray(product?.options) ? product.options : []) {
    const rawName = text(option?.name);
    const type = text(option?.type).toLowerCase();
    const name = type === "color" ? "Color" : type === "size" ? "Size" : (rawName || type || "Option");
    for (const value of Array.isArray(option?.values) ? option.values : []) {
      map.set(String(value?.id), { name, type, value: text(value?.title) });
    }
  }
  return map;
}
function resolvedOptions(product: any, variant: any) {
  const map = optionMap(product);
  return (Array.isArray(variant?.options) ? variant.options : [])
    .map((id: unknown) => map.get(String(id)))
    .filter(Boolean) as ResolvedOption[];
}
function sizeFrom(product: any, variant: any) {
  const explicit = resolvedOptions(product, variant).find((item) => item.type === "size")?.value;
  if (explicit) return text(explicit).toUpperCase();
  const match = text(variant?.title).match(/(?:^|\s|\/|\|)(xs|s|m|l|xl|2xl|3xl|4xl|5xl)(?:$|\s|\/|\|)/i);
  return match ? match[1].toUpperCase() : "";
}
function colorFrom(product: any, variant: any) {
  return text(resolvedOptions(product, variant).find((item) => item.type === "color")?.value);
}
function isToteProduct(product: any) {
  return /\btote\b/i.test(text(product?.title));
}
function isPublicVariant(_product: any, variant: any) {
  return variant?.is_enabled !== false && variant?.is_available !== false;
}

function variantDisplayLabel(product: any, variant: any) {
  const options = resolvedOptions(product, variant)
    .map((item) => text(item.value))
    .filter(Boolean);
  if (options.length) return options.join(" / ");
  return text(variant?.title) || "Default";
}
function collectionFor(product: any) {
  const title = text(product?.title);
  const key = title.toLowerCase();
  const haystack = [
    title,
    product?.description,
    product?.product_type,
    product?.productType,
    ...(Array.isArray(product?.tags) ? product.tags : []),
  ].map(text).join(" ");
  if (/(?:dispuut|spinoza)/i.test(haystack)) return "merch";
  if (/\b(?:oversized|boxy)\b/i.test(title) || BOXY_TITLES.has(key)) return "boxy";
  return "normal";
}
function artworkFor(product: any) {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const area of Array.isArray(product?.print_areas) ? product.print_areas : []) {
    for (const placeholder of Array.isArray(area?.placeholders) ? area.placeholders : []) {
      if (!/^front$/i.test(text(placeholder?.position))) continue;
      for (const image of Array.isArray(placeholder?.images) ? placeholder.images : []) {
        const src = text(image?.src);
        if (!src || seen.has(src)) continue;
        try {
          const url = new URL(src);
          if (url.protocol !== "https:") continue;
        } catch { continue; }
        seen.add(src);
        out.push({ image: src, label: "Artwork PNG" });
      }
    }
  }
  return out.slice(0, 1);
}
function versionedMockupUrl(src: string, updatedAt: unknown) {
  const raw = text(src);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.hostname === "images.printify.com" || url.hostname.endsWith(".printify.com")) {
      const stamp = Date.parse(text(updatedAt));
      if (Number.isFinite(stamp)) url.searchParams.set("kv", String(stamp));
    }
    return url.toString();
  } catch {
    return raw;
  }
}
function mediaFor(product: any) {
  const seen = new Set<string>();
  let media = (Array.isArray(product?.images) ? product.images : [])
    .map((image: any, index: number) => ({
    image: versionedMockupUrl(text(image?.src), product?.updated_at),
    label: text(image?.position || `View ${index + 1}`),
    index,
    variantIds: Array.isArray(image?.variant_ids) ? image.variant_ids.map((id: unknown) => String(id)) : [],
  }))
    .filter((item: any) => {
      if (!item.image || seen.has(item.image)) return false;
      try {
        const url = new URL(item.image);
        if (url.protocol !== "https:" || !(url.hostname === "images.printify.com" || url.hostname.endsWith(".printify.com"))) return false;
      } catch { return false; }
      seen.add(item.image);
      return true;
    })
    .sort((a: any, b: any) => a.index - b.index);
  return media.slice(0, 24).map(({ image, label, variantIds }: any) => ({ image, label, variantIds }));
}
function publicProduct(product: any, fx: any, shopId: number, shop: any) {
  const variants = (Array.isArray(product?.variants) ? product.variants : [])
    .filter((variant: any) => isPublicVariant(product, variant))
    .map((variant: any) => ({
      id: String(variant?.id || ""),
      sku: text(variant?.sku),
      title: text(variant?.title),
      size: sizeFrom(product, variant) || variantDisplayLabel(product, variant),
      label: variantDisplayLabel(product, variant),
      color: colorFrom(product, variant),
      price: retailEurCentsFromUsdCost(variant?.cost, fx, MARGIN_CENTS) / 100,
      is_enabled: variant?.is_enabled !== false,
      is_available: variant?.is_available !== false,
      options: resolvedOptions(product, variant).map((item) => ({ name: item.name, value: item.value })),
    }))
    .filter((variant: any) => variant.id && variant.price > 0);
  const available = variants.filter((variant: any) => variant.is_available !== false && variant.is_enabled !== false);
  const priced = available;
  const prices = priced.map((variant: any) => variant.price);
  const sizes: string[] = [];
  for (const variant of priced) {
    const label = text(variant.label || variant.size || variant.title) || "Default";
    if (!sizes.includes(label)) sizes.push(label);
  }
  const artwork = artworkFor(product);
  const garment = mediaFor(product);
  const mediaSeen = new Set<string>();
  const mockups = [...artwork, ...garment].filter((item: any) => {
    if (!item?.image || mediaSeen.has(item.image)) return false;
    mediaSeen.add(item.image);
    return true;
  });
  const collection = collectionFor(product);
  const colors = [...new Set(priced.map((variant: any) => text(variant?.color)).filter(Boolean))];
  const selectorType = isToteProduct(product) ? "handle-color" : "size";
  return {
    id: text(product?.id), source: "printify-live-v850", shopId: String(shopId), shopTitle: text(shop?.title),
    name: text(product?.title) || publicTitle(product), description: text(product?.description),
    collection, price: prices.length ? Math.min(...prices) : 0, priceMax: prices.length ? Math.max(...prices) : 0,
    sizes, colors, selectorType, mockups, image: mockups[0]?.image || "", baseKey: String(product?.blueprint_id || "shirt"),
    baseLabel: /\btote\b/i.test(text(product?.title)) ? "Tote Bag" : collection === "boxy" ? "Oversized Boxy T-Shirt" : "Classic T-Shirt",
    variants: available, updatedAt: product?.updated_at || null,
  };
}

async function buildCatalog(supabase: any) {
  const token = await resolveToken(supabase);
  const fx = await resolveUsdEurRate(supabase);
  const account = await loadAccountProducts(token);

  const cleanProducts = account.entries
    .filter((entry: any) => entry.product?.visible !== false && !text(entry.product?.title).startsWith(ROUTE_PREFIX))
    .map((entry: any) => publicProduct(entry.product, fx, entry.shopId, entry.shop))
    .filter((product: any) => product.id && product.name && product.price > 0 && product.mockups.length > 0 && product.variants.length > 0);

  if (!cleanProducts.length) throw new Error("no_sellable_products_in_printify_account");

  return {
    generatedAt: new Date().toISOString(),
    source: "printify-live-v850",
    catalogSelection: "all-readable-printify-shops-v850",
    fx: fxAuditSnapshot(fx),
    shops: account.shops,
    products: cleanProducts,
  };
}

async function refreshCatalog(supabase: any) {
  try {
    const payload = await buildCatalog(supabase);
    const now = new Date().toISOString();
    const { error } = await supabase.from("shop_catalog_cache_v828").update({
      payload, generated_at: now, refresh_started_at: null, last_error: null, updated_at: now,
    }).eq("id", 1);
    if (error) throw error;
  } catch (error) {
    const now = new Date().toISOString();
    const message = text(error instanceof Error ? error.message : error).slice(0, 500);
    await supabase.from("shop_catalog_cache_v828").update({ refresh_started_at: null, last_error: message, updated_at: now }).eq("id", 1);
    console.error("shop-catalog-v828 refresh failed", error instanceof Error ? error.name : "unknown");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "GET") return json(req, { error: "method_not_allowed" }, 405);
  const url = new URL(req.url);
  if (url.searchParams.get("bootstrap") === "1") {
    return json(req, {
      ok: true,
      envTokenConfigured: !!text(Deno.env.get("PRINTIFY_API_TOKEN")),
      serviceRoleConfigured: !!text(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
      mode: "printify-bootstrap-v850",
    });
  }
  let supabase: any;
  try { supabase = serviceClient(); } catch { return json(req, { error: "server_not_configured", products: [] }, 503); }

  const { data: row, error } = await supabase.from("shop_catalog_cache_v828")
    .select("payload,generated_at,refresh_started_at")
    .eq("id", 1).maybeSingle();
  if (error) return json(req, { error: "cache_unavailable", products: [] }, 503);

  const payload = row?.payload && typeof row.payload === "object" ? row.payload : { products: [] };
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const selectionCurrent = payload?.catalogSelection === "all-readable-printify-shops-v850";
  const generatedMs = row?.generated_at ? Date.parse(row.generated_at) : 0;
  const refreshStartedMs = row?.refresh_started_at ? Date.parse(row.refresh_started_at) : 0;
  const ageMs = generatedMs ? Math.max(0, Date.now() - generatedMs) : Number.POSITIVE_INFINITY;
  const refreshLeaseActive = refreshStartedMs > 0 && Date.now() - refreshStartedMs < REFRESH_LEASE_MS;
  const stale = ageMs > CACHE_FRESH_MS;
  let refreshScheduled = false;

  // The storefront never falls back to static catalog data. When the live Printify
  // cache is empty or was built with an obsolete selector, schedule a bounded
  // background refresh and return quickly so browsers can poll without timing out.
  if (!products.length || !selectionCurrent) {
    if (!refreshLeaseActive) {
      const now = new Date().toISOString();
      const { error: leaseError } = await supabase.from("shop_catalog_cache_v828").update({
        refresh_started_at: now,
        updated_at: now,
      }).eq("id", 1);
      if (!leaseError) {
        refreshScheduled = true;
        EdgeRuntime.waitUntil(refreshCatalog(supabase));
      }
    }

    if (url.searchParams.get("health") === "1") {
      return json(req, {
        ok: true,
        warming: true,
        mode: "bruis-direct-catalog-v838",
        usesShopifyApi: false,
        pricing: "production-cost-plus-5-rounded-up",
        pricingBase: "production-cost",
        marginEuros: MARGIN_CENTS / 100,
        rounding: "whole-euro-ceiling",
        sourceCurrency: "USD",
        displayCurrency: "EUR",
        cachedProducts: products.length,
        cacheAgeSeconds: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
        catalogSelection: payload?.catalogSelection || null,
        refreshScheduled,
      });
    }

    return json(req, {
      ok: false,
      warming: true,
      source: "bruis-direct-v838",
      products: [],
      refreshScheduled,
    }, 202);
  }

  if (stale && !refreshLeaseActive) {
    const now = new Date().toISOString();
    const { error: leaseError } = await supabase.from("shop_catalog_cache_v828").update({ refresh_started_at: now, updated_at: now }).eq("id", 1);
    if (!leaseError) {
      refreshScheduled = true;
      EdgeRuntime.waitUntil(refreshCatalog(supabase));
    }
  }

  if (url.searchParams.get("health") === "1") {
    return json(req, {
      ok: true, mode: "bruis-direct-catalog-v838", usesShopifyApi: false, whiteVariantsOnly: false, toteHandleColors: ["Black", "White"],
      pricing: "production-cost-plus-5-rounded-up", pricingBase: "production-cost",
      marginEuros: MARGIN_CENTS / 100, rounding: "whole-euro-ceiling", sourceCurrency: "USD", displayCurrency: "EUR", fx: payload?.fx || null, artworkFirst: true,
      cachedProducts: products.length, cacheAgeSeconds: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
      catalogSelection: payload?.catalogSelection || null,
      refreshScheduled,
    });
  }

  return json(req, {
    ...payload,
    cache: {
      generatedAt: row.generated_at,
      ageSeconds: Math.round(ageMs / 1000),
      stale,
      refreshScheduled,
    },
  });
});