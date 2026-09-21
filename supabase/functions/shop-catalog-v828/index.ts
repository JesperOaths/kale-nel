import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import postgres from "npm:postgres@3.4.7";
import { fxAuditSnapshot, parseEcbUsdRate, retailEurCentsFromUsdCost } from "../_shared/shop-fx.mjs";

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


const PUBLIC_PRODUCT_NAMES: Record<string, string> = {
  "6a97ea08b3fdf6e3e5006a3a": "Coral",
  "6a97e970031028396b0e06ee": "Daffodil",
  "6a871b6035cea7fe2c005ee6": "Dragonfly",
  "6a97d1242487da888903a445": "Honeysuckle",
  "6a97eac8031028396b0e07dc": "Horseshoe Crab",
  "6a97d253a530b95d7707ffa4": "Seahorse",
  "6a97ee4acef71a1df0017d52": "Kelp",
  "6a9742c08816f2362104d5cc": "Despinoza Rose T-Shirt",
  "6a975ec45d07cc05a702a491": "Despinoza Long-Stem Rose T-Shirt",
  "6aaff223e0eef877800262df": "Despinoza Rose Snapback Cap",
  "6aaa152378f50f3725033e18": "Despinoza DD Rose Tote Bag",
  "6a877d2aeb76ae387b05cfae": "Axolotl",
  "6aaa4536b6bab1f028069988": "Aye-Aye",
  "6aaa566a7e9070db3f09bc0a": "Thorny Devil",
  "6ab0fa9a0b770861f80da032": "Thorny Devil — Alternate Artwork",
  "6ab119be793a18c49f0d2f9c": "Crown Imperial",
  "6aaa4d00cf8017667a0586c6": "Japanese Spider Crab",
  "6a97d552b3fdf6e3e5005804": "Dogwood",
  "6aaa48e16b79c0257608010d": "Fennec Fox",
  "6aaa52d4248ab968df08c422": "Pom-Pom Crab",
  "6ab11a606c03da12620e7dce": "Himalayan Blue Poppy",
  "6aaa49f8583c51460607a144": "Humpback Whale",
  "6a98254d5c9d1f57390a1024": "Hydrangea",
  "6a878552828b6188a0031a81": "Jellyfish",
  "6aaa4c57583c51460607a270": "Jerboa",
  "6aaa50bb0da2b4cf33062dbf": "Kudu",
  "6ab11b242bc468efdf0ad5b8": "Lady's Slipper Orchid",
  "6aaa4ed8a0fd67a9700b9bc8": "Leaf-Tailed Gecko",
  "6aaa4fbae20a7d1fbb0fcf79": "Leopard Seal",
  "6a97ecf8031028396b0e0945": "Water Lily",
  "6a97f122cef71a1df0017f59": "Magnolia",
  "6aaa55ea5e707d1ff9060c88": "Manta Ray",
  "6a97e8d32487da888903ba9d": "Monstera",
  "6aaa46a143c8057f5104a52e": "Banded Linsang",
  "6a97d47e5100c415920da0ea": "Orchid",
  "6a8781c676f52ce62f082d19": "Orchid Mantis",
  "6ab11c1820563fc58009dec0": "Persian Buttercup",
  "6ab11cd7f4f8f622b2089cf3": "Pink Dahlia",
  "6aaa543d7e9070db3f09bb03": "Pufferfish",
  "6ab11eb805d12e6234068af3": "Red & White Parrot Tulip",
  "6ab11ddab6d42b3fc108ac42": "Red Spider Lily",
  "6aaa54ca248ab968df08c516": "Secretary Bird",
  "6aaa4ddfb3c36c673e0dee1b": "Krill",
  "6ab11f47937bf873f309905c": "Snake's Head Fritillary",
  "6a97ed9c2487da888903bde8": "Snowdrop",
  "6aaa520db1ff95a9e501202c": "Orb-Weaver",
  "6aaa4b12583c51460607a1f3": "Japanese Maple",
  "6a8769e26a41fe0f530b538f": "Thistle",
  "6ab11fcc793a18c49f0d3301": "Tiger Lily",
  "6ab1204d20563fc58009e1a9": "White Fringed Orchid",
  "6a877defbecced59b0037078": "Wild Carrot (Queen Anne's Lace)"
};

function publicProductName(product: any) {
  return PUBLIC_PRODUCT_NAMES[text(product?.id)] || publicTitle(product);
}

