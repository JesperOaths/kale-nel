import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// v874 retirement guard. This legacy endpoint must never regain catalog or
// checkout authority; callers should migrate to shop-manual-checkout-v832.
const headers={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
  "Cache-Control":"no-store",
  "Content-Type":"application/json; charset=utf-8"
};

Deno.serve((req: Request) => {
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers});
  return new Response(JSON.stringify({
    ok:false,
    error:"endpoint_retired",
    replacement:"shop-manual-checkout-v832",
    retired_by:"shop-cleanup-v874"
  }),{status:410,headers});
});
