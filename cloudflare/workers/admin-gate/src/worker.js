const ADMIN_HOST = 'admin.kalenel.nl';
const PUBLIC_HOST = 'kalenel.nl';
const SESSION_COOKIE = '__Host-kalenel_admin_session';
const OAUTH_COOKIE = '__Host-kalenel_admin_oauth';
const ATTEMPT_COOKIE = '__Host-kalenel_admin_attempts';
const SECURITY_COOKIE = '__Secure-kalenel_security_session';
const SECURITY_MEDIA_COOKIE = '__Host-kalenel_security_media';
const SECURITY_MEDIA_TTL_SECONDS = 15 * 60;
const SUPABASE_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA';
const SECURITY_MEDIA_SESSION_URL = `${SUPABASE_URL}/functions/v1/c720p-security-media?action=session`;
const SECURITY_MEDIA_PROXY_URL = `${SUPABASE_URL}/functions/v1/c720p-security-relay`;
const SESSION_TTL_SECONDS = 30 * 60;
const OAUTH_TTL_SECONDS = 10 * 60;
const ATTEMPT_WINDOW_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 8;
const ADMIN_BUILD = 'v769-security-clock-skew-safe-relay';

const PROTECTED_PUBLIC_PATTERNS = [
  /^\/admin[^/]*\.html$/i,
  /^\/admin[-_][^/]*\.js$/i,
  /^\/admin\.js$/i,
  /^\/gejast-admin[^/]*\.js$/i,
  /^\/gejast-push-admin-source\.js$/i,
  /^\/drinks_admin\.html$/i,
  /^\/familie_admin\.html$/i,
  /^\/match_control\.html$/i,
  /^\/match_swap\.html$/i,
  /^\/[^/]*_vault\.html$/i,
  /^\/vault\.html$/i,
  /^\/familie\/admin\.html$/i,
  /^\/repo\/admin[^/]*\.html$/i,
  /^\/admin-dev\.html$/i,
  /^\/admin_v60_orig\.html$/i,
  /^\/[^/]*_orig\.html$/i,
  /^\/[^/]*\.(md|txt|sql|patch)$/i,
  /^\/mnt(?:\/|$)/i,
  /^\/deployment_forensics_v761(?:\/|$)/i,
  /^\/sql(?:\/|$)/i
];

const PUBLIC_ALLOWED = new Set([
  '/', '/index.html', '/home.html', '/login.html', '/request.html', '/activate.html', '/invite.html'
]);

export default {
  async fetch(request, env, ctx) {
    try {
      if (!isSafeRawUrl(request.url)) return notFound();
      const url = new URL(request.url);
      if (url.protocol === 'http:') {
        const target = new URL(url.toString());
        target.protocol = 'https:';
        return new Response(null, {
          status: 308,
          headers: secureHeaders({
            Location: target.toString(),
            'Cache-Control': 'no-store'
          })
        });
      }
      if (url.hostname === PUBLIC_HOST || url.hostname === `www.${PUBLIC_HOST}`) {
        return await handlePublicApex(request, env, url);
      }
      if (url.hostname !== ADMIN_HOST) return notFound();
      return await handleAdminHost(request, env, url);
    } catch (error) {
      return failClosed(error);
    }
  }
};

async function handlePublicApex(request, env, url) {
  if (!isSafePath(url.pathname)) return notFound();
  if (isSecurityPath(url.pathname)) return await handlePublicSecurity(request, env, url);
  if (!isProtectedPublicPath(url.pathname)) {
    const response = await fetch(request);
    return withPublicSecurityHeaders(response);
  }
  const target = new URL(url.pathname + url.search, `https://${ADMIN_HOST}`);
  return new Response(null, {
    status: 302,
    headers: secureHeaders({
      Location: target.toString(),
      'Cache-Control': 'no-store'
    })
  });
}


