#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('gejast-auth-gate.js', 'utf8');

class StorageMock {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function exercise({ scope = 'friends', activeResponse, selectorResponse }) {
  const nativeCalls = [];
  const nativeFetch = async (input, init = {}) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    nativeCalls.push({ url, init });
    if (url.includes('/rest/v1/rpc/account_public_state_v687')) {
      return jsonResponse({ ok: true, site_scope: scope });
    }
    if (url.includes('/rest/v1/rpc/get_login_active_names_v687')) {
      return activeResponse();
    }
    if (url.includes('/rest/v1/rpc/get_player_selector_source_v1')) {
      return selectorResponse();
    }
    if (url.includes('/rest/v1/allowed_usernames')) {
      throw new Error('direct allowed_usernames network access escaped the v813 compatibility boundary');
    }
    throw new Error(`unexpected native request ${url}`);
  };

  const attributes = new Map();
  const style = new Map();
  const documentElement = {
    setAttribute(name, value) { attributes.set(name, String(value)); },
    style: {
      setProperty(name, value) { style.set(name, String(value)); },
      removeProperty(name) { style.delete(name); }
    }
  };
  const location = {
    search: scope === 'family' ? '?scope=family' : '',
    pathname: scope === 'family' ? '/familie/index.html' : '/home.html',
    replaced: null,
    replace(target) { this.replaced = String(target); }
  };
  const context = {
    console,
    URL,
    URLSearchParams,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    document: {
      documentElement,
      scripts: [],
      createElement() { throw new Error('config loader must not create a script when config is already present'); },
      head: { appendChild() { throw new Error('config loader must not append when config is already present'); } }
    },
    location,
    localStorage: new StorageMock({ jas_session_token_v11: 'test-player-session' }),
    sessionStorage: new StorageMock(),
    fetch: nativeFetch,
    GEJAST_CONFIG: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key'
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  new vm.Script(source, { filename: 'gejast-auth-gate.js' }).runInContext(context);

  assert.equal(await context.GEJAST_AUTH_GATE, true, 'player auth validation should succeed in the fixture');
  assert.equal(attributes.get('data-gejast-auth-state'), 'authenticated');
  assert.equal(location.replaced, null, 'successful auth must not redirect');
  assert.equal(context.GEJAST_DIRECT_READ_COMPAT_V813?.direct_allowed_usernames_network, false);

  const legacyUrl = 'https://example.supabase.co/rest/v1/allowed_usernames?select=display_name,status,site_scope&site_scope=eq.' + scope;
  const first = await context.fetch(legacyUrl, { headers: { apikey: 'legacy-client-value' } });
  assert.equal(first.status, 200);
  const rows = await first.json();
  const second = await context.fetch(legacyUrl);
  assert.deepEqual(await second.json(), rows, 'cached compatibility reads should remain deterministic');

  assert.equal(nativeCalls.some(({ url }) => url.includes('/rest/v1/allowed_usernames')), false, 'private table URL must never reach native fetch');
  for (const { url, init } of nativeCalls.filter(({ url }) => url.includes('/rest/v1/rpc/get_'))) {
    assert.equal(init.method, 'POST', `${url} must use POST`);
    const payload = JSON.parse(init.body || '{}');
    assert.equal(payload.site_scope_input, scope, `${url} must preserve site scope`);
  }
  return { rows, nativeCalls };
}

const primary = await exercise({
  activeResponse: () => jsonResponse([
    { display_name: ' Alice ' },
    { player_name: 'Bob' },
    { name: 'alice' }
  ]),
  selectorResponse: () => jsonResponse({ players: [{ display_name: 'SHOULD_NOT_BE_NEEDED' }] })
});
assert.deepEqual(primary.rows, [
  { display_name: 'Alice', status: 'active', site_scope: 'friends' },
  { display_name: 'Bob', status: 'active', site_scope: 'friends' }
]);
assert.equal(primary.nativeCalls.filter(({ url }) => url.includes('/get_login_active_names_v687')).length, 1, 'successful primary source should be cached');
assert.equal(primary.nativeCalls.filter(({ url }) => url.includes('/get_player_selector_source_v1')).length, 0, 'selector fallback should not run after primary success');

const fallback = await exercise({
  scope: 'family',
  activeResponse: () => jsonResponse({ message: 'not available' }, 404),
  selectorResponse: () => jsonResponse({ get_player_selector_source_v1: { players: [{ public_display_name: 'Familie Speler' }] } })
});
assert.deepEqual(fallback.rows, [
  { display_name: 'Familie Speler', status: 'active', site_scope: 'family' }
]);
assert.equal(fallback.nativeCalls.filter(({ url }) => url.includes('/get_login_active_names_v687')).length, 1);
assert.equal(fallback.nativeCalls.filter(({ url }) => url.includes('/get_player_selector_source_v1')).length, 1);

const failClosed = await exercise({
  activeResponse: () => jsonResponse({ message: 'down' }, 503),
  selectorResponse: () => jsonResponse({ message: 'down' }, 503)
});
assert.deepEqual(failClosed.rows, [], 'failed safe RPC sources must degrade to an empty compatibility set, never a private table read');
assert.equal(failClosed.nativeCalls.some(({ url }) => url.includes('/rest/v1/allowed_usernames')), false);

console.log('RESULT=V813_AUTH_GATE_ACTIVE_NAMES_PASS');
