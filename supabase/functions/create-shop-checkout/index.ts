import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  HttpError,
  assertAllowedOrigin,
  corsFor,
  dbRequest,
  jsonResponse,
  normalizeSize,
  safeError,
  stripeRequest,
} from "../_shared/shop.ts";

type CartInput = { id?: unknown; product_id?: unknown; size?: unknown; qty?: unknown; quantity?: unknown };

type VariantRow = {
  printify_product_id: string;
  printify_variant_id: number;
  title: string;
  size: string | null;
  color: string | null;
  retail_price_cents: number;
  enabled: boolean;
  available: boolean;
};

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, cors);

  try {
    assertAllowedOrigin(req);
    const payload = await req.json().catch(() => null);
    const rawItems: CartInput[] = Array.isArray(payload?.items) ? payload.items : [];
    if (!rawItems.length || rawItems.length > 25) throw new HttpError(400, "Cart is empty or too large");

    const grouped = new Map<string, { productId: string; size: string; quantity: number }>();
    for (const raw of rawItems) {
      const productId = String(raw.id ?? raw.product_id ?? "").trim();
      const size = normalizeSize(raw.size);
      const quantity = Math.floor(Number(raw.qty ?? raw.quantity ?? 0));
      if (!/^[a-zA-Z0-9_-]{6,80}$/.test(productId) || !size || !Number.isFinite(quantity) || quantity < 1 || quantity > 10) {
        throw new HttpError(400, "Invalid cart item");
      }
      const key = `${productId}::${size}`;
      const existing = grouped.get(key);
      const combined = (existing?.quantity || 0) + quantity;
      if (combined > 10) throw new HttpError(400, "Maximum quantity per size is 10");
      grouped.set(key, { productId, size, quantity: combined });
    }
    const items = [...grouped.values()];
    const productIds = [...new Set(items.map((item) => item.productId))];
    const inFilter = productIds.join(",");

    const products = await dbRequest(
      `shop_products?select=printify_product_id,title,active&printify_product_id=in.(${encodeURIComponent(inFilter)})`,
    ) as Array<{ printify_product_id: string; title: string; active: boolean }>;
    const productMap = new Map(products.map((row) => [row.printify_product_id, row]));

    const variants = await dbRequest(
      `shop_variants?select=printify_product_id,printify_variant_id,title,size,color,retail_price_cents,enabled,available&printify_product_id=in.(${encodeURIComponent(inFilter)})`,
    ) as VariantRow[];

    const resolved = items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product?.active) throw new HttpError(409, `Product ${item.productId} is not currently for sale`);
      const candidates = variants.filter((variant) =>
        variant.printify_product_id === item.productId &&
        variant.enabled && variant.available &&
        normalizeSize(variant.size) === item.size
      );
      if (!candidates.length) throw new HttpError(409, `${product.title} is unavailable in ${item.size}`);

      const preferred = candidates.filter((variant) => /(^|\b)(white|natural|off[- ]?white|ecru)(\b|$)/i.test(variant.color || variant.title));
      const choicePool = preferred.length ? preferred : candidates;
      const distinctVariantIds = new Set(choicePool.map((variant) => variant.printify_variant_id));
      if (distinctVariantIds.size !== 1) {
        throw new HttpError(409, `${product.title} has multiple variants for ${item.size}; the storefront needs a color choice before checkout`);
      }
      const variant = choicePool[0];
      return {
        productId: item.productId,
        productTitle: product.title,
        variantId: Number(variant.printify_variant_id),
        variantTitle: variant.title,
        size: item.size,
        color: variant.color,
        quantity: item.quantity,
        unitAmount: Number(variant.retail_price_cents),
      };
    });

    const currency = (Deno.env.get("SHOP_CURRENCY") || "eur").toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) throw new Error("SHOP_CURRENCY must be a 3-letter currency code");
    const subtotal = resolved.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
    const shippingCents = Math.max(0, Math.floor(Number(Deno.env.get("SHOP_SHIPPING_CENTS") || 0)));
    const orderId = crypto.randomUUID();

    await dbRequest("shop_orders", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: orderId,
        payment_status: "checkout_pending",
        fulfillment_status: "pending",
        currency,
        amount_subtotal_cents: subtotal,
        shipping_amount_cents: shippingCents,
        amount_total_cents: subtotal + shippingCents,
      }),
    });

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

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", `${Deno.env.get("SHOP_SUCCESS_URL") || "https://kalenel.nl/shop/?payment=success"}&session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", Deno.env.get("SHOP_CANCEL_URL") || "https://kalenel.nl/shop/?payment=cancelled");
    form.set("client_reference_id", orderId);
    form.set("metadata[order_id]", orderId);
    form.set("metadata[source]", "kalenel-shop");
    form.set("phone_number_collection[enabled]", "true");
    form.set("billing_address_collection", "auto");

    const countries = (Deno.env.get("SHOP_ALLOWED_COUNTRIES") || "NL,BE,DE,FR,LU,AT,DK,SE,FI,IE,ES,PT,IT,PL,CZ")
      .split(",").map((v) => v.trim().toUpperCase()).filter((v) => /^[A-Z]{2}$/.test(v));
    countries.forEach((country, index) => form.set(`shipping_address_collection[allowed_countries][${index}]`, country));

    resolved.forEach((item, index) => {
      form.set(`line_items[${index}][quantity]`, String(item.quantity));
      form.set(`line_items[${index}][price_data][currency]`, currency);
      form.set(`line_items[${index}][price_data][unit_amount]`, String(item.unitAmount));
      form.set(`line_items[${index}][price_data][product_data][name]`, `${item.productTitle} — ${item.size}`);
      form.set(`line_items[${index}][price_data][product_data][metadata][printify_product_id]`, item.productId);
      form.set(`line_items[${index}][price_data][product_data][metadata][printify_variant_id]`, String(item.variantId));
    });

    if (shippingCents > 0) {
      form.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
      form.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(shippingCents));
      form.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", currency);
      form.set("shipping_options[0][shipping_rate_data][display_name]", Deno.env.get("SHOP_SHIPPING_LABEL") || "Standard shipping");
    }
    if ((Deno.env.get("STRIPE_AUTOMATIC_TAX") || "false").toLowerCase() === "true") {
      form.set("automatic_tax[enabled]", "true");
    }
    if ((Deno.env.get("STRIPE_ALLOW_PROMO_CODES") || "false").toLowerCase() === "true") {
      form.set("allow_promotion_codes", "true");
    }

    let session: any;
    try {
      session = await stripeRequest("checkout/sessions", form, `shop-checkout-${orderId}`);
    } catch (error) {
      await dbRequest(`shop_orders?id=eq.${orderId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ payment_status: "checkout_failed", last_error: error instanceof Error ? error.message.slice(0, 1000) : "Stripe checkout failed" }),
      }).catch(() => null);
      throw error;
    }

    await dbRequest(`shop_orders?id=eq.${orderId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ stripe_checkout_session_id: session.id, payment_status: "checkout_open" }),
    });

    return jsonResponse({ url: session.url, order_id: orderId }, 200, cors);
  } catch (error) {
    const safe = safeError(error);
    return jsonResponse({ error: safe.message }, safe.status, cors);
  }
});
