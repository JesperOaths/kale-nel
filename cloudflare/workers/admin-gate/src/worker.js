const ADMIN_HOST = 'admin.kalenel.nl';
const PUBLIC_HOST = 'kalenel.nl';
const SESSION_COOKIE = '__Host-kalenel_admin_session';
const OAUTH_COOKIE = '__Host-kalenel_admin_oauth';
const ATTEMPT_COOKIE = '__Host-kalenel_admin_attempts';
const SESSION_TTL_SECONDS = 30 * 60;
const OAUTH_TTL_SECONDS = 10 * 60;
const ATTEMPT_WINDOW_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 8;

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
      if (url.hostname === PUBLIC_HOST || url.hostname === `www.${PUBLIC_HOST}`) {
        return handlePublicApex(request, url);
      }
      if (url.hostname !== ADMIN_HOST) return notFound();
      return await handleAdminHost(request, env, url);
    } catch (error) {
      return failClosed(error);
    }
  }
};

function handlePublicApex(request, url) {
  if (!isSafePath(url.pathname)) return notFound();
  if (!isProtectedPublicPath(url.pathname)) return fetch(request);
  const target = new URL(url.pathname + url.search, `https://${ADMIN_HOST}`);
  return new Response(null, {
    status: 302,
    headers: secureHeaders({
      Location: target.toString(),
      'Cache-Control': 'no-store'
    })
  });
}

async function handleAdminHost(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();
  if (!isSafePath(url.pathname)) return notFound();

  if (url.pathname === '/logout') return logout(url);
  if (url.pathname === '/oauth/callback') return await oauthCallback(request, env, url);
  if (url.pathname === '/login' || url.pathname === '/login/') return await login(request, env, url);

  const session = await readSignedCookie(request, env, SESSION_COOKIE);
  if (!session || session.kind !== 'session' || session.exp <= now() || !isAllowedGithubAccount(env, session.github)) {
    return loginPage(url, 'session_required', 401);
  }

  const assetPath = url.pathname === '/' ? '/admin.html' : url.pathname;
  return await serveProtectedAsset(request, env, assetPath);
}

async function login(request, env, url) {
  requireEnv(env, ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'COOKIE_SECRET']);
  const attempts = await readAttemptCookie(request, env);
  if (attempts.count >= MAX_LOGIN_ATTEMPTS && attempts.resetAt > now()) {
    return plain('Too many login attempts. Try again later.', 429);
  }

  const returnTo = sanitizeReturnTo(url.searchParams.get('return_to')) || '/admin.html';
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
  const headers = secureHeaders({
    Location: sanitizeReturnTo(oauth.returnTo) || '/admin.html',
    'Cache-Control': 'no-store'
  });
  headers.append('Set-Cookie', await signedCookie(env, SESSION_COOKIE, session, SESSION_TTL_SECONDS));
  headers.append('Set-Cookie', expireCookie(OAUTH_COOKIE));
  headers.append('Set-Cookie', expireCookie(ATTEMPT_COOKIE));
  return new Response(null, { status: 302, headers });
}

function logout(url) {
  const headers = secureHeaders({ Location: '/login?return_to=/admin.html', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', expireCookie(SESSION_COOKIE));
  headers.append('Set-Cookie', expireCookie(OAUTH_COOKIE));
  headers.append('Set-Cookie', expireCookie(ATTEMPT_COOKIE));
  return new Response(null, { status: 302, headers });
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
  if (/\.html$/i.test(pathname) || pathname === '/admin.html') headers.set('Cache-Control', 'no-store');
  headers.set('X-Kalenel-Admin-Gate', 'worker');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function loginPage(url, reason, status = 401) {
  const returnTo = sanitizeReturnTo(url.pathname + url.search) || '/admin.html';
  const body = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kalenel admin login</title><style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#f7f3e8;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:520px;padding:28px;border:1px solid #d4af3744;border-radius:18px;background:#171a22}a{display:inline-block;margin-top:16px;color:#111;background:#d4af37;padding:12px 16px;border-radius:12px;text-decoration:none;font-weight:800}</style></head><body><main class="card"><h1>Admin login vereist</h1><p>Deze beheeromgeving staat achter een Cloudflare Worker GitHub-login en daarna de bestaande Supabase admin/TOTP-controle.</p><p>Reden: ${escapeHtml(reason)}</p><a href="/login?return_to=${encodeURIComponent(returnTo)}">Login met GitHub</a></main></body></html>`;
  return new Response(body, { status, headers: secureHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }) });
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
  const value = trimWrappedSecret(env.GITHUB_CLIENT_SECRET);
  if (value.length < 10 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('GITHUB_CLIENT_SECRET malformed');
  return value;
}
function isAllowedGithubAccount(env, github) { const id = String(github?.id || ''); const login = String(github?.login || '').toLowerCase(); const allowedId = String(env.APPROVED_GITHUB_ID || '').trim(); const allowedLogin = String(env.APPROVED_GITHUB_LOGIN || '').trim().toLowerCase(); return !!((allowedId && id && constantTimeEqual(id, allowedId)) || (allowedLogin && login && constantTimeEqual(login, allowedLogin))); }
function constantTimeEqual(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let out = 0; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i); return out === 0; }

function parseCookies(request) { const raw = request.headers.get('Cookie') || ''; const out = {}; for (const part of raw.split(';')) { const idx = part.indexOf('='); if (idx > -1) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim(); } return out; }
async function readSignedCookie(request, env, name) { const raw = parseCookies(request)[name]; if (!raw) return null; const [payload, sig] = raw.split('.'); if (!payload || !sig) return null; const expected = await hmac(env, payload); if (!constantTimeEqual(sig, expected)) return null; const text = atob(payload.replace(/-/g, '+').replace(/_/g, '/')); return JSON.parse(text); }
async function signedCookie(env, name, value, maxAge, sameSite = 'Strict') { const payload = btoa(JSON.stringify(value)).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' }[m])); const sig = await hmac(env, payload); return `${name}=${payload}.${sig}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=${sameSite}`; }
function expireCookie(name) { return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`; }
async function hmac(env, payload) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.COOKIE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)); return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' }[m])); }
async function readAttemptCookie(request, env) { const v = await readSignedCookie(request, env, ATTEMPT_COOKIE); if (!v || v.resetAt <= now()) return { count: 0, resetAt: now() + ATTEMPT_WINDOW_SECONDS }; return v; }
function bumpAttempts(v) { return { kind: 'attempts', count: Number(v.count || 0) + 1, resetAt: v.resetAt || (now() + ATTEMPT_WINDOW_SECONDS) }; }

function secureHeaders(init = {}) { const headers = new Headers(init); applySecurityHeaders(headers); return headers; }
function applySecurityHeaders(headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('Content-Security-Policy', "default-src 'self' https://uiqntazgnrxwliaidkmy.supabase.co; connect-src 'self' https://uiqntazgnrxwliaidkmy.supabase.co https://api.github.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://github.com");
}

export const __test = { signedCookie, expireCookie, sanitizeReturnTo, isProtectedPublicPath, isAllowedGithubAccount };
