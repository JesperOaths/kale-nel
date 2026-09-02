import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PRINTIFY_BASE = "https://api.printify.com/v1";
const REFRESH_MS = 15 * 60 * 1000;
const RETRY_MS = 2 * 60 * 1000;
const MAX_PAGES_PER_SHOP = 100;
const MAX_MOCKUPS = 12;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
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

function activeVariants(raw: any) {
  const variants = Array.isArray(raw?.variants) ? raw.variants : [];
  const enabledAndAvailable = variants.filter((v: any) => v?.is_enabled !== false && v?.is_available !== false);
  if (enabledAndAvailable.length) return enabledAndAvailable;
  const enabled = variants.filter((v: any) => v?.is_enabled !== false);
  return enabled.length ? enabled : variants;
}

function optionMap(raw: any) {
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

function sizesFromProduct(raw: any) {
  const map = optionMap(raw);
  const result: string[] = [];
  for (const variant of activeVariants(raw)) {
    for (const optionId of Array.isArray(variant?.options) ? variant.options : []) {
      const option = map.get(optionId);
      if (option && /size/.test(option.option) && option.title && !result.includes(option.title)) {
        result.push(option.title);
      }
    }
  }
  return result.length ? result : ["S", "M", "L", "XL", "2XL"];
}

function pricesFromProduct(raw: any) {
  const prices = activeVariants(raw)
    .map((v: any) => Number(v?.price))
    .filter((value: number) => Number.isFinite(value) && value >= 0)
    .map((cents: number) => cents / 100);
  if (!prices.length) return { price: 0, priceMax: 0 };
  return { price: Math.min(...prices), priceMax: Math.max(...prices) };
}

function mockupsFromProduct(raw: any) {
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

function categoryFor(raw: any, blueprint: any) {
  const haystack = [
    raw?.title,
    ...(Array.isArray(raw?.tags) ? raw.tags : []),
    blueprint?.title,
    blueprint?.model,
  ].map(text).join(" ").toLowerCase();

  return /\bboxy\b/.test(haystack) || /oversized[\s-]*boxy|boxy[\s-]*oversized/.test(haystack)
    ? "oversized-boxy"
    : "classic";
}

function publicVariants(raw: any) {
  return activeVariants(raw).map((variant: any) => ({
    id: variant?.id,
    sku: text(variant?.sku),
    title: text(variant?.title),
    price: Number.isFinite(Number(variant?.price)) ? Number(variant.price) / 100 : 0,
    is_enabled: variant?.is_enabled !== false,
    is_available: variant?.is_available !== false,
    options: Array.isArray(variant?.options) ? variant.options : [],
  }));
}

function normalizeProduct(raw: any, shopId: number, blueprint: any, runId: string) {
  const mockups = mockupsFromProduct(raw);
  const prices = pricesFromProduct(raw);
  const blueprintId = raw?.blueprint_id;
  const providerId = raw?.print_provider_id;
  const baseKey = blueprintId && providerId ? `${blueprintId}-${providerId}` : text(blueprintId || providerId || "unknown");
  return {
    printify_product_id: text(raw?.id),
    printify_shop_id: shopId,
    title: text(raw?.title || "Untitled shirt"),
    description: plainText(raw?.description),
    category: categoryFor(raw, blueprint),
    price: prices.price,
    price_max: prices.priceMax,
    sizes: sizesFromProduct(raw),
    mockups,
    image: mockups[0]?.image || "",
    base_key: baseKey,
    base_label: text(blueprint?.title || (blueprintId ? `Printify base ${blueprintId}` : "Printify shirt")),
    variants: publicVariants(raw),
    source_updated_at: raw?.updated_at || null,
    synced_at: new Date().toISOString(),
    sync_run_id: runId,
  };
}

async function printifyJson(token: string, path: string) {
  const response = await fetch(`${PRINTIFY_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Kalenel-Shop-Printify-Sync/1.0",
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
    for (let page = 1; page <= MAX_PAGES_PER_SHOP; page += 1) {
      const payload = await printifyJson(token, `/shops/${shopId}/products.json?limit=50&page=${page}`);
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      products.push(...rows.map((raw: any) => ({ shopId, raw })));
      const lastPage = Number(payload?.last_page || 0);
      if (!rows.length || rows.length < 50 || (lastPage && page >= lastPage)) break;
    }
  }
  return { shops: selectedShops, products };
}

async function loadBlueprints(token: string, products: Array<{ raw: any }>) {
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

async function readCachedCatalog(supabase: any) {
  const { data, error } = await supabase
    .from("shop_printify_products")
    .select("printify_product_id,title,description,category,price,price_max,sizes,mockups,image,base_key,base_label,variants,source_updated_at,synced_at")
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
    console.warn("Printify Vault token lookup failed", error.message || error);
    return "";
  }
  return text(data);
}

function publicProduct(row: any) {
  return {
    id: row.printify_product_id,
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

async function syncCatalog(supabase: any, token: string) {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await supabase.from("shop_printify_sync_state").upsert({
    id: 1,
    last_sync_started_at: startedAt,
    next_refresh_at: new Date(Date.now() + RETRY_MS).toISOString(),
    last_error: null,
  });

  const { shops, products } = await loadPrintifyProducts(token);
  const blueprints = await loadBlueprints(token, products);
  const rows = products
    .map(({ shopId, raw }) => normalizeProduct(raw, shopId, blueprints.get(Number(raw?.blueprint_id)), runId))
    .filter((row) => row.printify_product_id && row.mockups.length && row.price > 0);

  const { error: clearRunError } = await supabase
    .from("shop_printify_products")
    .update({ sync_run_id: null })
    .not("printify_product_id", "is", null);
  if (clearRunError) throw clearRunError;

  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await supabase
      .from("shop_printify_products")
      .upsert(rows.slice(index, index + 100), { onConflict: "printify_product_id" });
    if (error) throw error;
  }

  const { error: deleteError } = rows.length
    ? await supabase.from("shop_printify_products").delete().is("sync_run_id", null)
    : await supabase.from("shop_printify_products").delete().not("printify_product_id", "is", null);
  if (deleteError) throw deleteError;

  const completedAt = new Date().toISOString();
  const { error: stateError } = await supabase.from("shop_printify_sync_state").upsert({
    id: 1,
    last_synced_at: completedAt,
    next_refresh_at: new Date(Date.now() + REFRESH_MS).toISOString(),
    last_error: null,
    product_count: rows.length,
    shop_count: shops.length,
  });
  if (stateError) throw stateError;
  return { productCount: rows.length, shopCount: shops.length, syncedAt: completedAt };
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
      .from("shop_printify_sync_state")
      .select("last_synced_at,next_refresh_at,last_error,product_count,shop_count")
      .eq("id", 1)
      .maybeSingle();

    const token = await resolvePrintifyToken(supabase);
    const nextRefresh = state?.next_refresh_at ? Date.parse(state.next_refresh_at) : 0;
    const stale = !nextRefresh || nextRefresh <= Date.now();
    let syncResult: any = null;
    let syncError = "";

    if (token && (!cached.length || stale)) {
      try {
        syncResult = await syncCatalog(supabase, token);
        cached = await readCachedCatalog(supabase);
      } catch (error) {
        syncError = text(error instanceof Error ? error.message : error).slice(0, 500);
        console.error("Printify sync failed", error);
        await supabase.from("shop_printify_sync_state").upsert({
          id: 1,
          next_refresh_at: new Date(Date.now() + RETRY_MS).toISOString(),
          last_error: syncError,
        });
      }
    }

    return json({
      generatedAt: new Date().toISOString(),
      source: "printify-live-cache",
      syncConfigured: Boolean(token),
      sync: syncResult || {
        lastSyncedAt: state?.last_synced_at || null,
        productCount: cached.length,
        shopCount: Number(state?.shop_count || 0),
        error: syncError || state?.last_error || null,
      },
      products: cached.map(publicProduct),
    });
  } catch (error) {
    console.error("shop-catalog failed", error);
    return json({ error: "catalog_unavailable", products: [] }, 503);
  }
});
