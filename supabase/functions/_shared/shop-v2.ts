export const SHOP_VERSION = "2026-08-30.2";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server secret/config: ${name}`);
  return value;
}

export function allowedOrigins(): string[] {
  return (Deno.env.get("SHOP_ALLOWED_ORIGINS") || "https://kalenel.nl,https://www.kalenel.nl")
    .split(",").map((v) => v.trim()).filter(Boolean);
}

export function corsFor(req: Request): HeadersInit {
  const origin = req.headers.get("origin") || "";
  const allowed = allowedOrigins();
  return {
    ...(allowed.includes(origin) ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-shop-sync-key",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "vary": "Origin",
  };
}

export function assertAllowedOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) throw new HttpError(403, "Origin is not allowed");
}

export function jsonResponse(body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...Object.fromEntries(new Headers(extra).entries()),
    },
  });
}

function serviceHeaders(extra: HeadersInit = {}) {
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    ...Object.fromEntries(new Headers(extra).entries()),
  };
}

export async function dbRequest(path: string, init: RequestInit = {}) {
  const base = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: serviceHeaders({ "content-type": "application/json", ...(init.headers || {}) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Database request failed (${response.status}): ${text.slice(0, 800)}`);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export async function stripePost(path: string, form: URLSearchParams, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${requiredEnv("STRIPE_SECRET_KEY")}`,
    "content-type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\//, "")}`, {
    method: "POST", headers, body: form.toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Stripe request failed (${response.status})`);
  return data;
}

export async function stripeGet(path: string) {
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\//, "")}`, {
    headers: { authorization: `Bearer ${requiredEnv("STRIPE_SECRET_KEY")}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Stripe request failed (${response.status})`);
  return data;
}

export async function printifyRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.printify.com/v1/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      authorization: `Bearer ${requiredEnv("PRINTIFY_API_TOKEN")}`,
      "content-type": "application/json;charset=utf-8",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data?.message || data?.error || `Printify request failed (${response.status})`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return data;
}

export function normalizeSize(value: unknown): string {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function normalizeColor(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

export function splitName(name: string) {
  const parts = String(name || "Customer").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first_name: parts[0] || "Customer", last_name: "-" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

export function safeCheckoutUrl(baseValue: string, params: Record<string, string>) {
  const url = new URL(baseValue);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStripeSignature(rawBody: string, header: string | null) {
  if (!header) return false;
  const parts = header.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || !signatures.length) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = await hmacHex(requiredEnv("STRIPE_WEBHOOK_SECRET"), `${timestamp}.${rawBody}`);
  return signatures.some((candidate) => timingSafeEqual(expected, candidate));
}

export async function verifyPrintifySignature(rawBody: string, header: string | null) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = `sha256=${await hmacHex(requiredEnv("PRINTIFY_WEBHOOK_SECRET"), rawBody)}`;
  return timingSafeEqual(expected, header.trim());
}

export function safeError(error: unknown) {
  if (error instanceof HttpError) return { status: error.status, message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  return { status: 500, message: "Shop backend error" };
}
