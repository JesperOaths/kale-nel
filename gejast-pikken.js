(function(){
  // Shared frontend module for `pikken.html` and `pikken_live.html`.
  // - Lobby page is room-first again, closer to the paardenrace flow.
  // - Live page remains the actual gameplay surface.
  // - Polls the scoped Pikken state and redirects lobby participants once the game starts.

  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtils = window.GEJAST_SCOPE_UTILS || {};
  const PIKKEN_PARTICIPANT_KEY = 'gejast_pikken_participant_v1';

  function currentPath(){
    try { return String((window.location && window.location.pathname) || '').split('/').pop().toLowerCase(); }
    catch(_){ return ''; }
  }
  function isLivePage(){
    try { return (document.body && document.body.dataset && document.body.dataset.pikkenPage === 'live') || currentPath() === 'pikken_live.html'; }
    catch(_){ return currentPath() === 'pikken_live.html'; }
  }
  function isLobbyPage(){ return !isLivePage(); }

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

  function qs(sel, root){ return (root||document).querySelector(sel); }
  function esc(s){ const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}; return String(s??'').replace(/[&<>"']/g,m=>map[m]); }
  function setText(sel, value){ const el = qs(sel); if (el) el.textContent = String(value ?? ''); return el; }
  function setHtml(sel, value){ const el = qs(sel); if (el) el.innerHTML = String(value ?? ''); return el; }
  function setDisplay(sel, value){ const el = qs(sel); if (el) el.style.display = value; return el; }

  function normalizeError(err){
    const msg = String(err && err.message || err || 'Onbekende fout');
    if(/game_type\s+ongeldig/i.test(msg)){
      return 'Pikken live-samenvatting staat backend nog niet open voor dit spel. Draai de v487a SQL-fix en probeer opnieuw.';
    }
    if(/geen match_ref of client_match_id/i.test(msg)){
      return 'Open deze live-pagina vanuit de lobby of met een geldige match-link.';
    }
    if(/not.*participant|geen.*deelnemer|not.*member|geen.*lid/i.test(msg)){
      return 'Deze spelersessie hoort niet bij deze Pikken-lobby. Open de juiste lobby en start van daaruit.';
    }
    return msg;
  }

  function storedParticipantGameId(){
    try{
      const raw = localStorage.getItem(PIKKEN_PARTICIPANT_KEY);
      if(!raw) return '';
      const parsed = JSON.parse(raw);
      return String(parsed && parsed.game_id || '').trim();
    }catch(_){ return ''; }
  }
  function setParticipantToken(gameId, active){
    try{
      if(active && gameId){
        localStorage.setItem(PIKKEN_PARTICIPANT_KEY, JSON.stringify({ game_id:String(gameId), scope:getScope(), at:Date.now() }));
      } else {
        localStorage.removeItem(PIKKEN_PARTICIPANT_KEY);
      }
    }catch(_){ }
  }

  function liveHref(gameId){
    const url = new URL('./pikken_live.html', window.location.href);
    if (gameId) url.searchParams.set('client_match_id', String(gameId));
    if (getScope() === 'family') url.searchParams.set('scope', 'family');
    return `${url.pathname.split('/').pop()}${url.search}`;
  }
  function lobbyHref(gameId){
    const url = new URL('./pikken.html', window.location.href);
    if (gameId) url.searchParams.set('game_id', String(gameId));
    if (getScope() === 'family') url.searchParams.set('scope', 'family');
    return `${url.pathname.split('/').pop()}${url.search}`;
  }
  function currentUrlGameId(){
    try{
      const params = new URLSearchParams(location.search);
      return String(params.get('game_id') || params.get('client_match_id') || params.get('match_ref') || '').trim();
    }catch(_){ return ''; }
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
    redirecting: false,
    joinCodeDirty: false,
    joinCodeTouchedAt: 0
  };

  function markJoinCodeDirty(){
    UI.joinCodeDirty = true;
    UI.joinCodeTouchedAt = Date.now();
  }
  function shouldPreserveJoinCodeInput(){
    const el = qs('#pkJoinCode');
    return !!(el && (document.activeElement === el || UI.joinCodeDirty || (Date.now() - UI.joinCodeTouchedAt) < 2500));
  }
  function setJoinCodeInputValue(value){
    const el = qs('#pkJoinCode');
    if(!el) return;
    if(shouldPreserveJoinCodeInput()) return;
    el.value = value || '';
    UI.joinCodeDirty = false;
  }

  function readyOf(player){
    return !!(player && (player.is_ready || player.ready || player.ready_at));
  }
  function hostOf(player){
    return !!(player && (player.is_host || player.host || player.is_creator));
  }
  function aliveOf(player){
    return !(player && player.alive === false);
  }
  function playerStatusBadges(player, phase){
    const out = [];
    if (hostOf(player)) out.push('<span class="badge">host</span>');
    if (phase === 'lobby') out.push(`<span class="badge ${readyOf(player) ? 'good' : 'warn'}">${readyOf(player) ? 'ready' : 'wacht'}</span>`);
    else out.push(`<span class="badge ${aliveOf(player) ? 'good' : 'bad'}">${aliveOf(player) ? 'levend' : 'uitgeschakeld'}</span>`);
    return out.join('');
  }

  function renderLobby(state){
    const game = state?.game || {};
    const viewer = state?.viewer || {};
    const players = Array.isArray(state?.players) ? state.players : [];
    const phase = String(game?.state?.phase || 'lobby');
    const resolvedGameId = String(game?.id || UI.gameId || '').trim();
    const lobbyCode = String(game?.lobby_code || '').trim();

    setDisplay('#pkRoomShell', resolvedGameId ? '' : 'none');
    setText('#pkLobbyCode', lobbyCode || '—');
    setText('#pkRoomMeta', resolvedGameId
      ? `Fase: ${phase} · Host: ${viewer.host_name || game.host_name || players.find(hostOf)?.name || '—'}`
      : 'Nog geen lobby geladen.');
    setText('#pkSyncNote', `Live sync actief · ${new Date().toLocaleTimeString('nl-NL')}`);
    if (lobbyCode) setJoinCodeInputValue(lobbyCode);

    const liveLink = qs('#pkLiveLink');
    if (liveLink){
      liveLink.href = liveHref(resolvedGameId || UI.gameId);
      liveLink.style.display = (resolvedGameId || UI.gameId) ? '' : 'none';
    }

    if (!resolvedGameId){
      setText('#pkLobbySummary', 'Nog geen lobby info.');
      setHtml('#pkPlayersBox', '');
      return;
    }

    const readyCount = players.filter(readyOf).length;
    const total = players.length;
    const mode = String(game?.state?.penalty_mode || '').trim();
    const modeLabel = mode === 'right_loses' ? 'Fair (goed verliest)' : 'Normal (fout verliest)';
    setText('#pkLobbySummary', `Spelers: ${total} · Ready: ${readyCount}/${total || 0} · Variant: ${modeLabel}`);

    const readyBtn = qs('#pkReadyBtn');
    const unreadyBtn = qs('#pkUnreadyBtn');
    const startBtn = qs('#pkStartBtn');
    if (readyBtn) readyBtn.disabled = phase !== 'lobby' || readyOf(viewer);
    if (unreadyBtn) unreadyBtn.disabled = phase !== 'lobby' || !readyOf(viewer);
    if (startBtn) startBtn.disabled = phase !== 'lobby' || !viewer.is_host || players.length < 2 || readyCount < players.length;

    setHtml('#pkPlayersBox', players.length ? players.map((p)=>{
      const seat = Number(p.seat || 0);
      return `
        <div class="player">
          <div>
            <strong>${esc(p.name || p.player_name || 'Speler')}</strong>
            <div class="small">Stoel ${seat || '—'} · ${Number(p.dice_count || 0)} dobbelstenen</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${playerStatusBadges(p, phase)}</div>
        </div>
      `;
    }).join('') : '<div class="small">Nog geen spelers in deze lobby.</div>');
  }

  function renderLive(state){
    const game = state?.game || {};
    const viewer = state?.viewer || {};
    const players = Array.isArray(state?.players) ? state.players : [];
    const votes = Array.isArray(state?.votes) ? state.votes : [];
    const myHand = Array.isArray(state?.my_hand) ? state.my_hand : [];
    const phase = String(game?.state?.phase || 'lobby');
    const resolvedGameId = String(game?.id || UI.gameId || '').trim();
    const bid = game?.state?.bid && game.state.bid !== null ? game.state.bid : null;
    const turnSeat = Number(game?.state?.current_turn_seat || 0);
    const voteTurnSeat = Number(game?.state?.vote_turn_seat || 0);
    const lastReveal = game?.state?.last_reveal || null;

    setText('#pkLobbyCode', game?.lobby_code || '—');
    setText('#pkPhase', phase);
    setText('#pkRoundNo', String(Number(game?.state?.round_no || 0) || 0));

    const totals = state?.dice_totals || {};
    setText('#pkDiceStart', String(Number(totals.start_total || 0)));
    setText('#pkDiceCurrent', String(Number(totals.current_total || 0)));
    setText('#pkDiceLost', String(Number(totals.lost_total || 0)));
    setText('#pkBidText', bid ? (Number(bid.face) === 1 ? `${bid.count} × pik` : `${bid.count} × ${bid.face}`) : '—');
    setText('#pkBidBy', bid ? `door ${bid.bidder_name || '—'}` : '');

    const lobbyLink = qs('#pkLobbyLink');
    if (lobbyLink){
      lobbyLink.href = lobbyHref(resolvedGameId || UI.gameId);
      lobbyLink.style.display = (resolvedGameId || UI.gameId) ? '' : 'none';
    }

    const list = qs('#pkPlayers');
    if (list){
      list.innerHTML = players.map((p)=>{
        const seat = Number(p.seat || 0);
        const alive = aliveOf(p);
        const isTurn = phase === 'bidding' && seat === turnSeat;
        const isVoteTurn = phase === 'voting' && seat === voteTurnSeat;
        const vote = votes.find(v=>Number(v.seat || 0) === seat);
        const voteStatus = vote ? String(vote.status || 'waiting') : 'waiting';
        const pillText = voteStatus === 'approved' ? 'goedgekeurd' : voteStatus === 'rejected' ? 'afgekeurd' : 'wacht';
        const pillClass = voteStatus === 'approved' ? 'pill ok' : voteStatus === 'rejected' ? 'pill bad' : 'pill wait';
        return `
          <div class="player-row ${alive ? '' : 'dead'} ${isTurn || isVoteTurn ? 'turn' : ''}">
            <div class="left">
              <div class="name"><strong>${esc(p.name || 'Speler')}</strong> <span class="muted">#${seat}</span></div>
              <div class="meta muted">${alive ? 'Levend' : 'Dood'} · ${Number(p.dice_count || 0)} dobbelstenen</div>
            </div>
            <div class="right">${phase === 'voting' ? `<span class="${pillClass}">${pillText}</span>` : ''}</div>
          </div>
        `;
      }).join('');
    }

    const myDiceWrap = qs('#pkMyDice');
    if (myDiceWrap){
      myDiceWrap.innerHTML = '';
      myHand.forEach((face)=>{
        const n = Number(face || 0);
        myDiceWrap.appendChild(dieImg(n, `die ${n === 1 ? 'pik' : ''}`.trim()));
      });
    }

    const myTurn = phase === 'bidding' && Number(viewer.seat || 0) === turnSeat && aliveOf(viewer);
    const myVoteTurn = phase === 'voting' && Number(viewer.seat || 0) === voteTurnSeat && aliveOf(viewer);
    setDisplay('#pkBidPanel', myTurn ? 'block' : 'none');
    setDisplay('#pkVotePanel', myVoteTurn ? 'block' : 'none');
    const rejectBtn = qs('#pkRejectBtn'); if (rejectBtn) rejectBtn.disabled = !myTurn || !bid;

    const revealWrap = qs('#pkReveal');
    if (revealWrap){
      if (!lastReveal){
        revealWrap.style.display = 'none';
        revealWrap.innerHTML = '';
      } else {
        revealWrap.style.display = 'block';
        const lrBid = lastReveal.bid || {};
        const lrBidTxt = (Number(lrBid.face) === 1) ? `${lrBid.count} × pik` : `${lrBid.count} × ${lrBid.face}`;
        revealWrap.innerHTML = `
          <details class="accordion" open>
            <summary>
              <span>Laatste ronde (R${Number(lastReveal.round_no || 0)}): bod ${esc(lrBidTxt)}</span>
              <span class="muted">${lastReveal.bid_true ? 'gehaald' : 'niet gehaald'} · geteld ${Number(lastReveal.counted_total || 0)}</span>
            </summary>
            <div class="detail">
              <div class="muted">Verliezers: ${esc(String(lastReveal.losing_kind || ''))} · Starter: stoel ${Number(lastReveal.next_starter_seat || 0)}</div>
              <div class="reveal-grid">
                ${(Array.isArray(lastReveal.hands) ? lastReveal.hands : []).map((h)=>{
                  const dice = Array.isArray(h.dice) ? h.dice : [];
                  return `
                    <div class="reveal-card">
                      <div class="reveal-name"><strong>${esc(h.name || 'Speler')}</strong> <span class="muted">#${Number(h.seat || 0)}</span></div>
                      <div class="dice-row">${dice.map((d)=>`<img class="die ${Number(d) === 1 ? 'pik' : ''}" src="./assets/pikken/dice-${Number(d)}.svg" alt="die ${Number(d)}">`).join('')}</div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </details>
        `;
      }
    }

    const liveMeta = qs('#pkLiveMeta');
    if (liveMeta){
      const seatLabel = Number(viewer.seat || 0) ? ` · stoel ${Number(viewer.seat || 0)}` : '';
      liveMeta.textContent = `${phase === 'finished' ? 'Wedstrijd afgerond' : 'Live'}${seatLabel}`;
    }
  }

  function render(state){
    const game = state?.game || {};
    const phase = String(game?.state?.phase || 'lobby');
    const resolvedGameId = String(game?.id || UI.gameId || '').trim();

    UI.gameId = resolvedGameId || UI.gameId;
    if (resolvedGameId){
      setParticipantToken(resolvedGameId, phase && phase !== 'finished');
    } else if (phase === 'finished') {
      setParticipantToken('', false);
    }

    if (isLobbyPage() && phase !== 'lobby' && resolvedGameId){
      if (!UI.redirecting){
        UI.redirecting = true;
        window.location.replace(liveHref(resolvedGameId));
      }
      return;
    }

    if (isLivePage()) renderLive(state);
    else renderLobby(state);
  }

  async function loadAndRender(){
    if (!UI.gameId){
      if (isLivePage()) setStatus('Geen actieve Pikken-match gekozen. Open deze pagina vanuit de lobby.', true);
      return;
    }
    try{
      const state = await rpc('pikken_get_state_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId });
      const version = Number(state?.game?.state_version || -1);
      if (version !== UI.lastStateVersion){
        UI.lastStateVersion = version;
        render(state);
      } else if (isLobbyPage()) {
        const phase = String(state?.game?.state?.phase || 'lobby');
        if (phase !== 'lobby' && String(state?.game?.id || UI.gameId || '').trim()){
          render(state);
          return;
        }
        setText('#pkSyncNote', `Live sync actief · ${new Date().toLocaleTimeString('nl-NL')}`);
      }
      setStatus('', false);
    }catch(err){
      setStatus(normalizeError(err) || 'Laden mislukt.', true);
    }
  }

  function startPolling(){
    stopPolling();
    UI.pollTimer = setInterval(()=>{ if(!document.hidden) loadAndRender(); }, 1200);
    loadAndRender();
  }
  function stopPolling(){
    if(UI.pollTimer){ clearInterval(UI.pollTimer); UI.pollTimer = null; }
  }

  function setStatus(text, isError){
    const el = qs('#pkStatus');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#8a1022' : '#2f6d3c';
  }

  async function createLobby(){
    setStatus('Lobby maken…', false);
    const mode = (qs('#pkPenaltyMode') && qs('#pkPenaltyMode').value) || 'wrong_loses';
    const out = await rpc('pikken_create_lobby_scoped', {
      session_token: sessionToken() || null,
      site_scope_input: getScope(),
      config_input: { penalty_mode: mode }
    });
    UI.gameId = out.game_id;
    setParticipantToken(UI.gameId, true);
    history.replaceState(null, '', lobbyHref(UI.gameId));
    startPolling();
  }

  async function joinLobby(){
    const code = String((qs('#pkJoinCode') && qs('#pkJoinCode').value) || '').trim().toUpperCase();
    if(!code) return setStatus('Vul een lobby code in.', true);
    setStatus('Lobby joinen…', false);
    const out = await rpc('pikken_join_lobby_scoped', {
      session_token: sessionToken() || null,
      site_scope_input: getScope(),
      lobby_code_input: code
    });
    UI.gameId = out.game_id;
    setParticipantToken(UI.gameId, true);
    history.replaceState(null, '', lobbyHref(UI.gameId));
    startPolling();
  }

  async function setReady(ready){
    setStatus(ready ? 'Ready…' : 'Unready…', false);
    await rpc('pikken_set_ready_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId, ready_input: !!ready });
    await loadAndRender();
  }

  async function startGame(){
    setStatus('Starten…', false);
    await rpc('pikken_start_game_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId });
    if (UI.gameId){
      window.location.replace(liveHref(UI.gameId));
      return;
    }
    await loadAndRender();
  }

  async function placeBid(){
    const count = Number((qs('#pkBidCount') && qs('#pkBidCount').value) || 0);
    const face = Number((qs('#pkBidFace') && qs('#pkBidFace').value) || 0);
    setStatus('Bieden…', false);
    const state = await rpc('pikken_place_bid_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId, bid_count_input: count, bid_face_input: face });
    render(state);
  }

  async function rejectBid(){
    setStatus('Afkeuren…', false);
    const state = await rpc('pikken_reject_bid_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId });
    render(state);
  }

  async function vote(v){
    setStatus('Stemmen…', false);
    const state = await rpc('pikken_cast_vote_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId, vote_input: !!v });
    render(state);
  }

  function bindClick(sel, handler){
    const el = qs(sel);
    if (el) el.addEventListener('click', handler);
  }

  function boot(){
    UI.gameId = currentUrlGameId() || storedParticipantGameId() || '';

    bindClick('#pkCreateLobbyBtn', ()=>createLobby().catch(e=>setStatus(normalizeError(e) || 'Maken mislukt.', true)));
    bindClick('#pkJoinLobbyBtn', ()=>joinLobby().catch(e=>setStatus(normalizeError(e) || 'Join mislukt.', true)));
    bindClick('#pkRefreshBtn', ()=>loadAndRender().catch(e=>setStatus(normalizeError(e) || 'Verversen mislukt.', true)));
    bindClick('#pkReadyBtn', ()=>setReady(true).catch(e=>setStatus(normalizeError(e) || 'Ready mislukt.', true)));
    bindClick('#pkUnreadyBtn', ()=>setReady(false).catch(e=>setStatus(normalizeError(e) || 'Unready mislukt.', true)));
    bindClick('#pkStartBtn', ()=>startGame().catch(e=>setStatus(normalizeError(e) || 'Start mislukt.', true)));
    bindClick('#pkPlaceBidBtn', ()=>placeBid().catch(e=>setStatus(normalizeError(e) || 'Bieden mislukt.', true)));
    bindClick('#pkRejectBtn', ()=>rejectBid().catch(e=>setStatus(normalizeError(e) || 'Afkeuren mislukt.', true)));
    bindClick('#pkVoteApproveBtn', ()=>vote(true).catch(e=>setStatus(normalizeError(e) || 'Stem mislukt.', true)));
    bindClick('#pkVoteRejectBtn', ()=>vote(false).catch(e=>setStatus(normalizeError(e) || 'Stem mislukt.', true)));

    const joinInput = qs('#pkJoinCode');
    if (joinInput){
      joinInput.addEventListener('input', markJoinCodeDirty);
      joinInput.addEventListener('focus', markJoinCodeDirty);
      joinInput.addEventListener('blur', ()=>{ UI.joinCodeTouchedAt = Date.now(); });
    }

    if (UI.gameId){
      setParticipantToken(UI.gameId, true);
      startPolling();
    } else if (isLivePage()) {
      setStatus('Geen actieve Pikken-match gekozen. Open deze pagina vanuit de lobby.', true);
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
