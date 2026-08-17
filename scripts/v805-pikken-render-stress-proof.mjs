#!/usr/bin/env node
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'https://kalenel.nl/';
const token1 = String(process.env.GEJAST_PLAYER1_TOKEN || '').trim();
const token2 = String(process.env.GEJAST_PLAYER2_TOKEN || '').trim();
const name1 = String(process.env.GEJAST_PLAYER1_NAME || '').trim();
const name2 = String(process.env.GEJAST_PLAYER2_NAME || '').trim();
const cycles = Number(process.env.GEJAST_STRESS_CYCLES || 20);
const timeout = 20000;
const configText = fs.readFileSync('gejast-config.js', 'utf8');
const supabaseUrl = configText.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
const key = configText.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];
if (!supabaseUrl || !key || !token1 || !token2 || !name1 || !name2) throw new Error('missing stress proof configuration');

const created = new Set();
const authSettleMs = [];
let blankWhileCheckingAt900 = 0;
const safe = (value) => String(value?.message || value || 'unknown').replaceAll(token1, '[TOKEN1]').replaceAll(token2, '[TOKEN2]');
const tokenPayload = (token, extra = {}) => ({ session_token: token, session_token_input: token, site_scope_input: 'friends', ...extra });

async function rpc(name, payload = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(`${name}: ${data?.message || data?.error || `HTTP ${res.status}`}`);
    return data && data[name] !== undefined ? data[name] : data;
  } finally {
    clearTimeout(timer);
  }
}

async function newContext(browser, token) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  await context.addInitScript((tokenValue) => {
    localStorage.setItem('jas_session_token_v11', tokenValue);
    localStorage.setItem('jas_session_token_v10', tokenValue);
    localStorage.setItem('jas_last_activity_at_v1', String(Date.now()));
  }, token);
  return context;
}

async function snapshot(page) {
  return page.evaluate(() => ({
    authState: document.documentElement.getAttribute('data-gejast-auth-state') || '',
    inlineVisibility: document.documentElement.style.getPropertyValue('visibility') || '',
    bodyLength: (document.body?.innerText || '').trim().length,
  }));
}

async function assertRendered(page, label) {
  const started = Date.now();
  await page.waitForTimeout(900);
  if (/login\.html/i.test(page.url())) throw new Error(`${label} login bounce url=${page.url()}`);

  const at900 = await snapshot(page);
  if (at900.bodyLength < 20) {
    if (at900.authState !== 'checking') {
      throw new Error(`${label} product blank after 900ms auth_state=${at900.authState || 'none'} visibility=${at900.inlineVisibility || 'none'} body_len=${at900.bodyLength} url=${page.url()}`);
    }
    blankWhileCheckingAt900 += 1;
    console.log(`PIKKEN_AUTH_GATE_PENDING label=${JSON.stringify(label)} after_ms=900 auth_state=checking body_len=${at900.bodyLength}`);
  }

  if (at900.authState === 'checking') {
    await page.waitForFunction(() => document.documentElement.getAttribute('data-gejast-auth-state') !== 'checking', null, { timeout: 8000 });
  }
  const settled = await snapshot(page);
  const elapsed = Date.now() - started;
  authSettleMs.push(elapsed);
  if (settled.authState !== 'authenticated') {
    throw new Error(`${label} auth did not authenticate state=${settled.authState || 'none'} after_ms=${elapsed} url=${page.url()}`);
  }
  if (settled.bodyLength < 20) {
    throw new Error(`${label} blank after auth reveal body_len=${settled.bodyLength} after_ms=${elapsed} url=${page.url()}`);
  }

  await page.waitForFunction(({ a, b }) => {
    const text = document.querySelector('#pkPlayers')?.textContent || '';
    return text.toLowerCase().includes(a.toLowerCase()) && text.toLowerCase().includes(b.toLowerCase());
  }, { a: name1, b: name2 }, { timeout: 10000 });
  const watermark = (await page.locator('[data-version-watermark], .site-credit-watermark').allTextContents().catch(() => [])).join(' ');
  if (!watermark.includes('v805')) throw new Error(`${label} missing v805 watermark`);
  console.log(`PIKKEN_RENDER_PASS label=${JSON.stringify(label)} auth_settle_after_dom_ms=${elapsed} blank_at_900=${at900.bodyLength < 20}`);
}

async function destroy(id) {
  try {
    await rpc('pikken_destroy_game_fast_v687', tokenPayload(token1, { game_id_input: id }));
    created.delete(id);
  } catch (error) {
    console.log(`PIKKEN_STRESS_CLEANUP_WARNING game=${id} ${safe(error)}`);
  }
}

const browser = await chromium.launch({ headless: true });
try {
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    const lobby = await rpc('pikken_create_lobby_fast_v687', tokenPayload(token1, {
      config_input: { penalty_mode: 'wrong_loses', start_dice: 1, pikken_render_stress: true },
    }));
    const id = String(lobby?.game?.id || lobby?.game_id || lobby?.id || '').trim();
    const code = String(lobby?.game?.lobby_code || lobby?.lobby_code || lobby?.code || '').trim();
    if (!id || !code) throw new Error(`cycle ${cycle} create missing id/code`);
    created.add(id);
    await rpc('pikken_join_lobby_fast_v687', tokenPayload(token2, { lobby_code_input: code }));

    const c1 = await newContext(browser, token1);
    const c2 = await newContext(browser, token2);
    try {
      const p1 = await c1.newPage();
      const p2 = await c2.newPage();
      const errors = [];
      for (const [page, label] of [[p1, 'p1'], [p2, 'p2']]) {
        page.on('pageerror', (e) => errors.push(`${label}:pageerror:${safe(e)}`));
        page.on('console', (msg) => {
          if (msg.type() === 'error' && !/favicon|Failed to load resource.*404/i.test(msg.text())) errors.push(`${label}:console:${msg.text()}`);
        });
      }
      const url = new URL(`pikken.html?game_id=${encodeURIComponent(id)}`, BASE).toString();
      const [r1, r2] = await Promise.all([
        p1.goto(url, { waitUntil: 'domcontentloaded', timeout }),
        p2.goto(url, { waitUntil: 'domcontentloaded', timeout }),
      ]);
      if (!r1 || r1.status() >= 500 || !r2 || r2.status() >= 500) throw new Error(`cycle ${cycle} document status ${r1?.status()}/${r2?.status()}`);
      await Promise.all([
        assertRendered(p1, `cycle ${cycle} p1 initial`),
        assertRendered(p2, `cycle ${cycle} p2 initial`),
      ]);
      await p2.reload({ waitUntil: 'domcontentloaded', timeout });
      await assertRendered(p2, `cycle ${cycle} p2 reload`);
      if (errors.length) throw new Error(`cycle ${cycle} browser errors ${errors.join(' | ')}`);
      console.log(`PIKKEN_STRESS_CYCLE_PASS cycle=${cycle} initial_pair=true p2_reload=true`);
    } finally {
      await c1.close();
      await c2.close();
    }
    await destroy(id);
  }

  const ordered = [...authSettleMs].sort((a, b) => a - b);
  const p95 = ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] || 0;
  const max = ordered.at(-1) || 0;
  console.log(`RESULT=V805_PIKKEN_AUTH_AWARE_RENDER_STRESS_PASS cycles=${cycles} protected_loads=${authSettleMs.length} blank_while_auth_checking_at_900=${blankWhileCheckingAt900} auth_settle_p95_ms=${p95} auth_settle_max_ms=${max} retries=0`);
} finally {
  for (const id of [...created]) await destroy(id);
  await browser.close();
}
