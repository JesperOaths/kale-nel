import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const PRINTIFY_BASE = "https://api.printify.com/v1";
const TIKKIE_URL = "https://api.abnamro.com/v2/tikkie/paymentrequests";
const MAX_ITEMS = 20;
const MAX_QTY = 10;
const ALLOWED_ORIGINS = new Set(["https://kalenel.nl", "https://www.kalenel.nl", "https://jesperoaths.github.io"]);
const text = (v: unknown) => String(v ?? "").trim();
const money = (cents: number) => `€${(Number(cents || 0) / 100).toFixed(2)}`;
const clean = (v: unknown) => text(v).replace(/\s+/g, " ");

function cors(req: Request) {
  const origin = text(req.headers.get("origin"));
  const allow = ALLOWED_ORIGINS.has(origin) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)
    ? origin
    : "https://kalenel.nl";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
}
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors(req) });
const normalizeCountry = (v: unknown) => text(v || "NL").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
function splitName(full: string) {
  const parts = clean(full).split(" ").filter(Boolean);
  return { first_name: parts[0] || "Customer", last_name: parts.slice(1).join(" ") || parts[0] || "Customer" };
}
function sizeFromVariant(v: any) {
  const m = clean(v?.title).toLowerCase().match(/(?:^|\s|\/|\|)(xs|s|m|l|xl|2xl|3xl|4xl|5xl)(?:$|\s|\/|\|)/i);
  return m ? m[1].toUpperCase() : "";
}
async function sha256(value: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function provider(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${PRINTIFY_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Kalenel-Manual-Shop/8.27",
      ...(init.headers || {}),
    },
  });
  const raw = await res.text();
  let payload: any = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
  if (!res.ok) throw new Error(`upstream_${res.status}:${text(payload?.message || payload?.error || raw).slice(0, 250)}`);
  return payload;
}

async function resolveProductionToken(supabase: any) {
  const envToken = text(Deno.env.get("PRINTIFY_API_TOKEN"));
  if (envToken) return envToken;
  const { data, error } = await supabase.rpc("get_printify_api_token_v815a");
  if (error || !text(data)) throw new Error("production_connection_missing");
  return text(data);
}

async function loadProducts(token: string, shopId: number) {
  const out: any[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const p = await provider(token, `/shops/${shopId}/products.json?limit=50&page=${page}`);
    const rows = Array.isArray(p?.data) ? p.data : [];
    out.push(...rows);
    const last = Number(p?.last_page || 0);
    if (!rows.length || rows.length < 50 || (last && page >= last)) break;
  }
  return out;
}

async function selectShopAndProducts(token: string) {
  const shops = await provider(token, "/shops.json");
  const rows = Array.isArray(shops) ? shops : [];
  if (!rows.length) throw new Error("no_production_shop");
  const configured = text(Deno.env.get("PRINTIFY_SHOP_ID"));
  if (configured) {
    const shop = rows.find((s: any) => String(s?.id) === configured);
    if (!shop) throw new Error("configured_production_shop_unavailable");
    return { shop, products: await loadProducts(token, Number(shop.id)) };
  }
  let best: { shop: any; products: any[] } | null = null;
  for (const shop of rows.slice(0, 12)) {
    const products = await loadProducts(token, Number(shop?.id));
    if (!best || products.length > best.products.length) best = { shop, products };
  }
  if (!best) throw new Error("no_production_shop");
  return best;
}

function findVariant(products: any[], item: any) {
  const sku = text(item?.sku);
  if (sku) {
    for (const p of products) {
      const v = (Array.isArray(p?.variants) ? p.variants : []).find((x: any) => text(x?.sku) === sku && x?.is_enabled !== false && x?.is_available !== false);
      if (v) return { product: p, variant: v };
    }
  }
  const name = clean(item?.name).toLowerCase();
  const size = clean(item?.size).toUpperCase();
  const product = products.find((p: any) => clean(p?.title).toLowerCase() === name);
  if (!product) return null;
  const variants = (Array.isArray(product?.variants) ? product.variants : []).filter((v: any) => v?.is_enabled !== false && v?.is_available !== false);
  const variant = variants.find((v: any) => sizeFromVariant(v) === size)
    || variants.find((v: any) => clean(v?.title).toUpperCase().includes(size))
    || variants[0];
  return variant ? { product, variant } : null;
}

const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
function validPaymentUrl(raw: unknown, providerName: string) {
  if (!text(raw)) return "";
  try {
    const u = new URL(text(raw));
    if (u.protocol !== "https:") return "";
    const host = u.hostname.toLowerCase();
    if (providerName === "bunq_me" && (host === "bunq.me" || host.endsWith(".bunq.me"))) return u.toString();
    if (providerName === "tikkie" && (host === "tikkie.me" || host.endsWith(".tikkie.me"))) return u.toString();
  } catch {}
  return "";
}