function publicBaseLabel(product: any) {
  const blueprint = String(product?.blueprint_id || "");
  if (blueprint === "6") return "Gildan 5000 Heavy Cotton T-Shirt";
  if (blueprint === "1382") return "Bella+Canvas 3010 Oversized Boxy T-Shirt";
  if (blueprint === "1753") return "Yupoong 6007 Flat Bill Cap";
  if (blueprint === "1389") return "All-Over Print Tote Bag";
  return /\btote\b/i.test(text(product?.title)) ? "Tote Bag" : "Product";
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

function directDb() {
  const dbUrl = text(Deno.env.get("SUPABASE_DB_URL"));
  if (!dbUrl) throw new Error("database_url_missing");
  return postgres(dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 6,
    idle_timeout: 2,
    max_lifetime: 30,
  });
}

async function readCatalogCacheDirect() {
  const sql = directDb();
  try {
    const rows = await sql`
      select payload, generated_at, refresh_started_at
      from public.shop_catalog_cache_v828
      where id = 1
      limit 1
    `;
    return rows?.[0] || null;
  } finally {
    try { await sql.end({ timeout: 1 }); } catch {}
  }
}

async function updateCatalogCacheDirect(values: {
  payload?: any;
  generated_at?: string | null;
  refresh_started_at?: string | null;
  last_error?: string | null;
}) {
  const sql = directDb();
  try {
    const now = new Date().toISOString();
    if (Object.prototype.hasOwnProperty.call(values, "payload")) {
      await sql`
        update public.shop_catalog_cache_v828
        set payload = ${sql.json(values.payload)},
            generated_at = ${values.generated_at || now},
            refresh_started_at = ${values.refresh_started_at ?? null},
            last_error = ${values.last_error ?? null},
            updated_at = ${now}
        where id = 1
      `;
    } else {
      await sql`
        update public.shop_catalog_cache_v828
        set refresh_started_at = coalesce(${values.refresh_started_at ?? null}, refresh_started_at),
            last_error = ${values.last_error ?? null},
            updated_at = ${now}
        where id = 1
      `;
    }
  } finally {
    try { await sql.end({ timeout: 1 }); } catch {}
  }
}

function normalizeFxRow(row: any, stale = false) {
  const rate = Number(row?.rate);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 10) return null;
  return {
    pair: "USD_EUR",
    base_currency: "USD",
    quote_currency: "EUR",
    rate,
    source: text(row?.source) || "ecb_reference",
    source_rate: Number.isFinite(Number(row?.source_rate)) ? Number(row.source_rate) : null,
    observed_on: text(row?.observed_on),
    fetched_at: text(row?.fetched_at),
    stale,
  };
}

