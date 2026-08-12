#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const BASE = process.env.V789_BASE_URL || 'http://127.0.0.1:4173';
const NAMES = ['Ada','Bram','Caro','Daan','Evi','Fons','Gijs','Hugo'];
const engines = [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]];
const failures = [];
const passes = [];

function rpcName(url) {
  try { return decodeURIComponent(new URL(url).pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/)?.[1] || ''); }
  catch { return ''; }
}
function playerRows() {
  return NAMES.map((name, i) => ({ player_id:`p${i+1}`, id:`p${i+1}`, display_name:name, player_name:name, public_display_name:name, login_active:true, active:true, site_scope:'friends' }));
}
function paardState(state) {
  if (!state.paard.exists) return { room:null, players:[], viewer:{} };
  const ada = {
    player_id:'p1', player_name:'Ada', selected_suit:state.paard.locked ? 'spades' : null,
    selected_suit_label:state.paard.locked ? 'Schoppen' : '', wager_bakken:state.paard.locked ? 1 : 0,
    wager_verified:state.paard.locked, is_ready:state.paard.ready
  };
  const bram = { player_id:'p2', player_name:'Bram', selected_suit:'hearts', selected_suit_label:'Harten', wager_bakken:1, wager_verified:true, is_ready:true };
  return {
    room:{ room_code:'PR789', stage:state.paard.stage, stage_label:state.paard.stage, host_name:'Ada', can_start:state.paard.ready },
    players:[ada, bram],
    viewer:{ ...ada, is_host:true, has_locked_choice:state.paard.locked },
    pending_verifications:[]
  };
}
function pikkenState(state) {
  if (!state.pikken.exists) return { game:null, players:[], viewer:{} };
  return {
    game:{ id:'pk-v789', game_id:'pk-v789', lobby_code:'PK789', status:state.pikken.phase, state:{ phase:state.pikken.phase, current_turn_player_id:'p1', current_bid:state.pikken.phase==='bidding'?{count:1,face:2,player_id:'p2'}:null } },
    game_id:'pk-v789', lobby_code:'PK789', code:'PK789',
    players:[
      {player_id:'p1', player_name:'Ada', display_name:'Ada', dice_count:6, is_ready:state.pikken.ready, alive:true, is_alive:true},
      {player_id:'p2', player_name:'Bram', display_name:'Bram', dice_count:6, is_ready:true, alive:true, is_alive:true}
    ],
    viewer:{ player_id:'p1', player_name:'Ada', is_host:true, is_ready:state.pikken.ready }
  };
}
function mockRpc(name, payload, state) {
  if (/^(get_login_active_names_v687|get_login_names_scoped|get_login_names|get_player_selector_source_v1)$/.test(name)) return playerRows();
  if (/^(get_public_state|get_gejast_homepage_state|get_jas_app_state|account_public_state_v687)$/.test(name)) {
    return { session_valid:true, is_logged_in:true, my_name:'Ada', display_name:'Ada', player_name:'Ada', viewer:{player_id:'p1',display_name:'Ada',player_name:'Ada'} };
  }
  if (name === 'get_toepen_app_state') return { recent_games:[] };
  if (name === 'create_toepen_game') return { ok:true, game_id:'toep-v789' };
  if (name === 'get_beerpong_leaderboard_public') return { leaderboard:[], recent_matches:[] };
  if (name === 'get_beerpong_pussycup_ranking_public') return { ranking:[] };
  if (name === 'save_beerpong_match') return { ok:true, match_id:'bp-v789' };
  if (/^get_paardenrace_open_rooms/.test(name) || /^get_paardenrace_stats/.test(name)) return [];
  if (name === 'create_paardenrace_room_fast_v687') { state.paard.exists=true; state.paard.locked=false; state.paard.ready=false; state.paard.stage='lobby'; return paardState(state); }
  if (name === 'get_paardenrace_room_state_fast_v687') return paardState(state);
  if (name === 'update_paardenrace_room_choice_safe') { state.paard.exists=true; state.paard.locked=true; return paardState(state); }
  if (name === 'verify_paardenrace_wager_safe') { state.paard.locked=true; return paardState(state); }
  if (name === 'set_paardenrace_ready_safe') { state.paard.ready=Boolean(payload?.ready_input); return paardState(state); }
  if (name === 'start_paardenrace_countdown_safe') { state.paard.stage='countdown'; state.paard.ready=true; return paardState(state); }
  if (/^(leave_paardenrace_room|disband_paardenrace_room_fast_v687)/.test(name)) { state.paard.exists=false; return {ok:true}; }
  if (/^get_pikken_open_lobbies/.test(name) || /^get_pikken_live_matches/.test(name)) return [];
  if (name === 'pikken_create_lobby_fast_v687') { state.pikken.exists=true; state.pikken.phase='lobby'; state.pikken.ready=false; return pikkenState(state); }
  if (name === 'pikken_get_state_scoped') return pikkenState(state);
  if (name === 'pikken_set_ready_scoped') { state.pikken.ready=Boolean(payload?.ready_input); return pikkenState(state); }
  if (name === 'pikken_update_lobby_config_v715') return pikkenState(state);
  if (name === 'pikken_start_game_scoped') { state.pikken.phase='bidding'; state.pikken.ready=true; return pikkenState(state); }
  if (/^pikken_(place_bid|challenge|call|reject|resolve)/.test(name)) return pikkenState(state);
  if (/^pikken_(destroy|leave)/.test(name)) { state.pikken.exists=false; return {ok:true}; }
  if (/^(get_homepage|get_drinks_homepage|get_homepage_ladders|get_beta|get_live|get_shared|get_recent|get_.*leaderboard|get_.*stats|get_.*matches|get_.*rooms|get_.*lobbies)/.test(name)) return [];
  if (/^(save_|create_|update_|set_|start_|join_|leave_|delete_|submit_|cast_|record_|sync_|upsert_|request_)/.test(name)) return { ok:true, client_match_id:`v789-${name}`, room_code:'V789', game_id:'v789-game' };
  return [];
}