async function createPaymentRequest(settings: any, totalCents: number, reference: string) {
  const paymentProvider = text(settings?.provider || "manual_transfer");
  if (paymentProvider === "tikkie") {
    const apiKey = text(Deno.env.get("TIKKIE_API_KEY"));
    const appToken = text(Deno.env.get("TIKKIE_APP_TOKEN"));
    if (apiKey && appToken) {
      const expiry = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const res = await fetch(TIKKIE_URL, {
        method: "POST",
        headers: { "API-Key": apiKey, "X-App-Token": appToken, "Content-Type": "application/json" },
        body: JSON.stringify({ amountInCents: totalCents, description: `Bruis order ${reference}`.slice(0, 35), expiryDate: expiry, referenceId: reference }),
      });
      const raw = await res.text();
      let p: any = {};
      try { p = raw ? JSON.parse(raw) : {}; } catch {}
      if (res.ok && text(p?.url)) return { provider: "tikkie", url: text(p.url), token: text(p.paymentRequestToken), expires_at: p.expiryDate ? `${p.expiryDate}T23:59:59Z` : null };
      console.error("payment request failed", res.status, raw.slice(0, 250));
    }
  }
  return { provider: paymentProvider, url: validPaymentUrl(settings?.payment_url, paymentProvider), token: "", expires_at: null };
}