async function resolveUsdEurRateDirect() {
  let cached: any = null;
  const sql = directDb();
  try {
    const rows = await sql`
      select pair, base_currency, quote_currency, rate, source, source_rate, observed_on, fetched_at
      from public.shop_fx_rates
      where pair = 'USD_EUR'
      limit 1
    `;
    cached = normalizeFxRow(rows?.[0]);
  } catch {}
  finally {
    try { await sql.end({ timeout: 1 }); } catch {}
  }

  const now = Date.now();
  const fetchedMs = cached?.fetched_at ? Date.parse(cached.fetched_at) : 0;
  const observedMs = cached?.observed_on ? Date.parse(`${cached.observed_on}T00:00:00Z`) : 0;
  if (cached && fetchedMs && observedMs && now - fetchedMs <= 6 * 60 * 60 * 1000 && now - observedMs <= 7 * 24 * 60 * 60 * 1000) {
    return cached;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
      signal: controller.signal,
      headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1", "User-Agent": "Kalenel-Shop-FX/8.50" },
    });
    if (!response.ok) throw new Error(`ecb_${response.status}`);
    const parsed = parseEcbUsdRate(await response.text());
    const live = {
      pair: "USD_EUR",
      base_currency: "USD",
      quote_currency: "EUR",
      rate: parsed.usd_eur,
      source: "ecb_reference",
      source_rate: parsed.eur_usd,
      observed_on: parsed.observed_on,
      fetched_at: new Date().toISOString(),
      stale: false,
    };
    const write = directDb();
    try {
      await write`
        insert into public.shop_fx_rates
          (pair, base_currency, quote_currency, rate, source, source_rate, observed_on, fetched_at, updated_at)
        values
          ('USD_EUR','USD','EUR',${live.rate},${live.source},${live.source_rate},${live.observed_on},${live.fetched_at},now())
        on conflict (pair) do update set
          base_currency = excluded.base_currency,
          quote_currency = excluded.quote_currency,
          rate = excluded.rate,
          source = excluded.source,
          source_rate = excluded.source_rate,
          observed_on = excluded.observed_on,
          fetched_at = excluded.fetched_at,
          updated_at = now()
      `;
    } finally {
      try { await write.end({ timeout: 1 }); } catch {}
    }
    return live;
  } catch (error) {
    if (cached && observedMs && now - observedMs <= 7 * 24 * 60 * 60 * 1000) return { ...cached, stale: true };
    throw error;
  } finally {
    clearTimeout(timer);
  }
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

  const dbUrl = text(Deno.env.get("SUPABASE_DB_URL"));
  if (dbUrl) {
    let sql: any = null;
    try {
      sql = postgres(dbUrl, {
        max: 1,
        prepare: false,
        connect_timeout: 6,
        idle_timeout: 2,
        max_lifetime: 30,
      });
      const rows = await sql`
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'kalenel_printify_api_token'
        order by updated_at desc nulls last, created_at desc
        limit 1
      `;
      const directToken = text(rows?.[0]?.decrypted_secret);
      if (directToken) return directToken;
    } catch (error) {
      console.warn("Direct Vault token lookup failed", error instanceof Error ? error.name : "unknown");
    } finally {
      try { if (sql) await sql.end({ timeout: 1 }); } catch {}
    }
  }

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
    id: text(product?.id), source: "printify-live-v851", shopId: String(shopId), shopTitle: text(shop?.title),
    name: publicProductName(product), description: text(product?.description),
    collection, price: prices.length ? Math.min(...prices) : 0, priceMax: prices.length ? Math.max(...prices) : 0,
    sizes, colors, selectorType, mockups, image: mockups[0]?.image || "", baseKey: String(product?.blueprint_id || "shirt"),
    baseLabel: publicBaseLabel(product),
    variants: available, updatedAt: product?.updated_at || null,
  };
}

async function buildCatalog(supabase: any) {
  const token = await resolveToken(supabase);
  const fx = await resolveUsdEurRateDirect();
  const account = await loadAccountProducts(token);

  const cleanProducts = account.entries
    .filter((entry: any) => entry.product?.visible !== false && !text(entry.product?.title).startsWith(ROUTE_PREFIX))
    .map((entry: any) => publicProduct(entry.product, fx, entry.shopId, entry.shop))
    .filter((product: any) => product.id && product.name && product.price > 0 && product.mockups.length > 0 && product.variants.length > 0);

  if (!cleanProducts.length) throw new Error("no_sellable_products_in_printify_account");

  return {
    generatedAt: new Date().toISOString(),
    source: "printify-live-v851",
    catalogSelection: "all-readable-printify-shops-v851",
    fx: fxAuditSnapshot(fx),
    shops: account.shops,
    products: cleanProducts,
  };
}

