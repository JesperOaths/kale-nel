import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { __test } from '../cloudflare/workers/admin-gate/src/worker.js';

const NOW = () => Math.floor(Date.now() / 1000);
const SECURITY_OUTER = '__Secure-kalenel_security_session';
const SECURITY_MEDIA = '__Host-kalenel_security_media';
const MEDIA_TOKEN = `media-${'m'.repeat(48)}`;
const ADMIN_TOKEN = `admin-${'a'.repeat(40)}`;
const MEDIA_SESSION_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-media?action=session';
const MEDIA_PROXY_PREFIX = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-relay';
const ENV_KEYS = {
  cookie: ['COOKIE', 'SECRET'].join('_'),
  approvedId: ['APPROVED', 'GITHUB', 'ID'].join('_'),
  approvedLogin: ['APPROVED', 'GITHUB', 'LOGIN'].join('_')
};

function env() {
  return {
    [ENV_KEYS.cookie]: `not-real-${'x'.repeat(48)}`,
    [ENV_KEYS.approvedId]: '12345',
    [ENV_KEYS.approvedLogin]: 'bruis-approved',
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/security/index.html') {
          return new Response('<!doctype html><title>Kalenel Security</title><main id="security-root"></main>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        return new Response('missing', { status: 404 });
      }
    }
  };
}

async function req(url, options = {}, e = env()) {
  return worker.fetch(new Request(url, options), e, {});
}

function cookiePair(setCookie, name) {
  const match = String(setCookie || '').match(new RegExp(`(?:^|,\\s*)(${name}=[^;,]+)`));
  return match ? match[1] : '';
}

async function outerCookie(e = env(), github = { id: '12345', login: 'bruis-approved' }, ttl = 300) {
  const value = await __test.signedCookie(e, SECURITY_OUTER, {
    kind: 'security-session', github, iat: NOW(), exp: NOW() + ttl, nonce: `security-unit-${github.login}`
  }, Math.max(1, ttl));
  return cookiePair(value, SECURITY_OUTER);
}

function joinCookies(...pairs) {
  return pairs.filter(Boolean).join('; ');
}

const securityHtml = fs.readFileSync(new URL('../security/index.html', import.meta.url), 'utf8');
assert.doesNotMatch(securityHtml, /https?:\/\/[a-z0-9-]+\.trycloudflare\.com/i, 'security UI leaks tunnel origin');
assert.doesNotMatch(securityHtml, /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/, 'security UI leaks private camera IP');
assert.doesNotMatch(securityHtml, /media_token/i, 'security UI must never receive the upstream media token');
assert.match(securityHtml, /\/security\/\$\{camera\}\/live\.mjpg/);
assert.match(securityHtml, /\/security\/\$\{clipCamera\}\/clip\//);

const canonical = await req('https://kalenel.nl/security', { redirect: 'manual' });
assert.equal(canonical.status, 302);
assert.equal(canonical.headers.get('Location'), '/security/');

const anonymous = await req('https://kalenel.nl/security/', { redirect: 'manual' });
assert.equal(anonymous.status, 302);
const anonymousLocation = new URL(anonymous.headers.get('Location'));
assert.equal(anonymousLocation.origin, 'https://admin.kalenel.nl');
assert.equal(anonymousLocation.pathname, '/login');
assert.equal(anonymousLocation.searchParams.get('return_to'), '/security/');
assert.equal(anonymous.headers.get('Cache-Control'), 'no-store');

const anonymousMutation = await req('https://kalenel.nl/security/auth/login', {
  method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' }
});
assert.equal(anonymousMutation.status, 401);
assert.deepEqual(await anonymousMutation.json(), { ok: false, error: 'github_session_required' });

const e = env();
const outer = await outerCookie(e);
const approvedViewer = await req('https://kalenel.nl/security/', { headers: { Cookie: outer } }, e);
assert.equal(approvedViewer.status, 200);
assert.equal(approvedViewer.headers.get('X-Kalenel-Security-Gate'), 'github+totp');
assert.equal(approvedViewer.headers.get('Cache-Control'), 'no-store');
assert.equal(approvedViewer.headers.get('X-Frame-Options'), 'DENY');
assert.match(approvedViewer.headers.get('Content-Security-Policy') || '', /connect-src 'self'/);
assert.doesNotMatch(approvedViewer.headers.get('Content-Security-Policy') || '', /trycloudflare/i);

const mediaBeforeUnlock = await req('https://kalenel.nl/security/new/api/status', { headers: { Cookie: outer } }, e);
assert.equal(mediaBeforeUnlock.status, 401);
assert.deepEqual(await mediaBeforeUnlock.json(), { ok: false, error: 'security_unlock_required' });
assert.match(mediaBeforeUnlock.headers.get('Set-Cookie') || '', new RegExp(`${SECURITY_MEDIA}=; Max-Age=0`));

const badMethod = await req('https://kalenel.nl/security/auth/login', { method: 'GET', headers: { Cookie: outer } }, e);
assert.equal(badMethod.status, 405);
assert.equal(badMethod.headers.get('Allow'), 'POST');

const malformedLogin = await req('https://kalenel.nl/security/auth/login', {
  method: 'POST', headers: { Cookie: outer, 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'secret', totp: '12345' })
}, e);
assert.equal(malformedLogin.status, 400);
assert.deepEqual(await malformedLogin.json(), { ok: false, error: 'invalid_credentials' });

const upstreamCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const value = String(input);
  if (value === 'https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/admin_login') {
    const body = JSON.parse(String(init.body || '{}'));
    assert.deepEqual(body, { input_username: 'admin', input_password: 'secret', input_totp_code: '123456' });
    return Response.json({ admin_session_token: ADMIN_TOKEN });
  }
  if (value === MEDIA_SESSION_URL) {
    assert.equal(init.method, 'POST');
    assert.equal(init.headers?.Origin, 'https://kalenel.nl');
    assert.deepEqual(JSON.parse(String(init.body || '{}')), { admin_session_token: ADMIN_TOKEN });
    return Response.json({ ok: true, media_token: MEDIA_TOKEN, expires_at: new Date(Date.now() + 5 * 60_000).toISOString() });
  }
  if (value.startsWith(MEDIA_PROXY_PREFIX)) {
    const requestHeaders = new Headers(init.headers || {});
    const parsed = new URL(value);
    const camera = parsed.searchParams.get('camera');
    const kind = parsed.searchParams.get('kind');
    const name = parsed.searchParams.get('name');
    assert.ok(camera === 'new' || camera === 's3');
    assert.ok(['status', 'events', 'live', 'snap', 'clip'].includes(kind));
    assert.equal(requestHeaders.get('X-Kalenel-Media-Token'), MEDIA_TOKEN);
    assert.equal(requestHeaders.get('Authorization'), null);
    assert.equal(init.redirect, 'follow');
    upstreamCalls.push({ url: value, camera, kind, name, range: requestHeaders.get('Range') || '' });
    if (camera === 's3' && kind === 'events') return new Response('upstream auth expired', { status: 401 });
    let path = `/${camera}`;
    if (kind === 'status' || kind === 'events') path += `/api/${kind}`;
    else if (kind === 'live') path += '/live.mjpg';
    else path += `/${kind}/${name}`;
    return Response.json({ ok: true, path }, {
      status: 200,
      headers: { 'X-Upstream-Secret': 'must-not-pass', ETag: 'unit-etag' }
    });
  }
  throw new Error(`unexpected outbound fetch in security gate test: ${value}`);
};

