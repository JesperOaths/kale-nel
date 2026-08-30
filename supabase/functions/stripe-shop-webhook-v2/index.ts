import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  dbRequest,
  jsonResponse,
  printifyRequest,
  requiredEnv,
  safeError,
  splitName,
  stripeGet,
  verifyStripeSignature,
} from "../_shared/shop-v2.ts";

async function patchOrder(orderId: string, body: Record<string, unknown>, suffix = "") {
  return dbRequest(`shop_orders?id=eq.${encodeURIComponent(orderId)}${suffix}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
}

function stripeShipping(session: any) {
  return session?.collected_information?.shipping_details || session?.shipping_details || null;
}

async function retrieveSession(sessionId: string) {
  return stripeGet(`checkout/sessions/${encodeURIComponent(sessionId)}`);
}

async function fulfillPaidSession(inputSession: any, eventId: string) {
  const session = stripeShipping(inputSession) ? inputSession : await retrieveSession(String(inputSession.id));
  const orderId = String(session?.metadata?.order_id || session?.client_reference_id || "").trim();
  if (!orderId) throw new Error("Paid Stripe session has no order_id metadata");

  let orders = await dbRequest(`shop_orders?id=eq.${encodeURIComponent(orderId)}&select=*`) as any[];
  let order = orders?.[0];
  if (!order) throw new Error(`Unknown shop order ${orderId}`);
  if (order.stripe_checkout_session_id && order.stripe_checkout_session_id !== session.id) {
    throw new Error("Stripe session does not match the stored shop order");
  }

  const shipping = stripeShipping(session);
  const customer = session?.customer_details || {};
  const address = shipping?.address || customer?.address || {};
  const customerName = String(shipping?.name || customer?.name || "Customer");
  const customerEmail = String(customer?.email || session?.customer_email || "");
  const customerPhone = String(customer?.phone || "");
  if (String(session?.currency || order.currency || "").toLowerCase() !== "eur") throw new Error("Unexpected Stripe currency");

  const paidTotal = Number(session?.amount_total ?? 0);
  if (!Number.isInteger(paidTotal) || paidTotal !== Number(order.amount_total_cents)) {
    throw new Error(`Stripe paid total mismatch for ${orderId}`);
  }

  await patchOrder(orderId, {
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
    payment_status: "paid",
    customer_email: customerEmail || null,
    customer_name: customerName || null,
    customer_phone: customerPhone || null,
    shipping_address: address && Object.keys(address).length ? address : null,
    paid_at: order.paid_at || new Date().toISOString(),
    last_error: null,
  });

  orders = await dbRequest(`shop_orders?id=eq.${encodeURIComponent(orderId)}&select=*`) as any[];
  order = orders?.[0];
  if (!order) throw new Error(`Shop order disappeared after payment update ${orderId}`);

  const lines = await dbRequest(
    `shop_order_items?order_id=eq.${encodeURIComponent(orderId)}&select=id,printify_product_id,printify_variant_id,quantity`,
  ) as Array<{ id: string; printify_product_id: string; printify_variant_id: number; quantity: number }>;
  if (!lines?.length) throw new Error("Paid order has no Printify line items");

  let printifyOrderId = order.printify_order_id ? String(order.printify_order_id) : "";
  if (!printifyOrderId) {
    const claim = await patchOrder(orderId, {
      fulfillment_status: "fulfillment_claimed",
      fulfillment_claimed_at: new Date().toISOString(),
      fulfillment_claim_event_id: eventId,
      last_error: null,
    }, "&payment_status=eq.paid&printify_order_id=is.null&fulfillment_status=in.(pending,needs_attention)") as any[];

    if (!claim?.length) {
      const latest = await dbRequest(`shop_orders?id=eq.${encodeURIComponent(orderId)}&select=printify_order_id,fulfillment_status`) as any[];
      if (latest?.[0]?.printify_order_id) printifyOrderId = String(latest[0].printify_order_id);
      else if (latest?.[0]?.fulfillment_status === "fulfillment_claimed") return { orderId, claimedByAnotherEvent: true };
      else throw new Error("Could not claim paid order for Printify fulfillment");
    }
  }

  if (!printifyOrderId) {
    const country = String(address?.country || "").toUpperCase();
    const address1 = String(address?.line1 || "");
    const city = String(address?.city || "");
    const zip = String(address?.postal_code || "");
    if (!customerEmail || !country || !address1 || !city || !zip) {
      await patchOrder(orderId, { fulfillment_status: "needs_attention", last_error: "Paid order has incomplete shipping details" });
      throw new Error("Stripe payment is paid but the shipping address is incomplete for Printify");
    }

    const names = splitName(customerName);
    const sendNotification = (Deno.env.get("PRINTIFY_SEND_SHIPPING_NOTIFICATION") || "true").toLowerCase() === "true";
    try {
      const printifyOrder = await printifyRequest(
        `shops/${encodeURIComponent(requiredEnv("PRINTIFY_SHOP_ID"))}/orders.json`,
        {
          method: "POST",
          body: JSON.stringify({
            external_id: orderId,
            label: `KALENEL ${orderId.slice(0, 8)}`,
            line_items: lines.map((line, index) => ({
              product_id: line.printify_product_id,
              variant_id: Number(line.printify_variant_id),
              quantity: Number(line.quantity),
              external_id: `${orderId}:${index + 1}`,
            })),
            shipping_method: Number(order.shipping_method || 1),
            is_printify_express: Number(order.shipping_method || 1) === 3,
            is_economy_shipping: Number(order.shipping_method || 1) === 4,
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
      if (!printifyOrderId) throw new Error("Printify returned no order ID");
      await patchOrder(orderId, {
        printify_order_id: printifyOrderId,
        printify_status: String(printifyOrder?.status || "created"),
        fulfillment_status: "printify_created",
        last_error: null,
      });
    } catch (error) {
      await patchOrder(orderId, {
        fulfillment_status: "needs_attention",
        last_error: error instanceof Error ? error.message.slice(0, 1000) : "Printify order creation failed",
      }).catch(() => null);
      throw error;
    }
  }

  const latest = await dbRequest(`shop_orders?id=eq.${encodeURIComponent(orderId)}&select=fulfillment_status`) as any[];
  const autoProduction = (Deno.env.get("PRINTIFY_AUTO_PRODUCTION") || "false").toLowerCase() === "true";
  if (autoProduction && latest?.[0]?.fulfillment_status === "printify_created") {
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

  return { orderId, claimedByAnotherEvent: false };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const rawBody = await req.text();
  let eventId = "";
  try {
    if (!(await verifyStripeSignature(rawBody, req.headers.get("stripe-signature")))) {
      return jsonResponse({ error: "Invalid Stripe signature" }, 400);
    }
    const event = JSON.parse(rawBody);
    eventId = String(event?.id || "");
    const eventType = String(event?.type || "unknown");
    if (!eventId) return jsonResponse({ error: "Stripe event has no id" }, 400);

    const existing = await dbRequest(`shop_webhook_events?provider=eq.stripe&event_id=eq.${encodeURIComponent(eventId)}&select=status`) as any[];
    if (existing?.[0]?.status === "processed") return jsonResponse({ received: true, duplicate: true });

    await dbRequest("shop_webhook_events?on_conflict=provider%2Cevent_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ provider: "stripe", event_id: eventId, event_type: eventType, status: "processing", last_error: null }),
    });

    const session = event?.data?.object;
    if (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded") {
      if (session?.payment_status === "paid" || eventType === "checkout.session.async_payment_succeeded") {
        await fulfillPaidSession(session, eventId);
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
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "processed", processed_at: new Date().toISOString(), last_error: null }),
    });
    return jsonResponse({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
    if (eventId) {
      await dbRequest(`shop_webhook_events?provider=eq.stripe&event_id=eq.${encodeURIComponent(eventId)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "error", last_error: message }),
      }).catch(() => null);
    }
    const safe = safeError(error);
    return jsonResponse({ error: safe.message }, safe.status === 400 ? 400 : 500);
  }
});
