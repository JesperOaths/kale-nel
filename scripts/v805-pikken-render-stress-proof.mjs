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

async function assertRendered(page, label) {
  await page.waitForTimeout(900);
  if (/login\.html/i.test(page.url())) throw new Error(`${label} login bounce url=${page.url()}`);
  const body = (await page.locator('body').innerText()).trim();
  if (body.length < 20) throw new Error(`${label} empty body len=${body.length} url=${page.url()}`);
  await page.waitForFunction(({ a, b }) => {
    const text = document.querySelector('#pkPlayers')?.textContent || '';
    return text.toLowerCase().includes(a.toLowerCase()) && text.toLowerCase().includes(b.toLowerCase());
  }, { a: name1, b: name2 }, { timeout: 10000 });
  const watermark = (await page.locator('[data-version-watermark], .site-credit-watermark').allTextContents().catch(() => [])).join(' ');
  if (!watermark.includes('v805')) throw new Error(`${label} missing v805 watermark`);
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
  console.log(`RESULT=V805_PIKKEN_FRESH_ROOM_RENDER_STRESS_PASS cycles=${cycles} concurrent_initial_loads=${cycles * 2} p2_reloads=${cycles} retries=0`);
} finally {
  for (const id of [...created]) await destroy(id);
  await browser.close();
}