try {
  const unlock = await req('https://kalenel.nl/security/auth/login', {
    method: 'POST',
    headers: { Cookie: outer, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'secret', totp: '123456' })
  }, e);
  assert.equal(unlock.status, 200);
  const unlockBody = await unlock.json();
  assert.equal(unlockBody.ok, true);
  assert.equal(Object.hasOwn(unlockBody, 'origin'), false);
  assert.equal(Object.hasOwn(unlockBody, 'media_token'), false);
  assert.ok(Date.parse(unlockBody.expires_at) > Date.now());
  const unlockSetCookie = unlock.headers.get('Set-Cookie') || '';
  assert.match(unlockSetCookie, new RegExp(`${SECURITY_MEDIA}=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+`));
  assert.match(unlockSetCookie, /HttpOnly/);
  assert.match(unlockSetCookie, /Secure/);
  assert.match(unlockSetCookie, /SameSite=Strict/);
  assert.match(unlockSetCookie, /Path=\//);
  assert.doesNotMatch(unlockSetCookie, new RegExp(MEDIA_TOKEN));
  const media = cookiePair(unlockSetCookie, SECURITY_MEDIA);
  assert.ok(media);
  const sessionCookies = joinCookies(outer, media);

  const newStatus = await req('https://kalenel.nl/security/new/api/status', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(newStatus.status, 200);
  assert.equal(newStatus.headers.get('X-Upstream-Secret'), null);
  assert.equal(newStatus.headers.get('ETag'), 'unit-etag');
  assert.match(newStatus.headers.get('Cache-Control') || '', /no-store/);
  assert.deepEqual(await newStatus.json(), { ok: true, path: '/new/api/status' });
  assert.equal(upstreamCalls.at(-1).camera, 'new');
  assert.equal(upstreamCalls.at(-1).kind, 'status');

  const s3Status = await req('https://kalenel.nl/security/s3/api/status', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(s3Status.status, 200);
  assert.deepEqual(await s3Status.json(), { ok: true, path: '/s3/api/status' });
  assert.equal(upstreamCalls.at(-1).camera, 's3');

  const clip = await req('https://kalenel.nl/security/new/clip/capture-01.mp4', {
    headers: { Cookie: sessionCookies, Range: 'bytes=0-999' }
  }, e);
  assert.equal(clip.status, 200);
  assert.equal(upstreamCalls.at(-1).camera, 'new');
  assert.equal(upstreamCalls.at(-1).kind, 'clip');
  assert.equal(upstreamCalls.at(-1).name, 'capture-01.mp4');
  assert.equal(upstreamCalls.at(-1).range, 'bytes=0-999');

  const badExtension = await req('https://kalenel.nl/security/new/clip/capture-01.txt', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(badExtension.status, 404);
  const traversalLike = await req('https://kalenel.nl/security/new/clip/bad..mp4', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(traversalLike.status, 404);
  const encodedSlash = await req('https://kalenel.nl/security/new/snap/a%2Fb.jpg', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(encodedSlash.status, 404);
  const unknownCamera = await req('https://kalenel.nl/security/other/api/status', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(unknownCamera.status, 404);
  const retiredLegacyRoute = await req('https://kalenel.nl/security/api/status', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(retiredLegacyRoute.status, 404);

  const upstreamExpired = await req('https://kalenel.nl/security/s3/api/events', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(upstreamExpired.status, 401);
  assert.deepEqual(await upstreamExpired.json(), { ok: false, error: 'security_unlock_required' });
  assert.match(upstreamExpired.headers.get('Set-Cookie') || '', new RegExp(`${SECURITY_MEDIA}=; Max-Age=0`));

  const mismatchedOuter = await outerCookie(e, { id: '12345', login: 'other-approved-by-id' });
  const replayAgainstOtherOuter = await req('https://kalenel.nl/security/new/api/status', {
    headers: { Cookie: joinCookies(mismatchedOuter, media) }
  }, e);
  assert.equal(replayAgainstOtherOuter.status, 401);
  assert.deepEqual(await replayAgainstOtherOuter.json(), { ok: false, error: 'security_unlock_required' });

  const tamperedMedia = media.slice(0, -1) + (media.endsWith('A') ? 'B' : 'A');
  const tampered = await req('https://kalenel.nl/security/new/api/status', {
    headers: { Cookie: joinCookies(outer, tamperedMedia) }
  }, e);
  assert.equal(tampered.status, 401);

  const logout = await req('https://kalenel.nl/security/auth/logout', { method: 'POST', headers: { Cookie: sessionCookies } }, e);
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { ok: true });
  assert.match(logout.headers.get('Set-Cookie') || '', new RegExp(`${SECURITY_MEDIA}=; Max-Age=0`));

  const disallowedHost = await req('https://evil.example/security/new/api/status', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(disallowedHost.status, 404);
  assert.equal(upstreamCalls.some(({url}) => /trycloudflare/i.test(url)), false);
} finally {
  globalThis.fetch = originalFetch;
}

const expiredOuter = await outerCookie(e, { id: '12345', login: 'bruis-approved' }, -1);
const expired = await req('https://kalenel.nl/security/', { headers: { Cookie: expiredOuter }, redirect: 'manual' }, e);
assert.equal(expired.status, 302);
assert.match(expired.headers.get('Location') || '', /^https:\/\/admin\.kalenel\.nl\/login\?/);

console.log('v813 private security worker boundary tests passed');
