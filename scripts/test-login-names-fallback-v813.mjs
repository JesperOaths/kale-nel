#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('gejast-login-names-fallback.js', 'utf8');
const calls = [];
const cacheWrites = [];

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const cfg = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
  async fetchScopedActivePlayerNames() { throw new Error('legacy loader must be replaced'); },
  async getActivatedPlayerNamesForScope() { throw new Error('legacy loader must be replaced'); },
  writeCachedLoginNames(names, scope) { cacheWrites.push({ names: [...names], scope }); },
  readCachedLoginNames() { return ['Cached Player']; }
};

const context = {
  console,
  URL,
  URLSearchParams,
  Response,
  GEJAST_CONFIG: cfg,
  location: { search: '?scope=family' },
  fetch: async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    assert.doesNotMatch(url, /\/rest\/v1\/allowed_usernames(?:[?#]|$)/i, 'private allowed_usernames relation must never be queried');
    if (url.includes('/rpc/get_login_active_names_v687')) {
      const body = JSON.parse(init.body || '{}');
      assert.equal(body.site_scope_input, 'family');
      return response([
        { display_name: ' Familie B ' },
        { public_display_name: 'Familie A' },
        { display_name: 'familie a' }
      ]);
    }
    throw new Error(`unexpected request ${url}`);
  }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
new vm.Script(source, { filename: 'gejast-login-names-fallback.js' }).runInContext(context);

assert.equal(context.GEJAST_LOGIN_NAMES_FALLBACK?.source, 'v813-safe-active-name-rpc');
assert.equal(cfg.fetchScopedActivePlayerNames, context.GEJAST_LOGIN_NAMES_FALLBACK.load);
assert.equal(cfg.getActivatedPlayerNamesForScope, context.GEJAST_LOGIN_NAMES_FALLBACK.load);

const names = await context.GEJAST_LOGIN_NAMES_FALLBACK.load();
assert.deepEqual(Array.from(names), ['Familie A', 'Familie B']);
assert.equal(calls.length, 1);
assert.equal(calls[0].init.method, 'POST');
assert.equal(calls[0].init.headers.apikey, 'publishable-test-key');
assert.equal(cacheWrites.length, 1);
assert.deepEqual(cacheWrites[0], { names: ['Familie A', 'Familie B'], scope: 'family' });

console.log('RESULT=V813_LOGIN_NAMES_PUBLIC_RPC_ONLY_PASS');
