import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  buildFulfillmentPlans,
  catalogProviderVariant,
  cheapestShippingQuote,
  chooseCheapestFulfillment,
  estimatedImportAllowanceCentsPerUnit,
  validateDirectProviderRoute,
} from "./fulfillment-routing.mjs";
import {
  applyPrintifyVatReserveEurCents,
  fxAuditSnapshot,
  marginEurCentsForSize,
  PRINTIFY_SOURCE_CURRENCY,
  PRINTIFY_VAT_RESERVE_BPS,
  resolveUsdEurRate,
  retailEurCentsFromUsdCost,
  retailEurCentsFromUsdCostAfterVat,
  stableClassicShirtRetailEurCents,
  usdCentsToEurCents,
} from "../_shared/shop-fx.mjs";

const PRINTIFY_BASE = "https://api.printify.com/v1";
const TIKKIE_URL = "https://api.abnamro.com/v2/tikkie/paymentrequests";
const MAX_ITEMS = 20;
const MAX_QTY = 10;
const MAX_FULFILLMENT_PLANS = 64;
const ALLOWED_ORIGINS = new Set(["https://kalenel.nl", "https://www.kalenel.nl", "https://jesperoaths.github.io"]);
const text = (v: unknown) => String(v ?? "").trim();
const clean = (v: unknown) => text(v).replace(/\s+/g, " ");
const money = (cents: unknown) => `€${(Number(cents || 0) / 100).toFixed(2)}`;
const MARGIN_CENTS = 500;
const LARGE_SIZE_MARGIN_CENTS = 700;

function cors(req: Request) {
  const origin = text(req.headers.get("origin"));
  const allow = ALLOWED_ORIGINS.has(origin) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin) ? origin : "https://kalenel.nl";
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
function normalizeCountry(v: unknown) { return text(v || "NL").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2); }
function splitName(full: string) { const parts = clean(full).split(" ").filter(Boolean); return { first_name: parts[0] || "Customer", last_name: parts.slice(1).join(" ") || parts[0] || "Customer" }; }
function validEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254; }
async function sha256(value: string) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join(""); }

