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

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: headers(req) });

type TokenCheck = {
  ok: boolean;
  status: number;
  count: number;
  kind: "ok" | "unauthorized" | "forbidden" | "rate_limited" | "upstream_error" | "bad_response" | "no_shops" | "network_error";
};

async function checkToken(token: string): Promise<TokenCheck> {
  try {
    const response = await fetch(`${UPSTREAM}/shops.json`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Kalenel-Connection/8.28",
      },
    });

    const raw = await response.text();
    let payload: unknown = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }

    if (response.status === 401) return { ok: false, status: 401, count: 0, kind: "unauthorized" };
    if (response.status === 403) return { ok: false, status: 403, count: 0, kind: "forbidden" };
    if (response.status === 429) return { ok: false, status: 429, count: 0, kind: "rate_limited" };
    if (!response.ok) return { ok: false, status: response.status, count: 0, kind: "upstream_error" };
    if (!Array.isArray(payload)) return { ok: false, status: response.status, count: 0, kind: "bad_response" };
    if (payload.length === 0) return { ok: false, status: response.status, count: 0, kind: "no_shops" };
    return { ok: true, status: response.status, count: payload.length, kind: "ok" };
  } catch (error) {
    console.error("Printify token check network failure", error instanceof Error ? error.name : "unknown");
    return { ok: false, status: 0, count: 0, kind: "network_error" };
  }
}

function rejected(req: Request, checked: TokenCheck, tokenLength: number) {
  const received = ` Server received ${tokenLength} token characters.`;
  if (checked.kind === "unauthorized") {
    return json(req, {
      error: "printify_unauthorized",
      upstream_status: 401,
      token_length_received: tokenLength,
      detail: `Printify returned HTTP 401: this token was not accepted as a valid Personal Access Token. No token was saved.${received}`,
    }, 400);
  }
  if (checked.kind === "forbidden") {
    return json(req, {
      error: "printify_forbidden",
      upstream_status: 403,
      token_length_received: tokenLength,
      detail: `Printify returned HTTP 403: the token is not permitted to read this account's shops. Confirm shops.read is enabled for the token. No token was saved.${received}`,
    }, 400);
  }
  if (checked.kind === "rate_limited") {
    return json(req, {
      error: "printify_rate_limited",
      upstream_status: 429,
      token_length_received: tokenLength,
      detail: `Printify is rate-limiting connection checks (HTTP 429). The token was not classified as invalid and was not saved.${received}`,
    }, 429);
  }
  if (checked.kind === "no_shops") {
    return json(req, {
      error: "printify_no_shops",
      upstream_status: 200,
      token_length_received: tokenLength,
      detail: `Printify accepted the token (HTTP 200), but this account returned zero shops. The token itself is valid; connect or create a Printify shop for this account.${received}`,
    }, 400);
  }
  if (checked.kind === "bad_response") {
    return json(req, {
      error: "printify_bad_response",
      upstream_status: checked.status,
      token_length_received: tokenLength,
      detail: `Printify accepted the request but returned an unexpected response. The token was not classified as invalid and was not saved.${received}`,
    }, 502);
  }
  if (checked.kind === "network_error") {
    return json(req, {
      error: "printify_network_error",
      upstream_status: 0,
      token_length_received: tokenLength,
      detail: `The server could not reach Printify. The token was not classified as invalid and was not saved.${received}`,
    }, 502);
  }
  return json(req, {
    error: "printify_upstream_error",
    upstream_status: checked.status,
    token_length_received: tokenLength,
    detail: `Printify returned HTTP ${checked.status || "unknown"}. The token was not classified as invalid and was not saved.${received}`,
  }, 502);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method === "GET") return json(req, { ok: true, mode: "production-connection-v828", diagnostics: 4, writes: false });
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
      return json(req, {
        ok: true,
        configured: true,
        connected: checked.ok,
        shop_count: checked.ok ? checked.count : 0,
        connection_state: checked.kind,
        upstream_status: checked.status,
      });
    }

    if (action === "save") {
      const apiToken = text(body?.api_token);
      if (apiToken.length < 20 || apiToken.length > 4096) {
        return json(req, {
          error: "invalid_api_token",
          token_length_received: apiToken.length,
          detail: `Enter a valid production Personal Access Token (20-4096 characters). Server received ${apiToken.length} token characters.`,
        }, 400);
      }

      const checked = await checkToken(apiToken);
      if (!checked.ok) return rejected(req, checked, apiToken.length);

      const { data, error } = await supabase.rpc("set_printify_api_token_v828", {
        admin_session_token: adminToken,
        api_token: apiToken,
      });
      if (error || data !== true) {
        console.error("set_printify_api_token_v828 failed", error?.code || "rpc_false");
        return json(req, { error: "save_failed", detail: "Printify accepted the token, but the secure connection could not be saved." }, 500);
      }

      return json(req, {
        ok: true,
        configured: true,
        connected: true,
        shop_count: checked.count,
        upstream_status: checked.status,
      });
    }

    return json(req, { error: "invalid_action" }, 400);
  } catch (error) {
    console.error("shop-production-connection-v828 failed", error instanceof Error ? error.name : "unknown");
    return json(req, { error: "connection_failed", detail: "The production connection could not be checked." }, 500);
  }
});
