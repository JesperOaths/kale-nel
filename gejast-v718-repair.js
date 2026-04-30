(function(){
  'use strict';
  const VERSION = 'v718';
  const PIKKEN_PARTICIPANT_KEYS = ['gejast_pikken_participant_v687','gejast_pikken_participant_v632'];
  const PAARDENRACE_ROOM_KEYS = ['gejast_paardenrace_room_code_v687','gejast_paardenrace_room_code_v506'];
  const esc = (v)=>String(v ?? '').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const sleep = (ms)=>new Promise((resolve)=>setTimeout(resolve, ms));
  function qs(id){ return document.getElementById(id); }
  function pageName(){ return String(location.pathname || '').split('/').pop().toLowerCase(); }
  function isPage(name){ return pageName() === String(name || '').toLowerCase(); }
  function normalizeRoomCode(value){
    let s = String(value || '').trim();
    for (let i = 0; i < 3; i += 1) {
      try {
        const d = decodeURIComponent(s);
        if (d === s) break;
        s = d;
      } catch (_) { break; }
    }
    return s.toUpperCase().replace(/\s+/g,' ').replace(/[^A-Z0-9 _-]/g,'').trim();
  }
  function normalizeLobbyCode(value){ return normalizeRoomCode(value); }
  function removeQueryKeys(keys){
    try {
      const url = new URL(location.href);
      let changed = false;
      keys.forEach((key)=>{ if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; } });
      if (changed) history.replaceState(null, '', `${url.pathname.split('/').pop()}${url.search}${url.hash}`);
    } catch (_) {}
  }
  function normalizePaardenraceLiveUrl(){
    if (!isPage('paardenrace_live.html')) return;
    try {
      const url = new URL(location.href);
      let changed = false;
      ['room','live'].forEach((key)=>{
        const raw = url.searchParams.get(key);
        if (!raw) return;
        const clean = normalizeRoomCode(raw);
        if (clean && raw !== clean) { url.searchParams.set(key, clean); changed = true; }
      });
      const room = normalizeRoomCode(url.searchParams.get('room') || url.searchParams.get('live') || '');
      if (room) {
        if (url.searchParams.get('room') !== room) { url.searchParams.set('room', room); changed = true; }
        if (url.searchParams.get('live') !== room) { url.searchParams.set('live', room); changed = true; }
      }
      if (changed) history.replaceState(null, '', `${url.pathname.split('/').pop()}${url.search}${url.hash}`);
    } catch (_) {}
  }
  function patchPaardenraceApi(){
    const api = window.GEJAST_PAARDENRACE;
    if (!api || api.__v718_patched) return !!api;
    api.__v718_patched = true;
    const originalSet = api.setStoredRoomCode;
    const originalGet = api.getStoredRoomCode;
    api.setStoredRoomCode = function(code){
      const clean = normalizeRoomCode(code);
      return originalSet ? originalSet.call(api, clean) : undefined;
    };
    api.getStoredRoomCode = function(){ return normalizeRoomCode(originalGet ? originalGet.call(api) : ''); };
    api.liveHref = function(room){
      const code = normalizeRoomCode(room);
      const url = new URL('./paardenrace_live.html', window.location.href);
      url.searchParams.set('room', code);
      url.searchParams.set('live', code);
      try { if (api.scope && api.scope() === 'family') url.searchParams.set('scope','family'); } catch (_) {}
      return `${url.pathname.split('/').pop()}${url.search}`;
    };
    api.gotoLive = function(room, options={}){
      const href = api.liveHref(room);
      if (options && options.replace) window.location.replace(href); else window.location.href = href;
    };
    return true;
  }
  function hideManualJoinSurfaces(){
    const cssId = 'gejast-v718-join-hide-css';
    if (!document.getElementById(cssId)) {
      const style = document.createElement('style');
      style.id = cssId;
      style.textContent = `
        #pkJoinFieldWrap,#pkJoinWrap{display:none!important;}
        #joinBtn{display:none!important;}
        #roomCodeInput{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;}
        #roomCodeInput.closest-hidden-fallback{display:none!important;}
        .gejast-v718-hidden-field{display:none!important;}
      `;
      document.head.appendChild(style);
    }
    ['pkJoinFieldWrap','pkJoinWrap'].forEach((id)=>{ const el=qs(id); if (el) el.classList.add('hidden'); });
    const joinBtn = qs('joinBtn');
    if (joinBtn) joinBtn.classList.add('hidden');
    const roomInput = qs('roomCodeInput');
    if (roomInput) {
      const field = roomInput.closest('.field');
      if (field) field.classList.add('gejast-v718-hidden-field');
      roomInput.setAttribute('aria-hidden','true');
      roomInput.tabIndex = -1;
      roomInput.readOnly = true;
    }
    const hint = document.querySelector('.hero-grid .small');
    if (hint && /Maak of join een room/i.test(hint.textContent || '')) hint.textContent = 'Maak een room of join via de Join-knop op een zichtbare lobbykaart.';
  }
  function readStoredPikkenGame(){
    for (const key of PIKKEN_PARTICIPANT_KEYS) {
      try {
        const raw = localStorage.getItem(key) || '';
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const id = String(parsed && (parsed.game_id || parsed.id || parsed.gameId) || '').trim();
        if (id) return id;
      } catch (_) {}
    }
    return '';
  }
  function clearStoredPikkenGame(){
    PIKKEN_PARTICIPANT_KEYS.forEach((key)=>{ try { localStorage.removeItem(key); } catch (_) {} });
    removeQueryKeys(['game_id','client_match_id']);
  }
  function readStoredPaardenraceRoom(){
    for (const key of PAARDENRACE_ROOM_KEYS) {
      try { const value = normalizeRoomCode(localStorage.getItem(key) || ''); if (value) return value; } catch (_) {}
    }
    return '';
  }
  function clearStoredPaardenraceRoom(){
    PAARDENRACE_ROOM_KEYS.forEach((key)=>{ try { localStorage.removeItem(key); } catch (_) {} });
    if (!isPage('paardenrace_live.html')) removeQueryKeys(['room','live']);
  }
  function viewerStillInPikken(payload){
    const viewer = payload && payload.viewer || {};
    if (viewer.is_host) return true;
    const players = Array.isArray(payload && payload.players) ? payload.players : [];
    if (!players.length) return false;
    const viewerId = String(viewer.player_id || viewer.id || '');
    const viewerSeat = Number(viewer.seat || viewer.seat_index || 0);
    const viewerName = String(viewer.player_name || viewer.name || viewer.display_name || '').toLowerCase();
    return players.some((p)=>{
      const pid = String(p.player_id || p.id || '');
      const seat = Number(p.seat || p.seat_index || 0);
      const name = String(p.player_name || p.name || p.display_name || '').toLowerCase();
      return (viewerId && pid === viewerId) || (viewerSeat && seat === viewerSeat) || (viewerName && name === viewerName);
    });
  }
  async function clearDeadPikkenRedirect(){
    const api = window.GEJAST_PIKKEN_CONTRACT;
    if (!api || !api.getState) return;
    const gameId = readStoredPikkenGame();
    if (!gameId) return;
    try {
      const payload = await api.getState(gameId);
      const phase = String(payload?.game?.state?.phase || payload?.game?.status || payload?.game?.status || '').toLowerCase();
      if (!payload?.game?.id || ['finished','deleted','closed','abandoned'].includes(phase) || !viewerStillInPikken(payload)) clearStoredPikkenGame();
    } catch (_) {
      clearStoredPikkenGame();
    }
  }
  async function clearDeadPaardenraceRoom(){
    const api = window.GEJAST_PAARDENRACE;
    if (!api || !api.rpc) return;
    const room = normalizeRoomCode((new URLSearchParams(location.search).get('room') || new URLSearchParams(location.search).get('live') || readStoredPaardenraceRoom() || ''));
    if (!room) return;
    try {
      const state = await api.rpc('get_paardenrace_room_state_fast_v687', { room_code_input: room }, { timeoutMs: 1800 });
      const stage = String(state?.room?.stage || '').toLowerCase();
      if (!state?.room || ['closed','deleted','archived','abandoned'].includes(stage)) clearStoredPaardenraceRoom();
    } catch (_) {
      if (!isPage('paardenrace_live.html')) clearStoredPaardenraceRoom();
    }
  }
  function renderPikkenLobbies(rows){
    const box = qs('pkLobbyFeed');
    if (!box) return;
    const list = Array.isArray(rows) ? rows : (rows?.rows || rows?.items || rows?.lobbies || rows?.matches || []);
    box.innerHTML = list.length ? list.map((r)=>{
      const code = normalizeLobbyCode(r.lobby_code || r.code || '');
      return `<article class="feed-card"><div class="feed-head"><div><div class="feed-title">${esc(code.replace(/^DESPINOZA (\d+)$/i,'Despinoza $1'))}</div><div class="feed-meta">${esc(r.host_name || r.created_by_player_name || 'Host')} - ${Number(r.player_count || 0)} speler(s) - ${Number(r.ready_count || 0)} ready</div></div><span class="pill wait">Lobby</span></div><div class="feed-actions"><button class="btn alt tiny" data-join-code="${esc(code)}">Join</button></div></article>`;
    }).join('') : '<div class="muted">Geen open Pikken-lobbies.</div>';
  }
  function renderPikkenLive(rows){
    const box = qs('pkLiveFeed');
    if (!box) return;
    const api = window.GEJAST_PIKKEN_CONTRACT;
    const list = Array.isArray(rows) ? rows : (rows?.rows || rows?.items || rows?.lobbies || rows?.matches || []);
    const liveHref = (id)=>`./pikken_live.html?client_match_id=${encodeURIComponent(String(id||''))}${api && api.scope && api.scope()==='family'?'&scope=family':''}`;
    box.innerHTML = list.length ? list.map((r)=>`<article class="feed-card"><div class="feed-head"><div><div class="feed-title">${esc(normalizeLobbyCode(r.lobby_code || r.code || 'Pikken').replace(/^DESPINOZA (\d+)$/i,'Despinoza $1'))}</div><div class="feed-meta">${esc(r.phase || r.status || 'live')} - ronde ${Number(r.round_no || 0)} - ${Number(r.player_count || 0)} speler(s)</div></div><span class="pill ok">Live</span></div><div class="feed-actions"><a class="btn alt tiny" href="${liveHref(r.game_id || r.id)}">Open live</a></div></article>`).join('') : '<div class="muted">Geen live Pikken-matches.</div>';
  }
  async function refreshPikkenFeeds(){
    const api = window.GEJAST_PIKKEN_CONTRACT;
    if (!api || !api.openLobbies || !isPage('pikken.html') || document.hidden) return;
    try { renderPikkenLobbies(await api.openLobbies()); } catch (_) {}
    try { renderPikkenLive(await api.liveMatches()); } catch (_) {}
  }
  function renderPaardenraceRooms(rows){
    if (!isPage('paardenrace.html')) return;
    const api = window.GEJAST_PAARDENRACE;
    const list = Array.isArray(rows) ? rows : (rows?.rows || rows?.items || rows?.lobbies || rows?.rooms || []);
    const live = list.filter((r)=>['countdown','race','nominations','finished'].includes(String(r.stage || '').toLowerCase()));
    const open = list.filter((r)=>!['countdown','race','nominations','finished'].includes(String(r.stage || '').toLowerCase()));
    function card(r, liveCard){
      const code = normalizeRoomCode(r.room_code || r.code || '');
      const href = api && api.liveHref ? api.liveHref(code) : `./paardenrace_live.html?room=${encodeURIComponent(code)}&live=${encodeURIComponent(code)}`;
      const action = liveCard ? `<a class="btn alt" href="${href}">Open live</a>` : `<button type="button" class="btn alt" data-room-code="${esc(code)}">Join</button>`;
      return `<div class="room-card" data-room-code="${esc(code)}"><div class="room-head"><div><div class="room-code">${esc(code.replace(/^DESPINOZA (\d+)$/i,'Despinoza $1'))}</div><div class="muted">${esc(r.host_name || 'Host')}</div></div><div class="room-meta"><span class="pill ${liveCard?'ok':'wait'}">${liveCard?'LIVE':'Lobby'}</span><span class="pill wait">${Number(r.player_count || 0)} spelers</span></div></div><div class="muted">${Number(r.ready_count || 0)} ready - pot ${Number(r.total_wager_bakken || r.pot_bakken || 0)} Bakken - fase ${esc(r.stage_label || r.stage || 'lobby')}</div><div class="room-actions">${action}</div></div>`;
    }
    const liveBox = qs('liveRoomsBox');
    const openBox = qs('openRoomsBox');
    if (liveBox) liveBox.innerHTML = live.length ? live.map((r)=>card(r,true)).join('') : '<div class="room-card"><div class="muted">Nog geen live paardenraces.</div></div>';
    if (openBox) openBox.innerHTML = open.length ? open.map((r)=>card(r,false)).join('') : '<div class="room-card"><div class="muted">Nog geen zichtbare rooms.</div></div>';
  }
  async function refreshPaardenraceRooms(){
    const api = window.GEJAST_PAARDENRACE;
    if (!api || !api.rpc || !isPage('paardenrace.html') || document.hidden) return;
    try { renderPaardenraceRooms(await api.rpc('get_paardenrace_open_rooms_fast_v687', { limit_input: 30 }, { timeoutMs: 1800 })); } catch (_) {}
  }
  function bindPaardenraceJoinCards(){
    if (!isPage('paardenrace.html')) return;
    document.addEventListener('click', async (ev)=>{
      const btn = ev.target.closest('[data-room-code] .room-actions button[data-room-code], button[data-room-code]');
      if (!btn) return;
      const api = window.GEJAST_PAARDENRACE;
      if (!api || !api.rpc) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const code = normalizeRoomCode(btn.getAttribute('data-room-code'));
      if (!code) return;
      try {
        await api.rpc('join_paardenrace_room_fast_v687', { room_code_input: code }, { timeoutMs: 2400 });
        api.setStoredRoomCode && api.setStoredRoomCode(code);
        const input = qs('roomCodeInput'); if (input) input.value = code;
        const refresh = qs('refreshBtn'); if (refresh) refresh.click();
      } catch (e) { alert(e.message || String(e)); }
    }, true);
  }
  async function validateAndStartPikken(ev){
    const start = ev.target.closest && ev.target.closest('#pkStartBtn');
    if (!start) return;
    const api = window.GEJAST_PIKKEN_CONTRACT;
    if (!api || !api.getState) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const gameId = (new URLSearchParams(location.search).get('game_id') || readStoredPikkenGame() || '').trim();
    if (!gameId) return alert('Geen actieve Pikken-lobby.');
    try {
      const payload = await api.getState(gameId);
      const viewer = payload.viewer || {};
      const players = Array.isArray(payload.players) ? payload.players : [];
      const material = players.filter((p)=>p && (p.player_id || p.id || p.player_name || p.name));
      const ready = material.filter((p)=>!!(p.is_ready || p.ready));
      if (!viewer.is_host) throw new Error('Alleen de host mag starten.');
      if (material.length < 2) throw new Error('Pikken kan niet starten met minder dan 2 spelers.');
      if (ready.length < material.length) throw new Error('Nog niet iedereen is ready.');
      const dice = Math.max(1, Math.min(8, Number(qs('pkStartDice')?.value || 6) || 6));
      if (api.updateLobbyConfig) await api.updateLobbyConfig(gameId, { start_dice: dice, penalty_mode: qs('pkPenaltyMode')?.value || 'wrong_loses', prev_winner_window_hours: 12 });
      if (api.rpc) await api.rpc('pikken_start_game_scoped_v718', { game_id_input: gameId }, 4200);
      else await api.startGame(gameId);
      location.href = `./pikken_live.html?client_match_id=${encodeURIComponent(gameId)}${api.scope && api.scope()==='family'?'&scope=family':''}`;
    } catch (e) { alert(e.message || String(e)); }
  }
  async function validateAndStartPaardenrace(ev){
    const start = ev.target.closest && ev.target.closest('#startBtn');
    if (!start || !isPage('paardenrace.html')) return;
    const api = window.GEJAST_PAARDENRACE;
    if (!api || !api.rpc) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const code = normalizeRoomCode(qs('roomCodeInput')?.value || readStoredPaardenraceRoom());
    if (!code) return alert('Geen actieve Paardenrace-lobby.');
    try {
      const state = await api.rpc('get_paardenrace_room_state_fast_v687', { room_code_input: code }, { timeoutMs: 2200 });
      const viewer = state.viewer || {};
      const players = Array.isArray(state.players) ? state.players : [];
      const suits = new Set(players.map((p)=>normalizeRoomCode(p.selected_suit || '').toLowerCase()).filter(Boolean));
      const ready = players.filter((p)=>!!p.is_ready).length;
      if (!viewer.is_host) throw new Error('Alleen de host mag starten.');
      if (players.length < 2) throw new Error('Paardenrace kan niet starten met minder dan 2 spelers.');
      if (suits.size < 2) throw new Error('Paardenrace heeft minstens 2 verschillende paarden nodig.');
      if (ready < players.length) throw new Error('Nog niet iedereen is ready.');
      await api.rpc('start_paardenrace_countdown_safe', { room_code_input: code }, { timeoutMs: 4200 });
      api.gotoLive ? api.gotoLive(code) : (location.href = `./paardenrace_live.html?room=${encodeURIComponent(code)}&live=${encodeURIComponent(code)}`);
    } catch (e) { alert(e.message || String(e)); }
  }
  function fixPikkenDiceSelector(){
    const sel = qs('pkStartDice');
    if (!sel || sel.__v718_bound) return;
    sel.__v718_bound = true;
    sel.addEventListener('change', async ()=>{
      const api = window.GEJAST_PIKKEN_CONTRACT;
      const gameId = (new URLSearchParams(location.search).get('game_id') || readStoredPikkenGame() || '').trim();
      if (!api || !api.updateLobbyConfig || !gameId) return;
      try { await api.updateLobbyConfig(gameId, { start_dice: Math.max(1, Math.min(8, Number(sel.value || 6) || 6)) }); }
      catch (e) { console.warn('[v718] start dice update failed', e); }
    });
  }
  async function waitForObjects(){
    for (let i=0; i<80; i+=1) {
      patchPaardenraceApi();
      hideManualJoinSurfaces();
      fixPikkenDiceSelector();
      if ((window.GEJAST_PIKKEN_CONTRACT || !isPage('pikken.html')) && (window.GEJAST_PAARDENRACE || !/^paardenrace/.test(pageName()))) return;
      await sleep(100);
    }
  }
  async function boot(){
    normalizePaardenraceLiveUrl();
    hideManualJoinSurfaces();
    bindPaardenraceJoinCards();
    document.addEventListener('click', validateAndStartPikken, true);
    document.addEventListener('click', validateAndStartPaardenrace, true);
    await waitForObjects();
    patchPaardenraceApi();
    hideManualJoinSurfaces();
    fixPikkenDiceSelector();
    clearDeadPikkenRedirect();
    clearDeadPaardenraceRoom();
    refreshPikkenFeeds();
    refreshPaardenraceRooms();
    setInterval(()=>{ hideManualJoinSurfaces(); fixPikkenDiceSelector(); clearDeadPikkenRedirect(); clearDeadPaardenraceRoom(); refreshPikkenFeeds(); refreshPaardenraceRooms(); }, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true }); else boot();
  window.GEJAST_V718_REPAIR = { VERSION, normalizeRoomCode };
})();