async function makeContext(browser, viewport={width:390,height:844}) {
  const state = { paard:{exists:false,locked:false,ready:false,stage:'lobby'}, pikken:{exists:false,ready:false,phase:'lobby'} };
  const calls = [];
  const context = await browser.newContext({ viewport, locale:'nl-NL', timezoneId:'Europe/Amsterdam', serviceWorkers:'block' });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('jas_session_token_v11','v789-safe-session');
      sessionStorage.setItem('jas_session_token_v11','v789-safe-session');
      sessionStorage.setItem('toepen_names_v1', JSON.stringify(['Ada','Bram','Caro','Daan','Evi','Fons','Gijs','Hugo']));
    } catch (_) {}
    window.confirm = () => true;
    window.alert = () => {};
  });
  await context.route('**/*', async (route) => {
    const req = route.request();
    let url; try { url = new URL(req.url()); } catch { return route.continue(); }
    if (url.hostname.includes('supabase.co') && url.pathname.includes('/rest/v1/rpc/')) {
      const name = rpcName(req.url());
      let payload = {};
      try { payload = req.postDataJSON() || {}; } catch {}
      calls.push({ name, method:req.method(), payload });
      const body = mockRpc(name, payload, state);
      return route.fulfill({ status:200, contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:JSON.stringify(body) });
    }
    if (url.hostname.includes('supabase.co') && url.pathname.includes('/rest/v1/')) {
      calls.push({ name:`REST:${req.method()}:${url.pathname}`, method:req.method(), payload:{} });
      return route.fulfill({ status:200, contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:'[]' });
    }
    if (url.pathname === '/favicon.ico') return route.fulfill({status:204,body:''});
    return route.continue();
  });
  return {context,calls,state};
}

async function openPage(context, path) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e)=>pageErrors.push(String(e?.message||e)));
  const response = await page.goto(`${BASE}${path}`, { waitUntil:'domcontentloaded', timeout:30000 });
  assert.ok(response && response.status() < 400, `${path} navigation failed: ${response?.status()}`);
  await page.waitForTimeout(350);
  return {page,pageErrors};
}
async function expectNoPageErrors(pageErrors, label) {
  assert.deepEqual(pageErrors, [], `${label} page errors: ${pageErrors.join(' | ')}`);
}
async function selectByText(page, selector, text) {
  await page.waitForFunction(({selector,text}) => [...document.querySelectorAll(`${selector} option`)].some(o => o.textContent.trim() === text), {selector,text}, {timeout:7000});
  await page.locator(selector).selectOption({label:text});
}
async function caseRun(engine, browser, label, fn) {
  const {context,calls,state} = await makeContext(browser);
  try {
    await fn(context,calls,state);
    passes.push(`${engine}:${label}`);
    console.log(`PLAYTEST_PASS ${engine} ${label}`);
  } catch (error) {
    failures.push(`${engine}:${label}: ${error?.stack || error}`);
    console.error(`PLAYTEST_FAIL ${engine} ${label}: ${error?.stack || error}`);
  } finally {
    await context.close();
  }
}

