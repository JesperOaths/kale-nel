import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  return new Response(JSON.stringify({
    ok: false,
    disabled: true,
    deprecated: true,
    error: "endpoint_disabled",
    detail: "Obsolete price writer disabled. Storefront and checkout pricing are calculated server-side from converted Printify production cost plus the approved EUR margin.",
    replacement: ["shop-catalog-v828", "shop-manual-checkout-v832"],
  }), { status: 410, headers });
});
