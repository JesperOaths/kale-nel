import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { __test } from '../cloudflare/workers/admin-gate/src/worker.js';

const COOKIE_SECRET = `security-test-${'x'.repeat(40)}`;
const APPROVED_ID = '12345';
const APPROVED_LOGIN = 'bruis-approved';
const MEDIA_TOKEN = `media-${'m'.repeat(48)}`;
const ORIGIN = 'https://unit-security.trycloudflare.com';

function env(extra = {}) {
  return {
    COOKIE_SECRET,
    APPROVED_GITHUB_ID: APPROVED_ID,
    APPROVED_GITHUB_LOGIN: APPROVED_LOGIN,
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/security/index.html') {
          return new Response('<!doctype html><title>Kalenel Security</title><main>private security fixture</main>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=9999' }
          });
        }
        return new Response('missing', { status: 404 });
      }
    },
    ...extra
  };
}

async function req(url, options = {}, e = env()) {
  return worker.fetch(new Request(url, options), e, {});
}

function cookieValue(setCookie, name) {
  const match = String(setCookie || '').match(new RegExp(`(?:^|,\\s*)(${name}=[^;,]+)`));
  return match ? match[1] : '';
}

const now = Math.floor(Date.now() / 1000);
const outerSetCookie = await __test.signedCookie(env(), '__Secure-kalenel_security_session', {
  kind: 'security-session',
  github: { id: APPROVED_ID, login: APPROVED_LOGIN },
  iat: now,
  exp: now + 300,
  nonce: 'security-unit'
}, 300);
const outerCookie = cookieValue(outerSetCookie, '__Secure-kalenel_security_session');
assert.ok(outerCookie);

const canonical = await req('https://kalenel.nl/security', { redirect: 'manual' });
assert.equal(canonical.status, 302);
assert.equal(canonical.headers.get('Location'), '/security/');

const anonymousPage = await req('https://kalenel.nl/security/', { redirect: 'manual' });
assert.equal(anonymousPage.status, 302);
assert.equal(anonymousPage.headers.get('Location'), 'https://admin.kalenel.nl/login?return_to=%2Fsecurity%2F');
assert.equal(anonymousPage.headers.get('Cache-Control'), 'no-store');

const anonymousApi = await req('https://kalenel.nl/security/new/api/status', { method: 'POST' });
assert.equal(anonymousApi.status, 401);
assert.deepEqual(await anonymousApi.json(), { ok: false, error: 'github_session_required' });

const expiredOuter = await __test.signedCookie(env(), '__Secure-kalenel_security_session', {
  kind: 'security-session', github: { id: APPROVED_ID, login: APPROVED_LOGIN }, iat: 1, exp: 2, nonce: 'expired'
}, 30);
const expired = await req('https://kalenel.nl/security/', { headers: { Cookie: cookieValue(expiredOuter, '__Secure-kalenel_security_session') }, redirect: 'manual' });
assert.equal(expired.status, 302);
assert.match(expired.headers.get('Location') || '', /^https:\/\/admin\.kalenel\.nl\/login\?return_to=/);

const page = await req('https://kalenel.nl/security/', { headers: { Cookie: outerCookie } });
assert.equal(page.status, 200);
assert.equal(page.headers.get('Cache-Control'), 'no-store');
assert.equal(page.headers.get('X-Kalenel-Security-Gate'), 'github+totp');
assert.equal(page.headers.get('X-Frame-Options'), 'DENY');
assert.equal(page.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
assert.match(page.headers.get('Content-Security-Policy') || '', /connect-src 'self'/);
assert.doesNotMatch(page.headers.get('Content-Security-Policy') || '', /trycloudflare/i);

const securityHtml = fs.readFileSync(new URL('../security/index.html', import.meta.url), 'utf8');
assert.doesNotMatch(securityHtml, /trycloudflare\.com/i);
assert.doesNotMatch(securityHtml, /media_token/i);
assert.doesNotMatch(securityHtml, /(?:192\.168\.|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.)/);
assert.match(securityHtml, /\/security\/\$\{camera\}\/live\.mjpg/);
assert.match(securityHtml, /\/security\/\$\{clipCamera\}\/clip\//);

const invalidInner = await req('https://kalenel.nl/security/auth/login', {
  method: 'POST',
  headers: { Cookie: outerCookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'pw', totp: '12' })
});
assert.equal(invalidInner.status, 400);
assert.deepEqual(await invalidInner.json(), { ok: false, error: 'invalid_credentials' });

const upstreamCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === 'https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/admin_login') {
    const body = JSON.parse(String(init.body || '{}'));
    assert.deepEqual(body, { input_username: 'admin', input_password: 'pw', input_totp_code: '123456' });
    return Response.json({ admin_session_token: `admin-${'a'.repeat(40)}` });
  }
  if (url === 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-control?action=session') {
    assert.equal(init.method, 'POST');
    assert.equal(init.headers?.Origin, 'https://kalenel.nl');
    return Response.json({ ok: true, origin: ORIGIN, media_token: MEDIA_TOKEN, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  }
  if (url.startsWith(`${ORIGIN}/`)) {
    upstreamCalls.push({ url, init });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('token'), MEDIA_TOKEN);
    if (parsed.pathname.endsWith('/unauthorized')) return new Response('denied', { status: 401 });
    return Response.json({ ok: true, path: parsed.pathname, source_online: true });
  }
  throw new Error(`unexpected fetch ${url}`);
};