async function printify(token: string, path: string, init: RequestInit = {}, timeoutMs = 12000) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${PRINTIFY_BASE}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "Kalenel-Manual-Shop/8.33", ...(init.headers || {}) },
      });
      const raw = await res.text();
      let payload: any = null;
      try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
      if (res.ok) return payload;

      const message = `Printify ${res.status}: ${text(payload?.message || payload?.error || raw).slice(0, 350)}`;
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
async function mapWithConcurrency(items: any[], concurrency: number, worker: (item: any, index: number) => Promise<any>) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length)) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function resolvePrintifyToken(sb: any) {
  const envToken = text(Deno.env.get("PRINTIFY_API_TOKEN"));
  if (envToken) return envToken;
  const { data, error } = await sb.rpc("get_printify_api_token_v815a");
  if (error || !text(data)) throw new Error("Printify token unavailable");
  return text(data);
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
function sizeFromVariant(product: any, variant: any) {
  const explicit = optionValues(product, variant).find(x => x.type === "size")?.value;
  if (explicit) return text(explicit).toUpperCase();
  const m = clean(variant?.title).match(/(?:^|\s|\/|\|)(xs|s|m|l|xl|2xl|3xl|4xl|5xl)(?:$|\s|\/|\|)/i);
  return m ? m[1].toUpperCase() : "";
}
function colorFromVariant(product: any, variant: any) {
  return text(optionValues(product, variant).find(x => x.type === "color")?.value);
}
function isToteProduct(product: any) {
  return /\btote\b/i.test(text(product?.title));
}
function isShirtProduct(product: any) {
  const blueprint = String(product?.blueprint_id || "");
  return blueprint === "6" || blueprint === "1382";
}
function isCustomerVariantAllowed(product: any, variant: any) {
  const color = colorFromVariant(product, variant);
  if (isToteProduct(product)) return /^(?:black|white)$/i.test(color);
  return !color || /^white$/i.test(color);
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

function validPaymentUrl(raw: unknown, provider: string) {
  if (!text(raw)) return "";
  try {
    const u = new URL(text(raw));
    if (u.protocol !== "https:") return "";
    const host = u.hostname.toLowerCase();
    if ((provider === "bunq" || provider === "bunq_me") && (host === "bunq.me" || host.endsWith(".bunq.me"))) return u.toString();
    if (provider === "tikkie" && (host === "tikkie.me" || host.endsWith(".tikkie.me"))) return u.toString();
  } catch {}
  return "";
}
async function createPaymentRequest(settings: any, totalCents: number, reference: string) {
  const provider = text(settings?.provider || "manual_transfer");
  if (provider === "tikkie") {
    const apiKey = text(Deno.env.get("TIKKIE_API_KEY"));
    const appToken = text(Deno.env.get("TIKKIE_APP_TOKEN"));
    if (apiKey && appToken) {
      const expiry = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const res = await fetch(TIKKIE_URL, { method: "POST", headers: { "API-Key": apiKey, "X-App-Token": appToken, "Content-Type": "application/json" }, body: JSON.stringify({ amountInCents: totalCents, description: `Bruis order ${reference}`.slice(0, 35), expiryDate: expiry, referenceId: reference }) });
      const raw = await res.text();
      let p: any = {};
      try { p = raw ? JSON.parse(raw) : {}; } catch {}
      if (res.ok && text(p?.url)) return { provider: "tikkie", url: text(p.url), token: text(p.paymentRequestToken), expires_at: p.expiryDate ? `${p.expiryDate}T23:59:59Z` : null };
      console.error("Tikkie payment request failed", res.status);
    }
  }
  return { provider, url: validPaymentUrl(settings?.payment_url, provider), token: "", expires_at: null };
}
function htmlEscape(v: unknown) { return text(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c)); }
async function sendEmail(to: string, subject: string, html: string, plain: string) {
  const key = text(Deno.env.get("RESEND_API_KEY"));
  const configuredFrom = text(Deno.env.get("RESEND_FROM_EMAIL"));
  const from = /@kalenel\.nl>?$/i.test(configuredFrom) ? configuredFrom : "Bruis <orders@kalenel.nl>";
  if (!key) return { ok: false, skipped: true, error: "Resend not configured" };
  const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, html, text: plain }) });
  const raw = await res.text();
  return res.ok ? { ok: true, skipped: false } : { ok: false, skipped: false, error: `Resend ${res.status}: ${raw.slice(0, 300)}` };
}