async function playScorer(context) {
  const {page,pageErrors} = await openPage(context, '/scorer.html?v789play=1');
  await page.locator('#setupOverlay.show').waitFor({timeout:8000});
  await selectByText(page, '#playerW1', 'Ada');
  await selectByText(page, '#playerZ1', 'Bram');
  await selectByText(page, '#playerW2', 'Caro');
  await selectByText(page, '#playerZ2', 'Daan');
  await page.getByRole('button',{name:'Opslaan en bieding kiezen'}).click();
  for (let round=1; round<=16; round++) {
    await page.locator('#bidOverlay.show').waitFor({timeout:5000});
    await page.locator('[data-team-choice="W"]').click();
    await page.locator('[data-suit="♠"]').click();
    await page.getByRole('button',{name:'Bieding bewaren'}).click();
    await page.locator('#inputW').fill('90');
    await page.locator('#saveRoundBtn').click();
  }
  await assertVisibleEnabled(page, '#saveMatchBtn');
  const before = await page.locator('#totalW').textContent();
  assert.ok(Number(before) > 0, 'Klaverjas round scorer total did not advance');
  await page.locator('#saveMatchBtn').click();
  await page.waitForURL(/klaverjas_scorer_v596_repo_ready\.html.*handoff=1/, {timeout:8000});
  await page.waitForFunction(() => document.querySelector('#a1')?.value === 'Ada' && Number(document.querySelector('#scoreA')?.value || 0) > 0, null, {timeout:8000});
  assert.equal(await page.locator('#a1').inputValue(), 'Ada');
  assert.ok(Number(await page.locator('#scoreA').inputValue()) > 0);
  await expectNoPageErrors(pageErrors, 'scorer');
  await page.close();
}
async function assertVisibleEnabled(page, selector) {
  const el = page.locator(selector);
  await el.waitFor({state:'visible',timeout:6000});
  assert.equal(await el.isDisabled(), false, `${selector} should be enabled`);
}

async function playToepen(context, calls) {
  const {page,pageErrors} = await openPage(context, '/toepen.html?v789play=1');
  await page.locator('#setupDialog').waitFor({state:'visible',timeout:8000});
  for (const [i,name] of ['Ada','Bram','Caro','Daan'].entries()) await selectByText(page, `#setupPlayers select[data-seat="${i}"]`, name);
  await page.locator('#target').selectOption('10');
  await page.locator('#dealer').selectOption('0');
  await page.locator('#setupForm').evaluate((form)=>form.requestSubmit());
  await page.waitForFunction(() => !document.querySelector('#roundForm')?.hidden);
  await page.locator('#stake').selectOption('10');
  await page.locator('#roundForm').evaluate((form)=>form.requestSubmit());
  await page.waitForFunction(() => document.querySelector('#activeStat')?.textContent === '1/4', null, {timeout:5000});
  assert.equal(await page.locator('#finishBtn').isDisabled(), false, 'Toepen finish must enable with one active player');
  await page.locator('#undoBtn').click();
  await page.waitForFunction(() => document.querySelector('#activeStat')?.textContent === '4/4');
  await page.locator('#stake').selectOption('10');
  await page.locator('#roundForm').evaluate((form)=>form.requestSubmit());
  await page.waitForFunction(() => document.querySelector('#activeStat')?.textContent === '1/4');
  await page.locator('#finishBtn').click();
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('opgeslagen'), null, {timeout:5000});
  assert.ok(calls.some(c=>c.name==='create_toepen_game'), 'Toepen finish never called create_toepen_game');
  await expectNoPageErrors(pageErrors, 'toepen');
  await page.close();
}

