import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const PRINTIFY_BASE = "https://api.printify.com/v1";
const TIKKIE_URL = "https://api.abnamro.com/v2/tikkie/paymentrequests";
const MAX_ITEMS = 20;
const MAX_QTY = 10;
const ALLOWED_ORIGINS = new Set(["https://kalenel.nl", "https://www.kalenel.nl", "https://jesperoaths.github.io"]);
const text = (v: unknown) => String(v ?? "").trim();
const clean = (v: unknown) => text(v).replace(/\s+/g, " ");
const money = (cents: unknown) => `€${(Number(cents || 0) / 100).toFixed(2)}`;

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

async function printify(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${PRINTIFY_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "Kalenel-Manual-Shop/8.28", ...(init.headers || {}) },
  });
  const raw = await res.text();
  let payload: any = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
  if (!res.ok) throw new Error(`Printify ${res.status}: ${text(payload?.message || payload?.error || raw).slice(0, 350)}`);
  return payload;
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
function isWhiteVariant(product: any, variant: any) {
  const color = optionValues(product, variant).find(x => x.type === "color")?.value;
  return !color || /^white$/i.test(text(color));
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
    if (provider === "bunq_me" && (host === "bunq.me" || host.endsWith(".bunq.me"))) return u.toString();
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
  const from = text(Deno.env.get("RESEND_FROM_EMAIL"));
  if (!key || !from) return { ok: false, skipped: true, error: "Resend not configured" };
  const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, html, text: plain }) });
  const raw = await res.text();
  return res.ok ? { ok: true, skipped: false } : { ok: false, skipped: false, error: `Resend ${res.status}: ${raw.slice(0, 300)}` };
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
    return json(req, {
      ok: true,
      mode: "manual-payment-v828",
      creates_pending_orders: true,
      sends_to_production: false,
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

    if (fullName.length < 2 || fullName.length > 120 || !validEmail(email) || !address1 || !city || !zip || country.length !== 2) return json(req, { error: "invalid_customer_or_address" }, 400);
    if (!items.length || items.length > MAX_ITEMS) return json(req, { error: "invalid_cart" }, 400);
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(checkoutKey) || confirmationToken.length < 32 || confirmationToken.length > 200) return json(req, { error: "invalid_checkout_token" }, 400);

    const tokenHash = await sha256(confirmationToken);
    const { data: existing } = await sb.from("shop_orders").select("id,status,subtotal_cents,shipping_cents,total_cents,shipping_method,payment_reference,payment_provider,payment_request_url,payment_request_expires_at,confirmation_token_hash,order_confirmation_notified_at").eq("checkout_idempotency_key", checkoutKey).maybeSingle();
    if (existing) {
      if (text(existing.confirmation_token_hash) !== tokenHash) return json(req, { error: "idempotency_conflict" }, 409);
      return json(req, { ok: true, order_id: existing.id, status: existing.status, subtotal_cents: existing.subtotal_cents, shipping_cents: existing.shipping_cents, total_cents: existing.total_cents, shipping_method: existing.shipping_method, payment_reference: existing.payment_reference, payment_provider: existing.payment_provider, payment_url: existing.payment_request_url || "", payment_expires_at: existing.payment_request_expires_at || null, confirmation_token: confirmationToken, confirmation_email_sent: !!existing.order_confirmation_notified_at, replayed: true });
    }

    const { data: cache, error: cacheError } = await sb.from("shop_catalog_cache_v828").select("payload,generated_at,last_error").eq("id", 1).maybeSingle();
    if (cacheError || !Array.isArray(cache?.payload?.products) || !cache.payload.products.length) throw new Error("Live Printify catalog is not ready");
    const shopId = Number(cache.payload?.shop?.id);
    if (!Number.isFinite(shopId)) throw new Error("Printify shop id unavailable");

    const resolved = items.map((item: any) => ({ raw: item, cached: cachedResolution(cache.payload, item) }));
    if (resolved.some((row: any) => !row.cached)) throw new Error("One or more selected variants are no longer in the live catalog");

    const printifyToken = await resolvePrintifyToken(sb);
    const freshProducts = new Map<string, any>();
    for (const productId of [...new Set(resolved.map((row: any) => text(row.cached.product.id)))]) {
      if (!/^[a-zA-Z0-9_-]{8,80}$/.test(productId)) throw new Error("Invalid Printify product id");
      freshProducts.set(productId, await printify(printifyToken, `/shops/${shopId}/products/${encodeURIComponent(productId)}.json`));
    }

    const authoritative: any[] = [];
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
      if (!freshVariant || freshVariant?.is_enabled === false || freshVariant?.is_available === false || !isWhiteVariant(freshProduct, freshVariant)) throw new Error(`Selected variant is unavailable: ${clean(row.cached.product.name)}`);
      const unit = Math.round(Number(freshVariant?.price));
      if (!Number.isFinite(unit) || unit <= 0) throw new Error(`Invalid authoritative price: ${clean(row.cached.product.name)}`);
      const size = sizeFromVariant(freshProduct, freshVariant) || text(cachedVariant.size).toUpperCase();
      subtotalCents += unit * qty;
      authoritative.push({
        name: clean(freshProduct?.title || row.cached.product.name), size, sku: text(freshVariant?.sku), qty,
        unit_price_cents: unit, printify_product_id: productId, printify_variant_id: variantId,
        image: text(raw?.image || row.cached.product.image), collection: text(row.cached.product.collection), color: "White",
      });
    }
    if (subtotalCents <= 0 || subtotalCents > 1000000) throw new Error("Order total outside allowed range");

    const nm = splitName(fullName);
    const addressTo = { ...nm, email, phone, country, region, address1, address2, city, zip };
    const pfLineItems = authoritative.map((i, idx) => ({ product_id: i.printify_product_id, variant_id: i.printify_variant_id, quantity: i.qty, external_id: `${checkoutKey}-${idx + 1}`.slice(0, 100) }));
    const shippingQuote = await printify(printifyToken, `/shops/${shopId}/orders/shipping.json`, { method: "POST", body: JSON.stringify({ line_items: pfLineItems, address_to: addressTo }) });
    let shippingMethod = "standard", shippingMethodCode = 1, shippingCents = Number(shippingQuote?.standard);
    if (!Number.isFinite(shippingCents)) { shippingMethod = "economy"; shippingMethodCode = 4; shippingCents = Number(shippingQuote?.economy); }
    if (!Number.isFinite(shippingCents)) { shippingMethod = "priority"; shippingMethodCode = 2; shippingCents = Number(shippingQuote?.priority ?? shippingQuote?.express); }
    if (!Number.isFinite(shippingCents) || shippingCents < 0) throw new Error("No shipping method available for this address");
    shippingCents = Math.round(shippingCents);

    const totalCents = subtotalCents + shippingCents;
    const orderId = crypto.randomUUID();
    const reference = `BRUIS-${orderId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const { data: settings } = await sb.from("shop_payment_settings").select("provider,payment_url,enabled,payment_instructions").eq("id", 1).maybeSingle();
    const payment = settings?.enabled === false ? { provider: "manual_transfer", url: "", token: "", expires_at: null } : await createPaymentRequest(settings || {}, totalCents, reference);

    const orderRow = {
      id: orderId, status: "pending", currency: "eur", subtotal_cents: subtotalCents, shipping_cents: shippingCents, tax_cents: 0, discount_cents: 0, total_cents: totalCents,
      shipping_method: shippingMethod, shipping_method_code: shippingMethodCode, line_items: authoritative, shipping_address: addressTo,
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
    if (mailed.ok) await sb.from("shop_orders").update({ order_confirmation_notified_at: new Date().toISOString() }).eq("id", orderId);
    else if (!mailed.skipped) await sb.from("shop_orders").update({ last_error: mailed.error }).eq("id", orderId);

    return json(req, { ok: true, order_id: orderId, status: "pending", subtotal_cents: subtotalCents, shipping_cents: shippingCents, total_cents: totalCents, shipping_method: shippingMethod, payment_reference: reference, payment_provider: payment.provider, payment_url: payment.url, payment_expires_at: payment.expires_at, confirmation_token: confirmationToken, confirmation_email_sent: !!mailed.ok });
  } catch (error) {
    const detail = text(error instanceof Error ? error.message : error).slice(0, 400);
    console.error("shop-manual-checkout-v828 failed", error instanceof Error ? error.name : "unknown");
    return json(req, { error: "checkout_failed", detail }, 502);
  }
});
