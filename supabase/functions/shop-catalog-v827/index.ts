import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const PRINTIFY_BASE = "https://api.printify.com/v1";
const CACHE_MS = 30_000;
const MAX_PAGES = 100;
const BOXY_TITLES = new Set([
  "coral", "daffodil", "dragonfly", "honeysuckle", "horseshoe crab", "seahorse", "seaweed"
]);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const headers = {
  ...cors,
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=15, stale-while-revalidate=30",
};
const text = (value: unknown) => String(value ?? "").trim();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const wholeEuro = (cents: unknown) => {
  const n = Number(cents);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n / 100) : 0;
};

let cache: { expiresAt: number; payload: unknown } | null = null;
let inFlight: Promise<unknown> | null = null;

async function provider(token: string, path: string) {
  const response = await fetch(`${PRINTIFY_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Kalenel-Direct-Catalog/8.27",
    },
  });
  const raw = await response.text();
  let payload: any = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
  if (!response.ok) throw new Error(`upstream_${response.status}:${text(payload?.message || payload?.error || raw).slice(0, 180)}`);
  return payload;
}

async function resolveToken() {
  const envToken = text(Deno.env.get("PRINTIFY_API_TOKEN"));
  if (envToken) return envToken;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("server_not_configured");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("get_printify_api_token_v815a");
  if (error || !text(data)) throw new Error("production_connection_missing");
  return text(data);
}

async function loadProducts(token: string, shopId: number) {
  const rows: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await provider(token, `/shops/${shopId}/products.json?limit=50&page=${page}`);
    const pageRows = Array.isArray(payload?.data) ? payload.data : [];
    rows.push(...pageRows);
    const lastPage = Number(payload?.last_page || 0);
    if (!pageRows.length || pageRows.length < 50 || (lastPage && page >= lastPage)) break;
  }
  return rows;
}

async function selectShopAndProducts(token: string) {
  const shops = await provider(token, "/shops.json");
  const rows = Array.isArray(shops) ? shops : [];
  if (!rows.length) throw new Error("no_shop_available");

  const configured = text(Deno.env.get("PRINTIFY_SHOP_ID"));
  if (configured) {
    const selected = rows.find((shop: any) => String(shop?.id) === configured);
    if (!selected) throw new Error("configured_shop_unavailable");
    return { shop: selected, products: await loadProducts(token, Number(selected.id)) };
  }

  let best: { shop: any; products: any[] } | null = null;
  for (const shop of rows.slice(0, 12)) {
    const products = await loadProducts(token, Number(shop?.id));
    if (!best || products.length > best.products.length) best = { shop, products };
  }
  if (!best) throw new Error("no_shop_available");
  return best;
}

function optionMap(product: any) {
  const map = new Map<string, { name: string; type: string; value: string }>();
  for (const option of Array.isArray(product?.options) ? product.options : []) {
    const name = text(option?.name);
    const type = text(option?.type);
    for (const value of Array.isArray(option?.values) ? option.values : []) {
      map.set(String(value?.id), { name, type, value: text(value?.title) });
    }
  }
  return map;
}

function variantOptions(product: any, variant: any) {
  const map = optionMap(product);
  return (Array.isArray(variant?.options) ? variant.options : [])
    .map((id: unknown) => map.get(String(id)))
    .filter(Boolean)
    .map((item: any) => ({ name: item.name || item.type || "Option", value: item.value }));
}

function sizeFrom(product: any, variant: any) {
  const explicit = variantOptions(product, variant).find((item: any) => /size/i.test(`${item.name}`))?.value;
  if (explicit) return text(explicit);
  const match = text(variant?.title).match(/(?:^|\s|\/|\|)(xs|s|m|l|xl|2xl|3xl|4xl|5xl)(?:$|\s|\/|\|)/i);
  return match ? match[1].toUpperCase() : "";
}

function collectionFor(product: any) {
  const title = text(product?.title);
  const key = title.toLowerCase();
  if (/despinoza/i.test(title)) return "merch";
  if (/\b(?:oversized|boxy)\b/i.test(title)) return "boxy";
  if (BOXY_TITLES.has(key)) return "boxy";
  return "normal";
}

function mediaFor(product: any) {
  const seen = new Set<string>();
  let media = (Array.isArray(product?.images) ? product.images : [])
    .map((image: any, index: number) => ({
      image: text(image?.src),
      label: text(image?.position || `View ${index + 1}`),
      isDefault: image?.is_default === true,
      index,
    }))
    .filter((item: any) => {
      if (!item.image || seen.has(item.image)) return false;
      try {
        const u = new URL(item.image);
        if (u.protocol !== "https:" || !(u.hostname === "images.printify.com" || u.hostname.endsWith(".printify.com"))) return false;
      } catch { return false; }
      seen.add(item.image);
      return true;
    })
    .sort((a: any, b: any) => a.index - b.index);

  // Explicit storefront request: retire the first Jellyfish mockup.
  if (/jellyfish/i.test(text(product?.title)) && media.length > 1) media = media.slice(1);
  return media.slice(0, 24).map(({ image, label }: any) => ({ image, label }));
}

function publicProduct(product: any) {
  const variants = (Array.isArray(product?.variants) ? product.variants : [])
    .filter((variant: any) => variant?.is_enabled !== false)
    .map((variant: any) => ({
      id: String(variant?.id || ""),
      sku: text(variant?.sku),
      title: text(variant?.title),
      price: wholeEuro(variant?.price),
      is_enabled: variant?.is_enabled !== false,
      is_available: variant?.is_available !== false,
      options: variantOptions(product, variant),
    }))
    .filter((variant: any) => variant.id && variant.price > 0);

  const prices = variants.filter((variant: any) => variant.is_available !== false).map((variant: any) => variant.price);
  const sizes: string[] = [];
  for (const variant of variants) {
    const size = sizeFrom(product, variant);
    if (size && !sizes.includes(size)) sizes.push(size);
  }
  const mockups = mediaFor(product);

  return {
    id: text(product?.id),
    source: "direct-v827",
    name: text(product?.title),
    description: text(product?.description),
    collection: collectionFor(product),
    price: prices.length ? Math.min(...prices) : 0,
    priceMax: prices.length ? Math.max(...prices) : 0,
    sizes,
    mockups,
    image: mockups[0]?.image || "",
    baseKey: String(product?.blueprint_id || "shirt"),
    baseLabel: "T-Shirt",
    variants,
    updatedAt: product?.updated_at || null,
  };
}

async function buildCatalog() {
  const token = await resolveToken();
  const { products } = await selectShopAndProducts(token);
  const clean = products
    .filter((product: any) => product?.visible !== false)
    .map(publicProduct)
    .filter((product: any) => product.id && product.name && product.price > 0 && product.mockups.length > 0);
  return { generatedAt: new Date().toISOString(), source: "direct-v827", products: clean };
}

async function catalog() {
  if (cache && cache.expiresAt > Date.now()) return cache.payload;
  if (inFlight) return inFlight;
  inFlight = buildCatalog()
    .then((payload) => {
      cache = { payload, expiresAt: Date.now() + CACHE_MS };
      return payload;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const url = new URL(req.url);
  if (url.searchParams.get("health") === "1") {
    return json({ ok: true, mode: "direct-catalog-v827", uses_shopify: false });
  }
  try {
    return json(await catalog());
  } catch (error) {
    console.error("direct catalog failed", error);
    const code = text(error instanceof Error ? error.message : error).startsWith("production_connection_missing")
      ? "production_connection_unavailable"
      : "catalog_unavailable";
    return json({ error: code, detail: "The product catalog is temporarily unavailable.", products: [] }, 503);
  }
});
