import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(JSON.stringify({
  ok: false,
  error: "retired_use_current_checkout",
  detail: "This legacy checkout is retired. Use shop-manual-checkout-v832 so every order uses clone-free direct-provider routing.",
}), {
  status: 410,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
}));
