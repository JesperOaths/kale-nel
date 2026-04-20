(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtils = window.GEJAST_SCOPE_UTILS || {};
  const PIKKEN_PARTICIPANT_KEY = 'jas_pikken_participant_v3';
  const DEFAULT_START_DICE = 6;

  function getScope(){
    try { return (scopeUtils.getScope && scopeUtils.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); }
    catch (_) { return 'friends'; }
  }
  function sessionToken(){
    try { return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; } catch (_) { return ''; }
  }
  function headers(){
    return {
      apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '',
      Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`,
      'Content-Type':'application/json',
      Accept:'application/json'
    };
  }
  async function parse(res){
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || text || `HTTP ${res.status}`);
    return data;
  }
  async function rpc(name, payload){
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method:'POST', headers:headers(), body: JSON.stringify(payload || {}), cache:'no-store', mode:'cors'
    });
    return parse(res);
  }
  async function rpcVariants(name, variants){
    let lastErr = null;
    for (const payload of variants){
      try { return await rpc(name, payload); }
      catch (err){ lastErr = err; }
    }
    throw lastErr || new Error('RPC mislukt.');
  }
  function qs(sel, root){ return (root || document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }
  function esc(s){ const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}; return String(s ?? '').replace(/[&<>"']/g, (m)=>map[m]); }
  function setStatus(text='', isError=false){
    const el = qs('#pkStatus');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#7f2f1d' : '#6b6257';
  }
  function setParticipantToken(gameId, active){
    try {
      if (active && gameId) localStorage.setItem(PIKKEN_PARTICIPANT_KEY, JSON.stringify({ game_id:String(gameId), at:Date.now() }));
      else localStorage.removeItem(PIKKEN_PARTICIPANT_KEY);
    } catch (_) {}
  }
  function getParticipantHint(){
    try {
      const raw = localStorage.getItem(PIKKEN_PARTICIPANT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.game_id ? parsed : null;
    } catch (_) { return null; }
  }
  function liveHref(gameId){ return `./pikken_live.html?client_match_id=${encodeURIComponent(String(gameId || ''))}&scope=${encodeURIComponent(getScope())}`; }
  function startDiceValue(){ return Number(qs('#pkStartDice')?.value || DEFAULT_START_DICE) || DEFAULT_START_DICE; }
  function roomCodeValue(){ return String(qs('#pkRoomCode')?.value || '').trim().toUpperCase(); }
  function normalizeRows(payload){
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.rows)) return payload.rows;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
  }
  function normalizeState(raw){
    if (raw && raw.game && raw.players) return raw;
    if (raw && raw.state && raw.players) return { game: raw.state, players: raw.players, viewer: raw.viewer || {}, votes: raw.votes || [], dice_totals: raw.dice_totals || {} };
    return raw || {};
  }
  function penaltyLabel(raw){ return String(raw || '').toLowerCase() === 'right_loses' ? 'Fair' : 'Normal'; }
  function isEditing(el){ return !!el && document.activeElement === el; }
  function safeSetValue(el, value){ if (!el || isEditing(el)) return; el.value = value; }
  function renderEmptyRail(target, message){
    const wrap = qs(target);
    if (!wrap) return;
    wrap.innerHTML = `<div class="room-card"><div class="muted">${esc(message)}</div></div>`;
  }

  const UI = {
    gameId: '',
    pollTimer: null,
    roomsTimer: null,
    presenceTimer: null,
    roomsLoadedAt: 0,
    lastStateVersion: -1,
    latestState: null,
    latestPresence: {},
    activeRedirectDone: false
  };

  async function findMyActiveGame(){
    const token = sessionToken();
    if (!token) return null;
    try {
      const out = await rpcVariants('pikken_find_my_active_game_scoped', [
        { session_token: token, site_scope_input: getScope() },
        { session_token: token }
      ]);
      const row = out && (out.game || out.row || out);
      return row && row.game_id ? row : null;
    } catch (_) { return null; }
  }
  async function touchPresence(){
    if (!UI.gameId || !sessionToken()) return;
    try {
      await rpcVariants('pikken_touch_presence_scoped', [
        { session_token: sessionToken(), game_id_input: UI.gameId, page_kind_input: 'lobby', site_scope_input: getScope() },
        { session_token: sessionToken(), game_id_input: UI.gameId, page_kind_input: 'lobby' }
      ]);
    } catch (_) {}
  }
  async function releasePresence(){
    if (!UI.gameId || !sessionToken()) return;
    try {
      await rpcVariants('pikken_release_presence_scoped', [
        { session_token: sessionToken(), game_id_input: UI.gameId, site_scope_input: getScope() },
        { session_token: sessionToken(), game_id_input: UI.gameId }
      ]);
    } catch (_) {}
  }
  async function getPresenceMap(){
    if (!UI.gameId) return {};
    try {
      const raw = await rpcVariants('get_pikken_presence_public', [
        { game_id_input: UI.gameId },
        { game_id_input: UI.gameId, site_scope_input: getScope() }
      ]);
      const rows = normalizeRows(raw);
      const out = {};
      rows.forEach((row)=>{
        const key = String(row.player_name || row.display_name || '').trim().toLowerCase();
        if (key) out[key] = row;
      });
      return out;
    } catch (_) { return {}; }
  }
  async function getState(gameId){
    const token = sessionToken();
    return normalizeState(await rpcVariants('pikken_get_state_scoped', [
      { session_token: token || null, game_id_input: gameId },
      { session_token: token || null, game_id_input: gameId, site_scope_input: getScope() }
    ]));
  }

  function renderRoomRail(rows){
    const openWrap = qs('#pkOpenRooms');
    const liveWrap = qs('#pkLiveRooms');
    const openRows = rows.filter((row)=>String(row?.stage || row?.status || '').toLowerCase() !== 'live');
    const liveRows = rows.filter((row)=>String(row?.stage || row?.status || '').toLowerCase() === 'live');

    if (!openRows.length) renderEmptyRail('#pkOpenRooms', 'Geen open lobbies.');
    else {
      openWrap.innerHTML = openRows.map((row)=>`
        <div class="room-card">
          <div class="room-head">
            <div>
              <div class="room-code">${esc(row.lobby_code || '—')}</div>
              <div class="muted">${esc(row.host_name || 'Onbekend')}</div>
            </div>
            <div class="room-meta">
              <span class="pill wait">${Number(row.player_count || 0)} spelers</span>
              <span class="pill ${Number(row.ready_count || 0) >= 2 ? 'ok' : 'wait'}">${Number(row.ready_count || 0)} ready</span>
            </div>
          </div>
          <div class="muted">${esc(penaltyLabel(row.penalty_mode))} · ${Number(row.start_dice || DEFAULT_START_DICE)} dobbel(s)</div>
          <div class="room-actions">
            <button class="btn alt" type="button" data-join-room="${esc(row.lobby_code || '')}">Join</button>
          </div>
        </div>
      `).join('');
      qsa('[data-join-room]', openWrap).forEach((btn)=>{
        btn.addEventListener('click', ()=>{
          const code = btn.getAttribute('data-join-room') || '';
          safeSetValue(qs('#pkRoomCode'), code);
          joinLobby().catch((e)=>setStatus(normalizeError(e), true));
        });
      });
    }

    if (!liveRows.length) renderEmptyRail('#pkLiveRooms', 'Geen live spellen.');
    else {
      liveWrap.innerHTML = liveRows.map((row)=>`
        <div class="room-card">
          <div class="room-head">
            <div>
              <div class="room-code">${esc(row.lobby_code || '—')}</div>
              <div class="muted">${esc(row.host_name || 'Onbekend')}</div>
            </div>
            <div class="room-meta">
              <span class="pill ok">live</span>
              <span class="pill wait">${Number(row.player_count || 0)} spelers</span>
            </div>
          </div>
          <div class="room-actions">
            <a class="btn alt" href="${liveHref(row.game_id)}">Kijk live</a>
            <button class="btn soft" type="button" data-reopen-room="${esc(String(row.game_id || ''))}">Heropen</button>
          </div>
        </div>
      `).join('');
      qsa('[data-reopen-room]', liveWrap).forEach((btn)=>{
        btn.addEventListener('click', ()=>{
          const gameId = btn.getAttribute('data-reopen-room') || '';
          if (!gameId) return;
          UI.gameId = gameId;
          setParticipantToken(UI.gameId, true);
          history.replaceState(null, '', `pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
          startPolling();
        });
      });
    }

    const meta = qs('#pkRoomsMeta');
    if (meta) meta.textContent = `${openRows.length} open · ${liveRows.length} live`;
  }
  async function loadRooms(force=false){
    if (!force && Date.now() - UI.roomsLoadedAt < 3500) return;
    UI.roomsLoadedAt = Date.now();
    try {
      const payload = await rpcVariants('get_pikken_open_lobbies_public_scoped', [
        { site_scope_input: getScope(), session_token: sessionToken() || null },
        { site_scope_input: getScope() },
        { session_token: sessionToken() || null }
      ]);
      renderRoomRail(normalizeRows(payload));
    } catch (_) {
      renderEmptyRail('#pkOpenRooms', 'Open lobbies tijdelijk niet bereikbaar.');
      renderEmptyRail('#pkLiveRooms', 'Live lijst tijdelijk niet bereikbaar.');
      const meta = qs('#pkRoomsMeta');
      if (meta) meta.textContent = 'fallback';
    }
  }

  function normalizeError(err){
    const msg = String(err && err.message || err || 'Onbekende fout');
    if (/function public\.pikken_get_state_scoped\(text, uuid\) does not exist/i.test(msg) || /pikken\)getstate scoped/i.test(msg.replace(/_/g,''))) {
      return 'De oude 2-argument Pikken state-reader ontbreekt op de database. Gebruik de meegeleverde SQL compat-fix en herlaad daarna de pagina.';
    }
    if (/Niet ingelogd/i.test(msg)) return 'Log eerst opnieuw in op de site voordat je Pikken gebruikt.';
    return msg;
  }

  function renderState(raw){
    const state = normalizeState(raw);
    UI.latestState = state;
    const game = state?.game || {};
    const viewer = state?.viewer || {};
    const players = Array.isArray(state?.players) ? state.players : [];
    const totals = state?.dice_totals || {};
    const phase = String(game?.state?.phase || game?.status || 'lobby');
    const readyCount = players.filter((player)=>!!player.ready).length;
    const isHost = !!viewer.is_host || (viewer.player_id && Number(viewer.player_id) === Number(game?.created_by_player_id || 0));
    const canStart = String(game?.status || phase).toLowerCase() === 'lobby' && isHost && readyCount >= 2;
    const config = game?.config || {};
    const startDice = Number(config.start_dice || game?.start_dice || DEFAULT_START_DICE) || DEFAULT_START_DICE;
    const liveLike = String(game?.status || '').toLowerCase() === 'live' || (phase && phase !== 'lobby');

    qs('#pkLobbyCode').textContent = game?.lobby_code || '—';
    qs('#pkPhase').textContent = phase;
    qs('#pkRoundNo').textContent = String(Number(game?.state?.round_no || 0));
    qs('#pkReadyCount').textContent = String(readyCount);
    qs('#pkDiceStart').textContent = String(Number(totals.start_total || (players.length * startDice) || 0));
    qs('#pkDiceCurrent').textContent = String(Number(totals.current_total || 0));
    qs('#pkHostName').textContent = String(game?.created_by_player_name || '—');
    qs('#pkPenaltyLabel').textContent = penaltyLabel(game?.penalty_mode || config.penalty_mode);
    qs('#pkDiceSetting').textContent = String(startDice);
    qs('#pkViewerSeat').textContent = viewer?.seat || viewer?.seat_index ? `stoel ${viewer.seat || viewer.seat_index}` : 'viewer';
    qs('#pkHostMeta').textContent = isHost ? 'host' : 'speler';
    qs('#pkReadyMetric').textContent = `${readyCount}/${players.length}`;

    const phasePill = qs('#pkPhasePill');
    phasePill.textContent = phase;
    phasePill.className = `pill ${phase === 'finished' ? 'bad' : phase === 'lobby' ? 'wait' : 'ok'}`;

    const startRule = qs('#pkStartRulePill');
    startRule.className = `pill ${readyCount >= 2 ? 'ok' : 'wait'}`;
    startRule.textContent = readyCount >= 2 ? 'Start mag nu' : 'Minimaal 2 ready nodig';

    const readyBtn = qs('#pkReadyBtn');
    const unreadyBtn = qs('#pkUnreadyBtn');
    if (readyBtn && unreadyBtn) {
      const meReady = !!viewer.ready;
      readyBtn.className = meReady ? 'btn ready-active' : 'btn alt';
      unreadyBtn.className = meReady ? 'btn alt' : 'btn unready-active';
    }

    const saveDiceBtn = qs('#pkSaveDiceBtn');
    const leaveLobbyBtn = qs('#pkLeaveLobbyBtn');
    const destroyLobbyBtn = qs('#pkDestroyLobbyBtn');
    const startBtn = qs('#pkStartBtn');
    saveDiceBtn.classList.toggle('hidden', !(isHost && !liveLike));
    leaveLobbyBtn.classList.toggle('hidden', !(viewer.player_id || viewer.display_name || viewer.player_name));
    destroyLobbyBtn.classList.toggle('hidden', !(isHost && !liveLike));
    startBtn.classList.toggle('hidden', !isHost);
    startBtn.disabled = !canStart;
    startBtn.textContent = canStart ? 'Start spel' : 'Nog niet startbaar';

    const liveLink = qs('#pkLiveLink');
    const reconnectBtn = qs('#pkReconnectBtn');
    liveLink.href = liveHref(game?.id || UI.gameId);
    liveLink.style.display = (game?.id || UI.gameId) ? '' : 'none';
    reconnectBtn.href = liveHref(game?.id || UI.gameId);
    reconnectBtn.style.display = liveLike && (viewer.player_id || viewer.display_name || viewer.player_name) ? '' : 'none';

    const startDiceEl = qs('#pkStartDice');
    if (!isEditing(startDiceEl)) startDiceEl.value = String(startDice);
    const roomCodeEl = qs('#pkRoomCode');
    if (game?.lobby_code && !isEditing(roomCodeEl)) roomCodeEl.value = game.lobby_code;

    const list = qs('#pkPlayers');
    list.innerHTML = players.length ? players.map((p)=>{
      const seat = Number(p.seat || p.seat_index || 0);
      const alive = !!p.alive || String(phase || '').toLowerCase() === 'lobby';
      const presenceKey = String(p.name || p.player_name || '').trim().toLowerCase();
      const presence = UI.latestPresence[presenceKey] || null;
      const disconnected = !!presence && presence.connected === false;
      return `
        <div class="player-row ${alive ? '' : 'dead'} ${disconnected ? 'disconnected' : ''}">
          <div class="player-name">
            <strong>${esc(p.name || p.player_name || 'Speler')}</strong>
            <div class="muted">stoel ${seat || '—'} · ${Number(p.dice_count || 0)} dobbel(s)${disconnected ? ' · offline' : ''}</div>
          </div>
          <div class="chip-line">
            <span class="pill ${p.ready ? 'ok' : 'wait'}">${p.ready ? 'ready' : 'wacht'}</span>
            ${alive ? '' : '<span class="pill bad">uitgeschakeld</span>'}
          </div>
        </div>
      `;
    }).join('') : '<div class="player-row"><div class="muted">Nog geen spelers.</div></div>';

    if ((game?.id || UI.gameId)) {
      setParticipantToken(game?.id || UI.gameId, true);
    }
    if (liveLike && !UI.activeRedirectDone && (game?.id || UI.gameId)) {
      UI.activeRedirectDone = true;
      window.location.href = liveHref(game?.id || UI.gameId);
      return;
    }
  }

  async function ensureNoExistingLobby(){
    const existing = await findMyActiveGame();
    if (existing && existing.game_id) {
      UI.gameId = String(existing.game_id);
      setParticipantToken(UI.gameId, true);
      history.replaceState(null, '', `pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
      startPolling();
      throw new Error('Je zat al in een Pikken-lobby of live match en bent teruggezet naar die kamer.');
    }
  }
  async function resumeIfNeeded(){
    if (UI.gameId) return false;
    const active = await findMyActiveGame();
    if (active && active.game_id) {
      UI.gameId = String(active.game_id);
      setParticipantToken(UI.gameId, true);
      history.replaceState(null, '', `pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
      startPolling();
      return true;
    }
    const hint = getParticipantHint();
    if (hint && hint.game_id) {
      UI.gameId = String(hint.game_id);
      history.replaceState(null, '', `pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
      startPolling();
      return true;
    }
    return false;
  }

  async function loadAndRender(forceRooms=false){
    if (!UI.gameId) { await loadRooms(forceRooms); return; }
    try {
      await touchPresence();
      const [state, presenceMap] = await Promise.all([
        getState(UI.gameId),
        getPresenceMap()
      ]);
      UI.latestPresence = presenceMap || {};
      const version = Number(state?.game?.state_version || -1);
      if (version !== UI.lastStateVersion || forceRooms) {
        UI.lastStateVersion = version;
        renderState(state);
      }
      await loadRooms(forceRooms);
      setStatus('', false);
    } catch (err) {
      setStatus(normalizeError(err), true);
    }
  }
  function stopPolling(){
    if (UI.pollTimer) { clearInterval(UI.pollTimer); UI.pollTimer = null; }
    if (UI.roomsTimer) { clearInterval(UI.roomsTimer); UI.roomsTimer = null; }
    if (UI.presenceTimer) { clearInterval(UI.presenceTimer); UI.presenceTimer = null; }
  }
  function startPolling(){
    stopPolling();
    UI.pollTimer = setInterval(()=>{ if (!document.hidden) loadAndRender(false).catch(()=>{}); }, 1500);
    UI.roomsTimer = setInterval(()=>{ if (!document.hidden) loadRooms(true).catch(()=>{}); }, 7000);
    UI.presenceTimer = setInterval(()=>{ if (!document.hidden) touchPresence().catch(()=>{}); }, 8000);
    loadAndRender(true).catch((e)=>setStatus(normalizeError(e), true));
  }

  async function createLobby(){
    await ensureNoExistingLobby();
    setStatus('Lobby maken…', false);
    const out = await rpcVariants('pikken_create_lobby_scoped', [
      { session_token: sessionToken() || null, site_scope_input: getScope(), config_input: { penalty_mode: qs('#pkPenaltyMode').value || 'wrong_loses', start_dice: startDiceValue() } },
      { session_token: sessionToken() || null, config_input: { penalty_mode: qs('#pkPenaltyMode').value || 'wrong_loses', start_dice: startDiceValue() } }
    ]);
    UI.gameId = out.game_id || out?.game?.id;
    setParticipantToken(UI.gameId, true);
    const requestedCode = roomCodeValue();
    if (requestedCode && UI.gameId) {
      try {
        await rpcVariants('pikken_set_lobby_code_scoped', [
          { session_token: sessionToken() || null, game_id_input: UI.gameId, lobby_code_input: requestedCode, site_scope_input: getScope() },
          { session_token: sessionToken() || null, game_id_input: UI.gameId, lobby_code_input: requestedCode }
        ]);
      } catch (_) {}
    }
    history.replaceState(null, '', `pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
    startPolling();
  }
  async function joinLobby(){
    await ensureNoExistingLobby();
    const code = roomCodeValue();
    if (!code) throw new Error('Vul eerst een lobbycode in.');
    setStatus('Lobby joinen…', false);
    const out = await rpcVariants('pikken_join_lobby_scoped', [
      { session_token: sessionToken() || null, site_scope_input: getScope(), lobby_code_input: code },
      { session_token: sessionToken() || null, lobby_code_input: code }
    ]);
    UI.gameId = out.game_id || out?.game?.id;
    setParticipantToken(UI.gameId, true);
    history.replaceState(null, '', `pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
    startPolling();
  }
  async function setReady(ready){
    if (!UI.gameId) return;
    setStatus(ready ? 'Ready…' : 'Unready…', false);
    await rpcVariants('pikken_set_ready_scoped', [
      { session_token: sessionToken() || null, game_id_input: UI.gameId, ready_input: !!ready, site_scope_input: getScope() },
      { session_token: sessionToken() || null, game_id_input: UI.gameId, ready_input: !!ready }
    ]);
    await loadAndRender(true);
  }
  async function saveStartDice(){
    if (!UI.gameId) return;
    setStatus('Startdobbels opslaan…', false);
    await rpcVariants('pikken_set_start_dice_scoped', [
      { session_token: sessionToken() || null, game_id_input: UI.gameId, start_dice_input: startDiceValue(), site_scope_input: getScope() },
      { session_token: sessionToken() || null, game_id_input: UI.gameId, start_dice_input: startDiceValue() }
    ]);
    await loadAndRender(true);
  }
  async function leaveLobby(){
    if (!UI.gameId) return;
    if (!confirm('Weet je zeker dat je deze lobby wilt verlaten?')) return;
    setStatus('Lobby verlaten…', false);
    await rpcVariants('pikken_leave_lobby_scoped', [
      { session_token: sessionToken() || null, game_id_input: UI.gameId },
      { session_token: sessionToken() || null, game_id_input: UI.gameId, site_scope_input: getScope() }
    ]);
    await releasePresence();
    setParticipantToken(UI.gameId, false);
    UI.gameId = '';
    UI.activeRedirectDone = false;
    history.replaceState(null, '', `pikken.html?scope=${encodeURIComponent(getScope())}`);
    stopPolling();
    await loadRooms(true);
  }
  async function destroyLobby(){
    if (!UI.gameId) return;
    if (!confirm('Host: lobby verwijderen?')) return;
    setStatus('Lobby verwijderen…', false);
    await rpcVariants('pikken_destroy_game_scoped', [
      { session_token: sessionToken() || null, game_id_input: UI.gameId },
      { session_token: sessionToken() || null, game_id_input: UI.gameId, site_scope_input: getScope() }
    ]);
    await releasePresence();
    setParticipantToken(UI.gameId, false);
    UI.gameId = '';
    UI.activeRedirectDone = false;
    history.replaceState(null, '', `pikken.html?scope=${encodeURIComponent(getScope())}`);
    stopPolling();
    await loadRooms(true);
  }
  async function startGame(){
    if (!UI.gameId) return;
    setStatus('Starten…', false);
    await rpcVariants('pikken_start_game_scoped', [
      { session_token: sessionToken() || null, game_id_input: UI.gameId, site_scope_input: getScope() },
      { session_token: sessionToken() || null, game_id_input: UI.gameId }
    ]);
    window.location.href = liveHref(UI.gameId);
  }

  function boot(){
    const params = new URLSearchParams(location.search);
    UI.gameId = params.get('game_id') || '';

    qs('#pkCreateLobbyBtn').addEventListener('click', ()=>createLobby().catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkJoinLobbyBtn').addEventListener('click', ()=>joinLobby().catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkRefreshRoomsBtn').addEventListener('click', ()=>loadRooms(true).catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkReadyBtn').addEventListener('click', ()=>setReady(true).catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkUnreadyBtn').addEventListener('click', ()=>setReady(false).catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkSaveDiceBtn').addEventListener('click', ()=>saveStartDice().catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkLeaveLobbyBtn').addEventListener('click', ()=>leaveLobby().catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkDestroyLobbyBtn').addEventListener('click', ()=>destroyLobby().catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkStartBtn').addEventListener('click', ()=>startGame().catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkRoomCode').addEventListener('input', (event)=>{
      event.target.value = String(event.target.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    });

    if (UI.gameId) {
      setParticipantToken(UI.gameId, true);
      startPolling();
    } else {
      resumeIfNeeded().then((didResume)=>{ if (!didResume) loadRooms(true).catch(()=>{}); });
    }

    document.addEventListener('visibilitychange', ()=>{
      if (!document.hidden) {
        if (UI.gameId) loadAndRender(true).catch(()=>{});
        else loadRooms(true).catch(()=>{});
      }
    });
  }

  window.addEventListener('beforeunload', ()=>{ releasePresence(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