async function handlePublicSecurity(request, env, url) {
  if (url.pathname === '/security') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();
    return canonicalRedirect('/security/');
  }

  const outer = await readSignedCookie(request, env, SECURITY_COOKIE);
  if (!outer || outer.kind !== 'security-session' || outer.exp <= now() || !isAllowedGithubAccount(env, outer.github)) {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const target = new URL('/login', `https://${ADMIN_HOST}`);
      target.searchParams.set('return_to', securityPageReturnTo(url.pathname));
      return new Response(null, { status: 302, headers: secureHeaders({ Location: target.toString(), 'Cache-Control': 'no-store' }) });
    }
    return securityJson({ ok: false, error: 'github_session_required' }, 401);
  }

  if (url.pathname === '/security/auth/login') {
    if (request.method !== 'POST') return securityMethodNotAllowed('POST');
    return await securityInnerLogin(request, env, outer);
  }
  if (url.pathname === '/security/auth/logout') {
    if (request.method !== 'POST') return securityMethodNotAllowed('POST');
    const headers = securityResponseHeaders({ 'Content-Type': 'application/json; charset=utf-8' });
    headers.append('Set-Cookie', expireCookie(SECURITY_MEDIA_COOKIE));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();
  if (url.pathname === '/security/new-clips') return canonicalRedirect('/security/new-clips/');
  if (url.pathname === '/security/s3-clips') return canonicalRedirect('/security/s3-clips/');
  if (url.pathname === '/security/' || url.pathname === '/security/new-clips/' || url.pathname === '/security/s3-clips/') {
    return await serveSecurityAsset(request, env);
  }

  const media = await readEncryptedCookie(request, env, SECURITY_MEDIA_COOKIE);
  if (!validSecurityMediaSession(env, media, outer)) {
    return securityJson({ ok: false, error: 'security_unlock_required' }, 401, true);
  }

  const upstreamPath = securityUpstreamPath(url.pathname);
  if (!upstreamPath) return notFound();
  return await proxySecurityOrigin(request, media, upstreamPath);
}

async function handleAdminHost(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();
  if (!isSafePath(url.pathname)) return notFound();

  const canonical = canonicalAdminRedirectTarget(url);
  if (canonical) return canonicalRedirect(canonical);

  if (url.pathname === '/admin_security.html') {
    return new Response(null, {
      status: 302,
      headers: secureHeaders({
        Location: `https://${PUBLIC_HOST}/security/`,
        'Cache-Control': 'no-store'
      })
    });
  }

  if (url.pathname === '/logout') return logout(url);
  if (url.pathname === '/oauth/callback') return await oauthCallback(request, env, url);
  if (url.pathname === '/login' || url.pathname === '/login/') return await login(request, env, url);

  const session = await readSignedCookie(request, env, SESSION_COOKIE);
  if (!session || session.kind !== 'session' || session.exp <= now() || !isAllowedGithubAccount(env, session.github)) {
    return loginPage(url, 'session_required', 401);
  }

  const assetPath = adminAssetPath(url.pathname);
  return await serveProtectedAsset(request, env, assetPath);
}

function adminAssetPath(pathname) {
  return pathname === '/' ? '/admin.html' : pathname;
}

function canonicalAdminRedirectTarget(url) {
  if (url.hostname !== ADMIN_HOST) return '';
  if (url.pathname !== '/admin' && url.pathname !== '/admin/') return '';
  return `/admin.html${url.search || ''}`;
}

function canonicalizeAdminReturnTo(value) {
  const safe = sanitizeReturnTo(value) || '/admin.html';
  if (safe === '/admin' || safe === '/admin/') return '/admin.html';
  if (safe.startsWith('/admin?')) return `/admin.html${safe.slice('/admin'.length)}`;
  return safe;
}
function isSecurityPath(pathname) { return pathname === '/security' || pathname.startsWith('/security/'); }
function securityPageReturnTo(value) {
  const path = String(value || '').split('?', 1)[0];
  if (path === '/security/new-clips' || path === '/security/new-clips/') return '/security/new-clips/';
  if (path === '/security/s3-clips' || path === '/security/s3-clips/') return '/security/s3-clips/';
  return '/security/';
}
function isSecurityReturnTo(value) {
  const path = String(value || '').split('?', 1)[0];
  return path === '/security' || path === '/security/' ||
    path === '/security/new-clips' || path === '/security/new-clips/' ||
    path === '/security/s3-clips' || path === '/security/s3-clips/';
}

function canonicalRedirect(location) {
  return new Response(null, {
    status: 302,
    headers: secureHeaders({
      Location: location,
      'Cache-Control': 'no-store'
    })
  });
}

