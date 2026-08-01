import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class ClassList {
  constructor() { this.set = new Set(); }
  add(...values) { values.forEach((value) => this.set.add(value)); }
  remove(...values) { values.forEach((value) => this.set.delete(value)); }
  contains(value) { return this.set.has(value); }
}

class ElementStub {
  constructor(id = '') {
    this.id = id;
    this.classList = new ClassList();
    this.textContent = '';
    this.className = '';
    this.value = '';
    this.style = {};
    this.dataset = {};
  }
  addEventListener() {}
  appendChild() {}
  setAttribute() {}
  getAttribute() { return ''; }
  requestSubmit() {}
}

function makeDocument() {
  const ids = new Map();
  const documentElement = new ElementStub('html');
  return {
    documentElement,
    head: new ElementStub('head'),
    body: new ElementStub('body'),
    hidden: false,
    readyState: 'complete',
    createElement: () => new ElementStub(),
    addEventListener: (name, fn) => { if (name === 'DOMContentLoaded') fn(); },
    querySelectorAll: () => [],
    getElementById: (id) => {
      if (!ids.has(id)) ids.set(id, new ElementStub(id));
      return ids.get(id);
    }
  };
}

function storage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
}

const sessionSync = fs.readFileSync('admin-session-sync.js', 'utf8');
for (const [pathname, shouldGate] of [['/admin', false], ['/admin/', false], ['/admin.html', false], ['/admin_claims.html', true]]) {
  const document = makeDocument();
  const context = {
    window: { location: { pathname, search: '', hash: '' }, addEventListener() {}, dispatchEvent() {}, GEJAST_CONFIG: {} },
    document,
    sessionStorage: storage(),
    localStorage: storage(),
    navigator: { userAgent: 'test', language: 'nl', platform: 'test' },
    Intl,
    screen: { width: 1, height: 1 },
    console,
    CustomEvent: function CustomEvent() {}
  };
  context.window.window = context.window;
  context.window.document = document;
  vm.runInNewContext(sessionSync, context);
  assert.equal(document.documentElement.classList.contains('admin-gate-pending'), shouldGate, `${pathname} protected-page prehide`);
}

const adminHtml = fs.readFileSync('admin.html', 'utf8');
const inlineScripts = [...adminHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
const adminInline = inlineScripts.find((script) => script.includes('async function boot()'));
assert.ok(adminInline, 'admin inline boot script exists');

async function runAdminHub({ token = false } = {}) {
  const document = makeDocument();
  const location = { pathname: '/admin.html', search: '', hash: '', href: 'https://admin.kalenel.nl/admin.html' };
  const context = {
    window: {
      location,
      addEventListener() {},
      GEJAST_CONFIG: { SUPABASE_URL: 'https://example.invalid', SUPABASE_PUBLISHABLE_KEY: 'not-secret' },
      GEJAST_ADMIN_SESSION: token
        ? { getToken: () => 'valid-token', validate: async () => ({ admin_session_token: 'valid-token' }), setBundle() {}, clearBundle() {} }
        : null,
      GEJAST_ADMIN_CLAIMS_SOURCE: { load: async () => ({ requests: [], history: [], expiredQueue: [] }) }
    },
    document,
    sessionStorage: storage(token ? { jas_admin_session_v8: 'valid-token' } : {}),
    localStorage: storage(token ? { jas_admin_session_v8: 'valid-token' } : {}),
    location,
    URL,
    URLSearchParams,
    fetch: async () => new Response('{}', { status: 200 }),
    Response,
    setInterval: () => 0,
    console
  };
  context.window.window = context.window;
  context.window.document = document;
  vm.runInNewContext(adminInline, context);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return document;
}

let document = await runAdminHub({ token: false });
assert.equal(document.getElementById('loginView').classList.contains('hidden'), false, 'missing inner session shows login/TOTP form');
assert.equal(document.getElementById('hubView').classList.contains('hidden'), true, 'missing inner session does not expose admin hub');

document = await runAdminHub({ token: true });
assert.equal(document.getElementById('loginView').classList.contains('hidden'), true, 'valid inner session hides login/TOTP form');
assert.equal(document.getElementById('hubView').classList.contains('hidden'), false, 'valid inner session shows admin hub');

console.log('admin inner render integration tests passed');
