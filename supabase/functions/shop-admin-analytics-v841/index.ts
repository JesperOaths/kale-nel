import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { fxAuditSnapshot, resolveUsdEurRate, usdCentsToEurCents } from "../_shared/shop-fx.mjs";

const PRINTIFY_BASE = "https://api.printify.com/v1";
const COST_CACHE_MS = 10 * 60 * 1000;
const MAX_PAGES = 100;
const ALLOWED_ORIGINS = new Set(["https://kalenel.nl","https://www.kalenel.nl","https://admin.kalenel.nl","https://jesperoaths.github.io"]);
const CATEGORIES = new Set(["marketing","packaging","payment_fee","refund","chargeback","tax","software","shipping_adjustment","discount","other"]);
const text = (v: unknown) => String(v ?? "").trim();

function cors(req: Request) {
  const origin = text(req.headers.get("origin"));
  const allow = ALLOWED_ORIGINS.has(origin) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin) ? origin : "https://admin.kalenel.nl";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
}
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors(req) });

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("server_not_configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function requireAdmin(sb: any, token: string) {
  const { data, error } = await sb.rpc("_require_valid_admin_session", { admin_session_token: token });
  if (error) throw new Error(error.message || String(error));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) throw new Error("invalid_admin_session");
  return row;
}
async function resolveToken(sb: any) {
  const envToken = text(Deno.env.get("PRINTIFY_API_TOKEN"));
  if (envToken) return envToken;
  const { data, error } = await sb.rpc("get_printify_api_token_v815a");
  if (error || !text(data)) throw new Error("production_connection_missing");
  return text(data);
}
async function printify(token: string, path: string) {
  const response = await fetch(PRINTIFY_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "Kalenel-Shop-Analytics/8.41" },
  });
  const raw = await response.text();
  let payload: any = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
  if (!response.ok) throw new Error(`printify_${response.status}:${text(payload?.message || payload?.error || raw).slice(0,180)}`);
  return payload;
}
async function loadProducts(token: string, shopId: number) {
  const rows: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await printify(token, `/shops/${shopId}/products.json?limit=50&page=${page}`);
    const batch = Array.isArray(payload?.data) ? payload.data : [];
    rows.push(...batch);
    const last = Number(payload?.last_page || 0);
    if (!batch.length || batch.length < 50 || (last && page >= last)) break;
  }
  return rows;
}
async function resolveShopId(token: string, catalogPayload: any) {
  const cached = Number(catalogPayload?.shop?.id);
  if (Number.isFinite(cached) && cached > 0) return cached;
  const configured = Number(Deno.env.get("PRINTIFY_SHOP_ID"));
  if (Number.isFinite(configured) && configured > 0) return configured;
  const shops = await printify(token, "/shops.json");
  const rows = Array.isArray(shops) ? shops : [];
  const shop = rows.find((r: any) => /shopify/i.test(text(r?.sales_channel))) || rows.find((r: any) => text(r?.sales_channel).toLowerCase() !== "disconnected") || rows[0];
  const id = Number(shop?.id);
  if (!Number.isFinite(id)) throw new Error("no_shop_available");
  return id;
}
async function currentCostSnapshot(sb: any, force = false) {
  const { data: cache } = await sb.from("shop_product_cost_cache_v841").select("payload,generated_at,last_error").eq("id",1).maybeSingle();
  const age = cache?.generated_at ? Date.now() - Date.parse(cache.generated_at) : Infinity;
  if (!force && age < COST_CACHE_MS && Array.isArray(cache?.payload?.products) && cache.payload.products.length) {
    return { ...cache.payload, cache: { generated_at: cache.generated_at, age_seconds: Math.round(age / 1000), stale: false } };
  }
  try {
    const { data: catalogRow, error: catalogError } = await sb.from("shop_catalog_cache_v828").select("payload,generated_at").eq("id",1).maybeSingle();
    if (catalogError) throw catalogError;
    const catalog = catalogRow?.payload || {};
    const catalogProducts = Array.isArray(catalog?.products) ? catalog.products : [];
    if (!catalogProducts.length) throw new Error("catalog_cache_empty");
    const token = await resolveToken(sb);
    const fx = await resolveUsdEurRate(sb);
    const shopId = await resolveShopId(token, catalog);
    const liveProducts = await loadProducts(token, shopId);
    const liveMap = new Map(liveProducts.map((p: any) => [text(p?.id), p]));
    const products = catalogProducts.map((product: any) => {
      const live = liveMap.get(text(product?.id));
      const liveVariants = new Map((Array.isArray((live as any)?.variants) ? (live as any).variants : []).map((v: any) => [String(v?.id || ""), v]));
      const variants = (Array.isArray(product?.variants) ? product.variants : []).map((variant: any) => {
        const source: any = liveVariants.get(String(variant?.id || ""));
        const rawUsdCents = Number(source?.cost);
        const productionCostCents = Number.isFinite(rawUsdCents) && rawUsdCents >= 0 ? usdCentsToEurCents(rawUsdCents, fx) : null;
        const retailCents = Math.round(Number(variant?.price || 0) * 100);
        return {
          id: String(variant?.id || ""),
          sku: text(variant?.sku),
          size: text(variant?.size),
          color: text(variant?.color),
          retail_cents: retailCents,
          production_cost_cents: productionCostCents,
          gross_product_margin_cents: productionCostCents == null ? null : retailCents - productionCostCents,
          source_cost_usd_cents: Number.isFinite(rawUsdCents) ? Math.round(rawUsdCents) : null,
          available: variant?.is_available !== false && variant?.is_enabled !== false,
        };
      }).filter((v: any) => v.id && v.retail_cents > 0);
      const available = variants.filter((v: any) => v.available);
      const basis = available.length ? available : variants;
      const known = basis.filter((v: any) => v.production_cost_cents != null);
      const vals = (key: string, rows = basis) => rows.map((v: any) => Number(v[key])).filter((n: number) => Number.isFinite(n));
      const retail = vals("retail_cents");
      const costs = vals("production_cost_cents", known);
      const margins = vals("gross_product_margin_cents", known);
      return {
        product_id: text(product?.id),
        product_name: text(product?.name),
        collection: text(product?.collection) || "unknown",
        base_label: text(product?.baseLabel),
        retail_min_cents: retail.length ? Math.min(...retail) : null,
        retail_max_cents: retail.length ? Math.max(...retail) : null,
        production_cost_min_cents: costs.length ? Math.min(...costs) : null,
        production_cost_max_cents: costs.length ? Math.max(...costs) : null,
        gross_product_margin_min_cents: margins.length ? Math.min(...margins) : null,
        gross_product_margin_max_cents: margins.length ? Math.max(...margins) : null,
        variants,
      };
    }).filter((p: any) => p.product_id);
    const now = new Date().toISOString();
    const payload = { generated_at: now, catalog_generated_at: catalogRow?.generated_at || null, fx: fxAuditSnapshot(fx), products };
    const { error: saveError } = await sb.from("shop_product_cost_cache_v841").update({ payload, generated_at: now, last_error: null, updated_at: now }).eq("id",1);
    if (saveError) throw saveError;
    return { ...payload, cache: { generated_at: now, age_seconds: 0, stale: false } };
  } catch (error) {
    const message = text(error instanceof Error ? error.message : error).slice(0,400);
    await sb.from("shop_product_cost_cache_v841").update({ last_error: message, updated_at: new Date().toISOString() }).eq("id",1);
    if (Array.isArray(cache?.payload?.products) && cache.payload.products.length) {
      return { ...cache.payload, cache: { generated_at: cache.generated_at, age_seconds: Number.isFinite(age) ? Math.round(age/1000) : null, stale: true, error: message } };
    }
    throw error;
  }
}
function isoOrNull(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function safeRange(body: any) {
  const now = Date.now();
  let to = isoOrNull(body?.to) || new Date(now).toISOString();
  let from = isoOrNull(body?.from) || new Date(now - 30*86400000).toISOString();
  if (Date.parse(from) >= Date.parse(to)) throw new Error("invalid_date_range");
  if (Date.parse(to) - Date.parse(from) > 5*365*86400000) throw new Error("range_too_large");
  return { from, to };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method === "GET") return json(req, { ok: true, mode: "shop-admin-analytics-v841", custom_admin_auth: true });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  let sb: any;
  try { sb = serviceClient(); } catch { return json(req, { error: "server_not_configured" }, 503); }
  try {
    const body = await req.json().catch(() => ({}));
    const admin = await requireAdmin(sb, text(body?.admin_session_token));
    const action = text(body?.action || "dashboard");
    if (action === "dashboard" || action === "refresh_costs") {
      const range = safeRange(body);
      const { data: snapshot, error } = await sb.rpc("shop_admin_analytics_snapshot_v841", { p_from: range.from, p_to: range.to });
      if (error) throw error;
      const catalog_costs = await currentCostSnapshot(sb, action === "refresh_costs" || body?.force_cost_refresh === true);
      return json(req, { ok: true, snapshot, catalog_costs });
    }
    if (action === "ledger_add") {
      const occurred = text(body?.occurred_on);
      const direction = text(body?.direction);
      const category = text(body?.category);
      const amount = Number(body?.amount_cents);
      const orderId = text(body?.order_id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(occurred)) return json(req, { error: "invalid_ledger_date" }, 400);
      if (!["cost","income"].includes(direction)) return json(req, { error: "invalid_ledger_direction" }, 400);
      if (!CATEGORIES.has(category)) return json(req, { error: "invalid_ledger_category" }, 400);
      if (!Number.isInteger(amount) || amount <= 0 || amount > 100000000) return json(req, { error: "invalid_ledger_amount" }, 400);
      if (orderId && !/^[0-9a-f-]{36}$/i.test(orderId)) return json(req, { error: "invalid_order_id" }, 400);
      const row = {
        occurred_on: occurred, direction, category, amount_cents: amount, currency: "eur",
        order_id: orderId || null, product_name: text(body?.product_name).slice(0,160) || null,
        note: text(body?.note).slice(0,1000) || null, created_by_admin_id: admin.admin_id, updated_at: new Date().toISOString(),
      };
      const { data, error } = await sb.from("shop_finance_ledger_v841").insert(row).select().single();
      if (error) throw error;
      return json(req, { ok: true, entry: data });
    }
    if (action === "ledger_delete") {
      const id = Number(body?.ledger_id);
      if (!Number.isInteger(id) || id <= 0) return json(req, { error: "invalid_ledger_id" }, 400);
      const { data, error } = await sb.from("shop_finance_ledger_v841").delete().eq("id",id).select("id").maybeSingle();
      if (error) throw error;
      return json(req, { ok: true, deleted: !!data });
    }
    return json(req, { error: "unknown_action" }, 400);
  } catch (error) {
    const message = text(error instanceof Error ? error.message : error);
    const invalid = /invalid_admin_session/i.test(message);
    console.error("shop-admin-analytics-v841 failed", invalid ? "invalid_admin_session" : message.slice(0,300));
    return json(req, { error: invalid ? "invalid_admin_session" : "shop_analytics_failed", detail: invalid ? undefined : message.slice(0,400) }, invalid ? 401 : 502);
  }
});