function merchantItemsText(items: any[]) {
  return (Array.isArray(items) ? items : []).map((item: any) => {
    const qty = Math.max(1, Number(item?.qty || item?.quantity || 1));
    const name = clean(item?.name || item?.title || "Item");
    const size = clean(item?.size);
    return `${qty}× ${name}${size ? ` (${size})` : ""}`;
  }).join(", ");
}
async function notifyMerchantNewOrder(sb: any, order: any) {
  if (order?.merchant_order_notified_at) return { sent: false, already_sent: true, skipped: true };
  const { data: ops } = await sb.from("shop_ops_settings_v847").select("owner_email").eq("id", 1).maybeSingle();
  const to = text(ops?.owner_email).toLowerCase();
  if (!validEmail(to)) return { sent: false, skipped: true, error: "merchant_email_not_configured" };

  const ref = text(order?.payment_reference || order?.id);
  const itemText = merchantItemsText(order?.line_items);
  const safeName = htmlEscape(order?.customer_name || "Customer");
  const safeEmail = htmlEscape(order?.customer_email || "");
  const safeItems = htmlEscape(itemText || "Order items recorded in admin");
  const subject = `New Kalenel shop order ${ref}`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111"><h2>New kalenel.nl/shop order</h2><p><strong>${htmlEscape(ref)}</strong> has just been created.</p><p>Customer: ${safeName}${safeEmail ? `<br>Email: ${safeEmail}` : ""}</p><p>Items: ${safeItems}</p><p><strong>Total: ${money(order?.total_cents)}</strong><br>Shipping: ${money(order?.shipping_cents)}<br>Status: Pending payment verification</p><p><a href="https://admin.kalenel.nl/admin_shop_orders.html?order=${encodeURIComponent(String(order?.id || ""))}">Open this order in Kalenel Admin</a></p></div>`;
  const plain = `New kalenel.nl/shop order ${ref}.\nCustomer: ${order?.customer_name || "Customer"}${order?.customer_email ? ` <${order.customer_email}>` : ""}\nItems: ${itemText || "See admin"}\nTotal: ${money(order?.total_cents)}\nShipping: ${money(order?.shipping_cents)}\nStatus: Pending payment verification.\nhttps://admin.kalenel.nl/admin_shop_orders.html?order=${encodeURIComponent(String(order?.id || ""))}`;
  const mailed = await sendEmail(to, subject, html, plain);
  const now = new Date().toISOString();
  if (mailed.ok) {
    await sb.from("shop_orders").update({
      merchant_order_notified_at: now,
      merchant_order_notification_error: null,
      merchant_order_notification_error_at: null,
      updated_at: now,
    }).eq("id", order.id);
    return { sent: true, notified_at: now };
  }
  if (!mailed.skipped) {
    await sb.from("shop_orders").update({
      merchant_order_notification_error: mailed.error,
      merchant_order_notification_error_at: now,
      updated_at: now,
    }).eq("id", order.id);
  }
  return { sent: false, skipped: !!mailed.skipped, error: mailed.error };
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(req, { error: "server_not_configured" }, 503);
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (req.method === "GET") {
    const { data: cache } = await sb.from("shop_catalog_cache_v828").select("payload,generated_at,last_error").eq("id", 1).maybeSingle();
    const { data: settings } = await sb.from("shop_payment_settings").select("provider,payment_url,enabled").eq("id", 1).maybeSingle();
    const { count: approvedProviderRoutes } = await sb.from("shop_provider_routes_v1").select("approval_id", { count: "exact", head: true }).eq("approved", true);
    return json(req, {
      ok: true,
      mode: "manual-payment-v832",
      pricing: "shirt-production-cost-plus-max-printify-vat-plus-size-margin-rounded-up",
      pricingBase: "production-cost-plus-printify-vat-reserve",
      marginEuros: { shirtsStandard: MARGIN_CENTS / 100, shirtsThreeXlPlus: LARGE_SIZE_MARGIN_CENTS / 100, standard: MARGIN_CENTS / 100, threeXlPlus: LARGE_SIZE_MARGIN_CENTS / 100 },
      vatReservePercent: PRINTIFY_VAT_RESERVE_BPS / 100,
      rounding: "whole-euro-ceiling",
      creates_pending_orders: true,
      sends_to_production: false,
      fulfillment_routing: "clone-free-direct-provider-plus-canonical",
      fulfillment_provider_consolidation: "eu-lowest-customer-shipping-first; non-eu-lowest-total-route-cost",
      approved_provider_routes: Number(approvedProviderRoutes || 0),
      cached_products: Array.isArray(cache?.payload?.products) ? cache.payload.products.length : 0,
      catalog_generated_at: cache?.generated_at || null,
      catalog_error: cache?.last_error || null,
      payment_provider: text(settings?.provider || "manual_transfer"),
      payment_configured: settings?.enabled !== false && !!validPaymentUrl(settings?.payment_url, text(settings?.provider)),
      email_configured: !!text(Deno.env.get("RESEND_API_KEY")) && !!text(Deno.env.get("RESEND_FROM_EMAIL")),
    });
  }
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  try {
    const body = await req.json();
    if (text(body?.website)) return json(req, { error: "invalid_request" }, 400);
    const customer = body?.customer || {};
    const fullName = clean(customer?.name);
    const email = text(customer?.email).toLowerCase();
    const phone = text(customer?.phone).slice(0, 40);
    const address1 = clean(customer?.address1);
    const address2 = clean(customer?.address2).slice(0, 100);
    const city = clean(customer?.city);
    const region = clean(customer?.region).slice(0, 100);
    const zip = clean(customer?.zip).slice(0, 24);
    const country = normalizeCountry(customer?.country);
    const items = Array.isArray(body?.items) ? body.items : [];
    const checkoutKey = text(body?.checkout_idempotency_key);
    const confirmationToken = text(body?.confirmation_token);
    const validationOnly = body?.validation_only === true;

    if (fullName.length < 2 || fullName.length > 120 || !validEmail(email) || !address1 || !city || !zip || country.length !== 2) return json(req, { error: "invalid_customer_or_address" }, 400);
    if (country === "US" && phone.replace(/\D/g, "").length < 7) return json(req, { error: "phone_required_for_destination", country: "US" }, 400);
    if (!items.length || items.length > MAX_ITEMS) return json(req, { error: "invalid_cart" }, 400);
    if (!validationOnly && (!/^[A-Za-z0-9_-]{20,100}$/.test(checkoutKey) || confirmationToken.length < 32 || confirmationToken.length > 200)) return json(req, { error: "invalid_checkout_token" }, 400);

    const tokenHash = validationOnly ? "" : await sha256(confirmationToken);
    const { data: existing } = validationOnly ? { data: null } : await sb.from("shop_orders").select("id,status,subtotal_cents,shipping_cents,total_cents,shipping_method,payment_reference,payment_provider,payment_request_url,payment_request_expires_at,confirmation_token_hash,order_confirmation_notified_at,merchant_order_notified_at,merchant_order_notification_error,customer_name,customer_email,line_items,created_at").eq("checkout_idempotency_key", checkoutKey).maybeSingle();
    if (existing) {
      if (text(existing.confirmation_token_hash) !== tokenHash) return json(req, { error: "idempotency_conflict" }, 409);
      const merchantNotice = existing.merchant_order_notified_at ? { sent: false, already_sent: true, skipped: true } : await notifyMerchantNewOrder(sb, existing);
      return json(req, { ok: true, order_id: existing.id, status: existing.status, subtotal_cents: existing.subtotal_cents, shipping_cents: existing.shipping_cents, total_cents: existing.total_cents, shipping_method: existing.shipping_method, payment_reference: existing.payment_reference, payment_provider: existing.payment_provider, payment_url: existing.payment_request_url || "", payment_expires_at: existing.payment_request_expires_at || null, confirmation_token: confirmationToken, confirmation_email_sent: !!existing.order_confirmation_notified_at, merchant_order_email_sent: !!(existing.merchant_order_notified_at || merchantNotice.sent), replayed: true });
    }

    const { data: cache, error: cacheError } = await sb.from("shop_catalog_cache_v828").select("payload,generated_at,last_error").eq("id", 1).maybeSingle();
    if (cacheError || !Array.isArray(cache?.payload?.products) || !cache.payload.products.length) throw new Error("Live Printify catalog is not ready");
    const resolved = items.map((item: any) => ({ raw: item, cached: cachedResolution(cache.payload, item) }));
    if (resolved.some((row: any) => !row.cached)) throw new Error("One or more selected variants are no longer in the live catalog");
    const shopId = cachedShopId(cache.payload, resolved.map((row: any) => row.cached?.product).filter(Boolean));

    // Clone-free routing: customer-facing products stay singular in Printify.
    // Approved alternate providers are quoted directly by blueprint/provider/variant.
    const sourceProductIds = [...new Set(resolved.map((row: any) => text(row.cached.product.id)).filter(Boolean))];
    const { data: routeRows, error: routeError } = await sb
      .from("shop_provider_routes_v1")
      .select("approval_id,approved,countries,source_product_id,source_variant_id,source_blueprint_id,source_print_provider_id,target_print_provider_id,estimated_import_cents_per_unit,source_cost_usd_cents,target_cost_usd_cents,cost_delta_usd_cents,cost_snapshot_at")
      .eq("approved", true)
      .contains("countries", [country])
      .in("source_product_id", sourceProductIds);
    if (routeError) console.warn("Approved direct provider routes unavailable", routeError.message);
    const providerRoutes: any[] = routeError ? [] : (Array.isArray(routeRows) ? routeRows : []);
    const printifyToken = await resolvePrintifyToken(sb);
    const fx = await resolveUsdEurRate(sb);

    const freshProducts = new Map<string, any>();
    const sourceEntries = await mapWithConcurrency(sourceProductIds, 4, async (productId: string) => {
      if (!/^[a-zA-Z0-9_-]{8,80}$/.test(productId)) throw new Error("Invalid Printify product id");
      return [productId, await printify(printifyToken, `/shops/${shopId}/products/${encodeURIComponent(productId)}.json`)] as const;
    });
    sourceEntries.forEach(([productId, product]) => freshProducts.set(productId, product));

    const providerCatalogs = new Map<string, any>();
    const providerKeys = [...new Set(providerRoutes.map((route: any) => `${Number(route?.source_blueprint_id)}:${Number(route?.target_print_provider_id)}`))];
    const catalogEntries = await mapWithConcurrency(providerKeys, 4, async (key: string) => {
      const [blueprintId, providerId] = key.split(":").map(Number);
      if (!Number.isInteger(blueprintId) || blueprintId <= 0 || !Number.isInteger(providerId) || providerId <= 0) return [key, null] as const;
      try {
        return [key, await printify(printifyToken, `/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`)] as const;
      } catch (error) {
        console.warn("Ignoring unavailable direct provider catalog", key, error instanceof Error ? error.message.slice(0, 180) : "unknown");
        return [key, null] as const;
      }
    });
    catalogEntries.forEach(([key, payload]) => providerCatalogs.set(key, payload));

    const authoritative: any[] = [];
    const candidateGroups: any[][] = [];
    let subtotalCents = 0;
    for (const row of resolved) {
      const raw = row.raw;
      const cachedVariant = row.cached.variant;
      const productId = text(row.cached.product.id);
      const freshProduct = freshProducts.get(productId);
      const variantId = Number(cachedVariant.id);
      const freshVariant = (Array.isArray(freshProduct?.variants) ? freshProduct.variants : []).find((v: any) => Number(v?.id) === variantId);
      const qtyRaw = Number(raw?.qty || 0);
      const qty = Math.floor(qtyRaw);
      if (!Number.isFinite(qtyRaw) || qty < 1 || qty > MAX_QTY) throw new Error("Invalid quantity");
      if (!freshVariant || freshVariant?.is_enabled === false || freshVariant?.is_available === false || !isCustomerVariantAllowed(freshProduct, freshVariant)) throw new Error(`Selected variant is unavailable: ${clean(row.cached.product.name)}`);
      const color = colorFromVariant(freshProduct, freshVariant) || "White";
      const variantSize = sizeFromVariant(freshProduct, freshVariant) || text(cachedVariant.size).toUpperCase();
      const unit = String(freshProduct?.blueprint_id || "") === "6"
        ? stableClassicShirtRetailEurCents(
            freshVariant?.cost,
            fx,
            variantSize,
            MARGIN_CENTS,
            LARGE_SIZE_MARGIN_CENTS,
          )
        : isShirtProduct(freshProduct)
          ? retailEurCentsFromUsdCostAfterVat(
              freshVariant?.cost,
              fx,
              marginEurCentsForSize(variantSize, MARGIN_CENTS, LARGE_SIZE_MARGIN_CENTS),
            )
          : retailEurCentsFromUsdCost(
              freshVariant?.cost,
              fx,
              marginEurCentsForSize(variantSize, MARGIN_CENTS, LARGE_SIZE_MARGIN_CENTS),
            );
      if (!unit) throw new Error(`Invalid authoritative production cost: ${clean(row.cached.product.name)}`);
      const size = isToteProduct(freshProduct) ? `${color} handles` : variantSize;
      subtotalCents += unit * qty;
      authoritative.push({
        name: clean(freshProduct?.title || row.cached.product.name), size, sku: text(freshVariant?.sku), qty,
        unit_price_cents: unit, printify_product_id: productId, printify_variant_id: variantId,
        image: text(raw?.image || row.cached.product.image), collection: text(row.cached.product.collection), color,
      });
      const sourceFulfillmentCostCents = usdCentsToEurCents(freshVariant.cost, fx);
      const candidates: any[] = [{
        product_id: productId,
        variant_id: variantId,
        quantity: qty,
        cost_cents: sourceFulfillmentCostCents,
        source_cost_cents: Math.round(Number(freshVariant.cost)),
        source_currency: PRINTIFY_SOURCE_CURRENCY,
        mapping_approval_id: "",
        blueprint_id: Number(freshProduct?.blueprint_id),
        print_provider_id: Number(freshProduct?.print_provider_id),
        estimated_import_cents_per_unit: estimatedImportAllowanceCentsPerUnit(
          country, Number(freshProduct?.blueprint_id), Number(freshProduct?.print_provider_id), sourceFulfillmentCostCents,
        ),
      }];
      const itemProviderRoutes = providerRoutes.filter((entry: any) =>
        text(entry?.source_product_id) === productId && Number(entry?.source_variant_id) === variantId
      );
      for (const route of itemProviderRoutes) {
        const key = `${Number(route?.source_blueprint_id)}:${Number(route?.target_print_provider_id)}`;
        const providerVariant = catalogProviderVariant(providerCatalogs.get(key), variantId);
        const validation = validateDirectProviderRoute(route, country, freshProduct, freshVariant, providerVariant);
        if (!validation.ok) {
          console.warn("Ignoring unsafe direct Printify provider route", text(route?.approval_id), validation.reason);
          continue;
        }
        const directCostCents = usdCentsToEurCents(validation.cost_cents, fx);
        candidates.push({
          direct_provider: true,
          product_id: "",
          source_product_id: productId,
          variant_id: variantId,
          quantity: qty,
          cost_cents: directCostCents,
          source_cost_cents: validation.cost_cents,
          source_currency: PRINTIFY_SOURCE_CURRENCY,
          mapping_approval_id: text(route?.approval_id),
          blueprint_id: Number(route?.source_blueprint_id),
          print_provider_id: Number(route?.target_print_provider_id),
          estimated_import_cents_per_unit: Math.max(
            validation.estimated_import_cents_per_unit || 0,
            estimatedImportAllowanceCentsPerUnit(country, Number(route?.source_blueprint_id), Number(route?.target_print_provider_id), directCostCents),
          ),
        });
      }
      if (String(freshProduct?.blueprint_id || "") === "6") {
        // Keep checkout on the same canonical provider-pair basis as the public
        // catalog. Route rows store both sides of the provider pair; using those
        // snapshots prevents identical shirts from repricing based on which
        // provider happened to be the source product.
        const routeSnapshotCosts = itemProviderRoutes.flatMap((route: any) => [
          Number(route?.source_cost_usd_cents || 0),
          Number(route?.target_cost_usd_cents || 0),
        ]).filter((value: number) => Number.isFinite(value) && value > 0);
        const routeSafeRawUsdCost = routeSnapshotCosts.length
          ? Math.max(...routeSnapshotCosts)
          : Math.max(...candidates.map((candidate: any) => Number(candidate?.source_cost_cents || 0)));
        const routeSafeUnit = stableClassicShirtRetailEurCents(
          routeSafeRawUsdCost,
          fx,
          variantSize,
          MARGIN_CENTS,
          LARGE_SIZE_MARGIN_CENTS,
        );
        if (routeSafeUnit > unit) {
          subtotalCents += (routeSafeUnit - unit) * qty;
          authoritative[authoritative.length - 1].unit_price_cents = routeSafeUnit;
        }
      }
      candidateGroups.push(candidates);
    }
    if (subtotalCents <= 0 || subtotalCents > 1000000) throw new Error("Order total outside allowed range");

    const nm = splitName(fullName);
    const addressTo = { ...nm, email, phone, country, region, address1, address2, city, zip };
    const plans = buildFulfillmentPlans(candidateGroups, MAX_FULFILLMENT_PLANS);
    const quoteResults = await mapWithConcurrency(plans, 4, async (plan: any) => {
      const pfLineItems = plan.candidates.map((candidate: any, idx: number) => candidate?.direct_provider === true ? ({
        print_provider_id: candidate.print_provider_id,
        blueprint_id: candidate.blueprint_id,
        variant_id: candidate.variant_id,
        quantity: candidate.quantity,
        external_id: `${checkoutKey}-${idx + 1}`.slice(0, 100),
      }) : ({
        product_id: candidate.product_id,
        variant_id: candidate.variant_id,
        quantity: candidate.quantity,
        external_id: `${checkoutKey}-${idx + 1}`.slice(0, 100),
      }));
      try {
        const quote = await printify(printifyToken, `/shops/${shopId}/orders/shipping.json`, { method: "POST", body: JSON.stringify({ line_items: pfLineItems, address_to: addressTo }) });
        const sourceShipping = cheapestShippingQuote(quote);
        if (!sourceShipping) return null;
        const preVatShippingCents = usdCentsToEurCents(sourceShipping.cents, fx);
        const shipping = {
          ...sourceShipping,
          cents: applyPrintifyVatReserveEurCents(preVatShippingCents),
          pre_vat_cents: preVatShippingCents,
          source_cents: sourceShipping.cents,
          source_currency: PRINTIFY_SOURCE_CURRENCY,
        };
        return { plan, shipping, route_key: pfLineItems.map((item: any) => `${item.product_id}:${item.variant_id}`).join("|") };
      } catch (error) {
        console.warn("Printify fulfillment route was not shippable", error instanceof Error ? error.message.slice(0, 180) : "unknown");
        return null;
      }
    });
    const quotedPlans: any[] = quoteResults.filter(Boolean);
    const selected = chooseCheapestFulfillment(quotedPlans, country);
    if (!selected) throw new Error("No shipping method available for this address");
    const shippingMethod = selected.shipping.name;
    const shippingMethodCode = selected.shipping.code;
    const shippingCents = selected.shipping.cents;
    const shippingSourceCents = Math.max(0, Math.round(Number(selected.shipping.source_cents || 0)));
    const fulfillmentEstimatedImportCents = Math.max(0, Math.round(Number(selected.plan.estimated_import_cents || 0)));
    const fulfillmentProviderGroups = Math.max(1, Math.round(Number(selected.plan.provider_groups || 1)));
    const preVatShippingCents = Math.max(0, Math.round(Number(selected.shipping.pre_vat_cents ?? shippingCents)));
    const fulfillmentScoreCents = Math.round(Number(selected.plan.production_cents) + preVatShippingCents + fulfillmentEstimatedImportCents);
    authoritative.forEach((item, index) => {
      const route = selected.plan.candidates[index];
      const sourceProductId = item.printify_product_id;
      const sourceVariantId = item.printify_variant_id;
      item.catalog_printify_product_id = sourceProductId;
      item.catalog_printify_variant_id = sourceVariantId;
      item.printify_product_id = sourceProductId;
      item.printify_variant_id = sourceVariantId;
      item.fulfillment_cost_cents = route.cost_cents;
      item.fulfillment_source_cost_cents = route.source_cost_cents;
      item.fulfillment_source_currency = route.source_currency || PRINTIFY_SOURCE_CURRENCY;
      item.fulfillment_estimated_import_cents_per_unit = route.estimated_import_cents_per_unit || 0;
      item.fulfillment_route = route?.direct_provider === true ? {
        type: "direct_provider",
        approval_id: route.mapping_approval_id,
        source_product_id: sourceProductId,
        source_variant_id: sourceVariantId,
        blueprint_id: route.blueprint_id,
        print_provider_id: route.print_provider_id,
        estimated_import_cents_per_unit: route.estimated_import_cents_per_unit || 0,
      } : {
        type: "catalog_product",
        source_product_id: sourceProductId,
        source_variant_id: sourceVariantId,
        blueprint_id: route.blueprint_id,
        print_provider_id: route.print_provider_id,
      };
    });

    const totalCents = subtotalCents + shippingCents;
    if (validationOnly) {
      return json(req, {
        ok: true,
        validation_only: true,
        shop_id: String(shopId),
        subtotal_cents: subtotalCents,
        shipping_cents: shippingCents,
        total_cents: totalCents,
        shipping_method: shippingMethod,
        shipping_method_code: shippingMethodCode,
        item_count: authoritative.length,
        units: authoritative.reduce((sum: number, item: any) => sum + Number(item.qty || 0), 0),
        pricing: "shirt-production-cost-plus-max-printify-vat-plus-size-margin-rounded-up",
      });
    }
    const orderId = crypto.randomUUID();
    const reference = `BRUIS-${orderId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const { data: settings } = await sb.from("shop_payment_settings").select("provider,payment_url,enabled,payment_instructions").eq("id", 1).maybeSingle();
    const payment = settings?.enabled === false ? { provider: "manual_transfer", url: "", token: "", expires_at: null } : await createPaymentRequest(settings || {}, totalCents, reference);

    const orderRow = {
      id: orderId, status: "pending", currency: "eur", subtotal_cents: subtotalCents, shipping_cents: shippingCents, tax_cents: 0, discount_cents: 0, total_cents: totalCents,
      shipping_method: shippingMethod, shipping_method_code: shippingMethodCode, shipping_source_currency: PRINTIFY_SOURCE_CURRENCY, shipping_source_cents: shippingSourceCents, fx_snapshot: fxAuditSnapshot(fx), line_items: authoritative, shipping_address: addressTo,
      fulfillment_estimated_import_cents: fulfillmentEstimatedImportCents, fulfillment_provider_groups: fulfillmentProviderGroups, fulfillment_score_cents: fulfillmentScoreCents,
      customer_email: email, customer_name: fullName, customer_phone: phone || null, payment_provider: payment.provider || "manual_transfer",
      payment_reference: reference, payment_request_token: payment.token || null, payment_request_url: payment.url || null, payment_request_expires_at: payment.expires_at,
      confirmation_token_hash: tokenHash, checkout_idempotency_key: checkoutKey, printify_shop_id: shopId,
    };
    const { error: insertError } = await sb.from("shop_orders").insert(orderRow);
    if (insertError) throw insertError;

    const payLine = payment.url ? `<p><a href="${htmlEscape(payment.url)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Pay order</a></p>` : "<p>The payment link is not configured yet. Your order is safely reserved as Pending.</p>";
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111"><h2>We received your Bruis order</h2><p>Hi ${htmlEscape(fullName)},</p><p>Your order <strong>${htmlEscape(reference)}</strong> is saved as <strong>Pending</strong>. We will only send it to production after the transfer has been manually verified.</p><p><strong>Total: ${money(totalCents)}</strong><br>Products: ${money(subtotalCents)}<br>Shipping: ${money(shippingCents)}<br>Payment reference: <strong>${htmlEscape(reference)}</strong></p>${payLine}<p>If you use bunq.me, enter exactly <strong>${money(totalCents)}</strong> and use <strong>${htmlEscape(reference)}</strong> as the description/reference.</p><p>You will receive another email as soon as your shipment is on the way.</p></div>`;
    const plain = `We received your Bruis order ${reference}.\nStatus: Pending\nTotal: ${money(totalCents)}\nShipping: ${money(shippingCents)}\nPayment reference: ${reference}\n${payment.url ? `Payment link: ${payment.url}\n` : ""}We only send the order to production after the transfer is manually verified. You will receive another email when the shipment is on the way.`;
    const mailed = await sendEmail(email, `Bruis order ${reference} received`, html, plain);
    if (mailed.ok) await sb.from("shop_orders").update({ order_confirmation_notified_at: new Date().toISOString(), notification_error: null, notification_error_at: null }).eq("id", orderId);
    else if (!mailed.skipped) await sb.from("shop_orders").update({ notification_error: mailed.error, notification_error_at: new Date().toISOString() }).eq("id", orderId);

    const merchantNotice = await notifyMerchantNewOrder(sb, { ...orderRow, id: orderId, payment_reference: reference });
    return json(req, { ok: true, order_id: orderId, status: "pending", subtotal_cents: subtotalCents, shipping_cents: shippingCents, total_cents: totalCents, shipping_method: shippingMethod, payment_reference: reference, payment_provider: payment.provider, payment_url: payment.url, payment_expires_at: payment.expires_at, confirmation_token: confirmationToken, confirmation_email_sent: !!mailed.ok, merchant_order_email_sent: !!merchantNotice.sent });
  } catch (error) {
    const detail = text(error instanceof Error ? error.message : error).slice(0, 400);
    console.error("shop-manual-checkout-v832 failed", error instanceof Error ? `${error.name}: ${detail}` : detail);
    return json(req, { error: "checkout_failed", detail: "We could not verify the order and shipping details. Please try again." }, 502);
  }
});
