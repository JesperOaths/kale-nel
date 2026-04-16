(function(){
  // Shared frontend module for `pikken.html` and `pikken_live.html`.
  // - No frameworks
  // - Talks to Supabase RPCs via fetch
  // - Lobby page redirects participants into the live page once the match starts
  // - Live page reads the scoped participant state instead of the generic spectator summary path

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

  function storedParticipantState(){
    try{
      const raw = localStorage.getItem(PIKKEN_PARTICIPANT_KEY);
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      const gameId = String(parsed && parsed.game_id || '').trim();
      const scope = String(parsed && parsed.scope || '').trim().toLowerCase();
      if(!gameId) return null;
      return { gameId, scope: scope === 'family' ? 'family' : 'friends' };
    }catch(_){ return null; }
  }
  function storedParticipantGameId(){
    const stored = storedParticipantState();
    if(!stored || !stored.gameId) return '';
    if(stored.scope && stored.scope !== getScope()) return '';
    return stored.gameId;
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
  function gameStatus(game){
    return String(game?.status || '').trim().toLowerCase();
  }
  function gamePhase(game){
    const phase = String(game?.state?.phase || '').trim().toLowerCase();
    if(phase) return phase;
    const status = gameStatus(game);
    if(status === 'live') return 'bidding';
    if(status === 'finished') return 'finished';
    return 'lobby';
  }
  function hasGameStarted(game){
    const phase = gamePhase(game);
    const status = gameStatus(game);
    return phase !== 'lobby' || status === 'live' || status === 'finished';
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
    redirecting: false
  };

  function render(state){
    const game = state?.game || {};
    const viewer = state?.viewer || {};
    const players = Array.isArray(state?.players) ? state.players : [];
    const votes = Array.isArray(state?.votes) ? state.votes : [];
    const myHand = Array.isArray(state?.my_hand) ? state.my_hand : [];
    const phase = gamePhase(game);
    const status = gameStatus(game);
    const resolvedGameId = String(game?.id || UI.gameId || '').trim();

    UI.gameId = resolvedGameId || UI.gameId;
    if (resolvedGameId){
      setParticipantToken(resolvedGameId, phase !== 'finished' && status !== 'finished');
    } else if (phase === 'finished' || status === 'finished') {
      setParticipantToken('', false);
    }

    if (isLobbyPage() && hasGameStarted(game) && resolvedGameId){
      if (!UI.redirecting){
        UI.redirecting = true;
        window.location.replace(liveHref(resolvedGameId));
      }
      return;
    }

    const bid = game?.state?.bid && game.state.bid !== null ? game.state.bid : null;
    const turnSeat = Number(game?.state?.current_turn_seat || 0);
    const voteTurnSeat = Number(game?.state?.vote_turn_seat || 0);
    const lastReveal = game?.state?.last_reveal || null;

    setText('#pkLobbyCode', game?.lobby_code || '—');
    const liveLink = qs('#pkLiveLink');
    if(liveLink){
      liveLink.href = liveHref(resolvedGameId || UI.gameId);
      liveLink.style.display = (resolvedGameId || UI.gameId) ? '' : 'none';
    }
    const lobbyLink = qs('#pkLobbyLink');
    if (lobbyLink){
      lobbyLink.href = lobbyHref(resolvedGameId || UI.gameId);
      lobbyLink.style.display = (resolvedGameId || UI.gameId) ? '' : 'none';
    }

    setText('#pkPhase', phase);
    setText('#pkRoundNo', String(Number(game?.state?.round_no || 0) || 0));

    const totals = state?.dice_totals || {};
    setText('#pkDiceStart', String(Number(totals.start_total||0)));
    setText('#pkDiceCurrent', String(Number(totals.current_total||0)));
    setText('#pkDiceLost', String(Number(totals.lost_total||0)));

    setText('#pkBidText', bid ? (Number(bid.face)===1 ? `${bid.count} × pik` : `${bid.count} × ${bid.face}`) : '—');
    setText('#pkBidBy', bid ? `door ${bid.bidder_name || '—'}` : '');

    const list = qs('#pkPlayers');
    if (list){
      list.innerHTML = players.map((p)=>{
        const seat = Number(p.seat||0);
        const alive = !!p.alive;
        const isTurn = phase === 'bidding' && seat === turnSeat;
        const isVoteTurn = phase === 'voting' && seat === voteTurnSeat;
        const vote = votes.find(v=>Number(v.seat||0)===seat);
        const voteStatus = vote ? String(vote.status||'waiting') : 'waiting';
        const pillText = voteStatus === 'approved' ? 'goedgekeurd' : voteStatus === 'rejected' ? 'afgekeurd' : 'wacht';
        const pillClass = voteStatus === 'approved' ? 'pill ok' : voteStatus === 'rejected' ? 'pill bad' : 'pill wait';
        return `
          <div class="player-row ${alive?'':'dead'} ${isTurn||isVoteTurn?'turn':''}">
            <div class="left">
              <div class="name"><strong>${esc(p.name||'Speler')}</strong> <span class="muted">#${seat}</span></div>
              <div class="meta muted">${alive?'Levend':'Dood'} · ${Number(p.dice_count||0)} dobbelstenen</div>
            </div>
            <div class="right">${phase==='voting'?`<span class="${pillClass}">${pillText}</span>`:''}</div>
          </div>
        `;
      }).join('');
    }

    const myDiceWrap = qs('#pkMyDice');
    if (myDiceWrap){
      myDiceWrap.innerHTML = '';
      myHand.forEach((face)=>{
        const n = Number(face||0);
        myDiceWrap.appendChild(dieImg(n, `die ${n===1?'pik':''}`.trim()));
      });
    }

    const myTurn = phase === 'bidding' && Number(viewer.seat||0) === turnSeat && !!viewer.alive;
    const myVoteTurn = phase === 'voting' && Number(viewer.seat||0) === voteTurnSeat && !!viewer.alive;
    setDisplay('#pkBidPanel', myTurn ? 'block' : 'none');
    setDisplay('#pkVotePanel', myVoteTurn ? 'block' : 'none');
    const rejectBtn = qs('#pkRejectBtn'); if (rejectBtn) rejectBtn.disabled = !myTurn || !bid;

    const revealWrap = qs('#pkReveal');
    if(revealWrap){
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

    const liveMeta = qs('#pkLiveMeta');
    if (liveMeta){
      const seatLabel = Number(viewer.seat || 0) ? ` · stoel ${Number(viewer.seat||0)}` : '';
      liveMeta.textContent = `${phase === 'finished' ? 'Wedstrijd afgerond' : 'Live'}${seatLabel}`;
    }
  }

  async function loadAndRender(){
    if(!UI.gameId){
      setStatus(isLivePage() ? 'Geen actieve Pikken-match gekozen. Open deze pagina vanuit de lobby.' : 'Maak of join eerst een lobby.', true);
      return;
    }
    try{
      const state = await rpc('pikken_get_state_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId });
      const version = Number(state?.game?.state_version || -1);
      if(version !== UI.lastStateVersion){
        UI.lastStateVersion = version;
        render(state);
      } else if (isLobbyPage()){
        if (hasGameStarted(state?.game) && String(state?.game?.id || UI.gameId || '').trim()){
          render(state);
          return;
        }
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
    if(UI.pollTimer){ clearInterval(UI.pollTimer); UI.pollTimer=null; }
  }

  function setStatus(text, isError){
    const el = qs('#pkStatus');
    if(!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#7f2f1d' : '#6b6257';
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
    history.replaceState(null,'', lobbyHref(UI.gameId));
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
    history.replaceState(null,'', lobbyHref(UI.gameId));
    startPolling();
  }

  async function setReady(ready){
    setStatus(ready?'Ready…':'Unready…', false);
    await rpc('pikken_set_ready_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId, ready_input: !!ready });
    await loadAndRender();
  }

  async function startGame(){
    setStatus('Starten…', false);
    await rpc('pikken_start_game_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId });
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

  function bindClick(sel, handler){
    const el = qs(sel);
    if (el) el.addEventListener('click', handler);
  }

  function boot(){
    UI.gameId = currentUrlGameId() || storedParticipantGameId();

    bindClick('#pkCreateLobbyBtn', ()=>createLobby().catch(e=>setStatus(normalizeError(e)||'Maken mislukt.',true)));
    bindClick('#pkJoinLobbyBtn', ()=>joinLobby().catch(e=>setStatus(normalizeError(e)||'Join mislukt.',true)));
    bindClick('#pkReadyBtn', ()=>setReady(true).catch(e=>setStatus(normalizeError(e)||'Ready mislukt.',true)));
    bindClick('#pkUnreadyBtn', ()=>setReady(false).catch(e=>setStatus(normalizeError(e)||'Unready mislukt.',true)));
    bindClick('#pkStartBtn', ()=>startGame().catch(e=>setStatus(normalizeError(e)||'Start mislukt.',true)));

    bindClick('#pkPlaceBidBtn', ()=>placeBid().catch(e=>setStatus(normalizeError(e)||'Bieden mislukt.',true)));
    bindClick('#pkRejectBtn', ()=>rejectBid().catch(e=>setStatus(normalizeError(e)||'Afkeuren mislukt.',true)));
    bindClick('#pkVoteApproveBtn', ()=>vote(true).catch(e=>setStatus(normalizeError(e)||'Stem mislukt.',true)));
    bindClick('#pkVoteRejectBtn', ()=>vote(false).catch(e=>setStatus(normalizeError(e)||'Stem mislukt.',true)));

    if(UI.gameId){
      if(!currentUrlGameId()){
        try{
          history.replaceState(null,'', isLivePage() ? liveHref(UI.gameId) : lobbyHref(UI.gameId));
        }catch(_){ }
      }
      setParticipantToken(UI.gameId, true);
      startPolling();
    } else if (isLivePage()) {
      setStatus('Geen actieve Pikken-match gekozen. Open deze pagina vanuit de lobby.', true);
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
