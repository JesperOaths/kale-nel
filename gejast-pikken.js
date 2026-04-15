(function(){
  // Template frontend module for `pikken.html`.
  // - No frameworks
  // - Talks to Supabase RPCs via fetch
  // - Polls `pikken_get_state_scoped`

  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtils = window.GEJAST_SCOPE_UTILS || {};

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
  function normalizeError(err){
    const msg = String(err && err.message || err || 'Onbekende fout');
    if(/game_type\s+ongeldig/i.test(msg)){
      return 'Pikken live-samenvatting staat backend nog niet open voor dit spel. Draai de v499 SQL-compat-fix en probeer opnieuw.';
    }

    if(/column reference "game_type" is ambiguous/i.test(msg)){
      return 'Pikken live-compat gebruikt nog een oudere game_type-lookup die botst. Draai de v499 SQL-compat-fix en vernieuw daarna hard.';
    }
    return msg;
  }

  function setParticipantToken(gameId, active){ try{ if(active && gameId){ localStorage.setItem(PIKKEN_PARTICIPANT_KEY, JSON.stringify({game_id:String(gameId), at:Date.now()})); } else { localStorage.removeItem(PIKKEN_PARTICIPANT_KEY); } }catch(_){ } }

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
    pollTimer: null
  };

  function render(state){
    const game = state?.game || {};
    const viewer = state?.viewer || {};
    const players = Array.isArray(state?.players) ? state.players : [];
    const votes = Array.isArray(state?.votes) ? state.votes : [];
    const myHand = Array.isArray(state?.my_hand) ? state.my_hand : [];
    const phase = String(game?.state?.phase || 'lobby');
    setParticipantToken(game?.id || UI.gameId, phase && phase !== 'finished');
    const bid = game?.state?.bid && game.state.bid !== null ? game.state.bid : null;
    const turnSeat = Number(game?.state?.current_turn_seat || 0);
    const voteTurnSeat = Number(game?.state?.vote_turn_seat || 0);
    const lastReveal = game?.state?.last_reveal || null;

    qs('#pkLobbyCode').textContent = game?.lobby_code || '—';
    const liveLink = qs('#pkLiveLink'); if(liveLink){ liveLink.href = liveHref(game?.id || UI.gameId); liveLink.style.display = (game?.id || UI.gameId) ? '' : 'none'; }
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
      setStatus(normalizeError(err) || 'Laden mislukt.', true);
    }
  }

  function startPolling(){
    stopPolling();
    UI.pollTimer = setInterval(()=>{ if(!document.hidden) loadAndRender(); }, 900);
    loadAndRender();
  }
  function stopPolling(){
    if(UI.pollTimer){ clearInterval(UI.pollTimer); UI.pollTimer=null; }
  }

  async function createLobby(){
    setStatus('Lobby maken…', false);
    const mode = qs('#pkPenaltyMode').value || 'wrong_loses';
    const out = await rpc('pikken_create_lobby_scoped', {
      session_token: sessionToken() || null,
      site_scope_input: getScope(),
      config_input: { penalty_mode: mode }
    });
    UI.gameId = out.game_id;
    setParticipantToken(UI.gameId, true);
    history.replaceState(null,'',`pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
    startPolling();
  }

  async function joinLobby(){
    const code = String(qs('#pkJoinCode').value||'').trim().toUpperCase();
    if(!code) return setStatus('Vul een lobby code in.', true);
    setStatus('Lobby joinen…', false);
    const out = await rpc('pikken_join_lobby_scoped', {
      session_token: sessionToken() || null,
      site_scope_input: getScope(),
      lobby_code_input: code
    });
    UI.gameId = out.game_id;
    setParticipantToken(UI.gameId, true);
    history.replaceState(null,'',`pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
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
    await loadAndRender();
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
    qs('#pkReadyBtn').addEventListener('click', ()=>setReady(true).catch(e=>setStatus(normalizeError(e)||'Ready mislukt.',true)));
    qs('#pkUnreadyBtn').addEventListener('click', ()=>setReady(false).catch(e=>setStatus(normalizeError(e)||'Unready mislukt.',true)));
    qs('#pkStartBtn').addEventListener('click', ()=>startGame().catch(e=>setStatus(normalizeError(e)||'Start mislukt.',true)));

    qs('#pkPlaceBidBtn').addEventListener('click', ()=>placeBid().catch(e=>setStatus(normalizeError(e)||'Bieden mislukt.',true)));
    qs('#pkRejectBtn').addEventListener('click', ()=>rejectBid().catch(e=>setStatus(normalizeError(e)||'Afkeuren mislukt.',true)));
    qs('#pkVoteApproveBtn').addEventListener('click', ()=>vote(true).catch(e=>setStatus(normalizeError(e)||'Stem mislukt.',true)));
    qs('#pkVoteRejectBtn').addEventListener('click', ()=>vote(false).catch(e=>setStatus(normalizeError(e)||'Stem mislukt.',true)));

    if(UI.gameId){ setParticipantToken(UI.gameId, true); startPolling(); }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();

