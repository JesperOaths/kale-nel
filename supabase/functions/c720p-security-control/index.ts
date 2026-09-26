import postgres from "npm:postgres@3.4.7";

const DB_URL = Deno.env.get("SUPABASE_DB_URL");
if (!DB_URL) throw new Error("SUPABASE_DB_URL missing");
const sql = postgres(DB_URL, { max: 2, prepare: false, idle_timeout: 20 });
const BRIDGE_TOKEN_SHA256 = "f76c2ca6526b7d48c6f864e374898ebafca35720d0ffebe898d326f8741798ab";
const ALLOWED_ORIGINS = new Set(["https://kalenel.nl", "https://www.kalenel.nl", "https://admin.kalenel.nl"]);
const enc = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function hexBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("bad_secret");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
async function mint(secretHex: string): Promise<{token:string,expires_at:string}> {
  const now = Math.floor(Date.now() / 1000);
  const iat = now - 120;
  const exp = now + 15 * 60;
  const payload = enc.encode(JSON.stringify({ iat, exp, scope: "c720p-security-media-v1" }));
  const payloadPart = b64url(payload);
  const key = await crypto.subtle.importKey("raw", hexBytes(secretHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payloadPart)));
  return { token: `${payloadPart}.${b64url(sig)}`, expires_at: new Date(exp * 1000).toISOString() };
}
function cors(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://kalenel.nl";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-c720p-token",
    "access-control-allow-credentials": "false",
    "vary": "Origin",
    "cache-control": "no-store",
  };
}
function json(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors(origin), "content-type": "application/json; charset=utf-8" } });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ ok:false, error:"method_not_allowed" }, 405, origin);
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "session";
  try {
    if (action === "health") {
      const bridgeToken = req.headers.get("x-c720p-token") || "";
      if (!bridgeToken || !constEq(await sha256Hex(bridgeToken), BRIDGE_TOKEN_SHA256)) return json({ ok:false, error:"unauthorized" }, 401, origin);
      const body = await req.json().catch(() => null) as Record<string, unknown> | null;
      if (!body || Array.isArray(body)) return json({ ok:false, error:"invalid_health_payload" }, 400, origin);
      const encoded = JSON.stringify(body);
      if (encoded.length > 48000) return json({ ok:false, error:"health_payload_too_large" }, 413, origin);
      const observedRaw = String(body.observed_at || "").trim();
      const observed = observedRaw && !Number.isNaN(Date.parse(observedRaw)) ? new Date(observedRaw) : new Date();
      await sql`
        insert into c720p_security.health_latest(singleton,observed_at,received_at,source,payload)
        values(true,${observed.toISOString()}::timestamptz,now(),'c720p',${sql.json(body)})
        on conflict(singleton) do update set
          observed_at=excluded.observed_at,
          received_at=now(),
          source=excluded.source,
          payload=excluded.payload
      `;
      return json({ ok:true, received_at:new Date().toISOString() }, 200, origin);
    }

    if (action === "register") {
      const bridgeToken = req.headers.get("x-c720p-token") || "";
      if (!bridgeToken || !constEq(await sha256Hex(bridgeToken), BRIDGE_TOKEN_SHA256)) return json({ ok:false, error:"unauthorized" }, 401, origin);
      const body = await req.json().catch(() => null) as { tunnel_url?: unknown; hmac_secret?: unknown } | null;
      const tunnelUrl = String(body?.tunnel_url || "").trim().replace(/\/+$/, "");
      const secret = String(body?.hmac_secret || "").trim().toLowerCase();
      if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(tunnelUrl)) return json({ ok:false, error:"invalid_tunnel_url" }, 400, origin);
      if (!/^[0-9a-f]{64}$/i.test(secret)) return json({ ok:false, error:"invalid_secret" }, 400, origin);
      await sql`
        update c720p_security.control
           set tunnel_url=${tunnelUrl}, hmac_secret=${secret}, tunnel_updated_at=now(), updated_at=now()
         where singleton=true
      `;
      return json({ ok:true }, 200, origin);
    }

    if (action === "session") {
      if (!origin || !ALLOWED_ORIGINS.has(origin)) return json({ ok:false, error:"origin_denied" }, 403, origin);
      const body = await req.json().catch(() => null) as { admin_session_token?: unknown } | null;
      const adminToken = String(body?.admin_session_token || "").trim();
      if (adminToken.length < 20 || adminToken.length > 500) return json({ ok:false, error:"admin_session_required" }, 401, origin);
      const checkRows = await sql`select public.admin_check_session(${adminToken}) as data`;
      const checked = checkRows?.[0]?.data as Record<string, unknown> | undefined;
      if (!checked || checked.ok !== true) return json({ ok:false, error:"admin_session_invalid" }, 401, origin);
      const rows = await sql`select tunnel_url,hmac_secret,tunnel_updated_at from c720p_security.control where singleton=true`;
      const control = rows?.[0];
      const tunnelUrl = String(control?.tunnel_url || "");
      const secret = String(control?.hmac_secret || "");
      if (!tunnelUrl || !secret) return json({ ok:false, error:"camera_origin_offline" }, 503, origin);
      const media = await mint(secret);
      return json({
        ok:true,
        camera_origin:tunnelUrl,
        camera_token:media.token,
        camera_token_expires_at:media.expires_at,
        origin:tunnelUrl,
        media_token:media.token,
        expires_at:media.expires_at,
        admin_session_token: checked.admin_session_token || null,
        admin_username: checked.username || null,
        tunnel_updated_at: control?.tunnel_updated_at || null,
      }, 200, origin);
    }
    return json({ ok:false, error:"not_found" }, 404, origin);
  } catch (e) {
    console.error(e);
    return json({ ok:false, error:"internal" }, 500, origin);
  }
});
