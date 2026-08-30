import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  HttpError,
  assertAllowedOrigin,
  corsFor,
  dbRequest,
  jsonResponse,
  normalizeSize,
  safeError,
  sha256Hex,
  stripePost,
} from "../_shared/shop-v2.ts";

type CartInput = { id?: unknown; product_id?: unknown; size?: unknown; qty?: unknown; quantity?: unknown };
type ProductRow = { printify_product_id: string; title: string; currency: string; storefront_price_cents: number; active: boolean };
type VariantRow = {
  printify_product_id: string;
  printify_variant_id: number;
  title: string;
  size: string | null;
  color: string | null;
  storefront_price_cents: number;
  enabled: boolean;
  available: boolean;
  selected_for_storefront: boolean;
};

function configuredShippingCents() {
  const raw = Deno.env.get("SHOP_SHIPPING_CENTS");
  if (raw == null || raw.trim() === "") throw new Error("SHOP_SHIPPING_CENTS must be configured before checkout is activated");
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value) || value < 0 || value > 50000) throw new Error("SHOP_SHIPPING_CENTS is invalid");
  return value;
}

function checkoutReturnUrl(kind: "success" | "cancelled") {
  const base = new URL(Deno.env.get(kind === "success" ? "SHOP_SUCCESS_URL" : "SHOP_CANCEL_URL") || "https://kalenel.nl/shop/");
  base.searchParams.set("payment", kind);
  if (kind === "success") {
    base.searchParams.set("session_id", "__CHECKOUT_SESSION_ID__");
    return base.toString().replace("__CHECKOUT_SESSION_ID__", "{CHECKOUT_SESSION_ID}");
  }
  return base.toString();
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, cors);

  try {
    assertAllowedOrigin(req);
    const payload = await req.json().catch(() => null);
    const rawItems: CartInput[] = Array.isArray(payload?.items) ? payload.items : [];
    if (!rawItems.length || rawItems.length > 20) throw new HttpError(400, "Cart is empty or too large");

    const grouped = new Map<string, { productId: string; size: string; quantity: number }>();
    for (const raw of rawItems) {
      const productId = String(raw.id ?? raw.product_id ?? "").trim();
      const size = normalizeSize(raw.size);
      const quantity = Math.floor(Number(raw.qty ?? raw.quantity ?? 0));
      if (!/^[a-zA-Z0-9_-]{6,80}$/.test(productId) || !size || !Number.isFinite(quantity) || quantity < 1 || quantity > 9) {
        throw new HttpError(400, "Invalid cart item");
      }
      const key = `${productId}::${size}`;
      const existing = grouped.get(key);
      const combined = (existing?.quantity || 0) + quantity;
      if (combined > 9) throw new HttpError(400, "Maximum quantity per size is 9");
      grouped.set(key, { productId, size, quantity: combined });
    }

    const items = [...grouped.values()];
    const productIds = [...new Set(items.map((item) => item.productId))];
    const inFilter = productIds.map(encodeURIComponent).join(",");
    const products = await dbRequest(
      `shop_products?select=printify_product_id,title,currency,storefront_price_cents,active&printify_product_id=in.(${inFilter})`,
    ) as ProductRow[];
    const productMap = new Map(products.map((row) => [row.printify_product_id, row]));

    const variants = await dbRequest(
      `shop_variants?select=printify_product_id,printify_variant_id,title,size,color,storefront_price_cents,enabled,available,selected_for_storefront&printify_product_id=in.(${inFilter})&selected_for_storefront=eq.true&enabled=eq.true&available=eq.true`,
    ) as VariantRow[];

    const resolved = items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product?.active) throw new HttpError(409, "A product in your cart is not currently for sale");
      if (product.currency !== "eur") throw new Error(`Unsupported shop currency for ${product.printify_product_id}`);
      const candidates = variants.filter((variant) =>
        variant.printify_product_id === item.productId && normalizeSize(variant.size) === item.size
      );
      if (candidates.length !== 1) throw new HttpError(409, `${product.title} is not currently available in ${item.size}`);
      const variant = candidates[0];
      const unitAmount = Number(product.storefront_price_cents);
      if (!Number.isInteger(unitAmount) || unitAmount <= 0 || variant.storefront_price_cents !== unitAmount) {
        throw new Error(`Catalog price mismatch for ${product.printify_product_id}`);
      }
      return {
        productId: item.productId,
        productTitle: product.title,
        variantId: Number(variant.printify_variant_id),
        size: item.size,
        color: variant.color,
        quantity: item.quantity,
        unitAmount,
      };
    });

    const subtotal = resolved.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
    const maxOrder = Math.max(1000, Math.floor(Number(Deno.env.get("SHOP_MAX_ORDER_CENTS") || 75000)));
    if (subtotal < 1 || subtotal > maxOrder) throw new HttpError(409, "Order amount is outside the allowed checkout range");
    const shippingCents = configuredShippingCents();
    const total = subtotal + shippingCents;
    const orderId = crypto.randomUUID();
    const statusToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
    const statusTokenHash = await sha256Hex(statusToken);

    await dbRequest("shop_orders", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: orderId,
        status_token_hash: statusTokenHash,
        payment_status: "checkout_pending",
        fulfillment_status: "pending",
        currency: "eur",
        amount_subtotal_cents: subtotal,
        shipping_amount_cents: shippingCents,
        amount_total_cents: total,
        shipping_method: 1,
      }),
    });

    try {
      await dbRequest("shop_order_items", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(resolved.map((item) => ({
          order_id: orderId,
          printify_product_id: item.productId,
          printify_variant_id: item.variantId,
          title: item.productTitle,
          size: item.size,
          color: item.color,
          quantity: item.quantity,
          unit_amount_cents: item.unitAmount,
        }))),
      });
    } catch (error) {
      await dbRequest(`shop_orders?id=eq.${encodeURIComponent(orderId)}`, { method: "DELETE" }).catch(() => null);
      throw error;
    }

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", checkoutReturnUrl("success"));
    form.set("cancel_url", checkoutReturnUrl("cancelled"));
    form.set("client_reference_id", orderId);
    form.set("metadata[order_id]", orderId);
    form.set("metadata[source]", "kalenel-shop-v2");
    form.set("customer_creation", "always");
    form.set("phone_number_collection[enabled]", "true");
    form.set("billing_address_collection", "auto");

    const countries = (Deno.env.get("SHOP_ALLOWED_COUNTRIES") || "NL")
      .split(",").map((v) => v.trim().toUpperCase()).filter((v) => /^[A-Z]{2}$/.test(v));
    if (!countries.length || countries.length > 20) throw new Error("SHOP_ALLOWED_COUNTRIES is invalid");
    countries.forEach((country, index) => form.set(`shipping_address_collection[allowed_countries][${index}]`, country));

    resolved.forEach((item, index) => {
      form.set(`line_items[${index}][quantity]`, String(item.quantity));
      form.set(`line_items[${index}][price_data][currency]`, "eur");
      form.set(`line_items[${index}][price_data][unit_amount]`, String(item.unitAmount));
      form.set(`line_items[${index}][price_data][product_data][name]`, `${item.productTitle} — ${item.size}`);
      form.set(`line_items[${index}][price_data][product_data][metadata][printify_product_id]`, item.productId);
      form.set(`line_items[${index}][price_data][product_data][metadata][printify_variant_id]`, String(item.variantId));
    });

    if (shippingCents > 0) {
      form.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
      form.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(shippingCents));
      form.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "eur");
      form.set("shipping_options[0][shipping_rate_data][display_name]", Deno.env.get("SHOP_SHIPPING_LABEL") || "Standard shipping");
    }
    if ((Deno.env.get("STRIPE_AUTOMATIC_TAX") || "false").toLowerCase() === "true") form.set("automatic_tax[enabled]", "true");
    if ((Deno.env.get("STRIPE_ALLOW_PROMO_CODES") || "false").toLowerCase() === "true") form.set("allow_promotion_codes", "true");

    let session: any;
    try {
      session = await stripePost("checkout/sessions", form, `shop-checkout-v2-${orderId}`);
    } catch (error) {
      await dbRequest(`shop_orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ payment_status: "checkout_failed", last_error: error instanceof Error ? error.message.slice(0, 1000) : "Stripe checkout failed" }),
      }).catch(() => null);
      throw error;
    }

    await dbRequest(`shop_orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ stripe_checkout_session_id: session.id, payment_status: "checkout_open", last_error: null }),
    });

    return jsonResponse({ url: session.url, order_id: orderId, status_token: statusToken }, 200, cors);
  } catch (error) {
    const safe = safeError(error);
    return jsonResponse({ error: safe.message }, safe.status, cors);
  }
});
