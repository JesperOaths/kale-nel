#!/usr/bin/env python3
from pathlib import Path

p = Path('cloudflare/workers/admin-gate/src/worker.js')
s = p.read_text()

old = "const ADMIN_BUILD = 'v771-security-custom-media-header';"
new = "const ADMIN_BUILD = 'v772-security-direct-origin-controls';"
if old not in s:
    raise SystemExit('v771 build marker missing')
s = s.replace(old, new, 1)

# Permit only the authenticated, narrowly-scoped camera control POST in addition
# to the existing auth endpoints. All other /security methods remain fail-closed.
old = "  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();\n  if (url.pathname === '/security/new-clips')"
new = "  const cameraControlPost = request.method === 'POST' && /^\\/security\\/(?:new|s3)\\/api\\/control$/.test(url.pathname);\n  if (request.method !== 'GET' && request.method !== 'HEAD' && !cameraControlPost) return methodNotAllowed();\n  if (url.pathname === '/security/new-clips')"
if old not in s:
    raise SystemExit('security method marker missing')
s = s.replace(old, new, 1)

# The session mint is still a tiny Supabase request. In addition to the opaque
# media session it returns a short-lived HMAC camera token and the strictly
# validated quick-tunnel origin. They are stored only in the AES-GCM HttpOnly
# Worker cookie and are never returned to browser JavaScript.
old = """  const mediaData = await mediaRes.json().catch(() => ({}));
  const mediaToken = String(mediaData?.media_token || '');
  const expiryMs = Date.parse(String(mediaData?.expires_at || ''));
  if (!mediaRes.ok || mediaData?.ok !== true ||
      mediaToken.length < 32 || mediaToken.length > 256 ||
      !Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
    return securityJson({ ok:false, error:'camera_origin_unavailable' }, 503);
  }

  const exp = Math.min(outer.exp, Math.floor(expiryMs / 1000), now() + SECURITY_MEDIA_TTL_SECONDS);
  if (exp <= now()) return securityJson({ ok:false, error:'security_session_expired' }, 401);
  const session = {
    kind: 'security-media',
    github: { id: String(outer.github?.id || ''), login: String(outer.github?.login || '') },
    mediaToken, iat: now(), exp
  };"""
new = """  const mediaData = await mediaRes.json().catch(() => ({}));
  const cameraOrigin = String(mediaData?.camera_origin || '').trim().replace(/\\/+$/, '');
  const cameraToken = String(mediaData?.camera_token || '').trim();
  const expiryMs = Date.parse(String(mediaData?.expires_at || ''));
  const cameraExpiryMs = Date.parse(String(mediaData?.camera_token_expires_at || mediaData?.expires_at || ''));
  if (!mediaRes.ok || mediaData?.ok !== true ||
      !/^https:\\/\\/[a-z0-9-]+\\.trycloudflare\\.com$/i.test(cameraOrigin) ||
      !/^[A-Za-z0-9_-]{16,1024}\\.[A-Za-z0-9_-]{32,256}$/.test(cameraToken) ||
      !Number.isFinite(expiryMs) || expiryMs <= Date.now() ||
      !Number.isFinite(cameraExpiryMs) || cameraExpiryMs <= Date.now()) {
    return securityJson({ ok:false, error:'camera_origin_unavailable' }, 503);
  }

  const exp = Math.min(outer.exp, Math.floor(expiryMs / 1000), Math.floor(cameraExpiryMs / 1000), now() + SECURITY_MEDIA_TTL_SECONDS);
  if (exp <= now()) return securityJson({ ok:false, error:'security_session_expired' }, 401);
  const session = {
    kind: 'security-media',
    github: { id: String(outer.github?.id || ''), login: String(outer.github?.login || '') },
    cameraOrigin, cameraToken, iat: now(), exp
  };"""
if old not in s:
    raise SystemExit('security media session marker missing')
s = s.replace(old, new, 1)

old = """  const token = String(media.mediaToken || '');
  return token.length >= 32 && token.length <= 512;"""
new = """  const origin = String(media.cameraOrigin || '');
  const token = String(media.cameraToken || '');
  return /^https:\\/\\/[a-z0-9-]+\\.trycloudflare\\.com$/i.test(origin) &&
    /^[A-Za-z0-9_-]{16,1024}\\.[A-Za-z0-9_-]{32,256}$/.test(token);"""
if old not in s:
    raise SystemExit('media validation marker missing')
s = s.replace(old, new, 1)

old = """    if (pathname === `${prefix}/api/events`) return `/${camera}/api/events`;
    if (pathname === `${prefix}/api/status`) return `/${camera}/api/status`;
    if (pathname === `${prefix}/live.mjpg`) return `/${camera}/live.mjpg`;"""
new = """    if (pathname === `${prefix}/api/events`) return `/${camera}/api/events`;
    if (pathname === `${prefix}/api/status`) return `/${camera}/api/status`;
    if (pathname === `${prefix}/api/controls`) return `/${camera}/api/controls`;
    if (pathname === `${prefix}/api/control`) return `/${camera}/api/control`;
    if (pathname === `${prefix}/live.mjpg`) return `/${camera}/live.mjpg`;"""
if old not in s:
    raise SystemExit('upstream path marker missing')
s = s.replace(old, new, 1)

start = s.index('function securityProxyTarget(upstreamPath) {')
end = s.index('\nfunction bytesToB64url(bytes) {', start)
replacement = r'''function securityProxyTarget(media, upstreamPath) {
  const origin = String(media?.cameraOrigin || '').replace(/\/+$/, '');
  const token = String(media?.cameraToken || '');
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(origin) ||
      !/^[A-Za-z0-9_-]{16,1024}\.[A-Za-z0-9_-]{32,256}$/.test(token)) return '';
  if (!/^\/(?:new|s3)\/(?:api\/(?:status|events|controls|control)|live\.mjpg|snap\/[A-Za-z0-9._%-]+|clip\/[A-Za-z0-9._%-]+)$/.test(String(upstreamPath || ''))) return '';
  const u = new URL(origin + upstreamPath);
  u.searchParams.set('token', token);
  return u.toString();
}
async function proxySecurityOrigin(request, media, upstreamPath) {
  const target = securityProxyTarget(media, upstreamPath);
  if (!target) return notFound();
  const upstreamHeaders = new Headers();
  for (const name of ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since']) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }
  let body;
  if (request.method === 'POST') {
    const text = await request.text();
    if (!text || text.length > 4096) return securityJson({ok:false,error:'bad_request'},400);
    try { JSON.parse(text); } catch { return securityJson({ok:false,error:'bad_request'},400); }
    upstreamHeaders.set('Content-Type','application/json');
    body = text;
  }
  let response;
  try {
    // The origin is a strict trycloudflare hostname minted into an encrypted
    // session. Refuse redirects so the HMAC query token can never leak onward.
    response = await fetch(target, { method: request.method, headers: upstreamHeaders, body, redirect: 'error' });
  } catch {
    return securityJson({ ok:false, error:'camera_origin_unavailable' }, 502);
  }
  if (response.status === 401 || response.status === 403) {
    return securityJson({ ok:false, error:'security_unlock_required' }, 401, true);
  }
  const headers = securityResponseHeaders();
  for (const name of ['Content-Type','Content-Length','Content-Range','Accept-Ranges','ETag','Last-Modified','Content-Disposition']) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, statusText: response.statusText, headers });
}'''
s = s[:start] + replacement + s[end:]
p.write_text(s)