let mediaCookie = '';
try {
  const login = await req('https://kalenel.nl/security/auth/login', {
    method: 'POST',
    headers: { Cookie: outerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'pw', totp: '123456' })
  });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  assert.equal(loginBody.ok, true);
  assert.equal(Object.hasOwn(loginBody, 'origin'), false);
  assert.equal(Object.hasOwn(loginBody, 'media_token'), false);
  const setCookie = login.headers.get('Set-Cookie') || '';
  assert.match(setCookie, /__Host-kalenel_security_media=/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.doesNotMatch(setCookie, /Domain=/i);
  mediaCookie = cookieValue(setCookie, '__Host-kalenel_security_media');
  assert.ok(mediaCookie);

  const authCookies = `${outerCookie}; ${mediaCookie}`;

  const newStatus = await req('https://kalenel.nl/security/new/api/status', { headers: { Cookie: authCookies } });
  assert.equal(newStatus.status, 200);
  assert.deepEqual(await newStatus.json(), { ok: true, path: '/new/api/status', source_online: true });
  assert.equal(newStatus.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  assert.equal(newStatus.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');

  const s3Status = await req('https://kalenel.nl/security/s3/api/status', { headers: { Cookie: authCookies } });
  assert.equal(s3Status.status, 200);
  assert.deepEqual(await s3Status.json(), { ok: true, path: '/s3/api/status', source_online: true });

  const newClip = await req('https://kalenel.nl/security/new/clip/new-001.mp4', { headers: { Cookie: authCookies } });
  assert.equal(newClip.status, 200);
  assert.equal((await newClip.json()).path, '/new/clip/new-001.mp4');

  const s3Clip = await req('https://kalenel.nl/security/s3/clip/s3-001.mp4', { headers: { Cookie: authCookies } });
  assert.equal(s3Clip.status, 200);
  assert.equal((await s3Clip.json()).path, '/s3/clip/s3-001.mp4');

  const wrongExtension = await req('https://kalenel.nl/security/new/clip/not-video.jpg', { headers: { Cookie: authCookies } });
  assert.equal(wrongExtension.status, 404);

  const traversal = await req('https://kalenel.nl/security/new/clip/%2e%2e%2fsecret.mp4', { headers: { Cookie: authCookies } });
  assert.equal(traversal.status, 404);

  const tamperedMedia = await req('https://kalenel.nl/security/new/api/status', { headers: { Cookie: `${outerCookie}; __Host-kalenel_security_media=bad.payload` } });
  assert.equal(tamperedMedia.status, 401);
  assert.deepEqual(await tamperedMedia.json(), { ok: false, error: 'security_unlock_required' });
  assert.match(tamperedMedia.headers.get('Set-Cookie') || '', /__Host-kalenel_security_media=; Max-Age=0/);

  const alternateOuterSetCookie = await __test.signedCookie(env(), '__Secure-kalenel_security_session', {
    kind: 'security-session', github: { id: APPROVED_ID, login: 'different-login' }, iat: now, exp: now + 300, nonce: 'alternate'
  }, 300);
  const alternateOuter = cookieValue(alternateOuterSetCookie, '__Secure-kalenel_security_session');
  const crossIdentity = await req('https://kalenel.nl/security/new/api/status', { headers: { Cookie: `${alternateOuter}; ${mediaCookie}` } });
  assert.equal(crossIdentity.status, 401);

  const lock = await req('https://kalenel.nl/security/auth/logout', { method: 'POST', headers: { Cookie: authCookies } });
  assert.equal(lock.status, 200);
  assert.deepEqual(await lock.json(), { ok: true });
  assert.match(lock.headers.get('Set-Cookie') || '', /__Host-kalenel_security_media=; Max-Age=0/);

  const disallowedHost = await req('https://evil.example/security/new/api/status', { headers: { Cookie: authCookies } });
  assert.equal(disallowedHost.status, 404);

  assert.equal(upstreamCalls.some((call) => call.url.includes('/new/api/status?token=')), true);
  assert.equal(upstreamCalls.some((call) => call.url.includes('/s3/api/status?token=')), true);
  assert.equal(upstreamCalls.some((call) => call.url.includes('/new/clip/new-001.mp4?token=')), true);
  assert.equal(upstreamCalls.some((call) => call.url.includes('/s3/clip/s3-001.mp4?token=')), true);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('v813 security viewer gate PASS: GitHub perimeter, inner login, encrypted media session, camera isolation, traversal rejection, no-origin leakage, lock and proxy boundaries are deterministic.');
