import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PRINTIFY_BASE = "https://api.printify.com/v1";
const SHOPIFY_API_VERSION = "2026-07";
const DEFAULT_SHOPIFY_DOMAIN = "n75mh8-bu.myshopify.com";
const REFRESH_MS = 60 * 1000;
const RETRY_MS = 30 * 1000;
const MAX_PAGES_PER_SOURCE = 100;
const MAX_MOCKUPS = 12;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function plainText(value: unknown) {
  return text(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: unknown) {
  return text(value)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function gidTail(value: unknown) {
  const raw = text(value);
  const match = raw.match(/\/([^/]+)$/);
  return match ? match[1] : raw;
}

function configuredShopifyDomain() {
  const raw = text(Deno.env.get("SHOPIFY_STORE_DOMAIN") || DEFAULT_SHOPIFY_DOMAIN)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(raw) ? raw : DEFAULT_SHOPIFY_DOMAIN;
}

function categoryFromText(title: unknown, values: unknown[] = []) {
  const productTitle = text(title).toLowerCase();
  if (productTitle.includes("despinoza")) return "merch";
  const haystack = [title, ...values].map(text).join(" ").toLowerCase();
  return /\b(?:oversized|boxy)\b/.test(haystack)
    ? "oversized-boxy"
    : "classic";
}

function rankedMockups(images: Array<{ url?: unknown; alt?: unknown; featured?: boolean }>) {
  const ranked = images
    .map((image, index) => {
      const url = text(image?.url);
      if (!url) return null;
      const alt = text(image?.alt);
      const haystack = `${alt} ${url}`.toLowerCase();
      const isFront = /\bfront\b/.test(haystack) || /camera_label=front/i.test(url);
      const featured = image?.featured === true;
      const rank = isFront && featured ? 0 : isFront ? 1 : featured ? 2 : 3;
      return {
        image: url,
        label: titleCase(alt || (isFront ? "Front" : `View ${index + 1}`)) || `View ${index + 1}`,
        rank,
        index,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.rank - b.rank || a.index - b.index);

  const seen = new Set<string>();
  const result: Array<{ image: string; label: string }> = [];
  for (const item of ranked as any[]) {
    if (seen.has(item.image)) continue;
    seen.add(item.image);
    result.push({ image: item.image, label: item.label });
    if (result.length >= MAX_MOCKUPS) break;
  }
  return result;
}

function activePrintifyVariants(raw: any) {
  const variants = Array.isArray(raw?.variants) ? raw.variants : [];
  const enabledAndAvailable = variants.filter((v: any) => v?.is_enabled !== false && v?.is_available !== false);
  if (enabledAndAvailable.length) return enabledAndAvailable;
  const enabled = variants.filter((v: any) => v?.is_enabled !== false);
  return enabled.length ? enabled : variants;
}

function printifyOptionMap(raw: any) {
  const map = new Map<number | string, { option: string; title: string }>();
  for (const option of Array.isArray(raw?.options) ? raw.options : []) {
    for (const value of Array.isArray(option?.values) ? option.values : []) {
      map.set(value.id, {
        option: text(option?.name || option?.title).toLowerCase(),
        title: text(value?.title || value?.name || value?.id),
      });
    }
  }
  return map;
}

function printifySizes(raw: any) {
  const map = printifyOptionMap(raw);
  const result: string[] = [];
  for (const variant of activePrintifyVariants(raw)) {
    for (const optionId of Array.isArray(variant?.options) ? variant.options : []) {
      const option = map.get(optionId);
      if (option && /size/.test(option.option) && option.title && !result.includes(option.title)) {
        result.push(option.title);
      }
    }
  }
  return result.length ? result : ["S", "M", "L", "XL", "2XL"];
}

function printifyPrices(raw: any) {
  const prices = activePrintifyVariants(raw)
    .map((v: any) => Number(v?.price))
    .filter((value: number) => Number.isFinite(value) && value >= 0)
    .map((cents: number) => cents / 100);
  if (!prices.length) return { price: 0, priceMax: 0 };
  return { price: Math.min(...prices), priceMax: Math.max(...prices) };
}

function printifyMockups(raw: any) {
  const images = Array.isArray(raw?.images) ? raw.images : [];
  const ranked = images
    .map((image: any, index: number) => {
      const src = text(image?.src || image?.url || image?.image || image);
      if (!src) return null;
      const position = text(image?.position).toLowerCase();
      const isDefault = image?.is_default === true;
      const rank = position === "front" && isDefault ? 0
        : position === "front" ? 1
        : isDefault ? 2
        : 3;
      return {
        image: src,
        label: titleCase(position || image?.label || `View ${index + 1}`) || `View ${index + 1}`,
        rank,
        index,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.rank - b.rank || a.index - b.index);

  const seen = new Set<string>();
  const result: Array<{ image: string; label: string }> = [];
  for (const item of ranked as any[]) {
    if (seen.has(item.image)) continue;
    seen.add(item.image);
    result.push({ image: item.image, label: item.label });
    if (result.length >= MAX_MOCKUPS) break;
  }
  return result;
}

function printifyPublicVariants(raw: any) {
  return activePrintifyVariants(raw).map((variant: any) => ({
    id: variant?.id,
    sku: text(variant?.sku),
    title: text(variant?.title),
    price: Number.isFinite(Number(variant?.price)) ? Number(variant.price) / 100 : 0,
    is_enabled: variant?.is_enabled !== false,
    is_available: variant?.is_available !== false,
    options: Array.isArray(variant?.options) ? variant.options : [],
  }));
}

function normalizePrintifyProduct(raw: any, shopId: number, blueprint: any, runId: string) {
  const mockups = printifyMockups(raw);
  const prices = printifyPrices(raw);
  const blueprintId = raw?.blueprint_id;
  const providerId = raw?.print_provider_id;
  const baseKey = blueprintId && providerId ? `${blueprintId}-${providerId}` : text(blueprintId || providerId || "unknown");
  return {
    source: "printify",
    source_product_id: text(raw?.id),
    source_shop_id: String(shopId),
    title: text(raw?.title || "Untitled shirt"),
    description: plainText(raw?.description),
    category: categoryFromText(raw?.title, [
      ...(Array.isArray(raw?.tags) ? raw.tags : []),
      blueprint?.title,
      blueprint?.model,
    ]),
    price: prices.price,
    price_max: prices.priceMax,
    sizes: printifySizes(raw),
    mockups,
    image: mockups[0]?.image || "",
    base_key: baseKey,
    base_label: text(blueprint?.title || (blueprintId ? `Printify base ${blueprintId}` : "Printify shirt")),
    variants: printifyPublicVariants(raw),
    source_updated_at: raw?.updated_at || null,
    synced_at: new Date().toISOString(),
    sync_run_id: runId,
  };
}

async function printifyJson(token: string, path: string) {
  const response = await fetch(`${PRINTIFY_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Kalenel-Shop-Catalog/2.0",
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Printify ${response.status} on ${path}: ${detail}`);
  }
  return await response.json();
}

async function loadPrintifyProducts(token: string) {
  const shops = await printifyJson(token, "/shops.json");
  if (!Array.isArray(shops) || !shops.length) throw new Error("Printify account returned no shops");

  const configuredShopIds = text(Deno.env.get("PRINTIFY_SHOP_ID"))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const selectedShops = configuredShopIds.length
    ? shops.filter((shop: any) => configuredShopIds.includes(String(shop?.id)))
    : shops;
  if (!selectedShops.length) throw new Error("PRINTIFY_SHOP_ID does not match an accessible Printify shop");

  const products: Array<{ shopId: number; raw: any }> = [];
  for (const shop of selectedShops) {
    const shopId = Number(shop?.id);
    if (!Number.isFinite(shopId)) continue;
    for (let page = 1; page <= MAX_PAGES_PER_SOURCE; page += 1) {
      const payload = await printifyJson(token, `/shops/${shopId}/products.json?limit=50&page=${page}`);
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      products.push(...rows.map((raw: any) => ({ shopId, raw })));
      const lastPage = Number(payload?.last_page || 0);
      if (!rows.length || rows.length < 50 || (lastPage && page >= lastPage)) break;
    }
  }
  return { shops: selectedShops, products };
}

async function loadPrintifyBlueprints(token: string, products: Array<{ raw: any }>) {
  const ids = [...new Set(products.map(({ raw }) => Number(raw?.blueprint_id)).filter(Number.isFinite))];
  const map = new Map<number, any>();
  for (const id of ids) {
    try {
      map.set(id, await printifyJson(token, `/catalog/blueprints/${id}.json`));
    } catch (error) {
      console.warn(`Blueprint ${id} lookup failed`, error);
      map.set(id, null);
    }
  }
  return map;
}

function shopifySizes(variants: any[]) {
  const result: string[] = [];
  for (const variant of variants) {
    for (const option of Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : []) {
      if (/size/i.test(text(option?.name))) {
        const value = text(option?.value);
        if (value && !result.includes(value)) result.push(value);
      }
    }
  }
  return result.length ? result : ["S", "M", "L", "XL", "2XL"];
}

function shopifyVariants(variants: any[], mode: "admin" | "storefront") {
  return variants.map((variant: any) => ({
    id: gidTail(variant?.id),
    sku: text(variant?.sku),
    title: text(variant?.title),
    price: mode === "admin" ? numeric(variant?.price) : numeric(variant?.price?.amount),
    is_enabled: true,
    is_available: variant?.availableForSale !== false,
    options: (Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : []).map((option: any) => ({
      name: text(option?.name),
      value: text(option?.value),
    })),
  }));
}

function normalizeShopifyAdminProduct(raw: any, domain: string, runId: string) {
  const variants = Array.isArray(raw?.variants?.nodes) ? raw.variants.nodes : [];
  const media = Array.isArray(raw?.media?.nodes) ? raw.media.nodes : [];
  const images = media.map((item: any, index: number) => ({
    url: item?.image?.url || item?.preview?.image?.url,
    alt: item?.image?.altText || item?.alt || `View ${index + 1}`,
    featured: index === 0,
  }));
  const mockups = rankedMockups(images);
  const values = [
    ...(Array.isArray(raw?.tags) ? raw.tags : []),
    raw?.productType,
    raw?.vendor,
    ...variants.map((variant: any) => variant?.title),
  ];
  return {
    source: "shopify-admin",
    source_product_id: gidTail(raw?.id),
    source_shop_id: domain,
    title: text(raw?.title || "Untitled product"),
    description: plainText(raw?.description),
    category: categoryFromText(raw?.title, values),
    price: numeric(raw?.priceRangeV2?.minVariantPrice?.amount),
    price_max: numeric(raw?.priceRangeV2?.maxVariantPrice?.amount),
    sizes: shopifySizes(variants),
    mockups,
    image: mockups[0]?.image || "",
    base_key: text(raw?.productType || raw?.vendor || "shopify"),
    base_label: text(raw?.productType || raw?.vendor || "Shopify product"),
    variants: shopifyVariants(variants, "admin"),
    source_updated_at: raw?.updatedAt || null,
    synced_at: new Date().toISOString(),
    sync_run_id: runId,
  };
}

function normalizeShopifyStorefrontProduct(raw: any, domain: string, runId: string) {
  const variants = Array.isArray(raw?.variants?.nodes) ? raw.variants.nodes : [];
  const imageNodes = Array.isArray(raw?.images?.nodes) ? raw.images.nodes : [];
  const featuredUrl = text(raw?.featuredImage?.url);
  const images: Array<{ url?: unknown; alt?: unknown; featured?: boolean }> = [];
  if (featuredUrl) {
    images.push({ url: featuredUrl, alt: raw?.featuredImage?.altText || "Front", featured: true });
  }
  for (const item of imageNodes) {
    images.push({
      url: item?.url,
      alt: item?.altText,
      featured: Boolean(featuredUrl && text(item?.url) === featuredUrl),
    });
  }
  const mockups = rankedMockups(images);
  const values = [
    ...(Array.isArray(raw?.tags) ? raw.tags : []),
    raw?.productType,
    raw?.vendor,
    ...variants.map((variant: any) => variant?.title),
  ];
  return {
    source: "shopify-storefront",
    source_product_id: gidTail(raw?.id),
    source_shop_id: domain,
    title: text(raw?.title || "Untitled product"),
    description: plainText(raw?.description),
    category: categoryFromText(raw?.title, values),
    price: numeric(raw?.priceRange?.minVariantPrice?.amount),
    price_max: numeric(raw?.priceRange?.maxVariantPrice?.amount),
    sizes: shopifySizes(variants),
    mockups,
    image: mockups[0]?.image || "",
    base_key: text(raw?.productType || raw?.vendor || "shopify"),
    base_label: text(raw?.productType || raw?.vendor || "Shopify product"),
    variants: shopifyVariants(variants, "storefront"),
    source_updated_at: raw?.updatedAt || null,
    synced_at: new Date().toISOString(),
    sync_run_id: runId,
  };
}

async function shopifyGraphql(domain: string, query: string, variables: Record<string, unknown>, adminToken = "") {
  const path = adminToken ? `/admin/api/${SHOPIFY_API_VERSION}/graphql.json` : `/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Kalenel-Shop-Catalog/2.0",
  };
  if (adminToken) headers["X-Shopify-Access-Token"] = adminToken;

  const response = await fetch(`https://${domain}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || Array.isArray(payload?.errors)) {
    const messages = Array.isArray(payload?.errors)
      ? payload.errors.map((error: any) => text(error?.message)).filter(Boolean).join("; ")
      : "";
    throw new Error(`Shopify ${response.status}: ${messages || text(payload?.error) || "request failed"}`);
  }
  return payload?.data || {};
}

const SHOPIFY_ADMIN_QUERY = `
  query KalenelAdminCatalog($cursor: String) {
    products(first: 100, after: $cursor, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        description
        productType
        vendor
        tags
        status
        updatedAt
        priceRangeV2 {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
        media(first: 50) {
          nodes {
            alt
            preview { image { url altText } }
            ... on MediaImage { image { url altText } }
          }
        }
        variants(first: 250) {
          nodes {
            id
            title
            sku
            availableForSale
            price
            selectedOptions { name value }
          }
        }
      }
    }
  }
`;

const SHOPIFY_STOREFRONT_QUERY = `
  query KalenelStorefrontCatalog($cursor: String) {
    products(first: 100, after: $cursor, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        description
        productType
        vendor
        tags
        updatedAt
        featuredImage { url altText }
        images(first: 50) { nodes { url altText } }
        priceRange {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
        variants(first: 250) {
          nodes {
            id
            title
            sku
            availableForSale
            price { amount currencyCode }
            selectedOptions { name value }
          }
        }
      }
    }
  }
`;

async function loadShopifyAdminProducts(domain: string, token: string) {
  const products: any[] = [];
  let cursor: string | null = null;
  for (let page = 1; page <= MAX_PAGES_PER_SOURCE; page += 1) {
    const data = await shopifyGraphql(domain, SHOPIFY_ADMIN_QUERY, { cursor }, token);
    const connection = data?.products;
    if (!connection || !Array.isArray(connection?.nodes)) throw new Error("Shopify Admin returned no product connection");
    products.push(...connection.nodes.filter((product: any) => text(product?.status).toUpperCase() !== "ARCHIVED"));
    if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) break;
    cursor = connection.pageInfo.endCursor;
  }
  return products;
}

async function loadShopifyStorefrontProducts(domain: string) {
  const products: any[] = [];
  let cursor: string | null = null;
  for (let page = 1; page <= MAX_PAGES_PER_SOURCE; page += 1) {
    const data = await shopifyGraphql(domain, SHOPIFY_STOREFRONT_QUERY, { cursor });
    const connection = data?.products;
    if (!connection || !Array.isArray(connection?.nodes)) throw new Error("Shopify Storefront returned no product connection");
    products.push(...connection.nodes);
    if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) break;
    cursor = connection.pageInfo.endCursor;
  }
  return products;
}

async function readCachedCatalog(supabase: any) {
  const { data, error } = await supabase
    .from("shop_catalog_products")
    .select("source,source_product_id,title,description,category,price,price_max,sizes,mockups,image,base_key,base_label,variants,source_updated_at,synced_at")
    .order("base_label", { ascending: true })
    .order("title", { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function resolvePrintifyToken(supabase: any) {
  const environmentToken = text(Deno.env.get("PRINTIFY_API_TOKEN"));
  if (environmentToken) return environmentToken;

  const { data, error } = await supabase.rpc("get_printify_api_token_v815a");
  if (error) {
    console.warn("Printify Vault token resolver unavailable", error.message || error);
    return "";
  }
  return text(data);
}

async function resolveShopifyAdminToken(supabase: any) {
  const environmentToken = text(Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN"));
  if (environmentToken) return environmentToken;

  const { data, error } = await supabase.rpc("get_shopify_admin_token_v815b");
  if (error) {
    console.warn("Shopify Vault token resolver unavailable", error.message || error);
    return "";
  }
  return text(data);
}

function publicProduct(row: any) {
  return {
    id: row.source_product_id,
    source: row.source,
    name: row.title,
    description: row.description,
    collection: row.category,
    price: Number(row.price || 0),
    priceMax: Number(row.price_max || row.price || 0),
    sizes: Array.isArray(row.sizes) ? row.sizes : [],
    mockups: Array.isArray(row.mockups) ? row.mockups : [],
    image: row.image,
    baseKey: row.base_key,
    baseLabel: row.base_label,
    variants: Array.isArray(row.variants) ? row.variants : [],
    updatedAt: row.source_updated_at,
  };
}

async function replaceCatalogForSource(supabase: any, source: string, rows: any[], shopCount: number) {
  const startedAt = new Date().toISOString();
  await supabase.from("shop_catalog_sync_state").upsert({
    id: 1,
    last_sync_started_at: startedAt,
    next_refresh_at: new Date(Date.now() + RETRY_MS).toISOString(),
    last_error: null,
  });

  const { error: clearRunError } = await supabase
    .from("shop_catalog_products")
    .update({ sync_run_id: null })
    .eq("source", source);
  if (clearRunError) throw clearRunError;

  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await supabase
      .from("shop_catalog_products")
      .upsert(rows.slice(index, index + 100), { onConflict: "source,source_product_id" });
    if (error) throw error;
  }

  const { error: staleError } = await supabase
    .from("shop_catalog_products")
    .delete()
    .eq("source", source)
    .is("sync_run_id", null);
  if (staleError) throw staleError;

  const { error: otherSourcesError } = await supabase
    .from("shop_catalog_products")
    .delete()
    .neq("source", source);
  if (otherSourcesError) throw otherSourcesError;

  const completedAt = new Date().toISOString();
  const { error: stateError } = await supabase.from("shop_catalog_sync_state").upsert({
    id: 1,
    last_synced_at: completedAt,
    next_refresh_at: new Date(Date.now() + REFRESH_MS).toISOString(),
    last_error: null,
    product_count: rows.length,
    shop_count: shopCount,
    last_source: source,
  });
  if (stateError) throw stateError;
  return { productCount: rows.length, shopCount, source, syncedAt: completedAt };
}

async function syncPrintify(supabase: any, token: string) {
  const runId = crypto.randomUUID();
  const { shops, products } = await loadPrintifyProducts(token);
  const blueprints = await loadPrintifyBlueprints(token, products);
  const rows = products
    .map(({ shopId, raw }) => normalizePrintifyProduct(raw, shopId, blueprints.get(Number(raw?.blueprint_id)), runId))
    .filter((row) => row.source_product_id && row.mockups.length && row.price > 0);
  return await replaceCatalogForSource(supabase, "printify", rows, shops.length);
}

async function syncShopifyAdmin(supabase: any, domain: string, token: string) {
  const runId = crypto.randomUUID();
  const products = await loadShopifyAdminProducts(domain, token);
  const rows = products
    .map((raw) => normalizeShopifyAdminProduct(raw, domain, runId))
    .filter((row) => row.source_product_id && row.mockups.length && row.price > 0);
  return await replaceCatalogForSource(supabase, "shopify-admin", rows, 1);
}

async function syncShopifyStorefront(supabase: any, domain: string) {
  const runId = crypto.randomUUID();
  const products = await loadShopifyStorefrontProducts(domain);
  const rows = products
    .map((raw) => normalizeShopifyStorefrontProduct(raw, domain, runId))
    .filter((row) => row.source_product_id && row.mockups.length && row.price > 0);
  return await replaceCatalogForSource(supabase, "shopify-storefront", rows, 1);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_not_configured" }, 503);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    let cached = await readCachedCatalog(supabase);
    const { data: state } = await supabase
      .from("shop_catalog_sync_state")
      .select("last_synced_at,next_refresh_at,last_error,product_count,shop_count,last_source")
      .eq("id", 1)
      .maybeSingle();

    const printifyToken = await resolvePrintifyToken(supabase);
    const shopifyAdminToken = await resolveShopifyAdminToken(supabase);
    const shopifyDomain = configuredShopifyDomain();
    const nextRefresh = state?.next_refresh_at ? Date.parse(state.next_refresh_at) : 0;
    const stale = !nextRefresh || nextRefresh <= Date.now();
    let syncResult: any = null;
    const sourceErrors: Array<{ source: string; error: string }> = [];

    if (!cached.length || stale) {
      const attempts: Array<{ source: string; run: () => Promise<any> }> = [];
      if (printifyToken) attempts.push({ source: "printify", run: () => syncPrintify(supabase, printifyToken) });
      if (shopifyAdminToken) attempts.push({ source: "shopify-admin", run: () => syncShopifyAdmin(supabase, shopifyDomain, shopifyAdminToken) });
      attempts.push({ source: "shopify-storefront", run: () => syncShopifyStorefront(supabase, shopifyDomain) });

      for (const attempt of attempts) {
        try {
          syncResult = await attempt.run();
          cached = await readCachedCatalog(supabase);
          break;
        } catch (error) {
          const message = text(error instanceof Error ? error.message : error).slice(0, 500);
          sourceErrors.push({ source: attempt.source, error: message });
          console.warn(`${attempt.source} catalog sync failed`, error);
        }
      }

      if (!syncResult) {
        const errorSummary = sourceErrors.map((item) => `${item.source}: ${item.error}`).join(" | ").slice(0, 1000);
        await supabase.from("shop_catalog_sync_state").upsert({
          id: 1,
          next_refresh_at: new Date(Date.now() + RETRY_MS).toISOString(),
          last_error: errorSummary || "No catalog source is currently readable",
        });
      }
    }

    return json({
      generatedAt: new Date().toISOString(),
      source: syncResult?.source || state?.last_source || cached[0]?.source || "none",
      sourceConfig: {
        printify: Boolean(printifyToken),
        shopifyAdmin: Boolean(shopifyAdminToken),
        shopifyStorefront: shopifyDomain,
      },
      sync: syncResult || {
        lastSyncedAt: state?.last_synced_at || null,
        productCount: cached.length,
        shopCount: Number(state?.shop_count || 0),
        source: state?.last_source || cached[0]?.source || null,
        error: sourceErrors.length ? sourceErrors : (state?.last_error || null),
      },
      products: cached.map(publicProduct),
    });
  } catch (error) {
    console.error("shop-catalog failed", error);
    return json({ error: "catalog_unavailable", products: [] }, 503);
  }
});
