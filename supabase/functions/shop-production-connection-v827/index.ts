import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const UPSTREAM = "https://api.printify.com/v1";
const ALLOWED_ORIGINS = new Set(["https://admin.kalenel.nl", "https://kalenel.nl", "https://www.kalenel.nl", "https://jesperoaths.github.io"]);
const text = (v: unknown) => String(v ?? "").trim();
function headers(req: Request) {
  const origin = text(req.headers.get("origin"));
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://admin.kalenel.nl";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
}
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headers(req) });

async function checkToken(token: string) {
  const response = await fetch(`${UPSTREAM}/shops.json`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "Kalenel-Connection/8.27" },
  });
  const raw = await response.text();
  let payload: any = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
  if (!response.ok) return { ok: false, status: response.status, count: 0 };
  const shops = Array.isArray(payload) ? payload : [];
  return { ok: shops.length > 0, status: response.status, count: shops.length };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method === "GET") return json(req, { ok: true, mode: "production-connection-v827", writes: false });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json(req, { error: "server_not_configured" }, 503);
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const body = await req.json();
    const adminToken = text(body?.admin_session_token);
    if (!adminToken) return json(req, { error: "unauthorized" }, 401);
    const { data: auth, error: authError } = await supabase.rpc("_require_valid_admin_session", { admin_session_token: adminToken });
    const valid = !authError && Array.isArray(auth) && auth.some((row: any) => row?.ok === true);
    if (!valid) return json(req, { error: "unauthorized" }, 401);

    const action = text(body?.action || "status");
    if (action === "status") {
      const { data: stored, error } = await supabase.rpc("get_printify_api_token_v815a");
      const token = !error ? text(stored) : "";
      if (!token) return json(req, { ok: true, configured: false, connected: false });
      const checked = await checkToken(token);
      return json(req, { ok: true, configured: true, connected: checked.ok, shop_count: checked.ok ? checked.count : 0 });
    }

    if (action === "save") {
      const apiToken = text(body?.api_token);
      if (apiToken.length < 20 || apiToken.length > 1000) return json(req, { error: "invalid_api_token", detail: "Enter a valid production API token." }, 400);
      const checked = await checkToken(apiToken);
      if (!checked.ok) return json(req, { error: "connection_rejected", detail: "The production service rejected this token. Create a new token and try again." }, 400);
      const { data, error } = await supabase.rpc("set_printify_api_token_v827", { admin_session_token: adminToken, api_token: apiToken });
      if (error || data !== true) return json(req, { error: "save_failed", detail: "The connection could not be saved." }, 500);
      return json(req, { ok: true, configured: true, connected: true, shop_count: checked.count });
    }

    return json(req, { error: "invalid_action" }, 400);
  } catch (error) {
    console.error("shop-production-connection-v827 failed", error);
    return json(req, { error: "connection_failed", detail: "The production connection could not be checked." }, 500);
  }
});
