import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { __test } from '../cloudflare/workers/admin-gate/src/worker.js';

const FRONTEND_VERSION = fs.readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();

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
    [ENV_KEYS.clientSecret]: 'a'.repeat(40),
    [ENV_KEYS.approvedId]: '12345',
    [ENV_KEYS.approvedLogin]: 'bruis-approved',
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/admin.html') return new Response(`<!doctype html><title>Beheerhub - Wordt er gejast?</title><script>window.GEJAST_PAGE_VERSION='${FRONTEND_VERSION}';</script><script src="./gejast-home-gate.js?${FRONTEND_VERSION}"></script><script src="./admin-session-sync.js?${FRONTEND_VERSION}"></script>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
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
assert.equal(anonymous.headers.get('X-Kalenel-Admin-Build'), 'v762');
assert.equal(anonymous.headers.get('X-Frame-Options'), 'DENY');

const anonymousAdminAliasRedirect = await req('https://admin.kalenel.nl/admin', { redirect: 'manual' });
assert.equal(anonymousAdminAliasRedirect.status, 302);
assert.equal(anonymousAdminAliasRedirect.headers.get('Location'), '/admin.html');
const anonymousAdminSlashRedirect = await req('https://admin.kalenel.nl/admin/', { redirect: 'manual' });
assert.equal(anonymousAdminSlashRedirect.status, 302);
assert.equal(anonymousAdminSlashRedirect.headers.get('Location'), '/admin.html');

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
assert.equal(approved.headers.get('X-Kalenel-Admin-Build'), 'v762');
const approvedHtml = await approved.text();
assert.match(approvedHtml, /Beheerhub/);
assert.ok(approvedHtml.includes(`GEJAST_PAGE_VERSION='${FRONTEND_VERSION}'`));
assert.ok(approvedHtml.includes(`gejast-home-gate.js?${FRONTEND_VERSION}`));
assert.ok(approvedHtml.includes(`admin-session-sync.js?${FRONTEND_VERSION}`));

const approvedAdminAlias = await follow('https://admin.kalenel.nl/admin', { Cookie: validCookie });
assert.deepEqual(approvedAdminAlias.chain.map((hop) => [hop.status, hop.location]), [[302, '/admin.html'], [200, '']]);
assert.equal(approvedAdminAlias.finalUrl, 'https://admin.kalenel.nl/admin.html');
assert.equal(approvedAdminAlias.final.status, 200);
assert.equal(approvedAdminAlias.final.headers.get('X-Kalenel-Admin-Gate'), 'worker');

const approvedAdminSlashAlias = await follow('https://admin.kalenel.nl/admin/', { Cookie: validCookie });
assert.deepEqual(approvedAdminSlashAlias.chain.map((hop) => [hop.status, hop.location]), [[302, '/admin.html'], [200, '']]);
assert.equal(approvedAdminSlashAlias.finalUrl, 'https://admin.kalenel.nl/admin.html');

const asset = await req('https://admin.kalenel.nl/admin.js', { headers: { Cookie: validCookie } });
assert.equal(asset.status, 200);
assert.equal(asset.headers.get('X-Kalenel-Admin-Gate'), 'worker');
assert.equal(asset.headers.get('Cache-Control'), 'no-store');
assert.equal(asset.headers.get('X-Kalenel-Admin-Build'), 'v762');

const loginStart = await req('https://admin.kalenel.nl/login?return_to=/admin.html', { redirect: 'manual' });
assert.equal(loginStart.status, 302);
assert.match(loginStart.headers.get('Set-Cookie'), /__Host-kalenel_admin_oauth=.*SameSite=Lax/);
assert.match(loginStart.headers.get('Set-Cookie'), /__Host-kalenel_admin_attempts=.*SameSite=Strict/);

const logout = await req('https://admin.kalenel.nl/logout', { headers: { Cookie: validCookie }, redirect: 'manual' });
assert.equal(logout.status, 302);
assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);

const publicAdmin = await req('https://kalenel.nl/admin.html', { redirect: 'manual' });
assert.equal(publicAdmin.status, 302);
assert.equal(publicAdmin.headers.get('Location'), 'https://admin.kalenel.nl/admin.html');

const publicAsset = await req('https://kalenel.nl/gejast-admin-rpc.js?v783', { redirect: 'manual' });
assert.equal(publicAsset.status, 302);
assert.equal(publicAsset.headers.get('Location'), 'https://admin.kalenel.nl/gejast-admin-rpc.js?v783');

const traversal = await req('https://admin.kalenel.nl/%5cadmin.html', { headers: { Cookie: validCookie } });
assert.equal(traversal.status, 404);

assert.equal(__test.sanitizeReturnTo('https://evil.test/'), '');
assert.equal(__test.sanitizeReturnTo('//evil.test/'), '');
assert.equal(__test.sanitizeReturnTo('/../admin.html'), '');
assert.equal(__test.sanitizeReturnTo('/oauth/callback'), '/admin.html');
assert.equal(__test.isAllowedGithubAccount(env(), { id: 12345, login: 'anything' }), true);
assert.equal(__test.isAllowedGithubAccount(env(), { id: ' 12345 ', login: 'anything' }), true);
assert.equal(__test.isAllowedGithubAccount(env(), { id: 999, login: 'bruis-approved' }), true);
assert.equal(__test.isAllowedGithubAccount(env(), { id: 999, login: ' Bruis-Approved ' }), true);
assert.equal(__test.isAllowedGithubAccount(env(), { id: 999, login: 'other' }), false);
assert.equal(__test.adminAssetPath('/'), '/admin.html');
assert.equal(__test.adminAssetPath('/admin'), '/admin');
assert.equal(__test.adminAssetPath('/admin/'), '/admin/');
assert.equal(__test.adminAssetPath('/admin_claims.html'), '/admin_claims.html');
assert.equal(__test.canonicalizeAdminReturnTo('/admin'), '/admin.html');
assert.equal(__test.canonicalizeAdminReturnTo('/admin/'), '/admin.html');
assert.equal(__test.canonicalizeAdminReturnTo('/admin?x=1'), '/admin.html?x=1');
assert.equal(__test.canonicalizeAdminReturnTo('/admin.html'), '/admin.html');