function htmlEscape(v: unknown) {
  return text(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
async function sendEmail(to: string, subject: string, html: string, plain: string) {
  const key = text(Deno.env.get("RESEND_API_KEY"));
  const from = text(Deno.env.get("RESEND_FROM_EMAIL"));
  if (!key || !from) return { ok: false, skipped: true, error: "Email service not configured" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text: plain }),
  });
  const raw = await res.text();
  return res.ok ? { ok: true, response: raw } : { ok: false, skipped: false, error: `Email service ${res.status}: ${raw.slice(0, 250)}` };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method === "GET") return json(req, { ok: true, mode: "manual-payment-v827", creates_orders: false, uses_shopify: false });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(req, { error: "server_not_configured" }, 503);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

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
    const { data: existing } = await supabase.from("shop_orders")
      .select("id,status,total_cents,payment_reference,payment_provider,payment_request_url,payment_request_expires_at,confirmation_token_hash")
      .eq("checkout_idempotency_key", checkoutKey).maybeSingle();
    if (existing) {
      if (text(existing.confirmation_token_hash) !== tokenHash) return json(req, { error: "idempotency_conflict" }, 409);
      return json(req, { ok: true, order_id: existing.id, status: existing.status, total_cents: existing.total_cents, payment_reference: existing.payment_reference, payment_provider: existing.payment_provider, payment_url: existing.payment_request_url || "", payment_expires_at: existing.payment_request_expires_at || null, confirmation_token: confirmationToken, replayed: true });
    }

    const productionToken = await resolveProductionToken(supabase);
    const { shop, products } = await selectShopAndProducts(productionToken);
    if (!shop?.id) throw new Error("no_production_shop");
    const shopId = Number(shop.id);
    const authoritative: any[] = [];
    let subtotalCents = 0;

    for (const raw of items) {
      const qty = Math.max(1, Math.min(MAX_QTY, Math.floor(Number(raw?.qty || 0))));
      if (!Number.isFinite(qty) || qty < 1) throw new Error("invalid_quantity");
      const found = findVariant(products, raw);
      if (!found) throw new Error(`variant_unavailable:${clean(raw?.name)} ${clean(raw?.size)}`);
      const sourcePrice = Number(found.variant?.price);
      const unit = Number.isFinite(sourcePrice) && sourcePrice > 0 ? Math.ceil(sourcePrice / 100) * 100 : 0;
      if (!unit) throw new Error(`invalid_price:${clean(raw?.name)}`);
      subtotalCents += unit * qty;
      authoritative.push({
        name: clean(found.product?.title), size: clean(raw?.size || sizeFromVariant(found.variant)), sku: text(found.variant?.sku), qty,
        unit_price_cents: unit, printify_product_id: text(found.product?.id), printify_variant_id: Number(found.variant?.id),
        image: text(raw?.image), collection: text(raw?.collection),
      });
    }
    if (subtotalCents <= 0 || subtotalCents > 1_000_000) throw new Error("order_total_outside_range");

    const nm = splitName(fullName);
    const addressTo = { ...nm, email, phone, country, region, address1, address2, city, zip };
    const lineItems = authoritative.map((i, idx) => ({ product_id: i.printify_product_id, variant_id: i.printify_variant_id, quantity: i.qty, external_id: `${checkoutKey}-${idx + 1}`.slice(0, 100) }));
    const shippingQuote = await provider(productionToken, `/shops/${shopId}/orders/shipping.json`, { method: "POST", body: JSON.stringify({ line_items: lineItems, address_to: addressTo }) });
    let shippingMethod = "standard", shippingMethodCode = 1, shippingCents = Number(shippingQuote?.standard);
    if (!Number.isFinite(shippingCents)) { shippingMethod = "economy"; shippingMethodCode = 4; shippingCents = Number(shippingQuote?.economy); }
    if (!Number.isFinite(shippingCents)) { shippingMethod = "priority"; shippingMethodCode = 2; shippingCents = Number(shippingQuote?.priority ?? shippingQuote?.express); }
    if (!Number.isFinite(shippingCents) || shippingCents < 0) throw new Error("shipping_unavailable");
    shippingCents = Math.round(shippingCents);

    const totalCents = subtotalCents + shippingCents;
    const orderId = crypto.randomUUID();
    const reference = `BRUIS-${orderId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const { data: settings } = await supabase.from("shop_payment_settings").select("provider,payment_url,enabled,payment_instructions").eq("id", 1).maybeSingle();
    const payment = settings?.enabled === false
      ? { provider: "manual_transfer", url: "", token: "", expires_at: null }
      : await createPaymentRequest(settings || {}, totalCents, reference);

    const row = {
      id: orderId, status: "pending", currency: "eur", subtotal_cents: subtotalCents, shipping_cents: shippingCents, tax_cents: 0, discount_cents: 0,
      total_cents: totalCents, shipping_method: shippingMethod, shipping_method_code: shippingMethodCode, line_items: authoritative, shipping_address: addressTo,
      customer_email: email, customer_name: fullName, customer_phone: phone || null, payment_provider: payment.provider || "manual_transfer",
      payment_reference: reference, payment_request_token: payment.token || null, payment_request_url: payment.url || null, payment_request_expires_at: payment.expires_at,
      confirmation_token_hash: tokenHash, checkout_idempotency_key: checkoutKey, printify_shop_id: shopId,
    };
    const { error: insertError } = await supabase.from("shop_orders").insert(row);
    if (insertError) throw insertError;

    const payLine = payment.url
      ? `<p><a href="${htmlEscape(payment.url)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Pay order</a></p>`
      : "<p>The payment link is not configured yet. Your order is safely reserved as Pending.</p>";
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111"><h2>We received your Bruis order</h2><p>Hi ${htmlEscape(fullName)},</p><p>Your order <strong>${htmlEscape(reference)}</strong> is saved as <strong>Pending</strong>. Production only starts after the transfer has been manually verified and approved.</p><p><strong>Total: ${money(totalCents)}</strong><br>Products: ${money(subtotalCents)}<br>Shipping: ${money(shippingCents)}<br>Payment reference: <strong>${htmlEscape(reference)}</strong></p>${payLine}<p>If you use bunq.me, enter exactly <strong>${money(totalCents)}</strong> and use <strong>${htmlEscape(reference)}</strong> as the description/reference.</p><p>You will receive another email as soon as your shipment is on the way.</p></div>`;
    const plain = `We received your Bruis order ${reference}.\nStatus: Pending\nTotal: ${money(totalCents)}\nShipping: ${money(shippingCents)}\nPayment reference: ${reference}\n${payment.url ? `Payment link: ${payment.url}\n` : ""}Production only starts after the transfer is manually verified and approved. You will receive another email when the shipment is on the way.`;
    const mailed = await sendEmail(email, `Bruis order ${reference} received`, html, plain);
    if (mailed.ok) await supabase.from("shop_orders").update({ order_confirmation_notified_at: new Date().toISOString() }).eq("id", orderId);
    else if (!mailed.skipped) await supabase.from("shop_orders").update({ last_error: mailed.error }).eq("id", orderId);

    return json(req, { ok: true, order_id: orderId, status: "pending", subtotal_cents: subtotalCents, shipping_cents: shippingCents, total_cents: totalCents, shipping_method: shippingMethod, payment_reference: reference, payment_provider: payment.provider, payment_url: payment.url, payment_expires_at: payment.expires_at, confirmation_token: confirmationToken, confirmation_email_sent: !!mailed.ok });
  } catch (error) {
    const detail = text(error instanceof Error ? error.message : error);
    console.error("shop-manual-checkout-v827 failed", detail);
    if (detail.startsWith("production_connection_missing")) return json(req, { error: "production_connection_unavailable", detail: "The production connection is not configured yet." }, 503);
    if (detail.startsWith("variant_unavailable")) return json(req, { error: "item_unavailable", detail: "One of the selected items or sizes is no longer available. Refresh the shop and try again." }, 409);
    if (detail.startsWith("shipping_unavailable")) return json(req, { error: "shipping_unavailable", detail: "No delivery method is available for this address." }, 422);
    if (detail.startsWith("upstream_")) return json(req, { error: "production_service_unavailable", detail: "The production service is temporarily unavailable. Please try again shortly." }, 503);
    return json(req, { error: "checkout_failed", detail: "The pending order could not be created. Please try again." }, 502);
  }
});
