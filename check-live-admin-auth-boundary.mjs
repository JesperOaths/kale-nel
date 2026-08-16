#!/usr/bin/env node

const ADMIN_BASE = String(process.env.GEJAST_ADMIN_BASE_URL || 'https://admin.kalenel.nl').replace(/\/+$/, '');
const timeoutMs = Number(process.env.GEJAST_ADMIN_AUTH_TIMEOUT_MS || 15000);

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { redirect: 'manual', signal: controller.signal, ...options });
  } finally {
    clearTimeout(timer);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function setCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') return response.headers.getSetCookie();
  const combined = response.headers.get('set-cookie');
  return combined ? [combined] : [];
}

const protectedUrl = `${ADMIN_BASE}/admin.html?final_certification=131`;
const protectedRes = await request(protectedUrl);
assert(protectedRes.status === 401, `anonymous admin perimeter expected 401, got ${protectedRes.status}`);
assert(protectedRes.headers.get('x-kalenel-admin-build') === 'v763', `admin perimeter build mismatch: ${protectedRes.headers.get('x-kalenel-admin-build') || '<none>'}`);
assert(/no-store/i.test(protectedRes.headers.get('cache-control') || ''), 'anonymous admin perimeter must be no-store');
const protectedBody = await protectedRes.text();
assert(/GitHub-login/i.test(protectedBody), 'anonymous admin gate must explain GitHub outer login');
assert(/Supabase admin\/TOTP/i.test(protectedBody), 'anonymous admin gate must preserve the Supabase/TOTP inner boundary');
console.log('Admin anonymous outer perimeter: 401 build=v763 PASS');

const loginUrl = `${ADMIN_BASE}/login?return_to=${encodeURIComponent('/admin.html')}`;
const loginRes = await request(loginUrl);
assert(loginRes.status === 302, `GitHub OAuth entrypoint expected 302, got ${loginRes.status}`);
assert(/no-store/i.test(loginRes.headers.get('cache-control') || ''), 'OAuth entrypoint must be no-store');
const location = loginRes.headers.get('location') || '';
const github = new URL(location);
assert(github.protocol === 'https:', 'OAuth authorization redirect must use HTTPS');
assert(github.hostname === 'github.com', `OAuth authorization host mismatch: ${github.hostname || '<none>'}`);
assert(github.pathname === '/login/oauth/authorize', `OAuth authorization path mismatch: ${github.pathname}`);
assert(!!github.searchParams.get('client_id'), 'OAuth authorization redirect missing client_id');
assert(github.searchParams.get('redirect_uri') === `${ADMIN_BASE}/oauth/callback`, 'OAuth callback URI mismatch');
assert(github.searchParams.get('scope') === 'read:user', 'OAuth scope must remain read:user');
assert((github.searchParams.get('state') || '').length >= 24, 'OAuth state token missing/too short');
assert(github.searchParams.get('allow_signup') === 'false', 'OAuth entrypoint must not enable signup');
const cookies = setCookies(loginRes).join('\n');
assert(cookies.includes('__Host-kalenel_admin_oauth='), 'OAuth entrypoint must set signed OAuth state cookie');
assert(cookies.includes('__Host-kalenel_admin_attempts='), 'OAuth entrypoint must set login-attempt cookie');
assert(/Secure/i.test(cookies) && /HttpOnly/i.test(cookies), 'OAuth cookies must be Secure and HttpOnly');
console.log('Admin GitHub OAuth entrypoint: 302 signed-state handoff PASS');

const httpAdmin = new URL(protectedUrl);
httpAdmin.protocol = 'http:';
const httpRes = await request(httpAdmin.toString());
assert(httpRes.status === 308, `HTTP admin transport expected 308, got ${httpRes.status}`);
const httpsTarget = httpRes.headers.get('location') || '';
assert(httpsTarget.startsWith('https://admin.kalenel.nl/admin.html?final_certification=131'), `HTTP admin redirect did not preserve secure target: ${httpsTarget || '<none>'}`);
console.log('Admin HTTP -> HTTPS pre-auth transport: 308 PASS');

console.log('RESULT=V792_LIVE_ADMIN_OUTER_AUTH_BOUNDARY_PASS');
console.log('Interactive GitHub credential entry/callback is intentionally not automated; the live proof stops at the signed GitHub authorization handoff rather than faking third-party authentication.');