async function playBoerenbridge(context) {
  const {page,pageErrors} = await openPage(context, '/boerenbridge.html?v789play=1');
  await page.locator('#setupOverlay.show').waitFor({timeout:8000});
  await page.locator('#playerCountInput').selectOption('4');
  for (const [i,name] of ['Ada','Bram','Caro','Daan'].entries()) await selectByText(page, `#playerFields select[data-player-index="${i}"]`, name);
  await page.locator('#dealerInput').selectOption('0');
  await page.locator('#setupSaveBtn').click();
  await page.locator('#bidOverlay.show').waitFor({timeout:5000});
  const bids = page.locator('[data-bid-player-index]');
  for (let i=0;i<await bids.count();i++) await bids.nth(i).selectOption('1');
  await page.locator('#bidSaveBtn').click();
  await page.locator('#wonOverlay.show').waitFor({timeout:5000});
  const won = page.locator('[data-won-player-index]');
  const maxValue = await won.nth(0).locator('option').last().getAttribute('value');
  for (let i=0;i<await won.count();i++) await won.nth(i).selectOption(i===0 ? maxValue : '0');
  await page.locator('#wonSaveBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#roundBody tr.done-row:not(.totals-row)').length >= 1, null, {timeout:5000});
  if (await page.locator('#bidOverlay.show').count()) await page.locator('#bidCancelBtn').click();
  await page.locator('#undoBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#roundBody tr.done-row:not(.totals-row)').length === 0, null, {timeout:5000});
  await expectNoPageErrors(pageErrors, 'boerenbridge');
  await page.close();
}

async function playBeerpong(context, calls) {
  const {page,pageErrors} = await openPage(context, '/beerpong.html?v789play=1');
  for (const [selector,name] of [['#teamA1','Ada'],['#teamA2','Bram'],['#teamB1','Caro'],['#teamB2','Daan']]) await selectByText(page, selector, name);
  await page.locator('#cupsA').fill('10');
  await page.locator('#cupsB').fill('6');
  await page.locator('#pussycupA').check();
  await page.locator('#notesInput').fill('v789 isolated playtest');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => document.querySelector('#formStatus')?.textContent.includes('opgeslagen'), null, {timeout:5000});
  assert.ok(calls.some(c=>c.name==='save_beerpong_match'), 'Beerpong save RPC was not called');
  await page.locator('#resetBtn').click();
  assert.equal(await page.locator('#cupsA').inputValue(), '0');
  assert.equal(await page.locator('#cupsB').inputValue(), '0');
  await expectNoPageErrors(pageErrors, 'beerpong');
  await page.close();
}

async function playRad(context) {
  const {page,pageErrors} = await openPage(context, '/rad.html?v789play=1');
  await page.evaluate(() => { Math.random = () => 0.001; });
  await page.locator('#spinBtn').click();
  await page.waitForFunction(() => !document.querySelector('#resultBox')?.textContent.includes('Nog niet gedraaid'), null, {timeout:12000});
  const result = (await page.locator('#resultBox').textContent())?.trim() || '';
  assert.ok(result.length > 3, 'Rad returned no result');
  await expectNoPageErrors(pageErrors, 'rad');
  await page.close();
}

async function playPaardenrace(context, calls) {
  const {page,pageErrors} = await openPage(context, '/paardenrace.html?v789play=1');
  await page.locator('#createBtn').click();
  await page.waitForFunction(() => document.querySelector('#roomCodeLabel')?.textContent === 'PR789', null, {timeout:6000});
  assert.ok(calls.some(c=>c.name==='create_paardenrace_room_fast_v687'), 'Paardenrace create RPC not called');
  await page.locator('#suitInput').selectOption('spades');
  await page.locator('#wagerInput').fill('1');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#savedChoiceBox')).display !== 'none', null, {timeout:5000});
  await assertVisibleEnabled(page, '#readyBtn');
  await page.locator('#readyBtn').click();
  await page.waitForFunction(() => document.querySelector('#roomReadyStat')?.textContent === '2/2', null, {timeout:5000});
  if (await page.locator('#startBtn').isEnabled()) {
    await page.locator('#startBtn').click();
    await page.waitForTimeout(300);
    assert.ok(calls.some(c=>c.name==='start_paardenrace_countdown_safe'), 'Paardenrace start RPC not called');
  }
  await expectNoPageErrors(pageErrors, 'paardenrace');
  await page.close();
}

async function playPikken(context, calls) {
  const {page,pageErrors} = await openPage(context, '/pikken.html?v789play=1');
  await page.locator('#pkCreateLobbyBtn').click();
  await page.waitForTimeout(700);
  assert.ok(calls.some(c=>c.name==='pikken_create_lobby_fast_v687'), 'Pikken create RPC not called');
  const code = (await page.locator('#pkLobbyCode').textContent())?.trim();
  assert.ok(code && code !== '-', `Pikken lobby code did not render (${code})`);
  if (await page.locator('#pkReadyBtn').isVisible() && await page.locator('#pkReadyBtn').isEnabled()) {
    await page.locator('#pkReadyBtn').click();
    await page.waitForTimeout(250);
  }
  if (await page.locator('#pkStartBtn').isVisible() && await page.locator('#pkStartBtn').isEnabled()) {
    await page.locator('#pkStartBtn').click();
    await page.waitForTimeout(350);
  }
  await expectNoPageErrors(pageErrors, 'pikken');
  await page.close();
}

