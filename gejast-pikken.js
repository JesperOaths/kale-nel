(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtils = window.GEJAST_SCOPE_UTILS || {};
  const PIKKEN_PARTICIPANT_KEY = 'jas_pikken_participant_v2';

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
      method:'POST',
      headers:headers(),
      body: JSON.stringify(payload || {}),
      cache:'no-store',
      mode:'cors'
    });
    return parse(res);
  }
  function qs(sel, root){ return (root || document).querySelector(sel); }
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
  function liveHref(gameId){ return `./pikken_live.html?client_match_id=${encodeURIComponent(String(gameId || ''))}`; }

  function getParticipantHint(){
    try {
      const raw = localStorage.getItem(PIKKEN_PARTICIPANT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.game_id ? parsed : null;
    } catch (_) { return null; }
  }
  async function findMyActiveGame(){
    const token = sessionToken();
    if (!token) return null;
    try {
      const out = await rpc('pikken_find_my_active_game_scoped', { session_token: token, site_scope_input: getScope() });
      const row = out && (out.game || out.row || out);
      return row && row.game_id ? row : null;
    } catch (_) {
      return null;
    }
  }

  async function touchPresence(){
    if (!UI.gameId || !sessionToken()) return null;
    try {
      return await rpc('pikken_touch_presence_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId, page_kind_input: 'lobby' });
    } catch (_) { return null; }
  }
  async function releasePresence(){
    if (!UI.gameId || !sessionToken()) return null;
    try {
      return await rpc('pikken_release_presence_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId });
    } catch (_) { return null; }
  }
  async function getPresenceMap(){
    if (!UI.gameId) return {};
    try {
      const raw = await rpc('get_pikken_presence_public', { game_id_input: UI.gameId });
      const rows = Array.isArray(raw?.rows) ? raw.rows : (Array.isArray(raw) ? raw : []);
      const out = {};
      rows.forEach((row)=>{
        const key = String(row.player_name || row.display_name || '').trim().toLowerCase();
        if (key) out[key] = row;
      });
      return out;
    } catch (_) {
      return {};
    }
  }

  async function ensureNoExistingLobby(){
    const existing = await findMyActiveGame();
    if (existing && existing.game_id) {
      UI.gameId = String(existing.game_id);
      setParticipantToken(UI.gameId, true);
      history.replaceState(null, '', `pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
      startPolling();
      throw new Error('Je zit al in een Pikken-lobby of live spel. Je bent teruggezet naar je huidige kamer.');
    }
    return null;
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
  function dieImg(face, cls){
    const n = Number(face || 0);
    const img = document.createElement('img');
    img.className = cls || '';
    img.alt = n ? `die ${n}` : 'die';
    img.src = n ? `./assets/pikken/dice-${n}.svg` : './assets/pikken/dice-hidden.svg';
    return img;
  }
  function normalizeError(err){
    const msg = String(err && err.message || err || 'Onbekende fout');
    if (/game_type\s+ongeldig/i.test(msg)) return 'Pikken live-samenvatting staat backend nog niet open voor dit spel. Draai eerst de Pikken-helper SQL.';
    if (/Niet ingelogd/i.test(msg)) return 'Log eerst opnieuw in op de site voordat je Pikken gebruikt.';
    return msg;
  }
  function roomCodeValue(){ return String(qs('#pkRoomCode')?.value || '').trim().toUpperCase(); }
  function renderEmptyRail(target, message){
    const wrap = qs(target);
    if (!wrap) return;
    wrap.innerHTML = `<div class="empty-note">${esc(message)}</div>`;
  }
  function parseRowsPayload(payload){
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.rows)) return payload.rows;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
  }

  const UI = {
    gameId: '',
    activeRedirectDone: false,
    lastReadyState: null,
    rulesOpen: false,
    lastStateVersion: -1,
    pollTimer: null,
    roomsTimer: null,
    roomsLoadedAt: 0,
    latestState: null,
    latestPresence: {},
    presenceTimer: null
  };

  function renderRoomRail(rows){
    const openWrap = qs('#pkOpenRooms');
    const liveWrap = qs('#pkLiveRooms');
    const openRows = rows.filter((row)=>String(row?.stage || '').toLowerCase() !== 'live');
    const liveRows = rows.filter((row)=>String(row?.stage || '').toLowerCase() === 'live');

    if (!openRows.length) renderEmptyRail('#pkOpenRooms', 'Nog geen open lobbies zichtbaar.');
    else {
      openWrap.innerHTML = openRows.map((row)=>`
        <div class="room-card">
          <div class="room-head">
            <div>
              <div class="room-code">${esc(row.lobby_code || '—')}</div>
              <div class="muted">Host: ${esc(row.host_name || 'Onbekend')}</div>
            </div>
            <div class="room-meta">
              <span class="pill wait">${Number(row.player_count || 0)} spelers</span>
              <span class="pill ${Number(row.ready_count || 0) >= 2 ? 'ok' : 'wait'}">${Number(row.ready_count || 0)} ready</span>
            </div>
          </div>
          <div class="muted">Variant: ${esc(String(row.penalty_mode || 'wrong_loses').replace('_',' '))}</div>
          <div class="room-actions">
            <button class="btn alt" type="button" data-join-room="${esc(row.lobby_code || '')}">Join</button>
          </div>
        </div>
      `).join('');
      openWrap.querySelectorAll('[data-join-room]').forEach((btn)=>{
        btn.addEventListener('click', ()=>{
          const code = btn.getAttribute('data-join-room') || '';
          qs('#pkRoomCode').value = code;
          joinLobby().catch((e)=>setStatus(normalizeError(e), true));
        });
      });
    }

    if (!liveRows.length) renderEmptyRail('#pkLiveRooms', 'Nog geen actieve Pikken-spellen zichtbaar.');
    else {
      liveWrap.innerHTML = liveRows.map((row)=>`
        <div class="room-card">
          <div class="room-head">
            <div>
              <div class="room-code">${esc(row.lobby_code || '—')}</div>
              <div class="muted">Host: ${esc(row.host_name || 'Onbekend')}</div>
            </div>
            <div class="room-meta">
              <span class="pill ok">live</span>
              <span class="pill wait">${Number(row.player_count || 0)} spelers</span>
            </div>
          </div>
          <div class="room-actions">
            <a class="btn alt" href="${liveHref(row.game_id)}">Kijk live</a>
            <button class="btn soft" type="button" data-reopen-room="${esc(String(row.game_id || ''))}">Heropen lobby</button>
          </div>
        </div>
      `).join('');
      liveWrap.querySelectorAll('[data-reopen-room]').forEach((btn)=>{
        btn.addEventListener('click', ()=>{
          const gameId = btn.getAttribute('data-reopen-room') || '';
          if (!gameId) return;
          UI.gameId = gameId;
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
      const payload = await rpc('get_pikken_open_lobbies_public_scoped', { site_scope_input: getScope(), session_token: sessionToken() || null });
      renderRoomRail(parseRowsPayload(payload));
    } catch (_) {
      renderEmptyRail('#pkOpenRooms', 'Open lobby helper nog niet live of tijdelijk niet bereikbaar.');
      renderEmptyRail('#pkLiveRooms', 'Live lobby helper nog niet live of tijdelijk niet bereikbaar.');
      const meta = qs('#pkRoomsMeta');
      if (meta) meta.textContent = 'fallback';
    }
  }

  function renderState(state){
    UI.latestState = state;
    const game = state?.game || {};
    const viewer = state?.viewer || {};
    const players = Array.isArray(state?.players) ? state.players : [];
    const votes = Array.isArray(state?.votes) ? state.votes : [];
    const myHand = Array.isArray(state?.my_hand) ? state.my_hand : [];
    const phase = String(game?.state?.phase || 'lobby');
    const bid = game?.state?.bid && game.state.bid !== null ? game.state.bid : null;
    const turnSeat = Number(game?.state?.current_turn_seat || game?.state?.turn_seat || 0);
    const voteTurnSeat = Number(game?.state?.vote_turn_seat || 0);
    const lastReveal = game?.state?.last_reveal || null;
    const readyCount = players.filter((player)=>!!player.ready).length;
    const isHost = !!viewer.is_host || (viewer.player_id && Number(viewer.player_id) === Number(game?.created_by_player_id || 0));
    const canStart = String(game?.status || phase || '').toLowerCase() === 'lobby' && isHost && readyCount >= 2;

    qs('#pkLobbyCode').textContent = game?.lobby_code || '—';
    const liveLink = qs('#pkLiveLink');
    if (liveLink) {
      liveLink.href = liveHref(game?.id || UI.gameId);
      liveLink.style.display = (game?.id || UI.gameId) ? '' : 'none';
    }

    const phasePill = qs('#pkPhasePill');
    if (phasePill) {
      phasePill.textContent = phase;
      phasePill.className = `pill ${phase === 'finished' ? 'bad' : phase === 'bidding' ? 'ok' : 'wait'}`;
    }

    qs('#pkPhase').textContent = phase;
    qs('#pkRoundNo').textContent = String(Number(game?.state?.round_no || 0) || 0);
    qs('#pkReadyCount').textContent = String(readyCount);

    const totals = state?.dice_totals || {};
    qs('#pkDiceStart').textContent = String(Number(totals.start_total || 0));
    qs('#pkDiceCurrent').textContent = String(Number(totals.current_total || 0));
    qs('#pkDiceCurrentSecondary').textContent = String(Number(totals.current_total || 0));
    qs('#pkDiceLost').textContent = String(Number(totals.lost_total || 0));

    qs('#pkBidText').textContent = bid ? (Number(bid.face) === 1 ? `${bid.count} × pik` : `${bid.count} × ${bid.face}`) : '—';
    qs('#pkBidBy').textContent = bid ? `door ${bid.bidder_name || '—'}` : '';

    const startRule = qs('#pkStartRulePill');
    if (startRule) {
      startRule.className = `pill ${readyCount >= 2 ? 'ok' : 'wait'}`;
      startRule.textContent = readyCount >= 2 ? 'Start mag nu' : 'Minimaal 2 ready nodig';
    }

    const readyMetric = qs('#pkReadyMetric');
    if (readyMetric) readyMetric.textContent = `${readyCount}/${players.length}`;

    const reconnectBtn = qs('#pkReconnectBtn');
    const liveLikeReconnect = String(game?.status || '').toLowerCase() === 'live' || (phase && phase !== 'lobby');
    if (reconnectBtn) {
      reconnectBtn.style.display = liveLikeReconnect && (viewer.player_id || viewer.display_name || viewer.player_name) ? '' : 'none';
      reconnectBtn.href = liveHref(game?.id || UI.gameId);
    }

    const readyBtn = qs('#pkReadyBtn');
    const unreadyBtn = qs('#pkUnreadyBtn');
    if (readyBtn && unreadyBtn) {
      const meReady = !!viewer.ready;
      UI.lastReadyState = meReady;
      readyBtn.className = meReady ? 'btn ready-active' : 'btn alt';
      unreadyBtn.className = meReady ? 'btn alt' : 'btn unready-active';
    }

    const startWrap = qs('#pkStartWrap');
    const startBtn = qs('#pkStartBtn');
    if (startWrap && startBtn) {
      startWrap.style.display = isHost ? '' : 'none';
      startBtn.disabled = !canStart;
      startBtn.textContent = canStart ? 'Start spel' : 'Nog niet startbaar';
    }

    const list = qs('#pkPlayers');
    list.innerHTML = players.length ? players.map((p)=>{
      const seat = Number(p.seat || p.seat_index || 0);
      const alive = !!p.alive || String(phase || '').toLowerCase() === 'lobby';
      const isTurn = phase === 'bidding' && seat === turnSeat;
      const isVoteTurn = phase === 'voting' && seat === voteTurnSeat;
      const vote = votes.find((v)=>Number(v.seat || 0) === seat);
      const voteStatus = vote ? String(vote.status || 'waiting') : 'waiting';
      const pillText = voteStatus === 'approved' ? 'goedgekeurd' : voteStatus === 'rejected' ? 'afgekeurd' : (p.ready ? 'ready' : 'wacht');
      const pillClass = voteStatus === 'approved' ? 'pill ok' : voteStatus === 'rejected' ? 'pill bad' : (p.ready ? 'pill ok' : 'pill wait');
      const presenceKey = String(p.name || p.player_name || '').trim().toLowerCase();
      const presence = UI.latestPresence && UI.latestPresence[presenceKey] ? UI.latestPresence[presenceKey] : null;
      const disconnected = !!presence && presence.connected === false;
      return `
        <div class="player-row ${alive ? '' : 'dead'} ${isTurn || isVoteTurn ? 'turn' : ''} ${disconnected ? 'disconnected' : ''}">
          <div class="player-name">
            <strong>${esc(p.name || p.player_name || 'Speler')}</strong>
            <div class="muted">Stoel #${seat || '—'} · ${alive ? 'Levend' : 'Dood'} · ${Number(p.dice_count || 0)} dobbelstenen${disconnected ? ' · offline' : ''}</div>
          </div>
          <div class="mini-actions">
            <span class="${pillClass}">${esc(pillText)}</span>
          </div>
        </div>
      `;
    }).join('') : '<div class="empty-note">Nog geen spelers in deze lobby.</div>';

    const myDiceWrap = qs('#pkMyDice');
    myDiceWrap.innerHTML = '';
    myHand.forEach((face)=>{
      const n = Number(face || 0);
      myDiceWrap.appendChild(dieImg(n, `die ${n === 1 ? 'pik' : ''}`.trim()));
    });

    const myTurn = phase === 'bidding' && Number(viewer.seat || viewer.seat_index || 0) === turnSeat && !!viewer.alive;
    const myVoteTurn = phase === 'voting' && Number(viewer.seat || viewer.seat_index || 0) === voteTurnSeat && !!viewer.alive;
    qs('#pkBidPanel').style.display = myTurn ? 'block' : 'none';
    qs('#pkVotePanel').style.display = myVoteTurn ? 'block' : 'none';
    qs('#pkRejectBtn').disabled = !myTurn || !bid;

    const revealWrap = qs('#pkReveal');
    if (!lastReveal) {
      revealWrap.style.display = 'none';
      revealWrap.innerHTML = '';
    } else {
      revealWrap.style.display = 'block';
      const lrBid = lastReveal.bid || {};
      const lrBidTxt = Number(lrBid.face) === 1 ? `${lrBid.count} × pik` : `${lrBid.count} × ${lrBid.face}`;
      revealWrap.innerHTML = `
        <details class="accordion" open>
          <summary>
            <span>Laatste ronde (R${Number(lastReveal.round_no || 0)}): bod ${esc(lrBidTxt)}</span>
            <span class="muted">${lastReveal.bid_true ? 'gehaald' : 'niet gehaald'} · geteld ${Number(lastReveal.counted_total || 0)}</span>
          </summary>
          <div class="detail">
            <div class="muted">Verliezers: ${esc(String(lastReveal.losing_kind || ''))} · Starter: stoel ${Number(lastReveal.next_starter_seat || 0)}</div>
            <div class="reveal-grid">
              ${(Array.isArray(lastReveal.hands) ? lastReveal.hands : []).map((h)=>`
                <div class="reveal-card">
                  <div><strong>${esc(h.name || 'Speler')}</strong> <span class="muted">#${Number(h.seat || 0)}</span></div>
                  <div class="dice-row">${(Array.isArray(h.dice) ? h.dice : []).map((d)=>`<img class="die ${Number(d) === 1 ? 'pik' : ''}" src="./assets/pikken/dice-${Number(d)}.svg" alt="die ${Number(d)}">`).join('')}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </details>
      `;
    }

    if ((game?.id || UI.gameId)) {
      setParticipantToken(game?.id || UI.gameId, true);
    }
    const liveLike = String(game?.status || '').toLowerCase() === 'live' || (phase && phase !== 'lobby');
    if (liveLike && !UI.activeRedirectDone && (game?.id || UI.gameId)) {
      UI.activeRedirectDone = true;
      window.location.href = liveHref(game?.id || UI.gameId);
      return;
    }
  }

  async function loadAndRender(forceRooms=false){
    if (!UI.gameId) { await loadRooms(forceRooms); return; }
    try {
      await touchPresence();
      const [state, presenceMap] = await Promise.all([
        rpc('pikken_get_state_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId }),
        getPresenceMap()
      ]);
      UI.latestPresence = presenceMap || {};
      const version = Number(state?.game?.state_version || -1);
      if (version !== UI.lastStateVersion) {
        UI.lastStateVersion = version;
        renderState(state);
      }
      await loadRooms(forceRooms);
      setStatus('', false);
    } catch (err) {
      setStatus(normalizeError(err) || 'Laden mislukt.', true);
    }
  }

  function startPolling(){
    stopPolling();
    UI.pollTimer = setInterval(()=>{ if (!document.hidden) loadAndRender(false); }, 1200);
    UI.roomsTimer = setInterval(()=>{ if (!document.hidden) loadRooms(true); }, 7000);
    UI.presenceTimer = setInterval(()=>{ if (!document.hidden) touchPresence(); }, 8000);
    loadAndRender(true);
  }
  function stopPolling(){
    if (UI.pollTimer) { clearInterval(UI.pollTimer); UI.pollTimer = null; }
    if (UI.roomsTimer) { clearInterval(UI.roomsTimer); UI.roomsTimer = null; }
    if (UI.presenceTimer) { clearInterval(UI.presenceTimer); UI.presenceTimer = null; }
  }

  async function createLobby(){
    await ensureNoExistingLobby();
    setStatus('Lobby maken…', false);
    const mode = qs('#pkPenaltyMode').value || 'wrong_loses';
    const requestedCode = roomCodeValue();
    const out = await rpc('pikken_create_lobby_scoped', {
      session_token: sessionToken() || null,
      site_scope_input: getScope(),
      config_input: { penalty_mode: mode }
    });
    UI.gameId = out.game_id;
    setParticipantToken(UI.gameId, true);
    if (requestedCode && out.game_id) {
      try { await rpc('pikken_set_lobby_code_scoped', { session_token: sessionToken() || null, game_id_input: out.game_id, lobby_code_input: requestedCode }); } catch (_) {}
    }
    history.replaceState(null, '', `pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
    startPolling();
  }

  async function joinLobby(){
    await ensureNoExistingLobby();
    const code = roomCodeValue();
    if (!code) return setStatus('Vul een lobbycode in.', true);
    setStatus('Lobby joinen…', false);
    const out = await rpc('pikken_join_lobby_scoped', {
      session_token: sessionToken() || null,
      site_scope_input: getScope(),
      lobby_code_input: code
    });
    UI.gameId = out.game_id;
    setParticipantToken(UI.gameId, true);
    history.replaceState(null, '', `pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
    startPolling();
  }

  async function setReady(ready){
    if (!UI.gameId) return;
    setStatus(ready ? 'Ready…' : 'Unready…', false);
    await rpc('pikken_set_ready_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId, ready_input: !!ready });
    await loadAndRender(true);
  }

  async function startGame(){
    if (!UI.gameId) return;
    setStatus('Starten…', false);
    await rpc('pikken_start_game_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId });
    await loadAndRender(true);
    window.location.href = liveHref(UI.gameId);
  }

  async function placeBid(){
    const count = Number(qs('#pkBidCount').value || 0);
    const face = Number(qs('#pkBidFace').value || 0);
    setStatus('Bieden…', false);
    const state = await rpc('pikken_place_bid_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId, bid_count_input: count, bid_face_input: face });
    renderState(state);
  }

  async function rejectBid(){
    setStatus('Afkeuren…', false);
    const state = await rpc('pikken_reject_bid_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId });
    renderState(state);
  }

  async function vote(v){
    setStatus('Stemmen…', false);
    const state = await rpc('pikken_cast_vote_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId, vote_input: !!v });
    renderState(state);
  }

  function boot(){
    const params = new URLSearchParams(location.search);
    UI.gameId = params.get('game_id') || '';

    qs('#pkCreateLobbyBtn').addEventListener('click', ()=>createLobby().catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkJoinLobbyBtn').addEventListener('click', ()=>joinLobby().catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkRefreshRoomsBtn').addEventListener('click', ()=>loadRooms(true).catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkReadyBtn').addEventListener('click', ()=>setReady(true).catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkUnreadyBtn').addEventListener('click', ()=>setReady(false).catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkStartBtn').addEventListener('click', ()=>startGame().catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkPlaceBidBtn').addEventListener('click', ()=>placeBid().catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkRejectBtn').addEventListener('click', ()=>rejectBid().catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkVoteApproveBtn').addEventListener('click', ()=>vote(true).catch((e)=>setStatus(normalizeError(e), true)));
    qs('#pkVoteRejectBtn').addEventListener('click', ()=>vote(false).catch((e)=>setStatus(normalizeError(e), true)));

    qs('#pkRoomCode').addEventListener('input', (event)=>{
      event.target.value = String(event.target.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    });

    const rulesOpenBtn = qs('#pkRulesOpenBtn');
    const rulesCloseBtn = qs('#pkRulesCloseBtn');
    const rulesLayer = qs('#pkRulesLayer');
    if (rulesOpenBtn && rulesCloseBtn && rulesLayer) {
      rulesOpenBtn.addEventListener('click', ()=>rulesLayer.classList.add('open'));
      rulesCloseBtn.addEventListener('click', ()=>rulesLayer.classList.remove('open'));
      rulesLayer.addEventListener('click', (e)=>{ if (e.target === rulesLayer) rulesLayer.classList.remove('open'); });
    }

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
