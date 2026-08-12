#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const BASE = process.env.V789_PROOF_BASE || 'http://127.0.0.1:4173';
const engines = [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]];
const viewports = [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1366, height: 768 }]
];
const names = ['Ada', 'Bram', 'Caro', 'Daan'];
const failures = [];
let cases = 0;

function playerRows() {
  return names.map((name, i) => ({
    player_id: `p${i + 1}`,
    id: `p${i + 1}`,
    display_name: name,
    player_name: name,
    public_display_name: name,
    login_active: true,
    active: true,
    site_scope: 'friends'
  }));
}
function pikkenFixture() {
  return {
    scope: 'friends',
    summary: {
      rating_pool: 6400,
      player_count: 4,
      matches_played: 12,
      unique_players: 4,
      average_duration_seconds: 480,
      pik_matches: 5,
      pik_bid_rate: 0.25,
      bluff_callouts: 7,
      successful_bluffs: 3,
      bluff_callout_rate: 0.42,
      correct_rejects: 4,
      total_rejects: 6,
      correct_reject_rate: 0.67,
      dice_lost_total: 21,
      average_rounds: 8
    },
    overview_cards: [
      { label: 'Wedstrijden', value: 12, sub: 'Gespeeld' },
      { label: 'Spelers', value: 4, sub: 'Uniek' },
      { label: 'Pik-potjes', value: 5, sub: 'Met pik' },
      { label: 'Dobbelstenen kwijt', value: 21, sub: 'Totaal' }
    ],
    story_cards: [
      { label: 'Blufkoning', value: 'Ada', sub: '3 succesvolle blufs' },
      { label: 'Scherpste afwijzer', value: 'Bram', sub: '67% goed' },
      { label: 'Langste adem', value: 'Caro', sub: '8 rondes gemiddeld' }
    ],
    leaderboard_sections: [
      { title: 'Pikken ladder', subtitle: 'Algemeen', rows: [
        { label: 'Ada', value: 1710, sub: '1e plaats' },
        { label: 'Bram', value: 1635, sub: '2e plaats' }
      ] },
      { title: 'Meeste wins', subtitle: 'Overwinningen', rows: [{ label: 'Caro', value: 5, sub: 'wins' }] },
      { title: 'Meeste piks', subtitle: 'Pik-statistiek', rows: [{ label: 'Daan', value: 4, sub: 'piks' }] }
    ],
    table_sections: [
      { title: 'Head-to-head', subtitle: 'Recente stand', columns: ['Speler', 'Wins'], rows: [
        { Speler: 'Ada', Wins: 5 },
        { Speler: 'Bram', Wins: 4 }
      ] }
    ],
    recent_rows: [
      { label: 'Ada won van Bram', value: 'vandaag', sub: 'Pikken' }
    ]
  };
}
function rpcName(url) {
  try { return decodeURIComponent(new URL(url).pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/)?.[1] || ''); }
  catch { return ''; }
}
function readPayload(name) {
  if (/^(get_login_active_names_v687|get_login_names_scoped|get_login_names|get_player_selector_source_v1|get_game_player_names_fast_v687)$/.test(name)) return playerRows();
  if (/^(get_public_state|get_gejast_homepage_state|get_jas_app_state|account_public_state_v687)$/.test(name)) {
    return { session_valid: true, is_logged_in: true, my_name: 'Ada', display_name: 'Ada', player_name: 'Ada', viewer: { player_id: 'p1', display_name: 'Ada' } };
  }
  if (name === 'get_pikken_stats_scoped') return pikkenFixture();
  return [];
}
async function makeContext(browser, viewport) {
  const context = await browser.newContext({ viewport, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam', serviceWorkers: 'block' });
  const calls = [];
  await context.addInitScript(() => {
    localStorage.setItem('jas_session_token_v11', 'v789-proof-session');
    sessionStorage.setItem('jas_session_token_v11', 'v789-proof-session');
  });
  await context.route('**/*', async (route) => {
    const req = route.request();
    let url;
    try { url = new URL(req.url()); } catch { return route.continue(); }

    if (url.origin === BASE && /\/gejast-home-gate\.js$/.test(url.pathname)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: "document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');document.body&&document.body.classList.remove('boot-pending');window.GEJAST_HOME_GATE={proof:true};"
      });
    }
    if (url.origin === BASE && /\/gejast-config\.js$/.test(url.pathname)) {
      const upstream = await route.fetch();
      const body = await upstream.text();
      return route.fulfill({
        response: upstream,
        contentType: 'application/javascript',
        body: `${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`
      });
    }
    if (url.hostname.includes('supabase.co') && url.pathname.includes('/rest/v1/rpc/')) {
      const name = rpcName(req.url());
      calls.push({ name, method: req.method() });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(readPayload(name))
      });
    }
    if (url.hostname.includes('supabase.co')) {
      calls.push({ name: `OTHER:${url.pathname}`, method: req.method() });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
    }
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
  return { context, calls };
}
async function open(context, path) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error?.message || error)));
  const response = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.ok(response && response.status() < 400, `${path}: HTTP ${response?.status()}`);
  assert.equal(new URL(page.url()).pathname, new URL(`${BASE}${path}`).pathname, `${path}: unexpected redirect to ${page.url()}`);
  return { page, errors };
}
async function selectByText(page, selector, text) {
  await page.waitForFunction(({ selector, text }) => [...document.querySelectorAll(`${selector} option`)].some((option) => option.textContent.trim() === text), { selector, text }, { timeout: 7000 });
  await page.locator(selector).selectOption({ label: text });
}
async function proveScorer(context, calls, label) {
  const { page, errors } = await open(context, '/scorer.html?runtimeproof=1');
  await page.locator('#setupOverlay.show').waitFor({ timeout: 8000 });
  await selectByText(page, '#playerW1', 'Ada');
  await selectByText(page, '#playerZ1', 'Bram');
  await selectByText(page, '#playerW2', 'Caro');
  await selectByText(page, '#playerZ2', 'Daan');
  await page.getByRole('button', { name: 'Opslaan en bieding kiezen' }).click();
  await page.locator('#bidOverlay.show').waitFor({ timeout: 5000 });
  await page.locator('[data-team-choice="W"]').click();
  await page.locator('[data-suit="♠"]').click();

  const layers = await page.evaluate(() => ({
    overlay: Number(getComputedStyle(document.querySelector('#bidOverlay')).zIndex || 0),
    manage: Number(getComputedStyle(document.querySelector('.manage-match-chip')).zIndex || 0),
    home: Number(getComputedStyle(document.querySelector('.page-floating-logo')).zIndex || 0)
  }));
  assert.ok(layers.overlay > layers.manage && layers.overlay > layers.home, `${label}: modal layer is not top-owned: ${JSON.stringify(layers)}`);

  const save = page.getByRole('button', { name: 'Bieding bewaren' });
  await save.click();
  await page.waitForFunction(() => !document.querySelector('#bidOverlay')?.classList.contains('show'), null, { timeout: 5000 });
  assert.deepEqual(errors, [], `${label}: scorer page errors: ${errors.join(' | ')}`);
  assert.ok(calls.every((call) => call.method === 'GET' || call.method === 'HEAD' || /^(get_|account_public_)/.test(call.name)), `${label}: unexpected non-read scorer RPC ${JSON.stringify(calls)}`);
  await page.close();
}
async function provePikkenLadder(context, calls, label) {
  const { page, errors } = await open(context, '/pikken_ladder.html?runtimeproof=1');
  await page.waitForFunction(() => document.querySelector('#ladderStatus')?.textContent.includes('geladen'), null, { timeout: 8000 });
  assert.equal(await page.locator('#ladderOverviewGrid .market-card').count(), 4, `${label}: overview cards`);
  assert.equal(await page.locator('#ladderStoryGrid .market-card').count(), 3, `${label}: story cards`);
  assert.ok(await page.locator('#ladderRows .ledger-row').count() >= 2, `${label}: main ladder rows missing`);
  assert.ok(await page.locator('#ladderSectionsWrap .panel').count() >= 2, `${label}: secondary ladder sections missing`);
  assert.ok(await page.locator('#ladderTablesWrap .panel').count() >= 1, `${label}: table section missing`);
  assert.ok(await page.locator('#ladderHistory .ledger-row').count() >= 1, `${label}: recent history missing`);
  assert.match(await page.locator('body').innerText(), /Blufkoning/);
  assert.match(await page.locator('body').innerText(), /Ada/);
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);
  assert.ok(overflow <= 6, `${label}: Pikken ladder horizontal overflow ${overflow}px`);
  assert.deepEqual(errors, [], `${label}: Pikken ladder page errors: ${errors.join(' | ')}`);
  assert.ok(calls.some((call) => call.name === 'get_pikken_stats_scoped'), `${label}: scoped Pikken stats RPC was not used`);
  assert.ok(calls.every((call) => call.method === 'GET' || call.method === 'HEAD' || /^(get_|account_public_)/.test(call.name)), `${label}: unexpected non-read ladder RPC ${JSON.stringify(calls)}`);
  await page.close();
}

for (const [engineName, engine] of engines) {
  const browser = await engine.launch({ headless: true });
  for (const [viewportName, viewport] of viewports) {
    for (const [name, proof] of [['scorer-pointer', proveScorer], ['pikken-ladder', provePikkenLadder]]) {
      cases += 1;
      const { context, calls } = await makeContext(browser, viewport);
      const label = `${engineName}/${viewportName}/${name}`;
      try {
        await proof(context, calls, label);
        console.log(`V789_RUNTIME_PROOF_PASS ${label}`);
      } catch (error) {
        failures.push(`${label}: ${error?.stack || error}`);
        console.error(`V789_RUNTIME_PROOF_FAIL ${label}: ${error?.stack || error}`);
      } finally {
        await context.close();
      }
    }
  }
  await browser.close();
}

console.log(`V789_RUNTIME_PROOF_CASES=${cases}`);
console.log(`V789_RUNTIME_PROOF_FAILURES=${failures.length}`);
if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
assert.equal(cases, 12);
console.log('V789_GAMEPLAY_RUNTIME_PROOF=PASS');
