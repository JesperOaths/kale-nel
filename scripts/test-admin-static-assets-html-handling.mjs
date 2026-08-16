import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import worker, { __test } from '../cloudflare/workers/admin-gate/src/worker.js';

const ROOT = process.cwd();
const WRANGLER = path.join(ROOT, 'cloudflare/workers/admin-gate/wrangler.toml');
const STATIC_ADMIN_HTML = path.join(ROOT, 'cloudflare/workers/admin-gate/static/admin.html');
const PROOF = path.join(ROOT, 'ADMIN_STATIC_ASSETS_HTML_HANDLING_PROOF_20260802.json');
const FAKE_COOKIE_SIGNING_VALUE = `not-real-${'x'.repeat(40)}`;
const ENV_KEYS = {
  cookie: ['COOKIE', 'SECRET'].join('_'),
  clientId: ['GITHUB', 'CLIENT', 'ID'].join('_'),
  clientSecret: ['GITHUB', 'CLIENT', 'SECRET'].join('_'),
  approvedId: ['APPROVED', 'GITHUB', 'ID'].join('_'),
  approvedLogin: ['APPROVED', 'GITHUB', 'LOGIN'].join('_')
};

const wranglerToml = fs.readFileSync(WRANGLER, 'utf8');
const assets = parseAssetsSection(wranglerToml);
assert.deepEqual(assets, {
  directory: './static',
  binding: 'ASSETS',
  not_found_handling: 'none',
  html_handling: 'none',
  run_worker_first: 'true'
});

const adminHtml = fs.readFileSync(STATIC_ADMIN_HTML, 'utf8');
assert.match(adminHtml, /GEJAST_PAGE_VERSION='v795'/);
assert.match(adminHtml, /gejast-home-gate\.js\?v795/);
assert.match(adminHtml, /admin-session-sync\.js\?v795/);

function env(htmlHandling = assets.html_handling) {
  return {
    [ENV_KEYS.cookie]: FAKE_COOKIE_SIGNING_VALUE,
    [ENV_KEYS.clientId]: 'Iv1.notrealclientid',
    [ENV_KEYS.clientSecret]: 'a'.repeat(40),
    [ENV_KEYS.approvedId]: '12345',
    [ENV_KEYS.approvedLogin]: 'bruis-approved',
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/admin.html') {
          if (htmlHandling !== 'none') {
            return new Response(null, {
              status: 307,
              headers: { Location: '/admin' }
            });
          }
          return new Response(adminHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        if (url.pathname === '/admin.js') {
          return new Response('window.GEJAST_ADMIN=1;', {
            status: 200,
            headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
          });
        }
        return new Response('missing', { status: 404 });
      }
    }
  };
}

const baseEnv = env('none');
const validCookie = await __test.signedCookie(baseEnv, '__Host-kalenel_admin_session', {
  kind: 'session',
  github: { id: '12345', login: 'bruis-approved' },
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 60,
  nonce: 'html-handling-proof'
}, 60);

const preFix = await trace('https://admin.kalenel.nl/admin.html', env('auto-trailing-slash'), validCookie);
assert.equal(preFix.cycle, true);
assert.deepEqual(preFix.chain.map((hop) => [hop.status, hop.location]), [[307, '/admin'], [302, '/admin.html']]);
assert.equal(preFix.nextRepeatedUrl, 'https://admin.kalenel.nl/admin.html');

const postFixDirect = await trace('https://admin.kalenel.nl/admin.html', env('none'), validCookie);
assert.equal(postFixDirect.cycle, false);
assert.deepEqual(postFixDirect.chain.map((hop) => [hop.status, hop.location]), [[200, '']]);
assert.equal(postFixDirect.finalUrl, 'https://admin.kalenel.nl/admin.html');
assert.equal(postFixDirect.finalHeaders['x-kalenel-admin-build'], 'v762');
assert.equal(postFixDirect.finalHeaders['cache-control'], 'no-store');
assert.match(postFixDirect.finalBodySnippet, /GEJAST_PAGE_VERSION='v795'/);

const postFixAlias = await trace('https://admin.kalenel.nl/admin', env('none'), validCookie);
assert.equal(postFixAlias.cycle, false);
assert.deepEqual(postFixAlias.chain.map((hop) => [hop.status, hop.location]), [[302, '/admin.html'], [200, '']]);
assert.equal(postFixAlias.finalUrl, 'https://admin.kalenel.nl/admin.html');
assert.equal(postFixAlias.finalHeaders['x-kalenel-admin-build'], 'v762');

const proof = {
  assets,
  synthetic_valid_outer_session: true,
  pre_fix_model: {
    html_handling: 'auto-trailing-slash',
    chain: preFix.chain,
    cycle: preFix.cycle,
    next_repeated_url: preFix.nextRepeatedUrl
  },
  post_fix_model: {
    html_handling: 'none',
    direct_admin_html: {
      chain: postFixDirect.chain,
      cycle: postFixDirect.cycle,
      final_url: postFixDirect.finalUrl,
      final_headers: postFixDirect.finalHeaders
    },
    admin_alias_followed: {
      chain: postFixAlias.chain,
      cycle: postFixAlias.cycle,
      final_url: postFixAlias.finalUrl,
      final_headers: postFixAlias.finalHeaders
    }
  }
};
fs.writeFileSync(PROOF, JSON.stringify(proof, null, 2));
console.log('admin static assets html_handling regression passed');
console.log(`proof: ${path.relative(ROOT, PROOF)}`);

async function req(url, e, cookie) {
  return worker.fetch(new Request(url, {
    redirect: 'manual',
    headers: cookie ? { Cookie: cookie } : {}
  }), e, {});
}

async function trace(url, e, cookie, max = 8) {
  const chain = [];
  const seen = new Set();
  let current = url;
  for (let i = 0; i < max; i += 1) {
    if (seen.has(current)) return { chain, cycle: true, nextRepeatedUrl: current };
    seen.add(current);
    const res = await req(current, e, cookie);
    const location = res.headers.get('Location') || '';
    const hop = { url: current, status: res.status, location };
    chain.push(hop);
    if (![301, 302, 303, 307, 308].includes(res.status)) {
      const body = await res.text();
      return {
        chain,
        cycle: false,
        finalUrl: current,
        finalHeaders: headersObject(res.headers),
        finalBodySnippet: body.slice(0, 5000)
      };
    }
    current = new URL(location, current).toString();
  }
  return { chain, cycle: true, nextRepeatedUrl: current, maxExceeded: true };
}

function headersObject(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) result[key.toLowerCase()] = value;
  return result;
}

function parseAssetsSection(toml) {
  const match = toml.match(/^\[assets\]\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m);
  assert.ok(match, '[assets] section missing');
  const result = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const pair = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!pair) continue;
    const [, key, rawValue] = pair;
    result[key] = rawValue.replace(/^"|"$/g, '');
  }
  return result;
}