async function refreshCatalog(supabase: any) {
  try {
    const payload = await buildCatalog(supabase);
    const now = new Date().toISOString();
    await updateCatalogCacheDirect({
      payload,
      generated_at: now,
      refresh_started_at: null,
      last_error: null,
    });
  } catch (error) {
    const message = text(error instanceof Error ? error.message : error).slice(0, 500);
    try {
      const sql = directDb();
      try {
        await sql`
          update public.shop_catalog_cache_v828
          set refresh_started_at = null,
              last_error = ${message},
              updated_at = now()
          where id = 1
        `;
      } finally {
        try { await sql.end({ timeout: 1 }); } catch {}
      }
    } catch {}
    console.error("shop-catalog-v828 refresh failed", error instanceof Error ? error.name : "unknown");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "GET") return json(req, { error: "method_not_allowed" }, 405);
  const url = new URL(req.url);
  if (url.searchParams.get("blueprint_meta") === "1") {
    let sb: any;
    try { sb = serviceClient(); } catch { sb = null; }
    try {
      const token = await resolveToken(sb);
      const ids = [6, 1382, 1753, 1389];
      const entries = await Promise.all(ids.map(async id => {
        try {
          const bp = await printify(token, `/catalog/blueprints/${id}.json`, 5000);
          return { id, title: text(bp?.title), brand: text(bp?.brand), model: text(bp?.model) };
        } catch (error) {
          return { id, error: error instanceof Error ? error.message : "lookup_failed" };
        }
      }));
      return json(req, { ok: true, blueprints: entries });
    } catch (error) {
      return json(req, { ok: false, error: error instanceof Error ? error.message : "lookup_failed" }, 503);
    }
  }

  if (url.searchParams.get("bootstrap") === "1") {
    return json(req, {
      ok: true,
      envTokenConfigured: !!text(Deno.env.get("PRINTIFY_API_TOKEN")),
      serviceRoleConfigured: !!text(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
      mode: "printify-bootstrap-v850",
    });
  }

  if (url.searchParams.get("diagnostic") === "1") {
    const started = Date.now();
    let sb: any;
    try { sb = serviceClient(); }
    catch { return json(req, { ok: false, stage: "service_client", elapsedMs: Date.now() - started }, 503); }

    const timeout = <T>(promise: Promise<T>, ms: number, label: string) =>
      Promise.race<T>([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
      ]);

    let token = "";
    let tokenMs = 0;
    try {
      const t0 = Date.now();
      token = await timeout(resolveToken(sb), 5000, "token_timeout");
      tokenMs = Date.now() - t0;
    } catch (error) {
      return json(req, {
        ok: false,
        stage: error instanceof Error ? error.message : "token_error",
        envTokenConfigured: !!text(Deno.env.get("PRINTIFY_API_TOKEN")),
        tokenResolveMs: Date.now() - started,
        elapsedMs: Date.now() - started,
      }, 503);
    }

    let shops: any[] = [];
    let shopsMs = 0;
    try {
      const t0 = Date.now();
      const payload = await timeout(printify(token, "/shops.json", 5000), 5500, "shops_timeout");
      shopsMs = Date.now() - t0;
      shops = Array.isArray(payload) ? payload : [];
    } catch (error) {
      return json(req, {
        ok: false,
        stage: error instanceof Error ? error.message : "shops_error",
        tokenResolveMs: tokenMs,
        shopsMs: Date.now() - started - tokenMs,
        elapsedMs: Date.now() - started,
      }, 503);
    }

    const probes = await Promise.allSettled(shops.map(async (shop: any) => {
      const shopId = Number(shop?.id);
      const t0 = Date.now();
      const first = await timeout(firstProductPage(token, shopId), 6000, "products_timeout");
      return {
        salesChannel: text(shop?.sales_channel),
        firstPageProducts: first.rows.length,
        lastPage: first.lastPage,
        elapsedMs: Date.now() - t0,
      };
    }));

    return json(req, {
      ok: true,
      mode: "printify-diagnostic-v850",
      envTokenConfigured: !!text(Deno.env.get("PRINTIFY_API_TOKEN")),
      tokenResolveMs: tokenMs,
      shopsMs,
      shopCount: shops.length,
      probes: probes.map((result) => result.status === "fulfilled"
        ? { ok: true, ...result.value }
        : { ok: false, error: result.reason instanceof Error ? result.reason.message : "probe_error" }),
      elapsedMs: Date.now() - started,
    });
  }
  let supabase: any;
  try { supabase = serviceClient(); } catch { supabase = null; }

  let row: any = null;
  try { row = await readCatalogCacheDirect(); }
  catch { return json(req, { error: "cache_unavailable", products: [] }, 503); }

  const payload = row?.payload && typeof row.payload === "object" ? row.payload : { products: [] };
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const selectionCurrent = payload?.catalogSelection === "all-readable-printify-shops-v851";
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
      try {
        const sql = directDb();
        try {
          await sql`
            update public.shop_catalog_cache_v828
            set refresh_started_at = ${now}, updated_at = ${now}
            where id = 1
          `;
        } finally {
          try { await sql.end({ timeout: 1 }); } catch {}
        }
        refreshScheduled = true;
        EdgeRuntime.waitUntil(refreshCatalog(supabase));
      } catch {}
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
    try {
      const sql = directDb();
      try {
        await sql`
          update public.shop_catalog_cache_v828
          set refresh_started_at = ${now}, updated_at = ${now}
          where id = 1
        `;
      } finally {
        try { await sql.end({ timeout: 1 }); } catch {}
      }
      refreshScheduled = true;
      EdgeRuntime.waitUntil(refreshCatalog(supabase));
    } catch {}
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