async function playKlaverjasEngine(context) {
  const {page,pageErrors} = await openPage(context, '/klaverjas_online.html?v789play=1');
  const proof = await page.evaluate(() => {
    const rt = window.GEJAST_KLAVERJAS_ONLINE;
    if (!rt) return {missing:true};
    const deck = rt.createDeck();
    const hands = rt.deal(deck, 0);
    const bids = rt.availableBids(null);
    const hand = [{suit:'hearts',rank:'A',id:'hearts-A'},{suit:'clubs',rank:'7',id:'clubs-7'}];
    const legal = rt.legalCards(hand, [{player:1,card:{suit:'hearts',rank:'7',id:'hearts-7'}}], 0, 'spades');
    return { deck:deck.length, hands:hands.map(h=>h.length), pass:bids.some(b=>b.action==='pass'), suit80:bids.some(b=>b.mode==='suit'&&b.points===80), legal:legal.map(c=>c.id) };
  });
  assert.equal(proof.missing, undefined, 'Klaverjas online runtime missing');
  assert.equal(proof.deck, 32, 'Klaverjas deck must contain 32 cards');
  assert.deepEqual(proof.hands, [8,8,8,8], 'Klaverjas deal must produce four 8-card hands');
  assert.equal(proof.pass, true, 'Klaverjas bidding must allow pass');
  assert.equal(proof.suit80, true, 'Klaverjas bidding must expose 80 suit bid');
  assert.deepEqual(proof.legal, ['hearts-A'], 'Klaverjas legal-card logic must require following suit');
  await expectNoPageErrors(pageErrors, 'klaverjas-online');
  await page.close();
}

const SURFACES = [
  '/klaverjas_live.html','/klaverjas_room.html','/klaverjas_spectator.html','/leaderboard.html',
  '/boerenbridge_live.html','/boerenbridge_spectator.html','/boerenbridge_vault.html',
  '/beerpong_vault.html','/toepen_vault.html',
  '/paardenrace_live.html','/paardenrace_spectator.html','/paardenrace_stats.html','/paardenrace_ladder.html',
  '/pikken_live.html','/pikken_spectator.html','/pikken_stats.html','/pikken_ladder.html',
  '/beurs.html','/despimarkt.html','/ballroom.html','/drinks_speed.html','/drinks.html'
];
async function smokeAllSurfaces(context) {
  for (const path of SURFACES) {
    const {page,pageErrors} = await openPage(context, `${path}?v789play=1`);
    const state = await page.evaluate(() => ({title:document.title.trim(), text:(document.body?.innerText||'').trim(), width:document.documentElement.scrollWidth, viewport:innerWidth}));
    assert.ok(state.title, `${path} missing title`);
    assert.ok(state.text.length > 8, `${path} effectively empty`);
    assert.ok(state.width <= state.viewport + 6, `${path} horizontal overflow ${state.width-state.viewport}px`);
    await expectNoPageErrors(pageErrors, path);
    await page.close();
  }
}

for (const [engineName, engine] of engines) {
  const browser = await engine.launch({headless:true});
  await caseRun(engineName,browser,'klaverjas-round-scorer-16-round-handoff',playScorer);
  await caseRun(engineName,browser,'toepen-win-undo-replay-save',playToepen);
  await caseRun(engineName,browser,'boerenbridge-bid-won-undo',playBoerenbridge);
  await caseRun(engineName,browser,'beerpong-save-reset',playBeerpong);
  await caseRun(engineName,browser,'rad-spin',playRad);
  await caseRun(engineName,browser,'paardenrace-lobby-choice-ready-start',playPaardenrace);
  await caseRun(engineName,browser,'pikken-create-ready-start',playPikken);
  await caseRun(engineName,browser,'klaverjas-online-rules-engine',playKlaverjasEngine);
  await caseRun(engineName,browser,'all-secondary-live-vault-stats-surfaces',smokeAllSurfaces);
  await browser.close();
}

console.log(`V789_PLAYTEST_PASSES=${passes.length}`);
console.log(`V789_PLAYTEST_FAILURES=${failures.length}`);
if (failures.length) {
  console.error('V789_FULL_GAMEPLAY_PLAYTEST=FAIL');
  failures.forEach((f)=>console.error(`- ${f}`));
  process.exit(1);
}
console.log('V789_FULL_GAMEPLAY_PLAYTEST=PASS');
