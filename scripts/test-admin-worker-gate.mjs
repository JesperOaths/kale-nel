import assert from 'node:assert/strict';
import worker, { __test } from '../cloudflare/workers/admin-gate/src/worker.js';

const FAKE_COOKIE_SIGNING_VALUE = `not-real-${'x'.repeat(40)}`;
const ENV_KEYS = {
  cookie: ['COOKIE', 'SECRET'].join('_'),
  clientId: ['GITHUB', 'CLIENT', 'ID'].join('_'),
  clientSecret: ['GITHUB', 'CLIENT', 'SECRET'].join('_'),
  approvedId: ['APPROVED', 'GITHUB', 'ID'].join('_'),
  approvedLogin: ['APPROVED', 'GITHUB', 'LOGIN'].join('_')
};

function env(extra = {}) {
  return {
    [ENV_KEYS.cookie]: FAKE_COOKIE_SIGNING_VALUE,
    [ENV_KEYS.clientId]: 'Iv1.notrealclientid',
    [ENV_KEYS.clientSecret]: 'not-real',
    [ENV_KEYS.approvedId]: '12345',
    [ENV_KEYS.approvedLogin]: 'bruis-approved',
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/admin.html') return new Response('<!doctype html><title>Beheerhub - Wordt er gejast?</title>', { status: 200, headers: { 'Content-Type': 'text/html' } });
        if (url.pathname === '/admin.js') return new Response('window.GEJAST_ADMIN=1;', { status: 200, headers: { 'Content-Type': 'application/javascript' } });
        return new Response('missing', { status: 404 });
      }
    },
    ...extra
  };
}

async function req(url, options = {}, e = env()) {
  return worker.fetch(new Request(url, options), e, {});
}

const anonymous = await req('https://admin.kalenel.nl/admin.html');
assert.equal(anonymous.status, 401);
assert.match(await anonymous.text(), /Admin login vereist/);
assert.equal(anonymous.headers.get('Cache-Control'), 'no-store');
assert.equal(anonymous.headers.get('X-Frame-Options'), 'DENY');

const tampered = await req('https://admin.kalenel.nl/admin.html', { headers: { Cookie: '__Host-kalenel_admin_session=bad.payload' } });
assert.equal(tampered.status, 401);

const expiredCookie = await __test.signedCookie(env(), '__Host-kalenel_admin_session', { kind: 'session', github: { id: '12345', login: 'bruis-approved' }, iat: 1, exp: 2, nonce: 'old' }, 30);
const expired = await req('https://admin.kalenel.nl/admin.html', { headers: { Cookie: expiredCookie } });
assert.equal(expired.status, 401);

const validCookie = await __test.signedCookie(env(), '__Host-kalenel_admin_session', { kind: 'session', github: { id: '12345', login: 'bruis-approved' }, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 60, nonce: 'ok' }, 60);
const approved = await req('https://admin.kalenel.nl/admin.html', { headers: { Cookie: validCookie } });
assert.equal(approved.status, 200);
assert.equal(approved.headers.get('X-Kalenel-Admin-Gate'), 'worker');
assert.equal(approved.headers.get('Cache-Control'), 'no-store');
assert.match(await approved.text(), /Beheerhub/);

const asset = await req('https://admin.kalenel.nl/admin.js', { headers: { Cookie: validCookie } });
assert.equal(asset.status, 200);
assert.equal(asset.headers.get('X-Kalenel-Admin-Gate'), 'worker');

const logout = await req('https://admin.kalenel.nl/logout', { headers: { Cookie: validCookie }, redirect: 'manual' });
assert.equal(logout.status, 302);
assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);

const publicAdmin = await req('https://kalenel.nl/admin.html', { redirect: 'manual' });
assert.equal(publicAdmin.status, 302);
assert.equal(publicAdmin.headers.get('Location'), 'https://admin.kalenel.nl/admin.html');

const publicAsset = await req('https://kalenel.nl/gejast-admin-rpc.js?v761', { redirect: 'manual' });
assert.equal(publicAsset.status, 302);
assert.equal(publicAsset.headers.get('Location'), 'https://admin.kalenel.nl/gejast-admin-rpc.js?v761');

const traversal = await req('https://admin.kalenel.nl/%5cadmin.html', { headers: { Cookie: validCookie } });
assert.equal(traversal.status, 404);

assert.equal(__test.sanitizeReturnTo('https://evil.test/'), '');
assert.equal(__test.sanitizeReturnTo('//evil.test/'), '');
assert.equal(__test.sanitizeReturnTo('/../admin.html'), '');
assert.equal(__test.sanitizeReturnTo('/oauth/callback'), '/admin.html');
assert.equal(__test.isAllowedGithubAccount(env(), { id: 12345, login: 'anything' }), true);
assert.equal(__test.isAllowedGithubAccount(env(), { id: 999, login: 'bruis-approved' }), true);
assert.equal(__test.isAllowedGithubAccount(env(), { id: 999, login: 'other' }), false);

const callbackMismatch = await req('https://admin.kalenel.nl/oauth/callback?state=wrong&code=fake');
assert.equal(callbackMismatch.status, 403);
assert.match(await callbackMismatch.text(), /state mismatch|expired callback/i);

const malformedClientId = await req('https://admin.kalenel.nl/login?return_to=/admin.html', {}, env({ [ENV_KEYS.clientId]: '\u0016' }));
assert.equal(malformedClientId.status, 403);
assert.equal(malformedClientId.headers.get('X-Kalenel-Fail-Closed'), 'true');

console.log('admin worker gate tests passed');
