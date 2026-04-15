(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtils = window.GEJAST_SCOPE_UTILS || {};
  const STORAGE_KEY = 'gejast_pikken_lobby_code_v514';
  const PIKKEN_PARTICIPANT_KEY = 'gejast_pikken_participant_v514';

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

  function setParticipantToken(gameId, active){ try{ if(active && gameId){ localStorage.setItem(PIKKEN_PARTICIPANT_KEY, JSON.stringify({game_id:String(gameId), at:Date.now()})); } else { localStorage.removeItem(PIKKEN_PARTICIPANT_KEY); } }catch(_){ } }
  function getStoredLobbyCode(){ try { return localStorage.getItem(STORAGE_KEY) || ''; } catch(_){ return ''; } }
  function setStoredLobbyCode(code){ try { if(code) localStorage.setItem(STORAGE_KEY, String(code).trim().toUpperCase()); } catch(_){ } }
  function clearStoredLobbyCode(){ try { localStorage.removeItem(STORAGE_KEY); } catch(_){ } }

  function liveHref(gameId){ return `./pikken_live.html?client_match_id=${encodeURIComponent(String(gameId||''))}`; }

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
    roomCodeTouchedAt: 0
  };

  function markRoomCodeDirty(){ UI.roomCodeDirty = true; UI.roomCodeTouchedAt = Date.now(); }
  function shouldPreserveRoomCodeInput(){ const el = qs('#pkRoomCodeInput'); return !!(el && (document.activeElement === el || UI.roomCodeDirty || Date.now() - UI.roomCodeTouchedAt < 2500)); }
  function setRoomCodeInputValue(value){ const el = qs('#pkRoomCodeInput'); if(!el) return; if(shouldPreserveRoomCodeInput()) return; el.value = value || ''; UI.roomCodeDirty = false; }
  function roomCode(){ return String(((qs('#pkRoomCodeInput') && qs('#pkRoomCodeInput').value) || getStoredLobbyCode() || '')).trim().toUpperCase(); }

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
    if(qs('#pkLiveLink')) qs('#pkLiveLink').style.display = 'none';
    if(qs('#pkReveal')){ qs('#pkReveal').style.display = 'none'; qs('#pkReveal').innerHTML = ''; }
    if(qs('#pkRoomCodeInput') && !shouldPreserveRoomCodeInput()) qs('#pkRoomCodeInput').value = '';
  }

  function applyCreateFallback(out){
    const gameId = String(out?.game_id || out?.client_match_id || '').trim();
    const lobbyCode = String(out?.lobby_code || out?.code || out?.join_code || '').trim();
    if(gameId){
      UI.gameId = gameId;
      setParticipantToken(gameId, true);
      history.replaceState(null,'',`pikken.html?game_id=${encodeURIComponent(gameId)}&scope=${encodeURIComponent(getScope())}`);
    }
    if(lobbyCode){
      setStoredLobbyCode(lobbyCode);
      setRoomCodeInputValue(lobbyCode);
    }
    const liveLink = qs('#pkLiveLink');
    if(liveLink && gameId){ liveLink.href = liveHref(gameId); liveLink.style.display = ''; }
    if(qs('#pkPhase')) qs('#pkPhase').textContent = 'lobby';
    if(qs('#pkRoundNo')) qs('#pkRoundNo').textContent = '0';
  }

  function bindRoomButtons(scope){
    (scope || document).querySelectorAll('[data-pk-room-code]').forEach((btn)=>{
      btn.addEventListener('click', async()=>{
        const code = String(btn.getAttribute('data-pk-room-code') || '').trim().toUpperCase();
        if(!code) return;
        const el = qs('#pkRoomCodeInput');
        if(el) el.value = code;
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
    box.innerHTML = list.map((r)=>`
      <button type="button" class="room-card" data-pk-room-code="${esc(r.lobby_code || '')}">
        <div>
          <strong>${esc(r.lobby_code || '—')}</strong>
          <div class="muted small-text">Host: ${esc(r.host_name || '—')} · ${Number(r.player_count || 0)} spelers (${Number(r.ready_count || 0)} ready) · fase: ${esc(r.stage_label || r.stage || 'lobby')}</div>
        </div>
        <div class="room-pill ${String(r.stage || '').toLowerCase()==='lobby' ? '' : 'busy'}">${String(r.stage || '').toLowerCase()==='lobby' ? 'Join' : 'Live'}</div>
      </button>
    `).join('');
    bindRoomButtons(box);
  }

  async function loadOpenRooms(){
    try {
      const rows = await rpc('get_pikken_open_rooms_public_scoped', { site_scope_input: getScope() });
      const list = Array.isArray(rows) ? rows : [];
      const live = list.filter((r)=>String(r.stage || '').toLowerCase() !== 'lobby');
      const open = list.filter((r)=>String(r.stage || '').toLowerCase() === 'lobby');
      renderRoomsInto(qs('#pkLiveRoomsBox'), live, 'Nog geen actieve pikkenkamers.');
      renderRoomsInto(qs('#pkOpenRoomsBox'), open, 'Nog geen open kamers. Maak er één aan of ververs zo weer.');
      clearKnownNonfatalStatus();
    } catch(err){
      renderRoomsInto(qs('#pkLiveRoomsBox'), [], 'Kon actieve kamers niet laden.');
      renderRoomsInto(qs('#pkOpenRoomsBox'), [], 'Kon open kamers niet laden.');
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
    setParticipantToken(game?.id || UI.gameId, phase && phase !== 'finished');
    const bid = game?.state?.bid && game.state.bid !== null ? game.state.bid : null;
    const turnSeat = Number(game?.state?.current_turn_seat || 0);
    const voteTurnSeat = Number(game?.state?.vote_turn_seat || 0);
    const lastReveal = game?.state?.last_reveal || null;

    if(qs('#pkLobbyShell')) qs('#pkLobbyShell').style.display = game?.id ? '' : 'none';
    if(qs('#pkLobbyCode')) qs('#pkLobbyCode').textContent = game?.lobby_code || '—';
    if(game?.lobby_code){ setStoredLobbyCode(game.lobby_code); setRoomCodeInputValue(game.lobby_code); }
    const liveLink = qs('#pkLiveLink'); if(liveLink){ liveLink.href = liveHref(game?.id || UI.gameId); liveLink.style.display = (game?.id || UI.gameId) ? '' : 'none'; }
    if(qs('#pkLobbyMeta')) qs('#pkLobbyMeta').textContent = `Fase: ${phase} · Host: ${viewer?.is_host ? 'jij' : (game?.created_by_player_name || '—')}`;
    if(qs('#pkLobbySummary')){
      const ready = players.filter((p)=>!!p.ready).length;
      const alive = players.filter((p)=>!!p.alive).length;
      qs('#pkLobbySummary').textContent = `Spelers: ${players.length} · Ready: ${ready}/${players.length||0} · Levend: ${alive}`;
    }

    qs('#pkPhase').textContent = phase;
    qs('#pkRoundNo').textContent = String(Number(game?.state?.round_no || 0) || 0);

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
    qs('#pkStartBtn').disabled = !viewer.is_host || players.length < 2 || status === 'finished';

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
    if(!UI.gameId) return;
    try{
      const state = await rpc('pikken_get_state_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId });
      const version = Number(state?.game?.state_version || -1);
      if(version !== UI.lastStateVersion){
        UI.lastStateVersion = version;
        render(state);
      }
      setStatus('', false);
    }catch(err){
      if(isKnownNonfatalRoundNoError(err)){
        clearLobbyView();
        clearKnownNonfatalStatus();
        return;
      }
      setStatus(normalizeError(err) || 'Laden mislukt.', true);
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
    await loadOpenRooms();
    startPolling();
  }

  async function setReady(ready){
    setStatus(ready?'Ready…':'Unready…', false);
    await rpc('pikken_set_ready_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId, ready_input: !!ready });
    await loadAndRender();
  }

  async function startGame(){
    setStatus('Starten…', false);
    let timedOut = false;
    try {
      await rpcWithTimeout('pikken_start_game_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId }, 3500);
    } catch(err) {
      if(err && err.code === 'START_TIMEOUT'){
        timedOut = true;
      } else if(!isKnownNonfatalRoundNoError(err)) {
        throw err;
      }
    }
    try { await loadAndRender(); } catch(_) { }
    try { await loadOpenRooms(); } catch(_) { }
    clearKnownNonfatalStatus();
    const phase = String((((UI.state||{}).game||{}).state||{}).phase || (((UI.state||{}).game||{}).status || '')).toLowerCase();
    if(phase && phase !== 'lobby'){
      setStatus('', false);
      return;
    }
    if(timedOut){
      setStatus('Start duurde te lang. Ververs zo nodig één keer.', true);
      return;
    }
    setStatus('', false);
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

  function boot(){
    const params = new URLSearchParams(location.search);
    UI.gameId = params.get('game_id') || '';

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

    const roomEl = qs('#pkRoomCodeInput');
    if(roomEl){
      roomEl.addEventListener('input', markRoomCodeDirty);
      roomEl.addEventListener('focus', markRoomCodeDirty);
      roomEl.addEventListener('blur', ()=>{ UI.roomCodeTouchedAt = Date.now(); });
    }

    const seeded = getStoredLobbyCode();
    if(seeded) setRoomCodeInputValue(seeded);

    if(UI.gameId){ setParticipantToken(UI.gameId, true); }
    startPolling();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