async function login(request, env, url) {
  requireEnv(env, ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'COOKIE_SECRET']);
  const attempts = await readAttemptCookie(request, env);
  if (attempts.count >= MAX_LOGIN_ATTEMPTS && attempts.resetAt > now()) {
    return plain('Too many login attempts. Try again later.', 429);
  }

  const returnTo = canonicalizeAdminReturnTo(url.searchParams.get('return_to'));
  const state = randomToken(24);
  const nonce = randomToken(24);
  const oauth = { kind: 'oauth', state, nonce, returnTo, exp: now() + OAUTH_TTL_SECONDS, used: false };
  const callback = `https://${ADMIN_HOST}/oauth/callback`;
  const github = new URL('https://github.com/login/oauth/authorize');
  github.searchParams.set('client_id', getGithubClientId(env));
  github.searchParams.set('redirect_uri', callback);
  github.searchParams.set('scope', 'read:user');
  github.searchParams.set('state', state);
  github.searchParams.set('allow_signup', 'false');

  const headers = secureHeaders({
    Location: github.toString(),
    'Cache-Control': 'no-store'
  });
  headers.append('Set-Cookie', await signedCookie(env, OAUTH_COOKIE, oauth, OAUTH_TTL_SECONDS, 'Lax')); 
  headers.append('Set-Cookie', await signedCookie(env, ATTEMPT_COOKIE, bumpAttempts(attempts), ATTEMPT_WINDOW_SECONDS));
  return new Response(null, { status: 302, headers });
}

