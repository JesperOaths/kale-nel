import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  HttpError,
  assertAllowedOrigin,
  corsFor,
  dbRequest,
  jsonResponse,
  safeError,
  sha256Hex,
  timingSafeEqual,
} from "../_shared/shop-v2.ts";

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405, cors);

  try {
    assertAllowedOrigin(req);
    const url = new URL(req.url);
    const orderId = String(url.searchParams.get("order") || "").trim();
    const token = String(url.searchParams.get("token") || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^[0-9a-f]{64}$/i.test(token)) throw new HttpError(400, "Invalid order status request");

    const rows = await dbRequest(
      `shop_orders?id=eq.${encodeURIComponent(orderId)}&select=id,status_token_hash,payment_status,fulfillment_status,currency,amount_total_cents,printify_status,tracking,created_at,paid_at,fulfilled_at,last_error`,
    ) as any[];
    const order = rows?.[0];
    if (!order) throw new HttpError(404, "Order not found");
    const suppliedHash = await sha256Hex(token);
    if (!timingSafeEqual(String(order.status_token_hash || ""), suppliedHash)) throw new HttpError(404, "Order not found");

    const paymentStatus = String(order.payment_status || "unknown");
    const fulfillmentStatus = String(order.fulfillment_status || "unknown");
    return jsonResponse({
      order_id: order.id,
      payment_status: paymentStatus,
      fulfillment_status: fulfillmentStatus,
      paid: paymentStatus === "paid",
      currency: order.currency,
      amount_total_cents: Number(order.amount_total_cents || 0),
      printify_status: order.printify_status || null,
      tracking: Array.isArray(order.tracking) ? order.tracking : [],
      created_at: order.created_at,
      paid_at: order.paid_at || null,
      fulfilled_at: order.fulfilled_at || null,
      needs_attention: fulfillmentStatus === "needs_attention",
    }, 200, cors);
  } catch (error) {
    const safe = safeError(error);
    return jsonResponse({ error: safe.message }, safe.status, cors);
  }
});
