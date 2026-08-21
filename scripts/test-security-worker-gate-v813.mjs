import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { __test } from '../cloudflare/workers/admin-gate/src/worker.js';

const NOW = () => Math.floor(Date.now() / 1000);
const SECURITY_OUTER = '__Secure-kalenel_security_session';
const SECURITY_MEDIA = '__Host-kalenel_security_media';
const MEDIA_TOKEN = 'm'.repeat(64);
const ADMIN_TOKEN = 'a'.repeat(48);
const CAMERA_ORIGIN = 'https://unit-security.trycloudflare.com';
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
    kind: 'security-session', github, iat: NOW(), exp: NOW() + ttl, nonce: 'security-unit'
  }, ttl);
  return cookiePair(value, SECURITY_OUTER);
}

function joinCookies(...pairs) {
  return pairs.filter(Boolean).join('; ');
}

for (const file of ['security/index.html']) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /https?:\/\/[a-z0-9-]+\.trycloudflare\.com/i, `${file} leaks tunnel origin`);
  assert.doesNotMatch(source, /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/, `${file} leaks private camera IP`);
}

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

const anonymousClipPage = await req('https://kalenel.nl/security/new-clips/', { redirect: 'manual' });
const anonymousClipLocation = new URL(anonymousClipPage.headers.get('Location'));
assert.equal(anonymousClipLocation.searchParams.get('return_to'), '/security/new-clips/');

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
assert.match(await approvedViewer.text(), /Kalenel Security/);

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
globalThis.fetch = async (url, init = {}) => {
  const value = String(url);
  if (value.includes('/rest/v1/rpc/admin_login')) {
    return Response.json({ admin_session_token: ADMIN_TOKEN });
  }
  if (value.includes('/functions/v1/c720p-security-control?action=session')) {
    return Response.json({
      ok: true,
      origin: CAMERA_ORIGIN,
      media_token: MEDIA_TOKEN,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString()
    });
  }
  if (value.startsWith(`${CAMERA_ORIGIN}/`)) {
    const requestHeaders = new Headers(init.headers || {});
    upstreamCalls.push({ url: value, method: init.method || 'GET', range: requestHeaders.get('Range') || '' });
    if (value.includes('/s3/api/status?')) return new Response('upstream auth expired', { status: 401 });
    const parsed = new URL(value);
    return Response.json({ ok: true, path: parsed.pathname }, {
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
  assert.equal(upstreamCalls.at(-1).url, `${CAMERA_ORIGIN}/new/api/status?token=${MEDIA_TOKEN}`);

  const clip = await req('https://kalenel.nl/security/new/clip/capture-01.mp4', {
    headers: { Cookie: sessionCookies, Range: 'bytes=0-999' }
  }, e);
  assert.equal(clip.status, 200);
  assert.equal(upstreamCalls.at(-1).url, `${CAMERA_ORIGIN}/new/clip/capture-01.mp4?token=${MEDIA_TOKEN}`);
  assert.equal(upstreamCalls.at(-1).range, 'bytes=0-999');

  const badExtension = await req('https://kalenel.nl/security/new/clip/capture-01.txt', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(badExtension.status, 404);
  const traversalLike = await req('https://kalenel.nl/security/new/clip/bad..mp4', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(traversalLike.status, 404);
  const encodedSlash = await req('https://kalenel.nl/security/new/snap/a%2Fb.jpg', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(encodedSlash.status, 404);
  const unknownCamera = await req('https://kalenel.nl/security/other/api/status', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(unknownCamera.status, 404);

  const legacyStatus = await req('https://kalenel.nl/security/api/status', { headers: { Cookie: sessionCookies } }, e);
  assert.equal(legacyStatus.status, 200);
  assert.equal(upstreamCalls.at(-1).url, `${CAMERA_ORIGIN}/api/status?token=${MEDIA_TOKEN}`);

  const upstreamExpired = await req('https://kalenel.nl/security/s3/api/status', { headers: { Cookie: sessionCookies } }, e);
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

  const logout = await req('https://kalenel.nl/security/auth/logout', { method: 'POST', headers: { Cookie: outer } }, e);
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { ok: true });
  assert.match(logout.headers.get('Set-Cookie') || '', new RegExp(`${SECURITY_MEDIA}=; Max-Age=0`));
} finally {
  globalThis.fetch = originalFetch;
}

const expiredOuter = await outerCookie(e, { id: '12345', login: 'bruis-approved' }, -1);
const expired = await req('https://kalenel.nl/security/', { headers: { Cookie: expiredOuter }, redirect: 'manual' }, e);
assert.equal(expired.status, 302);
assert.match(expired.headers.get('Location') || '', /^https:\/\/admin\.kalenel\.nl\/login\?/);

console.log('v813 private security worker boundary tests passed');
