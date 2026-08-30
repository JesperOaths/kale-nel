import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  dbRequest,
  jsonResponse,
  safeError,
  verifyPrintifySignature,
} from "../_shared/shop-v2.ts";

async function patchByPrintifyOrder(printifyOrderId: string, body: Record<string, unknown>) {
  return dbRequest(`shop_orders?printify_order_id=eq.${encodeURIComponent(printifyOrderId)}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const rawBody = await req.text();
  let eventId = "";
  try {
    if (!(await verifyPrintifySignature(rawBody, req.headers.get("x-pfy-signature")))) {
      return jsonResponse({ error: "Invalid Printify signature" }, 401);
    }
    const event = JSON.parse(rawBody);
    eventId = String(event?.id || "").trim();
    const eventType = String(event?.type || "unknown");
    const resource = event?.resource || {};
    const printifyOrderId = String(resource?.id || "").trim();
    if (!eventId || !printifyOrderId || String(resource?.type || "") !== "order") {
      return jsonResponse({ error: "Invalid Printify order event" }, 400);
    }

    const existing = await dbRequest(`shop_webhook_events?provider=eq.printify&event_id=eq.${encodeURIComponent(eventId)}&select=status`) as any[];
    if (existing?.[0]?.status === "processed") return jsonResponse({ received: true, duplicate: true });
    await dbRequest("shop_webhook_events?on_conflict=provider%2Cevent_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ provider: "printify", event_id: eventId, event_type: eventType, status: "processing", last_error: null }),
    });

    const data = resource?.data || {};
    const patch: Record<string, unknown> = {};
    if (eventType === "order:created") {
      patch.fulfillment_status = "printify_created";
      patch.printify_status = "created";
    } else if (eventType === "order:sent-to-production") {
      patch.fulfillment_status = "production_submitted";
      patch.printify_status = "sent_to_production";
    } else if (eventType === "order:updated") {
      const status = String(data?.status || "").trim();
      if (status) patch.printify_status = status;
      if (/in-production/i.test(status)) patch.fulfillment_status = "in_production";
      else if (/cancel/i.test(status)) patch.fulfillment_status = "cancelled";
    } else if (eventType === "order:shipment:created" || eventType === "order:shipment:delivered") {
      const rows = await dbRequest(`shop_orders?printify_order_id=eq.${encodeURIComponent(printifyOrderId)}&select=tracking`) as any[];
      const tracking = Array.isArray(rows?.[0]?.tracking) ? [...rows[0].tracking] : [];
      const carrier = data?.carrier || {};
      const item = {
        carrier: String(carrier?.code || ""),
        number: String(carrier?.tracking_number || ""),
        url: String(carrier?.tracking_url || ""),
        shipped_at: data?.shipped_at || null,
        delivered_at: data?.delivered_at || null,
      };
      if (item.number && !tracking.some((entry: any) => String(entry?.number || "") === item.number)) tracking.push(item);
      patch.tracking = tracking;
      if (eventType === "order:shipment:created") {
        patch.fulfillment_status = "shipped";
        patch.printify_status = "shipped";
      } else {
        patch.fulfillment_status = "delivered";
        patch.printify_status = "delivered";
        patch.fulfilled_at = data?.delivered_at || new Date().toISOString();
      }
    }

    if (Object.keys(patch).length) {
      const updated = await patchByPrintifyOrder(printifyOrderId, { ...patch, last_error: null }) as any[];
      if (!updated?.length) throw new Error(`Unknown Printify order ${printifyOrderId}`);
    }

    await dbRequest(`shop_webhook_events?provider=eq.printify&event_id=eq.${encodeURIComponent(eventId)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "processed", processed_at: new Date().toISOString(), last_error: null }),
    });
    return jsonResponse({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
    if (eventId) {
      await dbRequest(`shop_webhook_events?provider=eq.printify&event_id=eq.${encodeURIComponent(eventId)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "error", last_error: message }),
      }).catch(() => null);
    }
    const safe = safeError(error);
    return jsonResponse({ error: safe.message }, safe.status === 400 ? 400 : 500);
  }
});
