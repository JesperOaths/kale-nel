(function(global){
  const RPC = global.GEJAST_SCOPED_RPC;
  const SUITS = [
    { key: 'hearts', label: 'Harten' },
    { key: 'diamonds', label: 'Ruiten' },
    { key: 'clubs', label: 'Klaveren' },
    { key: 'spades', label: 'Schoppen' }
  ];

  const state = {
    createSuit: 'hearts',
    joinSuit: 'hearts',
    selectedRoom: '',
    rooms: [],
    current: null
  };

  function q(sel){ return document.querySelector(sel); }
  function qa(sel){ return Array.from(document.querySelectorAll(sel)); }
  function scope(){ try { return RPC && RPC.getScope ? RPC.getScope() : 'friends'; } catch(_) { return 'friends'; } }
  function sessionToken(){ try { return RPC && RPC.getSessionToken ? RPC.getSessionToken() : ''; } catch(_) { return ''; } }
  function showError(id, msg){ const n=document.getElementById(id); if (n) n.textContent = msg || ''; }
  function rpc(name, payload){
    if (!RPC || typeof RPC.callRpc !== 'function') return Promise.reject(new Error('GEJAST_SCOPED_RPC ontbreekt.'));
    return RPC.callRpc(name, payload || {});
  }
  function asInt(value){ const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; }
  function setStep(id){
    ['prStepChoose','prStepCreate','prStepJoinWager','prStepJoinRoom'].forEach((key) => {
      const node = document.getElementById(key);
      if (node) node.classList.toggle('hidden', key !== id);
    });
  }
  function renderSuitButtons(target, activeKey, setter){
    const node = document.getElementById(target);
    if (!node) return;
    node.innerHTML = SUITS.map((s) => `<button class="suit-btn ${s.key === activeKey ? 'active' : ''}" type="button" data-suit="${s.key}">${s.label}</button>`).join('');
    node.querySelectorAll('[data-suit]').forEach((btn) => {
      btn.addEventListener('click', () => setter(btn.getAttribute('data-suit') || 'hearts'));
    });
  }
  function updateRoomMeta(current){
    const roomStatus = q('#prRoomStatus');
    const stageChip = q('#prStageChip');
    const scopeChip = q('#prScopeChip');
    if (scopeChip) scopeChip.textContent = scope();
    if (!current) {
      if (roomStatus) roomStatus.textContent = 'Nog geen room actief.';
      if (stageChip) stageChip.textContent = 'lobby';
      return;
    }
    if (roomStatus) roomStatus.textContent = `Room ${current.room_code || current.code || '—'} actief.`;
    if (stageChip) stageChip.textContent = String(current.stage || current.status || 'lobby');
  }
  function renderPlayers(players){
    const node = q('#prPlayers');
    const rows = Array.isArray(players) ? players : [];
    if (!node) return;
    if (!rows.length) {
      node.innerHTML = '<div class="muted">Nog niemand in de room.</div>';
      return;
    }
    node.innerHTML = rows.map((player) => `<div class="player-row"><div><strong>${player.display_name || player.player_name || 'Speler'}</strong><div class="muted">${player.selected_suit || 'geen suit'} · ${player.wager_bakken || 0} bakken</div></div><div class="chip">${player.ready ? 'ready' : 'niet ready'}</div></div>`).join('');
  }
  function applyState(payload){
    const next = payload && typeof payload === 'object' ? payload : null;
    state.current = next;
    updateRoomMeta(next);
    renderPlayers(next && (next.players || next.room_players || []));
    const result = q('#prResultPanel');
    if (result && next) {
      result.innerHTML = `<div><strong>${next.room_code || next.code || 'Room actief'}</strong></div><div class="muted">Room bevestigd. De create/join flow loopt nu via echte create/join RPCs in plaats van een browser-only popupflow.</div>`;
    }
  }
  async function maybeCreateWagerObligation(roomState, wager, selectedSuit){
    try {
      await rpc('paardenrace_create_game_drink_obligations_scoped', {
        room_code: roomState.room_code || roomState.code,
        match_ref: roomState.match_ref || roomState.active_match_ref || null,
        selected_suit: selectedSuit,
        source_kind: 'wager',
        wager_bakken: wager,
        session_token: sessionToken(),
        site_scope_input: scope()
      });
      const result = q('#prResultPanel');
      if (result) {
        result.innerHTML = `<div class="success">Room bevestigd</div><div class="muted">Je eigen inzet van ${wager} bakken is nu pas naar de request pipeline gestuurd.</div>`;
      }
    } catch (error) {
      const result = q('#prResultPanel');
      if (result) {
        result.innerHTML = `<div><strong>Room bevestigd</strong></div><div class="muted">De room zelf werkt, maar de wager-obligation kon nog niet worden aangemaakt: ${String(error.message || error)}</div>`;
      }
    }
  }
  async function createRoom(){
    showError('prCreateError','');
    const wager = asInt(q('#prCreateWager') && q('#prCreateWager').value);
    if (!wager) {
      showError('prCreateError','Kies een geldige hele inzet in bakken.');
      return;
    }
    try {
      const created = await rpc('paardenrace_create_room_scoped', {
        session_token: sessionToken(),
        site_scope_input: scope()
      });
      const roomCode = created && (created.room_code || created.code || (created.room && created.room.code));
      if (!roomCode) throw new Error('Geen room_code teruggekregen van create_room.');
      const joined = await rpc('paardenrace_join_room_scoped', {
        room_code: roomCode,
        session_token: sessionToken(),
        site_scope_input: scope()
      });
      const selection = await rpc('paardenrace_update_selection_scoped', {
        room_code: roomCode,
        selected_suit: state.createSuit,
        wager_bakken: wager,
        session_token: sessionToken(),
        site_scope_input: scope()
      });
      const nextState = selection || joined || created;
      applyState(nextState);
      q('#prSetupDialog').close();
      await maybeCreateWagerObligation(nextState, wager, state.createSuit);
    } catch (error) {
      showError('prCreateError', String(error.message || error));
    }
  }
  function renderRoomChoices(){
    const list = q('#prRooms');
    if (!list) return;
    if (!state.rooms.length) {
      list.innerHTML = '<div class="muted">Geen open rooms gevonden.</div>';
      return;
    }
    list.innerHTML = state.rooms.map((room, index) => `<button class="room-item ${index===0 ? 'active' : ''}" type="button" data-room="${room.room_code || room.code || ''}"><strong>Room ${room.room_code || room.code}</strong><div class="muted">${room.player_count || 0} speler(s) · ${room.stage || room.status || 'lobby'}</div></button>`).join('');
    state.selectedRoom = state.rooms[0].room_code || state.rooms[0].code || '';
    list.querySelectorAll('[data-room]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedRoom = btn.getAttribute('data-room') || '';
        list.querySelectorAll('.room-item').forEach((node) => node.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }
  async function loadRooms(){
    showError('prJoinError','');
    const wager = asInt(q('#prJoinWager') && q('#prJoinWager').value);
    if (!wager) {
      showError('prJoinError','Kies een geldige hele inzet in bakken.');
      return;
    }
    try {
      const rows = await rpc('paardenrace_list_joinable_rooms_scoped', {
        session_token: sessionToken(),
        site_scope_input: scope()
      });
      state.rooms = Array.isArray(rows) ? rows : (rows && rows.rooms) || [];
      renderRoomChoices();
      setStep('prStepJoinRoom');
    } catch (error) {
      showError('prJoinError', String(error.message || error));
    }
  }
  async function joinRoom(){
    showError('prRoomsError','');
    const wager = asInt(q('#prJoinWager') && q('#prJoinWager').value);
    if (!state.selectedRoom) {
      showError('prRoomsError','Kies eerst een room.');
      return;
    }
    try {
      const joined = await rpc('paardenrace_join_room_scoped', {
        room_code: state.selectedRoom,
        session_token: sessionToken(),
        site_scope_input: scope()
      });
      const selection = await rpc('paardenrace_update_selection_scoped', {
        room_code: state.selectedRoom,
        selected_suit: state.joinSuit,
        wager_bakken: wager,
        session_token: sessionToken(),
        site_scope_input: scope()
      });
      const nextState = selection || joined;
      applyState(nextState);
      q('#prSetupDialog').close();
      await maybeCreateWagerObligation(nextState, wager, state.joinSuit);
    } catch (error) {
      showError('prRoomsError', String(error.message || error));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const dlg = q('#prSetupDialog');
    // bind suit selectors
    const bindCreateSuit = () => renderSuitButtons('prCreateSuitGrid', state.createSuit, (key) => { state.createSuit = key; bindCreateSuit(); });
    const bindJoinSuit = () => renderSuitButtons('prJoinSuitGrid', state.joinSuit, (key) => { state.joinSuit = key; bindJoinSuit(); });
    bindCreateSuit();
    bindJoinSuit();
    updateRoomMeta(null);
    q('#prOpenSetup').addEventListener('click', () => { setStep('prStepChoose'); dlg.showModal(); });
    qa('[data-close]').forEach((btn) => btn.addEventListener('click', () => dlg.close()));
    qa('[data-back]').forEach((btn) => btn.addEventListener('click', () => setStep('prStepChoose')));
    qa('[data-back-join]').forEach((btn) => btn.addEventListener('click', () => setStep('prStepJoinWager')));
    qa('[data-choice]').forEach((btn) => btn.addEventListener('click', () => {
      setStep(btn.getAttribute('data-choice') === 'create' ? 'prStepCreate' : 'prStepJoinWager');
    }));
    q('#prCreateSubmit').addEventListener('click', createRoom);
    q('#prLoadRooms').addEventListener('click', loadRooms);
    q('#prJoinSubmit').addEventListener('click', joinRoom);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close(); });
  });
})(window);