async function oauthCallback(request, env, url) {
  requireEnv(env, ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'COOKIE_SECRET']);
  if (url.origin !== `https://${ADMIN_HOST}` || url.pathname !== '/oauth/callback') return notFound();
  const oauth = await readSignedCookie(request, env, OAUTH_COOKIE);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (!oauth || oauth.kind !== 'oauth' || oauth.exp <= now() || oauth.used || !constantTimeEqual(state, oauth.state) || !code || code.length > 256) {
    return clearOauthAndDeny('OAuth state mismatch or expired callback.');
  }

  const callback = `https://${ADMIN_HOST}/oauth/callback`;
  const tokenPayload = { code, redirect_uri: callback };
  tokenPayload[['client', 'id'].join('_')] = getGithubClientId(env);
  tokenPayload[['client', 'secret'].join('_')] = getGithubClientSecret(env);
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'kalenel-admin-worker' },
    body: JSON.stringify(tokenPayload)
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token || token.error) return clearOauthAndDeny('GitHub OAuth token exchange failed.');

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'kalenel-admin-worker' }
  });
  const github = await userRes.json().catch(() => ({}));
  if (!userRes.ok || !isAllowedGithubAccount(env, github)) return clearOauthAndDeny('GitHub account is not approved for this admin surface.');

  const session = {
    kind: 'session',
    github: { id: String(github.id || ''), login: String(github.login || '') },
    iat: now(),
    exp: now() + SESSION_TTL_SECONDS,
    nonce: oauth.nonce
  };
  const returnTo = canonicalizeAdminReturnTo(oauth.returnTo);
  const headers = secureHeaders({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  headers.append('Set-Cookie', await signedCookie(env, SESSION_COOKIE, session, SESSION_TTL_SECONDS));
  if (isSecurityReturnTo(returnTo)) {
    const securitySession = { ...session, kind: 'security-session' };
    headers.append('Set-Cookie', await signedDomainCookie(env, SECURITY_COOKIE, securitySession, SESSION_TTL_SECONDS, '/security/'));
  }
  headers.append('Set-Cookie', expireCookie(OAUTH_COOKIE));
  headers.append('Set-Cookie', expireCookie(ATTEMPT_COOKIE));
  return new Response(oauthCompletePage(returnTo), { status: 200, headers });
}

function logout(url) {
  const headers = secureHeaders({ Location: '/login?return_to=/admin.html', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', expireCookie(SESSION_COOKIE));
  headers.append('Set-Cookie', expireCookie(OAUTH_COOKIE));
  headers.append('Set-Cookie', expireCookie(ATTEMPT_COOKIE));
  headers.append('Set-Cookie', expireDomainCookie(SECURITY_COOKIE, '/security/'));
  return new Response(null, { status: 302, headers });
}

async function serveSecurityAsset(request, env) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') return failClosed(new Error('ASSETS binding missing'));
  const assetUrl = new URL(request.url);
  assetUrl.pathname = '/security/index.html';
  assetUrl.search = '';
  const response = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (!response || response.status === 404) return notFound();
  const headers = new Headers(response.headers);
  applySecurityViewerHeaders(headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Kalenel-Security-Gate', 'github+totp');
  headers.set('X-Kalenel-Admin-Build', ADMIN_BUILD);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function securityResponseHeaders(init = {}) {
  const headers = new Headers(init);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return headers;
}
function securityJson(data, status = 200, clearMedia = false) {
  const headers = securityResponseHeaders({ 'Content-Type': 'application/json; charset=utf-8' });
  if (clearMedia) headers.append('Set-Cookie', expireCookie(SECURITY_MEDIA_COOKIE));
  return new Response(JSON.stringify(data), { status, headers });
}
function securityMethodNotAllowed(allow) {
  return new Response('Method not allowed', { status: 405, headers: securityResponseHeaders({ Allow: allow, 'Content-Type': 'text/plain; charset=utf-8' }) });
}
async function securityInnerLogin(request, env, outer) {
  let body;
  try { body = await request.json(); } catch { return securityJson({ ok:false, error:'invalid_request' }, 400); }
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  const totp = String(body?.totp || '').replace(/\D/g, '');
  if (!username || username.length > 160 || !password || password.length > 512 || !/^\d{6}$/.test(totp)) {
    return securityJson({ ok:false, error:'invalid_credentials' }, 400);
  }

  const loginRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_login`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ input_username: username, input_password: password, input_totp_code: totp })
  });
  const loginText = await loginRes.text();
  let loginData = {};
  try { loginData = loginText ? JSON.parse(loginText) : {}; } catch {}
  if (Array.isArray(loginData)) loginData = loginData[0] || {};
  const adminToken = String(loginData?.admin_session_token || loginData?.token || '').trim();
  if (!loginRes.ok || adminToken.length < 20 || adminToken.length > 500) {
    return securityJson({ ok:false, error:'invalid_credentials' }, 401);
  }

  const mediaRes = await fetch(SECURITY_MEDIA_SESSION_URL, {
    method: 'POST',
    headers: { Origin: `https://${PUBLIC_HOST}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ admin_session_token: adminToken })
  });
  const mediaData = await mediaRes.json().catch(() => ({}));
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
  };
  const headers = securityResponseHeaders({ 'Content-Type': 'application/json; charset=utf-8' });
  headers.append('Set-Cookie', await encryptedCookie(env, SECURITY_MEDIA_COOKIE, session, Math.max(1, exp - now())));
  return new Response(JSON.stringify({ ok:true, expires_at:new Date(exp * 1000).toISOString() }), { status:200, headers });
}
function validSecurityMediaSession(env, media, outer) {
  if (!media || media.kind !== 'security-media' || media.exp <= now()) return false;
  if (!media.github || !isAllowedGithubAccount(env, media.github)) return false;
  if (normalizeGithubId(media.github.id) !== normalizeGithubId(outer.github?.id)) return false;
  if (normalizeGithubLogin(media.github.login) !== normalizeGithubLogin(outer.github?.login)) return false;
  const token = String(media.mediaToken || '');
  return token.length >= 32 && token.length <= 512;
}
function cleanSecurityFilename(raw, extension = '') {
  let name = '';
  try { name = decodeURIComponent(String(raw || '')); } catch { return ''; }
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(name) || name.includes('..')) return '';
  if (extension && !name.toLowerCase().endsWith(extension)) return '';
  return name;
}
function securityUpstreamPath(pathname) {
  for (const camera of ['s3', 'new']) {
    const prefix = `/security/${camera}`;
    if (pathname === `${prefix}/api/events`) return `/${camera}/api/events`;
    if (pathname === `${prefix}/api/status`) return `/${camera}/api/status`;
    if (pathname === `${prefix}/live.mjpg`) return `/${camera}/live.mjpg`;
    if (pathname.startsWith(`${prefix}/snap/`)) {
      const name = cleanSecurityFilename(pathname.slice(`${prefix}/snap/`.length));
      return name ? `/${camera}/snap/${encodeURIComponent(name)}` : '';
    }
    if (pathname.startsWith(`${prefix}/clip/`)) {
      const name = cleanSecurityFilename(pathname.slice(`${prefix}/clip/`.length), '.mp4');
      return name ? `/${camera}/clip/${encodeURIComponent(name)}` : '';
    }
  }
  // Backwards compatibility: pre-v766 unprefixed security media remains S3.
  if (pathname === '/security/api/events') return '/api/events';
  if (pathname === '/security/api/status') return '/api/status';
  if (pathname === '/security/live.mjpg') return '/live.mjpg';
  if (pathname.startsWith('/security/snap/')) {
    const name = cleanSecurityFilename(pathname.slice('/security/snap/'.length));
    return name ? `/snap/${encodeURIComponent(name)}` : '';
  }
  if (pathname.startsWith('/security/clip/')) {
    const name = cleanSecurityFilename(pathname.slice('/security/clip/'.length), '.mp4');
    return name ? `/clip/${encodeURIComponent(name)}` : '';
  }
  return '';
}
function securityProxyTarget(upstreamPath) {
  const m = String(upstreamPath || '').match(/^\/(new|s3)\/(api\/(status|events)|live\.mjpg|snap\/([^/]+)|clip\/([^/]+))$/);
  if (!m) return '';
  const u = new URL(SECURITY_MEDIA_PROXY_URL);
  u.searchParams.set('camera', m[1]);
  if (m[3] === 'status' || m[3] === 'events') u.searchParams.set('kind', m[3]);
  else if (m[2] === 'live.mjpg') u.searchParams.set('kind', 'live');
  else if (m[4]) { u.searchParams.set('kind', 'snap'); u.searchParams.set('name', decodeURIComponent(m[4])); }
  else if (m[5]) { u.searchParams.set('kind', 'clip'); u.searchParams.set('name', decodeURIComponent(m[5])); }
  else return '';
  return u.toString();
}
async function proxySecurityOrigin(request, media, upstreamPath) {
  const target = securityProxyTarget(upstreamPath);
  if (!target) return notFound();
  const upstreamHeaders = new Headers({ Authorization: `Bearer ${media.mediaToken}`, Origin: `https://${PUBLIC_HOST}` });
  for (const name of ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since']) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }
  let response;
  try { response = await fetch(target, { method: request.method, headers: upstreamHeaders, redirect: 'error' }); }
  catch { return securityJson({ ok:false, error:'camera_origin_unavailable' }, 502); }
  if (response.status === 401 || response.status === 403) return securityJson({ ok:false, error:'security_unlock_required' }, 401, true);
  const headers = securityResponseHeaders();
  for (const name of ['Content-Type','Content-Length','Content-Range','Accept-Ranges','ETag','Last-Modified','Content-Disposition']) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, statusText: response.statusText, headers });
}
function bytesToB64url(bytes) {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64urlToBytes(value) {
  const s = String(value);
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function securityEncryptionKey(env) {
  requireEnv(env, ['COOKIE_SECRET']);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`kalenel-security-media-v1:${env.COOKIE_SECRET}`));
  return crypto.subtle.importKey('raw', digest, { name:'AES-GCM' }, false, ['encrypt','decrypt']);
}
async function encryptedCookie(env, name, value, maxAge) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await securityEncryptionKey(env);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, plaintext));
  return `${name}=${bytesToB64url(iv)}.${bytesToB64url(ciphertext)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
async function readEncryptedCookie(request, env, name) {
  const raw = parseCookies(request)[name];
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  try {
    const iv = b64urlToBytes(parts[0]);
    const ciphertext = b64urlToBytes(parts[1]);
    if (iv.length !== 12 || ciphertext.length < 17 || ciphertext.length > 4096) return null;
    const key = await securityEncryptionKey(env);
    const plaintext = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch { return null; }
}

async function serveProtectedAsset(request, env, pathname) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') return failClosed(new Error('ASSETS binding missing'));
  if (!isSafePath(pathname)) return notFound();
  const assetUrl = new URL(request.url);
  assetUrl.pathname = pathname;
  const response = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (!response || response.status === 404) return notFound();
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Kalenel-Admin-Gate', 'worker');
  headers.set('X-Kalenel-Admin-Build', ADMIN_BUILD);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function loginPage(url, reason, status = 401) {
  const returnTo = canonicalizeAdminReturnTo(url.pathname + url.search);
  const body = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kalenel admin login</title><style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#f7f3e8;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:520px;padding:28px;border:1px solid #d4af3744;border-radius:18px;background:#171a22}a{display:inline-block;margin-top:16px;color:#111;background:#d4af37;padding:12px 16px;border-radius:12px;text-decoration:none;font-weight:800}</style></head><body><main class="card"><h1>Admin login vereist</h1><p>Deze beheeromgeving staat achter een Cloudflare Worker GitHub-login en daarna de bestaande Supabase admin/TOTP-controle.</p><p>Reden: ${escapeHtml(reason)}</p><a href="/login?return_to=${encodeURIComponent(returnTo)}">Login met GitHub</a></main></body></html>`;
  return new Response(body, { status, headers: secureHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Kalenel-Admin-Build': ADMIN_BUILD }) });
}

function oauthCompletePage(returnTo) {
  const safeReturnTo = canonicalizeAdminReturnTo(returnTo);
  const destination = isSecurityReturnTo(safeReturnTo) ? `https://${PUBLIC_HOST}${securityPageReturnTo(safeReturnTo)}` : safeReturnTo;
  const href = escapeHtml(destination);
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="1;url=${href}"><title>Kalenel admin login voltooid</title><style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#f7f3e8;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:520px;padding:28px;border:1px solid #d4af3744;border-radius:18px;background:#171a22}a{display:inline-block;margin-top:16px;color:#111;background:#d4af37;padding:12px 16px;border-radius:12px;text-decoration:none;font-weight:800}</style></head><body><main class="card"><h1>GitHub-login voltooid</h1><p>Je beveiligde sessie is gezet. Ga verder naar de adminomgeving via een same-origin navigatie.</p><a href="${href}">Verder naar admin</a></main></body></html>`;
}

function clearOauthAndDeny(message) {
  const headers = secureHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', expireCookie(OAUTH_COOKIE));
  return new Response(message, { status: 403, headers });
}

function failClosed(error) {
  return new Response('Forbidden', { status: 403, headers: secureHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Kalenel-Fail-Closed': 'true' }) });
}

function notFound() { return new Response('Not found', { status: 404, headers: secureHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }) }); }
function methodNotAllowed() { return new Response('Method not allowed', { status: 405, headers: secureHeaders({ Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }) }); }
function plain(text, status) { return new Response(text, { status, headers: secureHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }) }); }

