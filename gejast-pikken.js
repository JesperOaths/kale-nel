(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtils = window.GEJAST_SCOPE_UTILS || {};
  const STORAGE_KEYS = {
    lobby: ['gejast_pikken_lobby_code', 'gejast_pikken_lobby_code_v517'],
    participant: ['gejast_pikken_participant', 'gejast_pikken_participant_v517'],
    leaveSuppress: ['gejast_pikken_leave_suppress', 'gejast_pikken_leave_suppress_v540'],
    viewerHint: ['gejast_pikken_viewer_hint', 'gejast_pikken_viewer_hint_v541', 'gejast_pikken_viewer_hint_v542'],
    stateSnapshot: ['gejast_pikken_state_snapshot', 'gejast_pikken_state_snapshot_v541', 'gejast_pikken_state_snapshot_v542']
  };

  function storageRead(keys){
    for (const key of (Array.isArray(keys) ? keys : [keys])){
      try { const raw = localStorage.getItem(key); if (raw != null && raw !== '') return raw; } catch(_){ }
    }
    return '';
  }
  function storageWrite(keys, value){
    const list = Array.isArray(keys) ? keys : [keys];
    list.forEach((key)=>{ try { localStorage.setItem(key, value); } catch(_){ } });
  }
  function storageRemove(keys){
    const list = Array.isArray(keys) ? keys : [keys];
    list.forEach((key)=>{ try { localStorage.removeItem(key); } catch(_){ } });
  }
  function storageReadJson(keys){
    const raw = storageRead(keys);
    if (!raw) return null;
    try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' ? parsed : null; } catch(_){ return null; }
  }
  function storageWriteJson(keys, value){
    try { storageWrite(keys, JSON.stringify(value)); } catch(_){ }
  }

  function getScope(){
    try { return (scopeUtils.getScope && scopeUtils.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); }
    catch(_){ return 'friends'; }
  }
  function sessionToken(){
    try { return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; } catch(_){ return ''; }
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
    try { data = text ? JSON.parse(text) : null; } catch { throw new Error(text || `HTTP ${res.status}`); }
    if(!res.ok) throw new Error(data?.message || data?.error || text || `HTTP ${res.status}`);
    return data;
  }
  async function rpc(name, payload){
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method:'POST', headers:headers(), body: JSON.stringify(payload || {}), cache:'no-store'
    });
    return parse(res);
  }

  async function rpcWithTimeout(name, payload, timeoutMs){
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), Math.max(1, Number(timeoutMs)||3500));
    try{
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method:'POST', headers:headers(), body: JSON.stringify(payload || {}), cache:'no-store', signal: controller.signal
      });
      return await parse(res);
    }catch(err){
      if(err && (err.name === 'AbortError' || /aborted|abort/i.test(String(err)))){
        const e = new Error('start-timeout');
        e.code = 'START_TIMEOUT';
        throw e;
      }
      throw err;
    }finally{
      clearTimeout(timer);
    }
  }

  function qs(sel, root){ return (root||document).querySelector(sel); }
  function esc(s){ const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}; return String(s??'').replace(/[&<>"']/g,m=>map[m]); }
  function normalizeName(value){ return String(value || '').replace(/\s+/g,' ').trim().toLowerCase(); }
  function normalizeError(err){
    const msg = String(err && err.message || err || 'Onbekende fout');
    if(/column "?submitter_name"? of relation "?live_match_summaries"? does not exist/i.test(msg)){
      return 'Pikken backend raakt nog een oudere live-summary contractlaag buiten de huidige repo-patch. Ruwe fout: ' + msg;
    }
    if(/game_type\s+ongeldig/i.test(msg)){
      return 'Pikken backend raakt nog een oudere game_type-lookup buiten de huidige repo-patch. Ruwe fout: ' + msg;
    }
    if(/column reference "?game_type"? is ambiguous/i.test(msg)){
      return 'Pikken backend raakt nog een dubbelzinnige game_type-verwijzing buiten de huidige compat-laag. Ruwe fout: ' + msg;
    }
    return msg;
  }

  function isKnownNonfatalRoundNoError(err){
    const msg = String(err && err.message || err || '');
    return /column reference\s+"?round_no"?\s+is ambiguous/i.test(msg);
  }

  function clearKnownNonfatalStatus(){
    const el = qs('#pkStatus');
    if(!el) return;
    const txt = String(el.textContent || '');
    if(/round_no/i.test(txt) && /ambiguous|dubbelzinnige/i.test(txt)){
      setStatus('', false);
    }
  }

  function setParticipantToken(gameId, active, lobbyCode){ try{ if(active && gameId){ storageWriteJson(STORAGE_KEYS.participant, {game_id:String(gameId), lobby_code:String(lobbyCode||'').trim().toUpperCase(), at:Date.now()}); } else { storageRemove(STORAGE_KEYS.participant); } }catch(_){ } }
  function getParticipantToken(){ return storageReadJson(STORAGE_KEYS.participant); }
  function setLeaveSuppression(gameId, lobbyCode){ try { storageWriteJson(STORAGE_KEYS.leaveSuppress, { game_id:String(gameId||'').trim(), lobby_code:String(lobbyCode||'').trim().toUpperCase(), at:Date.now() }); } catch(_){ } }
  function getLeaveSuppression(){ return storageReadJson(STORAGE_KEYS.leaveSuppress); }
  function clearLeaveSuppression(){ storageRemove(STORAGE_KEYS.leaveSuppress); }
  function markerMatches(marker, gameId, lobbyCode){ const markerGameId = String(marker?.game_id || '').trim(); const markerLobbyCode = String(marker?.lobby_code || '').trim().toUpperCase(); const id = String(gameId || '').trim(); const code = String(lobbyCode || '').trim().toUpperCase(); return (!!markerGameId && !!id && markerGameId === id) || (!!markerLobbyCode && !!code && markerLobbyCode === code); }
  function isRoomLeaveSuppressed(gameId, lobbyCode){ const marker = getLeaveSuppression(); if(!marker) return false; const age = Date.now() - Number(marker.at || 0); if(age > 45000){ clearLeaveSuppression(); return false; } return markerMatches(marker, gameId, lobbyCode); }
  function clearLeaveSuppressionFor(gameId, lobbyCode){ if(markerMatches(getLeaveSuppression(), gameId, lobbyCode)) clearLeaveSuppression(); }
  function getStoredLobbyCode(){ return storageRead(STORAGE_KEYS.lobby); }
  function setStoredLobbyCode(code){ try { if(code) storageWrite(STORAGE_KEYS.lobby, String(code).trim().toUpperCase()); } catch(_){ } }
  function clearStoredLobbyCode(){ storageRemove(STORAGE_KEYS.lobby); }
  function setViewerHint(hint){ try { if(hint && hint.name){ storageWriteJson(STORAGE_KEYS.viewerHint, Object.assign({}, hint, { at: Date.now() })); } } catch(_){ } }
  function getViewerHint(){ return storageReadJson(STORAGE_KEYS.viewerHint); }
  function saveStateSnapshot(state){
    try {
      const game = state?.game || {};
      const players = Array.isArray(state?.players) ? state.players : [];
      const gameId = String(game?.id || '').trim();
      const lobbyCode = String(game?.lobby_code || '').trim().toUpperCase();
      if(!gameId && !lobbyCode) return;
      storageWriteJson(STORAGE_KEYS.stateSnapshot, {
        at: Date.now(),
        game_id: gameId,
        lobby_code: lobbyCode,
        game: {
          id: gameId,
          lobby_code: lobbyCode,
          status: game?.status || '',
          config: game?.config || {},
          state: game?.state || {},
          updated_at: game?.updated_at || null,
          created_by_player_name: game?.created_by_player_name || '',
          last_reveal: game?.last_reveal || null
        },
        players,
        votes: Array.isArray(state?.votes) ? state.votes : [],
        dice_totals: state?.dice_totals || {}
      });
    } catch(_){ }
  }

  function scopedHref(path, params){
    const search = new URLSearchParams();
    const entries = Object.entries(params || {});
    entries.forEach(([key, value])=>{
      const resolved = String(value || '').trim();
      if (resolved) search.set(key, resolved);
    });
    const scope = getScope();
    if (scope) search.set('scope', scope);
    const query = search.toString();
    return query ? `${path}?${query}` : path;
  }
  function liveHref(gameId, lobbyCode){
    const id = String(gameId || '').trim();
    const code = String(lobbyCode || '').trim().toUpperCase();
    const params = {};
    if (code) params.match_ref = code;
    else if (id) params.client_match_id = id;
    return scopedHref('./pikken_live.html', params);
  }
  function statsHref(){
    return scopedHref('./pikken_stats.html');
  }
  function lobbyHref(gameId){
    const id = String(gameId || UI.gameId || '').trim();
    return scopedHref('./pikken.html', { game_id: id });
  }
  function goLive(gameId, lobbyCode){
    const id = String(gameId || UI.gameId || '').trim();
    const code = String(lobbyCode || currentLobbyCode() || '').trim().toUpperCase();
    if(!id && !code) return false;
    window.location.href = liveHref(id, code);
    return true;
  }

  function setStatus(text, isError){
    const el = qs('#pkStatus');
    if(!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#7f2f1d' : '#6b6257';
  }

  function dieImg(face, cls){
    const n = Number(face||0);
    const img = document.createElement('img');
    img.className = cls || '';
    img.alt = n ? `die ${n}` : 'die';
    img.src = n ? `./assets/pikken/dice-${n}.svg` : './assets/pikken/dice-hidden.svg';
    return img;
  }

  const UI = {
    gameId: '',
    lastStateVersion: -1,
    pollTimer: null,
    polling: false,
    roomCodeDirty: false,
    roomCodeTouchedAt: 0,
    state: null
  };

  function markRoomCodeDirty(){ UI.roomCodeDirty = true; UI.roomCodeTouchedAt = Date.now(); }
  function shouldPreserveRoomCodeInput(){ const el = qs('#pkRoomCodeInput'); return !!(el && (document.activeElement === el || UI.roomCodeDirty || Date.now() - UI.roomCodeTouchedAt < 2500)); }
  function setRoomCodeInputValue(value){ const el = qs('#pkRoomCodeInput'); if(!el) return; if(shouldPreserveRoomCodeInput()) return; el.value = value || ''; UI.roomCodeDirty = false; }
  function roomCode(){ return String(((qs('#pkRoomCodeInput') && qs('#pkRoomCodeInput').value) || getStoredLobbyCode() || '')).trim().toUpperCase(); }
  function currentLobbyCode(){
    const shown = String(qs('#pkLobbyCode')?.textContent || '').trim();
    if (shown && shown !== '—') return shown.toUpperCase();
    const typed = String(qs('#pkRoomCodeInput')?.value || '').trim();
    if (typed) return typed.toUpperCase();
    return String(getStoredLobbyCode() || '').trim().toUpperCase();
  }

  function hasJoinedSeat(viewer){
    return Number(viewer?.seat || 0) > 0;
  }
  function roomDisplayable(room){
    const rawPlayerCount = room?.player_count;
    const playerCount = rawPlayerCount == null ? null : Number(rawPlayerCount);
    const stage = String(room?.stage || '').toLowerCase();
    if (stage === 'finished' || stage === 'closed' || stage === 'ended') return false;
    if (playerCount != null && Number.isFinite(playerCount) && playerCount <= 0) return false;
    return true;
  }
  function syncNavLinks(){
    const statsLink = qs('#pkStatsLink');
    if (statsLink) statsLink.href = statsHref();
    const liveLink = qs('#pkLiveLink');
    if (liveLink) liveLink.href = liveHref(UI.gameId || '', currentLobbyCode());
  }

  function hasParticipantClaimFor(room){
    const gameId = String(room?.game_id || '').trim();
    const lobbyCode = String(room?.lobby_code || '').trim().toUpperCase();
    if (isRoomLeaveSuppressed(gameId, lobbyCode)) return false;
    if (UI.pendingLiveEntryUntil && Date.now() < UI.pendingLiveEntryUntil) return true;
    const token = getParticipantToken();
    if (markerMatches(token, gameId, lobbyCode)) return true;
    const viewer = UI.state?.viewer || {};
    if ((viewer.is_host || Number(viewer.seat || 0) > 0) && markerMatches({ game_id: UI.gameId, lobby_code: currentLobbyCode() }, gameId, lobbyCode)) return true;
    return false;
  }

  async function loadParticipantState(gameIdInput){
    const token = sessionToken() || null;
    const gameId = String(gameIdInput || UI.gameId || '').trim();
    const lobbyCode = currentLobbyCode();
    if(!token || (!gameId && !lobbyCode)) return null;
    let lastErr = null;
    const attempts = [
      { session_token: token, lobby_code_input: lobbyCode || null, site_scope_input: getScope() },
      { session_token_input: token, lobby_code_input: lobbyCode || null, site_scope_input: getScope() },
      { session_token: token, game_id_input: gameId, lobby_code_input: lobbyCode || null, site_scope_input: getScope() },
      { session_token_input: token, game_id_input: gameId, lobby_code_input: lobbyCode || null, site_scope_input: getScope() },
      { session_token: token, game_id: gameId, lobby_code_input: lobbyCode || null, site_scope_input: getScope() },
      { session_token_input: token, game_id: gameId, lobby_code_input: lobbyCode || null, site_scope_input: getScope() },
      { session_token: token, lobby_code_input: lobbyCode || null },
      { session_token_input: token, lobby_code_input: lobbyCode || null },
      { session_token: token, game_id_input: gameId },
      { session_token_input: token, game_id_input: gameId }
    ];
    for (const payload of attempts){
      try { return await rpc('pikken_get_state_scoped', payload); }
      catch(err){ lastErr = err; }
    }
    throw lastErr || new Error('Pikken state laden mislukt.');
  }

  async function waitForConfirmedLiveSeat(gameIdInput, options){
    const gameId = String(gameIdInput || UI.gameId || '').trim();
    const timeoutMs = Math.max(800, Number(options?.timeoutMs || 9000));
    const intervalMs = Math.max(250, Number(options?.intervalMs || 650));
    const startedAt = Date.now();
    let lastState = null;
    while(Date.now() - startedAt < timeoutMs){
      try {
        const state = await loadParticipantState(gameId);
        if(state){
          lastState = state;
          const viewer = state?.viewer || null;
          const phase = String(state?.game?.state?.phase || state?.game?.status || '').toLowerCase();
          if(viewer && (viewer.is_host || Number(viewer.seat || 0) > 0) && phase && phase !== 'lobby'){
            return state;
          }
        }
      } catch(_){ }
      await new Promise((resolve)=>setTimeout(resolve, intervalMs));
    }
    return lastState;
  }

  function findMatchingLiveRoom(list){
    const currentCode = currentLobbyCode();
    const currentGameId = String(UI.gameId || '').trim();
    const rooms = Array.isArray(list) ? list : [];
    return rooms.find((r)=>{
      const stage = String(r.stage || '').toLowerCase();
      if(stage === 'lobby') return false;
      const roomCode = String(r.lobby_code || '').trim().toUpperCase();
      const gameId = String(r.game_id || '').trim();
      return (currentCode && roomCode === currentCode) || (currentGameId && gameId === currentGameId);
    }) || null;
  }


  function clearLobbyView(){
    UI.gameId = '';
    UI.lastStateVersion = -1;
    clearStoredLobbyCode();
    setParticipantToken('', false);
    if(qs('#pkLobbyShell')) qs('#pkLobbyShell').style.display = 'none';
    if(qs('#pkLobbyCode')) qs('#pkLobbyCode').textContent = '—';
    if(qs('#pkLobbyMeta')) qs('#pkLobbyMeta').textContent = 'Nog geen room geladen.';
    if(qs('#pkLobbySummary')) qs('#pkLobbySummary').textContent = 'Nog geen lobby info.';
    if(qs('#pkPlayers')) qs('#pkPlayers').innerHTML = '';
    if(qs('#pkPhase')) qs('#pkPhase').textContent = 'lobby';
    if(qs('#pkRoundNo')) qs('#pkRoundNo').textContent = '0';
    if(qs('#pkDiceStart')) qs('#pkDiceStart').textContent = '0';
    if(qs('#pkDiceCurrent')) qs('#pkDiceCurrent').textContent = '0';
    if(qs('#pkDiceLost')) qs('#pkDiceLost').textContent = '0';
    if(qs('#pkBidText')) qs('#pkBidText').textContent = '—';
    if(qs('#pkBidBy')) qs('#pkBidBy').textContent = '';
    if(qs('#pkLiveLink')){ qs('#pkLiveLink').href = liveHref('', currentLobbyCode()); qs('#pkLiveLink').style.display = 'none'; }
    const disbandBtn = qs('#pkDisbandBtn'); if(disbandBtn) disbandBtn.style.display = 'none';
    if(qs('#pkReveal')){ qs('#pkReveal').style.display = 'none'; qs('#pkReveal').innerHTML = ''; }
    if(qs('#pkRoomCodeInput') && !shouldPreserveRoomCodeInput()) qs('#pkRoomCodeInput').value = '';
  }

  function applyCreateFallback(out){
    const gameId = String(out?.game_id || out?.client_match_id || '').trim();
    const lobbyCode = String(out?.lobby_code || out?.code || out?.join_code || '').trim();
    if(gameId){
      UI.gameId = gameId;
      setParticipantToken(gameId, true, lobbyCode);
      clearLeaveSuppressionFor(gameId, lobbyCode);
      history.replaceState(null,'',lobbyHref(gameId));
    }
    if(lobbyCode){
      setStoredLobbyCode(lobbyCode);
      setRoomCodeInputValue(lobbyCode);
    }
    const liveLink = qs('#pkLiveLink');
    if(liveLink && (gameId || lobbyCode)){ liveLink.href = liveHref(gameId, lobbyCode); liveLink.style.display = ''; }
    if(qs('#pkPhase')) qs('#pkPhase').textContent = 'lobby';
    if(qs('#pkRoundNo')) qs('#pkRoundNo').textContent = '0';
    syncNavLinks();
  }

  function bindRoomButtons(scope){
    (scope || document).querySelectorAll('[data-pk-room-code]').forEach((btn)=>{
      btn.addEventListener('click', async()=>{
        const code = String(btn.getAttribute('data-pk-room-code') || '').trim().toUpperCase();
        const stage = String(btn.getAttribute('data-pk-room-stage') || '').trim().toLowerCase();
        const gameId = String(btn.getAttribute('data-pk-room-game-id') || '').trim();
        if(!code) return;
        const el = qs('#pkRoomCodeInput');
        if(el) el.value = code;
        if(stage && stage !== 'lobby'){
          const resolvedGameId = gameId || String(UI.gameId || '').trim();
          if(resolvedGameId){
            UI.gameId = resolvedGameId;
            setParticipantToken(resolvedGameId, true, code);
            clearLeaveSuppressionFor(resolvedGameId, code);
            setStoredLobbyCode(code);
            history.replaceState(null,'',lobbyHref(resolvedGameId));
            goLive(resolvedGameId, code);
            return;
          }
          goLive('', code);
          return;
        }
        await joinLobby(code);
      });
    });
  }

  function renderRoomsInto(box, list, empty){
    if(!box) return;
    if(!Array.isArray(list) || !list.length){
      box.innerHTML = `<div class="muted small-text">${empty}</div>`;
      return;
    }
    box.innerHTML = list.map((r)=>{
      const stage = String(r.stage || '').toLowerCase();
      const isLobby = stage === 'lobby';
      return `
      <button
        type="button"
        class="room-card"
        data-pk-room-code="${esc(r.lobby_code || '')}"
        data-pk-room-stage="${esc(stage)}"
        data-pk-room-game-id="${esc(r.game_id || '')}"
      >
        <div>
          <strong>${esc(r.lobby_code || '—')}</strong>
          <div class="muted small-text">Host: ${esc(r.host_name || 'geen host')} · ${Number(r.player_count || 0)} spelers (${Number(r.ready_count || 0)} ready) · fase: ${esc(r.stage_label || r.stage || 'lobby')}</div>
        </div>
        <div class="room-pill ${isLobby ? '' : 'busy'}">${!r.host_name && isLobby ? 'Open' : (isLobby ? 'Join' : 'Live')}</div>
      </button>
    `;}).join('');
    bindRoomButtons(box);
  }

  async function loadOpenRooms(){
    try {
      const rows = await rpc('get_pikken_open_rooms_public_scoped', { site_scope_input: getScope() });
      const list = (Array.isArray(rows) ? rows : []).filter(roomDisplayable);
      const live = list.filter((r)=>String(r.stage || '').toLowerCase() !== 'lobby');
      const open = list.filter((r)=>String(r.stage || '').toLowerCase() === 'lobby');
      renderRoomsInto(qs('#pkLiveRoomsBox'), live, 'Nog geen actieve pikkenkamers.');
      renderRoomsInto(qs('#pkOpenRoomsBox'), open, 'Nog geen open kamers. Maak er één aan of ververs zo weer.');
      clearKnownNonfatalStatus();

      const matchedLive = findMatchingLiveRoom(list);
      if (matchedLive && !/pikken_live\.html/i.test(window.location.pathname) && hasParticipantClaimFor(matchedLive)) {
        const gameId = String(matchedLive.game_id || UI.gameId || '').trim();
        const lobbyCode = String(matchedLive.lobby_code || currentLobbyCode() || '').trim().toUpperCase();
        if (lobbyCode) {
          setStoredLobbyCode(lobbyCode);
        }
        if (gameId) {
          let joinedState = null;
          try { joinedState = await loadParticipantState(gameId); } catch(_) {}
          const joinedViewer = joinedState?.viewer && (joinedState.viewer.is_host || Number(joinedState.viewer.seat || 0) > 0);
          const joinedPhase = String(joinedState?.game?.state?.phase || joinedState?.game?.status || '').toLowerCase();
          if (joinedViewer && joinedPhase && joinedPhase !== 'lobby') {
            if (gameId) UI.gameId = gameId;
            setParticipantToken(gameId || UI.gameId || '', true, lobbyCode);
            clearLeaveSuppressionFor(gameId || UI.gameId || '', lobbyCode);
            history.replaceState(null,'',lobbyHref(gameId || UI.gameId || ''));
            goLive('', lobbyCode || currentLobbyCode());
            return list;
          }
        }
      }
      return list;
    } catch(err){
      renderRoomsInto(qs('#pkLiveRoomsBox'), [], 'Kon actieve kamers niet laden.');
      renderRoomsInto(qs('#pkOpenRoomsBox'), [], 'Kon open kamers niet laden.');
      throw err;
    }
  }

  function render(state){
    const game = state?.game || {};
    const viewer = state?.viewer || {};
    const players = Array.isArray(state?.players) ? state.players : [];
    const votes = Array.isArray(state?.votes) ? state.votes : [];
    const myHand = Array.isArray(state?.my_hand) ? state.my_hand : [];
    const phase = String(game?.state?.phase || 'lobby');
    const status = String(game?.status || phase || 'lobby').toLowerCase();
    if (game?.id) UI.gameId = String(game.id);
    if (game?.lobby_code) setStoredLobbyCode(game.lobby_code);
    const joinedViewer = !!viewer && (viewer.is_host || Number(viewer.seat || 0) > 0);
    if (viewer?.name){
      setViewerHint({
        name: viewer.name,
        seat: Number(viewer.seat || 0) || null,
        is_host: !!viewer.is_host,
        game_id: String(game?.id || UI.gameId || '').trim(),
        lobby_code: String(game?.lobby_code || currentLobbyCode() || '').trim().toUpperCase()
      });
    } else {
      const hint = getViewerHint();
      if (hint?.name && ((game?.id && String(hint.game_id || '') === String(game.id)) || (game?.lobby_code && normalizeName(hint.lobby_code || '') === normalizeName(game.lobby_code)))) {
        setViewerHint(Object.assign({}, hint, { game_id: String(game?.id || UI.gameId || '').trim(), lobby_code: String(game?.lobby_code || currentLobbyCode() || '').trim().toUpperCase() }));
      }
    }
    saveStateSnapshot(state);
    setParticipantToken(game?.id || UI.gameId, joinedViewer && phase && phase !== 'finished', game?.lobby_code || currentLobbyCode());
    if (joinedViewer) clearLeaveSuppressionFor(game?.id || UI.gameId, game?.lobby_code || currentLobbyCode());
    const bid = game?.state?.bid && game.state.bid !== null ? game.state.bid : null;
    const turnSeat = Number(game?.state?.current_turn_seat || game?.state?.turn_seat || 0);
    const voteTurnSeat = Number(game?.state?.vote_turn_seat || game?.state?.turn_seat || 0);
    const lastReveal = game?.state?.last_reveal || null;

    if(qs('#pkLobbyShell')) qs('#pkLobbyShell').style.display = game?.id ? '' : 'none';
    if(qs('#pkLobbyCode')) qs('#pkLobbyCode').textContent = game?.lobby_code || '—';
    if(game?.lobby_code){ setStoredLobbyCode(game.lobby_code); setRoomCodeInputValue(game.lobby_code); }
    const liveLink = qs('#pkLiveLink'); if(liveLink){ liveLink.href = liveHref(game?.id || UI.gameId, game?.lobby_code || currentLobbyCode()); liveLink.style.display = (game?.id || UI.gameId || game?.lobby_code || currentLobbyCode()) ? '' : 'none'; }
    if(qs('#pkLobbyMeta')) qs('#pkLobbyMeta').textContent = `Fase: ${phase} · Host: ${viewer?.is_host ? 'jij' : (game?.created_by_player_name || '—')}`;
    if(qs('#pkLobbySummary')){
      const ready = players.filter((p)=>!!p.ready).length;
      const alive = players.filter((p)=>!!p.alive).length;
      qs('#pkLobbySummary').textContent = `Spelers: ${players.length} · Ready: ${ready}/${players.length||0} · Levend: ${alive}`;
    }

    qs('#pkPhase').textContent = phase;
    qs('#pkRoundNo').textContent = String(Number(game?.state?.round_no || 0) || 0);
    if ((viewer?.is_host || viewer?.seat) && String(phase).toLowerCase() !== 'lobby' && !/pikken_live\.html/i.test(window.location.pathname)) {
      setTimeout(()=>{ try { goLive(game?.id || UI.gameId, game?.lobby_code || currentLobbyCode()); } catch(_){} }, 150);
    }

    const totals = state?.dice_totals || {};
    qs('#pkDiceStart').textContent = String(Number(totals.start_total||0));
    qs('#pkDiceCurrent').textContent = String(Number(totals.current_total||0));
    qs('#pkDiceLost').textContent = String(Number(totals.lost_total||0));

    qs('#pkBidText').textContent = bid ? (Number(bid.face)===1 ? `${bid.count} × pik` : `${bid.count} × ${bid.face}`) : '—';
    qs('#pkBidBy').textContent = bid ? `door ${bid.bidder_name || '—'}` : '';

    const list = qs('#pkPlayers');
    list.innerHTML = players.map((p)=>{
      const seat = Number(p.seat||0);
      const alive = !!p.alive;
      const isTurn = phase === 'bidding' && seat === turnSeat;
      const isVoteTurn = phase === 'voting' && seat === voteTurnSeat;
      const vote = votes.find(v=>Number(v.seat||0)===seat);
      const voteStatus = vote ? String(vote.status||'waiting') : 'waiting';
      const pillText = voteStatus === 'approved' ? 'goedgekeurd' : voteStatus === 'rejected' ? 'afgekeurd' : 'wacht';
      const pillClass = voteStatus === 'approved' ? 'pill ok' : voteStatus === 'rejected' ? 'pill bad' : 'pill wait';
      const hostMark = (viewer.is_host && Number(viewer.seat||0) === seat) || (!viewer.is_host && String(game?.created_by_player_name||'') === String(p.name||''));
      return `
        <div class="player-row ${alive?'':'dead'} ${isTurn||isVoteTurn?'turn':''}">
          <div class="left">
            <div class="name"><strong>${esc(p.name||'Speler')}</strong> <span class="muted">#${seat}</span> ${hostMark ? '<span class="pill wait">host</span>' : ''}</div>
            <div class="meta muted">${alive?'Levend':'Dood'} · ${Number(p.dice_count||0)} dobbelstenen · ${p.ready ? 'ready' : 'niet ready'}</div>
          </div>
          <div class="right">${phase==='voting'?`<span class="${pillClass}">${pillText}</span>`:''}</div>
        </div>
      `;
    }).join('');

    const myDiceWrap = qs('#pkMyDice');
    myDiceWrap.innerHTML = '';
    myHand.forEach((face)=>{
      const n = Number(face||0);
      myDiceWrap.appendChild(dieImg(n, `die ${n===1?'pik':''}`.trim()));
    });

    const myTurn = phase === 'bidding' && Number(viewer.seat||0) === turnSeat && !!viewer.alive;
    const myVoteTurn = phase === 'voting' && Number(viewer.seat||0) === voteTurnSeat && !!viewer.alive;
    qs('#pkBidPanel').style.display = myTurn ? 'block' : 'none';
    qs('#pkVotePanel').style.display = myVoteTurn ? 'block' : 'none';
    qs('#pkRejectBtn').disabled = !myTurn || !bid;
    const startBtn = qs('#pkStartBtn');
    if(startBtn){
      startBtn.disabled = !viewer.is_host || players.length < 2 || status === 'finished';
      startBtn.style.display = viewer.is_host ? '' : 'none';
    }
    const leaveBtn = qs('#pkLeaveBtn'); if(leaveBtn) leaveBtn.style.display = hasJoinedSeat(viewer) ? '' : 'none';
    const disbandBtn = qs('#pkDisbandBtn'); if(disbandBtn) disbandBtn.style.display = viewer.is_host ? '' : 'none';
    syncNavLinks();

    const revealWrap = qs('#pkReveal');
    if(!lastReveal){
      revealWrap.style.display='none';
      revealWrap.innerHTML='';
    } else {
      revealWrap.style.display='block';
      const lrBid = lastReveal.bid || {};
      const lrBidTxt = (Number(lrBid.face)===1) ? `${lrBid.count} × pik` : `${lrBid.count} × ${lrBid.face}`;
      revealWrap.innerHTML = `
        <details class="accordion" open>
          <summary>
            <span>Laatste ronde (R${Number(lastReveal.round_no||0)}): bod ${esc(lrBidTxt)}</span>
            <span class="muted">${lastReveal.bid_true ? 'gehaald' : 'niet gehaald'} · geteld ${Number(lastReveal.counted_total||0)}</span>
          </summary>
          <div class="detail">
            <div class="muted">Verliezers: ${esc(String(lastReveal.losing_kind||''))} · Starter: stoel ${Number(lastReveal.next_starter_seat||0)}</div>
            <div class="reveal-grid">
              ${(Array.isArray(lastReveal.hands)?lastReveal.hands:[]).map((h)=>{
                const dice = Array.isArray(h.dice) ? h.dice : [];
                return `
                  <div class="reveal-card">
                    <div class="reveal-name"><strong>${esc(h.name||'Speler')}</strong> <span class="muted">#${Number(h.seat||0)}</span></div>
                    <div class="dice-row">${dice.map((d)=>`<img class="die ${Number(d)===1?'pik':''}" src="./assets/pikken/dice-${Number(d)}.svg" alt="die ${Number(d)}">`).join('')}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </details>
      `;
    }
  }

  async function loadAndRender(){
    if(!UI.gameId) return null;
    try{
      const state = await loadParticipantState(UI.gameId);
      UI.state = state || null;
      const version = Number(state?.game?.state_version || -1);
      if(version !== UI.lastStateVersion){
        UI.lastStateVersion = version;
        render(state);
      }
      const phase = String(state?.game?.state?.phase || state?.game?.status || 'lobby').toLowerCase();
      setStatus('', false);
      if(phase && phase !== 'lobby' && !/pikken_live\.html/i.test(window.location.pathname)){
        goLive(state?.game?.id || UI.gameId, state?.game?.lobby_code || currentLobbyCode());
        return state;
      }
      return state;
    }catch(err){
      if(isKnownNonfatalRoundNoError(err)){
        clearLobbyView();
        clearKnownNonfatalStatus();
        return null;
      }
      setStatus(normalizeError(err) || 'Laden mislukt.', true);
      throw err;
    }
  }

  async function poll(){
    if(UI.polling) return;
    UI.polling = true;
    try {
      if(UI.gameId) await loadAndRender();
      await loadOpenRooms();
    } finally {
      UI.polling = false;
    }
  }

  function startPolling(){
    stopPolling();
    UI.pollTimer = setInterval(()=>{ if(!document.hidden) poll(); }, 1200);
    poll();
  }
  function stopPolling(){
    if(UI.pollTimer){ clearInterval(UI.pollTimer); UI.pollTimer=null; }
  }

  async function createLobby(){
    setStatus('Lobby maken…', false);
    const mode = qs('#pkPenaltyMode') ? (qs('#pkPenaltyMode').value || 'wrong_loses') : 'wrong_loses';
    const out = await rpc('pikken_create_lobby_scoped', {
      session_token: sessionToken() || null,
      site_scope_input: getScope(),
      config_input: { penalty_mode: mode }
    });
    applyCreateFallback(out || {});
    try { await loadAndRender(); } catch(_) {}
    await loadOpenRooms();
    startPolling();
  }

  async function joinLobby(explicitCode){
    const code = String(explicitCode || roomCode()).trim().toUpperCase();
    if(!code) return setStatus('Vul een roomcode in.', true);
    setStatus('Room joinen…', false);
    const out = await rpc('pikken_join_lobby_scoped', {
      session_token: sessionToken() || null,
      site_scope_input: getScope(),
      lobby_code_input: code
    });
    applyCreateFallback(Object.assign({}, out || {}, { lobby_code: code }));
    try { await loadAndRender(); } catch(_) {}
    await loadOpenRooms();
    startPolling();
  }

  async function setReady(ready){
    setStatus(ready?'Ready…':'Unready…', false);
    await rpc('pikken_set_ready_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId, ready_input: !!ready });
    await loadAndRender();
  }

  async function startGame(){
    const viewer = UI.state?.viewer || {};
    const players = Array.isArray(UI.state?.players) ? UI.state.players : [];
    if(!viewer.is_host){ setStatus('Alleen de host kan pikken starten.', true); return; }
    if(players.length < 2){ setStatus('Pikken kan niet starten met minder dan 2 spelers.', true); return; }
    clearLeaveSuppression();
    UI.pendingLiveEntryUntil = Date.now() + 20000;
    setStatus('Starten…', false);
    let startState = null;
    let timedOut = false;
    try {
      startState = await rpcWithTimeout('pikken_start_game_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId }, 5000);
      if(startState && typeof startState === 'object'){
        UI.state = startState;
        try { render(startState); } catch(_) {}
      }
    } catch(err) {
      if(err && err.code === 'START_TIMEOUT'){
        timedOut = true;
      } else if(!isKnownNonfatalRoundNoError(err)) {
        throw err;
      }
    }
    let loadedState = null;
    try { loadedState = await loadAndRender(); } catch(_) { }
    let rooms = null;
    try { rooms = await loadOpenRooms(); } catch(_) { }

    const stateToUse = loadedState || startState || UI.state || null;
    const phase = String(stateToUse?.game?.state?.phase || stateToUse?.game?.status || '').toLowerCase();
    const joinedViewer = stateToUse?.viewer && (stateToUse.viewer.is_host || Number(stateToUse.viewer.seat || 0) > 0);
    if(joinedViewer && phase && phase !== 'lobby'){
      UI.pendingLiveEntryUntil = 0;
      setStatus('', false);
      goLive('', stateToUse?.game?.lobby_code || currentLobbyCode());
      return;
    }

    const gameIdForWait = String(stateToUse?.game?.id || UI.gameId || '').trim();
    const confirmedState = gameIdForWait ? await waitForConfirmedLiveSeat(gameIdForWait, { timeoutMs: 9000, intervalMs: 650 }) : null;
    const confirmedPhase = String(confirmedState?.game?.state?.phase || confirmedState?.game?.status || '').toLowerCase();
    const confirmedViewer = confirmedState?.viewer && (confirmedState.viewer.is_host || Number(confirmedState.viewer.seat || 0) > 0);
    if(confirmedViewer && confirmedPhase && confirmedPhase !== 'lobby'){
      UI.pendingLiveEntryUntil = 0;
      try { render(confirmedState); } catch(_) {}
      setStatus('', false);
      goLive('', confirmedState?.game?.lobby_code || currentLobbyCode());
      return;
    }

    const matchedLive = findMatchingLiveRoom(rooms || []);
    if(matchedLive){
      const gameId = String(matchedLive.game_id || UI.gameId || '').trim();
      const lobbyCode = String(matchedLive.lobby_code || currentLobbyCode() || '').trim().toUpperCase();
      if(gameId) {
        setStoredLobbyCode(lobbyCode);
      }
      UI.pendingLiveEntryUntil = 0;
      setStatus('Spel lijkt live te zijn, maar jouw spelerstoel is nog niet bevestigd. Blijf op de lobbypagina en ververs één keer als dit zo blijft.', true);
      return;
    }

    if(timedOut){
      UI.pendingLiveEntryUntil = 0;
      setStatus('Start duurde te lang. Ververs zo nodig één keer.', true);
      return;
    }
    UI.pendingLiveEntryUntil = 0;
    setStatus('Start leverde nog geen bevestigde spelersstoel op. Blijf op de lobbypagina en ververs één keer als dit zo blijft.', true);
  }

  async function placeBid(){
    const count = Number(qs('#pkBidCount').value||0);
    const face = Number(qs('#pkBidFace').value||0);
    setStatus('Bieden…', false);
    const state = await rpc('pikken_place_bid_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId, bid_count_input: count, bid_face_input: face });
    render(state);
  }

  async function rejectBid(){
    setStatus('Afkeuren…', false);
    const state = await rpc('pikken_reject_bid_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId });
    render(state);
  }

  async function vote(v){
    setStatus('Stemmen…', false);
    const state = await rpc('pikken_cast_vote_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId, vote_input: !!v });
    render(state);
  }

  async function leaveLobby(){
    if(!UI.gameId) return;
    if(!window.confirm('Weet je zeker dat je deze room wilt verlaten?')) return;
    setStatus('Room verlaten…', false);
    const leavingGameId = UI.gameId;
    const leavingLobbyCode = currentLobbyCode();
    await rpc('pikken_leave_lobby_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId });
    setLeaveSuppression(leavingGameId, leavingLobbyCode);
    clearLobbyView();
    history.replaceState(null,'',lobbyHref(''));
    await loadOpenRooms();
  }

  async function disbandLobby(){
    if(!UI.gameId) return;
    if(!window.confirm('Weet je zeker dat je deze room wilt verwijderen?')) return;
    setStatus('Room verwijderen…', false);
    const leavingGameId = UI.gameId;
    const leavingLobbyCode = currentLobbyCode();
    await rpc('pikken_destroy_lobby_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId });
    setLeaveSuppression(leavingGameId, leavingLobbyCode);
    clearLobbyView();
    history.replaceState(null,'',lobbyHref(''));
    await loadOpenRooms();
  }

  function spectateCurrent(){
    const code = currentLobbyCode();
    if(goLive(UI.gameId, code)) return;
    setStatus('Open of join eerst een room om live te kijken.', true);
  }

  function boot(){
    const params = new URLSearchParams(location.search);
    UI.gameId = params.get('game_id') || '';
    syncNavLinks();

    qs('#pkCreateLobbyBtn').addEventListener('click', ()=>createLobby().catch(e=>setStatus(normalizeError(e)||'Maken mislukt.',true)));
    qs('#pkJoinLobbyBtn').addEventListener('click', ()=>joinLobby().catch(e=>setStatus(normalizeError(e)||'Join mislukt.',true)));
    qs('#pkRefreshRoomsBtn').addEventListener('click', ()=>poll().catch(e=>setStatus(normalizeError(e)||'Verversen mislukt.',true)));
    qs('#pkReadyBtn').addEventListener('click', ()=>setReady(true).catch(e=>setStatus(normalizeError(e)||'Ready mislukt.',true)));
    qs('#pkUnreadyBtn').addEventListener('click', ()=>setReady(false).catch(e=>setStatus(normalizeError(e)||'Unready mislukt.',true)));
    qs('#pkStartBtn').addEventListener('click', ()=>startGame().catch(e=>setStatus(normalizeError(e)||'Start mislukt.',true)));

    qs('#pkPlaceBidBtn').addEventListener('click', ()=>placeBid().catch(e=>setStatus(normalizeError(e)||'Bieden mislukt.',true)));
    qs('#pkRejectBtn').addEventListener('click', ()=>rejectBid().catch(e=>setStatus(normalizeError(e)||'Afkeuren mislukt.',true)));
    qs('#pkVoteApproveBtn').addEventListener('click', ()=>vote(true).catch(e=>setStatus(normalizeError(e)||'Stem mislukt.',true)));
    qs('#pkVoteRejectBtn').addEventListener('click', ()=>vote(false).catch(e=>setStatus(normalizeError(e)||'Stem mislukt.',true)));
    qs('#pkSpectateBtn').addEventListener('click', ()=>spectateCurrent());
    qs('#pkLeaveBtn').addEventListener('click', ()=>leaveLobby().catch(e=>setStatus(normalizeError(e)||'Verlaten mislukt.',true)));
    qs('#pkDisbandBtn').addEventListener('click', ()=>disbandLobby().catch(e=>setStatus(normalizeError(e)||'Verwijderen mislukt.',true)));

    const roomEl = qs('#pkRoomCodeInput');
    if(roomEl){
      roomEl.addEventListener('input', markRoomCodeDirty);
      roomEl.addEventListener('focus', markRoomCodeDirty);
      roomEl.addEventListener('blur', ()=>{ UI.roomCodeTouchedAt = Date.now(); });
    }

    const seeded = getStoredLobbyCode();
    if(seeded) setRoomCodeInputValue(seeded);

    startPolling();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
