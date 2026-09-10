import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const PRINTIFY_BASE = "https://api.printify.com/v1";
const CACHE_FRESH_MS = 60_000;
const REFRESH_LEASE_MS = 120_000;
const MAX_PAGES = 100;
const BOXY_TITLES = new Set(["coral", "daffodil", "dragonfly", "honeysuckle", "horseshoe crab", "seahorse", "seaweed"]);
const ALLOWED_ORIGINS = new Set(["https://kalenel.nl", "https://www.kalenel.nl", "https://jesperoaths.github.io"]);

const text = (value: unknown) => String(value ?? "").trim();
const priceEuros = (cents: unknown) => {
  const n = Number(cents);
  return Number.isFinite(n) && n > 0 ? Math.round(n) / 100 : 0;
};

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

async function printify(token: string, path: string) {
  const response = await fetch(`${PRINTIFY_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Kalenel-Direct-Catalog/8.28",
    },
  });
  const raw = await response.text();
  let payload: any = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
  if (!response.ok) throw new Error(`printify_${response.status}:${text(payload?.message || payload?.error || raw).slice(0, 180)}`);
  return payload;
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

async function selectShopAndProducts(token: string) {
  const shopsPayload = await printify(token, "/shops.json");
  const shops = Array.isArray(shopsPayload) ? shopsPayload : [];
  if (!shops.length) throw new Error("no_shop_available");
  const configured = text(Deno.env.get("PRINTIFY_SHOP_ID"));
  let shop = configured ? shops.find((row: any) => String(row?.id) === configured) : null;
  if (configured && !shop) throw new Error("configured_shop_unavailable");
  shop ||= shops.find((row: any) => /shopify/i.test(text(row?.sales_channel)))
    || shops.find((row: any) => text(row?.sales_channel).toLowerCase() !== "disconnected")
    || shops[0];
  const shopId = Number(shop?.id);
  if (!Number.isFinite(shopId)) throw new Error("invalid_shop_id");
  return { shop, products: await loadProducts(token, shopId) };
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
function isWhiteVariant(product: any, variant: any) {
  if (variant?.is_enabled === false) return false;
  const color = resolvedOptions(product, variant).find((item) => item.type === "color");
  return !color || /^white$/i.test(text(color.value));
}
function collectionFor(product: any) {
  const title = text(product?.title);
  const key = title.toLowerCase();
  if (/despinoza/i.test(title)) return "merch";
  if (/\b(?:oversized|boxy)\b/i.test(title) || BOXY_TITLES.has(key)) return "boxy";
  return "normal";
}
function mediaFor(product: any) {
  const seen = new Set<string>();
  let media = (Array.isArray(product?.images) ? product.images : [])
    .map((image: any, index: number) => ({ image: text(image?.src), label: text(image?.position || `View ${index + 1}`), index }))
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
  if (/jellyfish/i.test(text(product?.title)) && media.length > 1) media = media.slice(1);
  return media.slice(0, 24).map(({ image, label }: any) => ({ image, label }));
}
function publicProduct(product: any) {
  const variants = (Array.isArray(product?.variants) ? product.variants : [])
    .filter((variant: any) => isWhiteVariant(product, variant))
    .map((variant: any) => ({
      id: String(variant?.id || ""),
      sku: text(variant?.sku),
      title: text(variant?.title),
      size: sizeFrom(product, variant),
      color: colorFrom(product, variant) || "White",
      price: priceEuros(variant?.price),
      is_enabled: variant?.is_enabled !== false,
      is_available: variant?.is_available !== false,
      options: resolvedOptions(product, variant).map((item) => ({ name: item.name, value: item.value })),
    }))
    .filter((variant: any) => variant.id && variant.size && variant.price > 0);
  const available = variants.filter((variant: any) => variant.is_available !== false);
  const priced = available.length ? available : variants;
  const prices = priced.map((variant: any) => variant.price);
  const sizes: string[] = [];
  for (const variant of priced) if (variant.size && !sizes.includes(variant.size)) sizes.push(variant.size);
  const mockups = mediaFor(product);
  const collection = collectionFor(product);
  return {
    id: text(product?.id), source: "printify-direct-v828", name: text(product?.title), description: text(product?.description),
    collection, price: prices.length ? Math.min(...prices) : 0, priceMax: prices.length ? Math.max(...prices) : 0,
    sizes, mockups, image: mockups[0]?.image || "", baseKey: String(product?.blueprint_id || "shirt"),
    baseLabel: collection === "boxy" ? "Oversized Boxy T-Shirt" : "Classic T-Shirt",
    variants, updatedAt: product?.updated_at || null,
  };
}

async function buildCatalog(supabase: any) {
  const token = await resolveToken(supabase);
  const { shop, products } = await selectShopAndProducts(token);
  const cleanProducts = products.filter((product: any) => product?.visible !== false)
    .map(publicProduct)
    .filter((product: any) => product.id && product.name && product.price > 0 && product.mockups.length > 0 && product.variants.length > 0);
  return {
    generatedAt: new Date().toISOString(), source: "printify-direct-v828",
    shop: { id: String(shop?.id || ""), salesChannel: text(shop?.sales_channel) }, products: cleanProducts,
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
  let supabase: any;
  try { supabase = serviceClient(); } catch { return json(req, { error: "server_not_configured", products: [] }, 503); }

  const { data: row, error } = await supabase.from("shop_catalog_cache_v828")
    .select("payload,generated_at,refresh_started_at")
    .eq("id", 1).maybeSingle();
  if (error) return json(req, { error: "cache_unavailable", products: [] }, 503);

  const payload = row?.payload && typeof row.payload === "object" ? row.payload : { products: [] };
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const generatedMs = row?.generated_at ? Date.parse(row.generated_at) : 0;
  const refreshStartedMs = row?.refresh_started_at ? Date.parse(row.refresh_started_at) : 0;
  const ageMs = generatedMs ? Math.max(0, Date.now() - generatedMs) : Number.POSITIVE_INFINITY;
  const refreshLeaseActive = refreshStartedMs > 0 && Date.now() - refreshStartedMs < REFRESH_LEASE_MS;
  const stale = ageMs > CACHE_FRESH_MS;
  let refreshScheduled = false;

  if ((stale || !products.length) && !refreshLeaseActive) {
    const now = new Date().toISOString();
    const { error: leaseError } = await supabase.from("shop_catalog_cache_v828").update({ refresh_started_at: now, updated_at: now }).eq("id", 1);
    if (!leaseError) {
      refreshScheduled = true;
      EdgeRuntime.waitUntil(refreshCatalog(supabase));
    }
  }

  if (url.searchParams.get("health") === "1") {
    return json(req, {
      ok: true, mode: "printify-direct-catalog-v828", usesShopifyApi: false, whiteVariantsOnly: true,
      cachedProducts: products.length, cacheAgeSeconds: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
      refreshScheduled,
    });
  }

  if (!products.length) {
    return json(req, { ok: false, warming: true, source: "printify-direct-v828", products: [], refreshScheduled }, 202);
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