function isProtectedPublicPath(pathname) { return PROTECTED_PUBLIC_PATTERNS.some((rx) => rx.test(pathname)); }
function isSafeRawUrl(raw) { try { const path = String(raw).split('://')[1]?.replace(/^[^/]+/, '') || '/'; return !/(?:^|\/|%2f)(?:\.|%2e){2}(?:\/|%2f|$)/i.test(path) && !/%5c/i.test(path); } catch { return false; } }
function isSafePath(pathname) { try { const p = decodeURIComponent(pathname); return p.startsWith('/') && !p.includes('\\') && !p.includes('\0') && !p.split('/').includes('..'); } catch { return false; } }
function sanitizeReturnTo(value) { if (!value) return ''; try { value = decodeURIComponent(String(value)); } catch { value = String(value); } value = String(value).trim(); if (/^\/\//.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return ''; if (!value.startsWith('/')) value = `/${value}`; if (!isSafePath(value.split('?')[0])) return ''; if (value.startsWith('/oauth/') || value.startsWith('/login') || value.startsWith('/logout')) return '/admin.html'; return value.slice(0, 300); }
function now() { return Math.floor(Date.now() / 1000); }
function randomToken(bytes) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' }[m])); }
function escapeHtml(s) { return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }

function requireEnv(env, keys) {
  for (const key of keys) if (!env[key]) throw new Error(`Missing ${key}`);
  if (String(env.COOKIE_SECRET || '').length < 32) throw new Error('COOKIE_SECRET too short');
  if (env.GITHUB_CLIENT_ID) getGithubClientId(env);
  if (env.GITHUB_CLIENT_SECRET) getGithubClientSecret(env);
}
function trimWrappedSecret(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}
function getGithubClientId(env) {
  const value = trimWrappedSecret(env.GITHUB_CLIENT_ID);
  if (!/^[A-Za-z0-9_.-]{10,128}$/.test(value)) throw new Error('GITHUB_CLIENT_ID malformed');
  return value;
}
function getGithubClientSecret(env) {
  const raw = trimWrappedSecret(env.GITHUB_CLIENT_SECRET);
  const compact = raw.replace(/[^\x21-\x7e]+/g, '');
  const embeddedHexSecret = compact.match(/[a-f0-9]{40}/i);
  const value = embeddedHexSecret ? embeddedHexSecret[0] : compact;
  if (value.length < 10 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('GITHUB_CLIENT_SECRET malformed');
  return value;
}
function normalizeGithubId(value) { return String(value || '').trim(); }
function normalizeGithubLogin(value) { return String(value || '').trim().toLowerCase(); }
function isAllowedGithubAccount(env, github) { const id = normalizeGithubId(github?.id); const login = normalizeGithubLogin(github?.login); const allowedId = normalizeGithubId(env.APPROVED_GITHUB_ID); const allowedLogin = normalizeGithubLogin(env.APPROVED_GITHUB_LOGIN); return !!((allowedId && id && constantTimeEqual(id, allowedId)) || (allowedLogin && login && constantTimeEqual(login, allowedLogin))); }
function constantTimeEqual(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let out = 0; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i); return out === 0; }

function parseCookies(request) { const raw = request.headers.get('Cookie') || ''; const out = {}; for (const part of raw.split(';')) { const idx = part.indexOf('='); if (idx > -1) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim(); } return out; }
async function readSignedCookie(request, env, name) { const raw = parseCookies(request)[name]; if (!raw) return null; const [payload, sig] = raw.split('.'); if (!payload || !sig) return null; const expected = await hmac(env, payload); if (!constantTimeEqual(sig, expected)) return null; const text = atob(payload.replace(/-/g, '+').replace(/_/g, '/')); return JSON.parse(text); }
async function signedCookie(env, name, value, maxAge, sameSite = 'Strict') { const payload = btoa(JSON.stringify(value)).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' }[m])); const sig = await hmac(env, payload); return `${name}=${payload}.${sig}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=${sameSite}`; }
async function signedDomainCookie(env, name, value, maxAge, path = '/') { const payload = btoa(JSON.stringify(value)).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' }[m])); const sig = await hmac(env, payload); return `${name}=${payload}.${sig}; Max-Age=${maxAge}; Domain=${PUBLIC_HOST}; Path=${path}; HttpOnly; Secure; SameSite=Strict`; }
function expireCookie(name) { return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`; }
function expireDomainCookie(name, path = '/') { return `${name}=; Max-Age=0; Domain=${PUBLIC_HOST}; Path=${path}; HttpOnly; Secure; SameSite=Strict`; }
async function hmac(env, payload) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.COOKIE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)); return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' }[m])); }
async function readAttemptCookie(request, env) { const v = await readSignedCookie(request, env, ATTEMPT_COOKIE); if (!v || v.resetAt <= now()) return { count: 0, resetAt: now() + ATTEMPT_WINDOW_SECONDS }; return v; }
function bumpAttempts(v) { return { kind: 'attempts', count: Number(v.count || 0) + 1, resetAt: v.resetAt || (now() + ATTEMPT_WINDOW_SECONDS) }; }

function withPublicSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  applyPublicSecurityHeaders(headers);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function applyPublicSecurityHeaders(headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), payment=()');
}

function secureHeaders(init = {}) { const headers = new Headers(init); applySecurityHeaders(headers); return headers; }
function applySecurityViewerHeaders(headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function applySecurityHeaders(headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('Content-Security-Policy', "default-src 'self' https://uiqntazgnrxwliaidkmy.supabase.co; connect-src 'self' https://uiqntazgnrxwliaidkmy.supabase.co https://api.github.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://github.com");
}

export const __test = { signedCookie, expireCookie, sanitizeReturnTo, isProtectedPublicPath, isAllowedGithubAccount, adminAssetPath, canonicalAdminRedirectTarget, canonicalizeAdminReturnTo };