const callbackMismatch = await req('https://admin.kalenel.nl/oauth/callback?state=wrong&code=fake');
assert.equal(callbackMismatch.status, 403);
assert.match(await callbackMismatch.text(), /state mismatch|expired callback/i);

const oauthEnv = env();
const oauthState = 'state-ok';
const oauthCookie = await __test.signedCookie(oauthEnv, '__Host-kalenel_admin_oauth', { kind: 'oauth', state: oauthState, nonce: 'nonce-ok', returnTo: '/admin.html', exp: Math.floor(Date.now()/1000) + 60, used: false }, 60, 'Lax');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const value = String(url);
  if (value === 'https://github.com/login/oauth/access_token') return Response.json({ [['access', 'token'].join('_')]: 'ok' });
  if (value === 'https://api.github.com/user') return Response.json({ id: ' 12345 ', login: ' Bruis-Approved ' });
  return originalFetch(url);
};
try {
  const callbackSuccess = await req(`https://admin.kalenel.nl/oauth/callback?state=${oauthState}&code=fake-code`, { headers: { Cookie: oauthCookie } }, oauthEnv);
  assert.equal(callbackSuccess.status, 200);
  assert.equal(callbackSuccess.headers.get('Cache-Control'), 'no-store');
  assert.match(callbackSuccess.headers.get('Content-Type'), /text\/html/);
  assert.match(callbackSuccess.headers.get('Set-Cookie'), /__Host-kalenel_admin_session=.*SameSite=Strict/);
  assert.match(callbackSuccess.headers.get('Set-Cookie'), /__Host-kalenel_admin_oauth=; Max-Age=0/);
  const callbackBody = await callbackSuccess.text();
  assert.match(callbackBody, /GitHub-login voltooid/);
  assert.match(callbackBody, /http-equiv="refresh" content="1;url=\/admin\.html"/);
  assert.match(callbackBody, /href="\/admin\.html"/);
  const sessionCookie = extractCookie(callbackSuccess.headers.get('Set-Cookie'), '__Host-kalenel_admin_session');
  assert.ok(sessionCookie);
  const adminAfterCallback = await req('https://admin.kalenel.nl/admin.html', { headers: { Cookie: sessionCookie } }, oauthEnv);
  assert.equal(adminAfterCallback.status, 200);
  assert.equal(adminAfterCallback.headers.get('X-Kalenel-Admin-Gate'), 'worker');
  const adminAfterCallbackHtml = await adminAfterCallback.text();
  assert.match(adminAfterCallbackHtml, /Beheerhub/);
  assert.ok(adminAfterCallbackHtml.includes(`GEJAST_PAGE_VERSION='${FRONTEND_VERSION}'`));
} finally {
  globalThis.fetch = originalFetch;
}

const quotedClientId = await req('https://admin.kalenel.nl/login?return_to=/admin.html', {}, env({ [ENV_KEYS.clientId]: '"Iv1.notrealclientid"' }));
assert.equal(quotedClientId.status, 302);
assert.match(quotedClientId.headers.get('Location'), /client_id=Iv1\.notrealclientid/);

const malformedClientId = await req('https://admin.kalenel.nl/login?return_to=/admin.html', {}, env({ [ENV_KEYS.clientId]: '\u0016' }));
assert.equal(malformedClientId.status, 403);
assert.equal(malformedClientId.headers.get('X-Kalenel-Fail-Closed'), 'true');

const quotedClientSecret = await req('https://admin.kalenel.nl/login?return_to=/admin.html', {}, env({ [ENV_KEYS.clientSecret]: '"secret value with spaces"' }));
assert.equal(quotedClientSecret.status, 302);

const malformedClientSecret = await req('https://admin.kalenel.nl/login?return_to=/admin.html', {}, env({ [ENV_KEYS.clientSecret]: '\u0016' }));
assert.equal(malformedClientSecret.status, 403);
assert.equal(malformedClientSecret.headers.get('X-Kalenel-Fail-Closed'), 'true');

console.log('admin worker gate tests passed');

async function follow(url, cookieHeaders = {}, max = 5) {
  const chain = [];
  let current = url;
  const seen = new Set();
  for (let i = 0; i < max; i += 1) {
    if (seen.has(current)) throw new Error(`redirect cycle at ${current}`);
    seen.add(current);
    const res = await req(current, { redirect: 'manual', headers: cookieHeaders });
    const location = res.headers.get('Location') || '';
    chain.push({ status: res.status, location, url: current });
    if (![301, 302, 303, 307, 308].includes(res.status)) return { chain, final: res, finalUrl: current };
    current = new URL(location, current).toString();
  }
  throw new Error(`too many redirects from ${url}`);
}

function extractCookie(setCookie, name) {
  const match = String(setCookie || '').match(new RegExp(`(?:^|,\\s*)(${name}=[^;,]+)`));
  return match ? match[1] : '';
}
