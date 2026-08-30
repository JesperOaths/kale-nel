import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  dbRequest,
  jsonResponse,
  printifyRequest,
  requiredEnv,
  safeError,
  splitName,
  verifyStripeSignature,
} from "../_shared/shop.ts";

async function retrieveSession(sessionId: string) {
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { authorization: `Bearer ${requiredEnv("STRIPE_SECRET_KEY")}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Could not retrieve Stripe session (${response.status})`);
  return data;
}

async function patchOrder(orderId: string, body: Record<string, unknown>) {
  return dbRequest(`shop_orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
}

function stripeShipping(session: any) {
  return session?.collected_information?.shipping_details || session?.shipping_details || null;
}

async function fulfillPaidSession(inputSession: any) {
  const session = stripeShipping(inputSession) ? inputSession : await retrieveSession(String(inputSession.id));
  const orderId = String(session?.metadata?.order_id || session?.client_reference_id || "").trim();
  if (!orderId) throw new Error("Paid Stripe session has no order_id metadata");

  const orders = await dbRequest(`shop_orders?id=eq.${encodeURIComponent(orderId)}&select=*`) as any[];
  const order = orders?.[0];
  if (!order) throw new Error(`Unknown shop order ${orderId}`);

  const shipping = stripeShipping(session);
  const customer = session?.customer_details || {};
  const address = shipping?.address || customer?.address || {};
  const customerName = String(shipping?.name || customer?.name || "Customer");
  const customerEmail = String(customer?.email || session?.customer_email || "");
  const customerPhone = String(customer?.phone || "");

  await patchOrder(orderId, {
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
    payment_status: "paid",
    amount_subtotal_cents: Number(session.amount_subtotal ?? order.amount_subtotal_cents ?? 0),
    amount_total_cents: Number(session.amount_total ?? order.amount_total_cents ?? 0),
    customer_email: customerEmail || null,
    customer_name: customerName || null,
    customer_phone: customerPhone || null,
    shipping_address: address && Object.keys(address).length ? address : null,
    paid_at: order.paid_at || new Date().toISOString(),
    last_error: null,
  });

  const lines = await dbRequest(
    `shop_order_items?order_id=eq.${encodeURIComponent(orderId)}&select=printify_product_id,printify_variant_id,quantity`,
  ) as Array<{ printify_product_id: string; printify_variant_id: number; quantity: number }>;
  if (!lines?.length) throw new Error("Paid order has no Printify line items");

  let printifyOrderId = order.printify_order_id ? String(order.printify_order_id) : "";
  if (!printifyOrderId) {
    const country = String(address?.country || "").toUpperCase();
    const address1 = String(address?.line1 || "");
    const city = String(address?.city || "");
    const zip = String(address?.postal_code || "");
    if (!customerEmail || !country || !address1 || !city || !zip) {
      throw new Error("Stripe payment is paid but the shipping address is incomplete for Printify");
    }
    const names = splitName(customerName);
    const sendNotification = (Deno.env.get("PRINTIFY_SEND_SHIPPING_NOTIFICATION") || "true").toLowerCase() === "true";
    const printifyOrder = await printifyRequest(
      `shops/${encodeURIComponent(requiredEnv("PRINTIFY_SHOP_ID"))}/orders.json`,
      {
        method: "POST",
        body: JSON.stringify({
          external_id: orderId,
          label: `KALENEL ${orderId.slice(0, 8)}`,
          line_items: lines.map((line) => ({
            product_id: line.printify_product_id,
            variant_id: Number(line.printify_variant_id),
            quantity: Number(line.quantity),
          })),
          shipping_method: 1,
          is_printify_express: false,
          is_economy_shipping: false,
          send_shipping_notification: sendNotification,
          address_to: {
            ...names,
            email: customerEmail,
            phone: customerPhone,
            country,
            region: String(address?.state || ""),
            address1,
            address2: String(address?.line2 || ""),
            city,
            zip,
          },
        }),
      },
    );
    printifyOrderId = String(printifyOrder?.id || "");
    if (!printifyOrderId) throw new Error("Printify accepted the request but returned no order ID");
    await patchOrder(orderId, {
      printify_order_id: printifyOrderId,
      printify_status: String(printifyOrder?.status || "created"),
      fulfillment_status: "printify_created",
      last_error: null,
    });
  }

  const autoProduction = (Deno.env.get("PRINTIFY_AUTO_PRODUCTION") || "false").toLowerCase() === "true";
  if (autoProduction && order.fulfillment_status !== "production_submitted") {
    await printifyRequest(
      `shops/${encodeURIComponent(requiredEnv("PRINTIFY_SHOP_ID"))}/orders/${encodeURIComponent(printifyOrderId)}/send_to_production.json`,
      { method: "POST", body: "{}" },
    );
    await patchOrder(orderId, {
      fulfillment_status: "production_submitted",
      printify_status: "sent_to_production",
      last_error: null,
    });
  }

  return orderId;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const rawBody = await req.text();
  try {
    const signatureOk = await verifyStripeSignature(rawBody, req.headers.get("stripe-signature"));
    if (!signatureOk) return jsonResponse({ error: "Invalid Stripe signature" }, 400);

    const event = JSON.parse(rawBody);
    const eventId = String(event?.id || "");
    const eventType = String(event?.type || "unknown");
    if (!eventId) return jsonResponse({ error: "Stripe event has no id" }, 400);

    const existing = await dbRequest(
      `shop_webhook_events?provider=eq.stripe&event_id=eq.${encodeURIComponent(eventId)}&select=status`,
    ) as any[];
    if (existing?.[0]?.status === "processed") return jsonResponse({ received: true, duplicate: true });

    await dbRequest("shop_webhook_events?on_conflict=provider%2Cevent_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ provider: "stripe", event_id: eventId, event_type: eventType, status: "processing", last_error: null }),
    });

    const session = event?.data?.object;
    if (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded") {
      if (session?.payment_status === "paid" || eventType === "checkout.session.async_payment_succeeded") {
        await fulfillPaidSession(session);
      } else {
        const orderId = String(session?.metadata?.order_id || session?.client_reference_id || "");
        if (orderId) await patchOrder(orderId, { payment_status: "processing" });
      }
    } else if (eventType === "checkout.session.async_payment_failed") {
      const orderId = String(session?.metadata?.order_id || session?.client_reference_id || "");
      if (orderId) await patchOrder(orderId, { payment_status: "failed", last_error: "Stripe asynchronous payment failed" });
    } else if (eventType === "checkout.session.expired") {
      const orderId = String(session?.metadata?.order_id || session?.client_reference_id || "");
      if (orderId) await patchOrder(orderId, { payment_status: "expired" });
    }

    await dbRequest(`shop_webhook_events?provider=eq.stripe&event_id=eq.${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "processed", processed_at: new Date().toISOString(), last_error: null }),
    });
    return jsonResponse({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed?.id) {
        await dbRequest(`shop_webhook_events?provider=eq.stripe&event_id=eq.${encodeURIComponent(String(parsed.id))}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status: "error", last_error: message }),
        });
        const orderId = String(parsed?.data?.object?.metadata?.order_id || parsed?.data?.object?.client_reference_id || "");
        if (orderId) await patchOrder(orderId, { fulfillment_status: "needs_attention", last_error: message }).catch(() => null);
      }
    } catch { /* keep Stripe retry response */ }
    const safe = safeError(error);
    return jsonResponse({ error: safe.message }, safe.status === 400 ? 400 : 500);
  }
});
