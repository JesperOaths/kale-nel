import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PRINTIFY_BASE = "https://api.printify.com/v1";
const MARGIN_CENTS = 500;
const RUN_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const MAX_PAGES = 100;

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

async function printify(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${PRINTIFY_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Kalenel-Price-Rule/1.1",
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { detail: raw.slice(0, 500) }; }
  if (!response.ok) {
    throw new Error(`Printify ${response.status} ${path}: ${text(payload?.error || payload?.message || payload?.detail || "request failed")}`);
  }
  return payload;
}

async function resolveToken(supabase: any) {
  const envToken = text(Deno.env.get("PRINTIFY_API_TOKEN"));
  if (envToken) return envToken;
  const { data, error } = await supabase.rpc("get_printify_api_token_v815a");
  if (error) throw new Error(`Printify token resolver failed: ${error.message || error}`);
  const token = text(data);
  if (!token) throw new Error("No Printify API token configured");
  return token;
}

function selectedShops(shops: any[]) {
  const configuredIds = text(Deno.env.get("PRINTIFY_SHOP_ID"))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configuredIds.length) return shops.filter((shop) => configuredIds.includes(String(shop?.id)));
  const shopify = shops.filter((shop) => /shopify/i.test(text(shop?.sales_channel)));
  return shopify.length ? shopify : shops.filter((shop) => text(shop?.sales_channel).toLowerCase() !== "disconnected");
}

async function listProducts(token: string, shopId: number) {
  const products: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await printify(token, `/shops/${shopId}/products.json?limit=50&page=${page}`);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    products.push(...rows);
    const lastPage = Number(payload?.last_page || 0);
    if (!rows.length || rows.length < 50 || (lastPage && page >= lastPage)) break;
  }
  return products;
}

function pricedVariants(product: any) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (!variants.length) return { variants: [], changed: 0, min: 0, max: 0 };
  const next = variants.map((variant: any) => {
    const cost = Number(variant?.cost);
    if (!Number.isFinite(cost) || cost < 0) {
      throw new Error(`Missing fulfillment cost for ${text(product?.title)} variant ${text(variant?.title || variant?.id)}`);
    }
    return {
      id: Number(variant?.id),
      price: Math.round(cost) + MARGIN_CENTS,
      is_enabled: variant?.is_enabled !== false,
    };
  });
  const changed = next.reduce((count: number, variant: any, index: number) => count + (Number(variants[index]?.price) !== variant.price ? 1 : 0), 0);
  const prices = next.filter((variant: any) => variant.is_enabled).map((variant: any) => variant.price);
  return {
    variants: next,
    changed,
    min: prices.length ? Math.min(...prices) : 0,
    max: prices.length ? Math.max(...prices) : 0,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_not_configured" }, 503);

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const { data: state, error: stateError } = await supabase
      .from("shop_price_rule_state")
      .select("next_run_at,last_completed_at,last_error")
      .eq("id", 1)
      .maybeSingle();
    if (stateError) throw stateError;

    const nextRunAt = state?.next_run_at ? Date.parse(state.next_run_at) : 0;
    if (nextRunAt && nextRunAt > Date.now()) {
      return json({ ok: true, skipped: true, reason: "not_due", nextRunAt: state.next_run_at, lastCompletedAt: state.last_completed_at || null, lastError: state.last_error || null });
    }

    await supabase.from("shop_price_rule_state").update({
      last_started_at: new Date().toISOString(),
      next_run_at: new Date(Date.now() + RUN_INTERVAL_MS).toISOString(),
      last_error: null,
    }).eq("id", 1);

    const token = await resolveToken(supabase);
    const shopsPayload = await printify(token, "/shops.json");
    const shops = selectedShops(Array.isArray(shopsPayload) ? shopsPayload : []);
    if (!shops.length) throw new Error("No connected Printify Shopify shop found");

    let changedProducts = 0;
    let changedVariants = 0;
    const results: any[] = [];
    const errors: any[] = [];

    for (const shop of shops) {
      const shopId = Number(shop?.id);
      if (!Number.isFinite(shopId)) continue;
      const products = await listProducts(token, shopId);

      for (const product of products) {
        try {
          if (product?.visible === false) continue;
          const pricing = pricedVariants(product);
          if (!pricing.variants.length) continue;

          if (pricing.changed > 0) {
            await printify(token, `/shops/${shopId}/products/${text(product?.id)}.json`, {
              method: "PUT",
              body: JSON.stringify({ variants: pricing.variants }),
            });
            await printify(token, `/shops/${shopId}/products/${text(product?.id)}/publish.json`, {
              method: "POST",
              body: JSON.stringify({ title: false, description: false, images: false, variants: true, tags: false, keyFeatures: false, shipping_template: false }),
            });
            changedProducts += 1;
            changedVariants += pricing.changed;
          }

          results.push({
            shopId,
            shop: text(shop?.title),
            salesChannel: text(shop?.sales_channel),
            productId: text(product?.id),
            title: text(product?.title),
            changedVariants: pricing.changed,
            minPrice: pricing.min / 100,
            maxPrice: pricing.max / 100,
          });
        } catch (error) {
          errors.push({ shopId, productId: text(product?.id), title: text(product?.title), error: text(error instanceof Error ? error.message : error).slice(0, 500) });
        }
      }
    }

    const completedAt = new Date().toISOString();
    const resultSummary = {
      marginEuros: MARGIN_CENTS / 100,
      shops: shops.map((shop: any) => ({ id: shop?.id, title: shop?.title, salesChannel: shop?.sales_channel })),
      changedProducts,
      changedVariants,
      errors,
      products: results,
    };

    await supabase.from("shop_price_rule_state").update({
      last_completed_at: completedAt,
      next_run_at: new Date(Date.now() + RUN_INTERVAL_MS).toISOString(),
      last_error: errors.length ? `${errors.length} product(s) failed` : null,
      changed_products: changedProducts,
      changed_variants: changedVariants,
      last_result: resultSummary,
    }).eq("id", 1);

    return json({ ok: errors.length === 0, completedAt, ...resultSummary }, errors.length ? 207 : 200);
  } catch (error) {
    const message = text(error instanceof Error ? error.message : error).slice(0, 1000);
    await supabase.from("shop_price_rule_state").update({ next_run_at: new Date(Date.now() + RETRY_MS).toISOString(), last_error: message }).eq("id", 1);
    console.error("shop-price-rule-v819 failed", error);
    return json({ error: "price_rule_failed", detail: message }, 502);
  }
});