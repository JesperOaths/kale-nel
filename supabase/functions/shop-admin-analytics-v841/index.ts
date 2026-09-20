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

function average(values: number[]) {
  const rows = values.filter((v) => Number.isFinite(v) && v >= 0);
  return rows.length ? rows.reduce((sum, v) => sum + v, 0) / rows.length : null;
}
function supplierShippingEurCents(row: any) {
  const shipping = Number(row?.shipping_cents || 0);
  if (shipping === 0) return 0;
  const source = Number(row?.shipping_source_cents);
  const currency = text(row?.shipping_source_currency).toLowerCase();
  if (!Number.isFinite(source) || source < 0) return null;
  if (currency === "eur") return Math.round(source);
  if (currency === "usd") {
    const rate = Number(row?.fx_snapshot?.rate);
    if (Number.isFinite(rate) && rate > 0) return Math.round(source * rate);
  }
  return null;
}
async function operationalBreakdown(sb: any, range: { from: string; to: string }) {
  const { data, error } = await sb.from("shop_orders")
    .select("id,status,created_at,payment_verified_at,submitted_to_printify_at,shipped_at,payment_provider,shipping_method,shipping_cents,shipping_source_currency,shipping_source_cents,fx_snapshot,paid_amount_cents,total_cents,customer_email,line_items")
    .gte("created_at", range.from).lt("created_at", range.to)
    .order("created_at", { ascending: false }).limit(5000);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const customers = new Map<string, number>();
  const payments = new Map<string, any>();
  const statuses = new Map<string, number>();
  const shippingMethods = new Map<string, any>();
  const providers = new Map<string, any>();
  const paymentMinutes: number[] = [], productionHours: number[] = [], shipDays: number[] = [];
  let knownShippingRevenueCents = 0, knownShippingCostCents = 0, knownShippingOrders = 0, missingShippingCostOrders = 0, overpaymentCents = 0;

  const addTime = (bucket: number[], from: unknown, to: unknown, divisor: number) => {
    const a = Date.parse(text(from)), b = Date.parse(text(to));
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) bucket.push((b - a) / divisor);
  };

  for (const row of rows) {
    const paid = !!row?.payment_verified_at;
    const email = text(row?.customer_email).toLowerCase();
    if (email) customers.set(email, (customers.get(email) || 0) + 1);

    const status = text(row?.status) || "unknown";
    statuses.set(status, (statuses.get(status) || 0) + 1);

    const provider = text(row?.payment_provider) || "manual";
    const payment = payments.get(provider) || { provider, orders: 0, paid_orders: 0, paid_sales_cents: 0 };
    payment.orders += 1;
    if (paid) { payment.paid_orders += 1; payment.paid_sales_cents += Number(row?.total_cents || 0); }
    payments.set(provider, payment);

    const shipMethod = text(row?.shipping_method) || "unknown";
    const sm = shippingMethods.get(shipMethod) || { method: shipMethod, orders: 0, paid_orders: 0, shipping_revenue_cents: 0 };
    sm.orders += 1;
    if (paid) { sm.paid_orders += 1; sm.shipping_revenue_cents += Number(row?.shipping_cents || 0); }
    shippingMethods.set(shipMethod, sm);

    if (paid) {
      const paidAmount = Number(row?.paid_amount_cents);
      const total = Number(row?.total_cents || 0);
      if (Number.isFinite(paidAmount) && paidAmount > total) overpaymentCents += paidAmount - total;
      const supplier = supplierShippingEurCents(row);
      if (supplier == null && Number(row?.shipping_cents || 0) > 0) {
        missingShippingCostOrders += 1;
      } else if (supplier != null) {
        knownShippingOrders += 1;
        knownShippingRevenueCents += Number(row?.shipping_cents || 0);
        knownShippingCostCents += supplier;
      }
    }

    addTime(paymentMinutes, row?.created_at, row?.payment_verified_at, 60000);
    addTime(productionHours, row?.payment_verified_at, row?.submitted_to_printify_at, 3600000);
    addTime(shipDays, row?.submitted_to_printify_at, row?.shipped_at, 86400000);

    const seenProviders = new Set<string>();
    for (const item of Array.isArray(row?.line_items) ? row.line_items : []) {
      const providerId = text(item?.fulfillment_route?.print_provider_id || item?.print_provider_id || "unknown");
      const qty = Math.max(1, Math.round(Number(item?.qty || 1)));
      const pr = providers.get(providerId) || { provider_id: providerId, units: 0, paid_units: 0, orders: 0, paid_orders: 0 };
      pr.units += qty;
      if (paid) pr.paid_units += qty;
      providers.set(providerId, pr);
      if (!seenProviders.has(providerId)) {
        pr.orders += 1;
        if (paid) pr.paid_orders += 1;
        seenProviders.add(providerId);
      }
    }
  }
  const repeatCustomers = [...customers.values()].filter((count) => count > 1).length;
  return {
    unique_customers: customers.size,
    repeat_customers: repeatCustomers,
    repeat_customer_rate: customers.size ? repeatCustomers / customers.size : null,
    avg_minutes_to_payment: average(paymentMinutes),
    avg_hours_payment_to_production: average(productionHours),
    avg_days_production_to_ship: average(shipDays),
    known_shipping_orders: knownShippingOrders,
    missing_shipping_cost_orders: missingShippingCostOrders,
    known_shipping_revenue_cents: knownShippingRevenueCents,
    known_shipping_cost_cents: knownShippingCostCents,
    known_shipping_margin_cents: knownShippingRevenueCents - knownShippingCostCents,
    overpayment_cents: overpaymentCents,
    payment_providers: [...payments.values()].sort((a, b) => b.orders - a.orders),
    shipping_methods: [...shippingMethods.values()].sort((a, b) => b.orders - a.orders),
    fulfillment_providers: [...providers.values()].sort((a, b) => b.units - a.units),
    statuses: [...statuses.entries()].map(([status, orders]) => ({ status, orders })).sort((a, b) => b.orders - a.orders),
  };
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
      const [catalog_costs, operations] = await Promise.all([
        currentCostSnapshot(sb, action === "refresh_costs" || body?.force_cost_refresh === true),
        operationalBreakdown(sb, range),
      ]);
      return json(req, { ok: true, snapshot, catalog_costs, operations });
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
