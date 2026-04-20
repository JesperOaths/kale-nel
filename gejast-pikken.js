(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtils = window.GEJAST_SCOPE_UTILS || {};
  const PARTICIPANT_KEY = 'gejast_pikken_participant_v613';

  function getScope(){
    try { return (scopeUtils.getScope && scopeUtils.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); }
    catch(_){ return 'friends'; }
  }
  function sessionToken(){ try { return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; } catch(_){ return ''; } }
  function headers(){ return { apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { throw new Error(text || `HTTP ${res.status}`); } if(!res.ok) throw new Error(data?.message || data?.error || text || `HTTP ${res.status}`); return data; }
  async function rpc(name, payload){ const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', headers:headers(), body: JSON.stringify(payload || {}), cache:'no-store' }); return parse(res); }
  async function rpcFirst(names, payload){ let last = null; for (const name of names){ try { return await rpc(name, payload); } catch (err) { last = err; } } throw last || new Error('RPC mislukt.'); }

  function qs(sel, root){ return (root||document).querySelector(sel); }
  function esc(s){ const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}; return String(s??'').replace(/[&<>"']/g,m=>map[m]); }
  function normalizeError(err){
    const msg = String(err && err.message || err || 'Onbekende fout');
    if(/invalid input syntax for type uuid/i.test(msg)) return 'Nog geen actieve match geselecteerd. Maak eerst een lobby of join er één.';
    if(/game_type\s+ongeldig/i.test(msg)) return 'Pikken live-samenvatting staat backend nog niet open voor dit spel. Draai de compat SQL en probeer opnieuw.';
    return msg;
  }

  function setParticipantToken(gameId, active){ try{ if(active && gameId){ localStorage.setItem(PARTICIPANT_KEY, JSON.stringify({game_id:String(gameId), at:Date.now()})); } else { localStorage.removeItem(PARTICIPANT_KEY); } }catch(_){ } }
  function liveHref(gameId){ return `./pikken_live.html?client_match_id=${encodeURIComponent(String(gameId||''))}`; }
  function spectatorHref(gameId){ return `./pikken_spectator.html?client_match_id=${encodeURIComponent(String(gameId||''))}`; }
  function setStatus(text, isError){ const el = qs('#pkStatus'); if(!el) return; el.textContent = text || ''; el.style.color = isError ? '#7f2f1d' : '#6b6257'; }
  function setChip(text){ const el = qs('#pkStatusChip'); if (el) el.textContent = text || 'Lobby'; }

  function sortDiceFaces(dice){ return (Array.isArray(dice) ? dice : []).map((n)=>Number(n || 0)).filter(Boolean).sort((a,b)=>((a===1?7:a)-(b===1?7:b))); }
  function extractMyHandFromActorState(state){
    const viewer = state?.viewer || {};
    const players = Array.isArray(state?.players) ? state.players : [];
    const directCandidates = [
      state?.my_hand, state?.myHand, viewer?.my_hand, viewer?.myHand, viewer?.hand, viewer?.dice,
      viewer?.dice_values, state?.game?.state?.my_hand, state?.actor_state?.my_hand, state?.actor_state?.dice,
      state?.actor_state?.dice_values, state?.private_state?.my_hand, state?.private_state?.dice
    ];
    for (const cand of directCandidates){ const dice = sortDiceFaces(cand); if (dice.length) return dice; }
    const mySeat = Number(viewer?.seat || viewer?.seat_index || 0);
    const myPlayerId = Number(viewer?.player_id || 0);
    const viewerName = String(viewer?.display_name || viewer?.player_name || viewer?.name || '').trim().toLowerCase();
    for (const player of players){
      const sameSeat = mySeat && Number(player?.seat || player?.seat_index || 0) === mySeat;
      const sameId = myPlayerId && Number(player?.player_id || 0) === myPlayerId;
      const sameName = viewerName && String(player?.name || player?.player_name || '').trim().toLowerCase() === viewerName;
      if (!(sameSeat || sameId || sameName)) continue;
      const dice = sortDiceFaces(player?.hand || player?.my_hand || player?.dice || player?.dice_values || player?.current_hand || player?.rolled_dice);
      if (dice.length) return dice;
    }
    return [];
  }
  function dieImg(face, cls){
    const n = Number(face||0);
    const img = document.createElement('img');
    img.className = cls || '';
    img.alt = n ? `die ${n}` : 'die';
    img.src = n ? `./assets/pikken/dice-${n}.svg` : './assets/pikken/dice-hidden.svg';
    return img;
  }

  const UI = { gameId:'', lastStateVersion:-1, pollTimer:null };

  function render(state){
    const game = state?.game || {};
    const viewer = state?.viewer || {};
    const players = Array.isArray(state?.players) ? state.players : [];
    const votes = Array.isArray(state?.votes) ? state.votes : [];
    const phase = String(game?.state?.phase || 'lobby');
    const myHand = extractMyHandFromActorState(state);

    setParticipantToken(game?.id || UI.gameId, phase && phase !== 'finished');
    setChip(phase);
    const liveLink = qs('#pkLiveLink'); if(liveLink){ liveLink.href = liveHref(game?.id || UI.gameId); liveLink.style.display = (game?.id || UI.gameId) ? '' : 'none'; }
    const spectatorLink = qs('#pkSpectatorLink'); if (spectatorLink) spectatorLink.href = spectatorHref(game?.id || UI.gameId);
    const lobby = qs('#pkLobbyCode'); if (lobby) lobby.textContent = game?.lobby_code || '—';
    const phaseEl = qs('#pkPhase'); if (phaseEl) phaseEl.textContent = phase;
    const roundEl = qs('#pkRoundNo'); if (roundEl) roundEl.textContent = String(Number(game?.state?.round_no || 0) || 0);

    const totals = state?.dice_totals || {};
    const start = qs('#pkDiceStart'); if (start) start.textContent = String(Number(totals.start_total||0));
    const current = qs('#pkDiceCurrent'); if (current) current.textContent = String(Number(totals.current_total||0));
    const lost = qs('#pkDiceLost'); if (lost) lost.textContent = String(Number(totals.lost_total||0));

    const bid = game?.state?.bid && game.state.bid !== null ? game.state.bid : null;
    const bidTxt = bid ? (Number(bid.face)===1 ? `${bid.count} × pik` : `${bid.count} × ${bid.face}`) : '—';
    const bidTextEl = qs('#pkBidText'); if (bidTextEl) bidTextEl.textContent = bidTxt;
    const bidByEl = qs('#pkBidBy'); if (bidByEl) bidByEl.textContent = bid ? `door ${bid.bidder_name || '—'}` : '';

    const turnSeat = Number(game?.state?.current_turn_seat || 0);
    const voteTurnSeat = Number(game?.state?.vote_turn_seat || 0);
    const list = qs('#pkPlayers');
    if (list){
      list.innerHTML = players.map((p)=>{
        const seat = Number(p.seat||p.seat_index||0);
        const alive = !!p.alive || phase === 'lobby';
        const isTurn = phase === 'bidding' && seat === turnSeat;
        const isVoteTurn = phase === 'voting' && seat === voteTurnSeat;
        const kick = viewer?.is_host && !p.is_self ? `<button class="btn alt tiny" data-kick-seat="${seat}">Kick</button>` : '';
        const vote = votes.find(v=>Number(v.seat||v.seat_index||0)===seat);
        const voteStatus = vote ? String(vote.status||'waiting') : 'waiting';
        const pillText = phase === 'voting' ? (voteStatus === 'approved' ? 'goedgekeurd' : voteStatus === 'rejected' ? 'afgekeurd' : 'wacht') : (p.is_host ? 'Host' : (p.is_ready ? 'Ready' : 'Niet ready'));
        const pillClass = phase === 'voting' ? (voteStatus === 'approved' ? 'pill ok' : voteStatus === 'rejected' ? 'pill bad' : 'pill wait') : (p.is_host ? 'pill ok' : (p.is_ready ? 'pill ok' : 'pill wait'));
        return `<div class="player-row ${alive?'':'dead'} ${isTurn||isVoteTurn?'turn':''}"><div><div class="name"><strong>${esc(p.name||p.player_name||'Speler')}</strong> <span class="muted">#${seat}</span></div><div class="meta muted">${alive?'Levend':'Dood'} · ${Number(p.dice_count||0)} dobbelstenen</div></div><div><span class="${pillClass}">${pillText}</span></div><div>${kick}</div></div>`;
      }).join('') || '<div class="muted">Nog geen spelers.</div>';
    }

    const myDiceWrap = qs('#pkMyDice');
    if (myDiceWrap){
      myDiceWrap.innerHTML = '';
      if (!myHand.length) myDiceWrap.innerHTML = '<div class="muted">Nog geen dobbelstenen zichtbaar. Dit wijst meestal op een backend-state gat of een andere sleutelnaam in de state.</div>';
      myHand.forEach((face)=>{ const n = Number(face||0); myDiceWrap.appendChild(dieImg(n, `die ${n===1?'pik':''}`.trim())); });
    }

    const myTurn = phase === 'bidding' && Number(viewer.seat||viewer.seat_index||0) === turnSeat && !!viewer.alive;
    const myVoteTurn = phase === 'voting' && Number(viewer.seat||viewer.seat_index||0) === voteTurnSeat && !!viewer.alive;
    const bidPanel = qs('#pkBidPanel'); if (bidPanel) bidPanel.style.display = myTurn ? 'block' : 'none';
    const votePanel = qs('#pkVotePanel'); if (votePanel) votePanel.style.display = myVoteTurn ? 'block' : 'none';
    const rejectBtn = qs('#pkRejectBtn'); if (rejectBtn) rejectBtn.disabled = !myTurn || !bid;

    const revealWrap = qs('#pkReveal');
    const lastReveal = game?.state?.last_reveal || null;
    if (revealWrap){
      if(!lastReveal){ revealWrap.style.display='none'; revealWrap.innerHTML=''; }
      else {
        revealWrap.style.display='block';
        const lrBid = lastReveal.bid || {};
        const lrBidTxt = (Number(lrBid.face)===1) ? `${lrBid.count} × pik` : `${lrBid.count} × ${lrBid.face}`;
        revealWrap.innerHTML = `<details class="accordion" open><summary><span>Laatste ronde (R${Number(lastReveal.round_no||0)}): bod ${esc(lrBidTxt)}</span><span class="muted">${lastReveal.bid_true ? 'gehaald' : 'niet gehaald'} · geteld ${Number(lastReveal.counted_total||0)}</span></summary><div class="detail"><div class="muted">Verliezers: ${esc(String(lastReveal.losing_kind||''))} · Starter: stoel ${Number(lastReveal.next_starter_seat||0)}</div><div class="reveal-grid">${(Array.isArray(lastReveal.hands)?lastReveal.hands:[]).map((h)=>{ const dice = Array.isArray(h.dice) ? h.dice : []; return `<div class="reveal-card"><div class="reveal-name"><strong>${esc(h.name||'Speler')}</strong> <span class="muted">#${Number(h.seat||0)}</span></div><div class="dice-row">${dice.map((d)=>`<img class="die ${Number(d)===1?'pik':''}" src="./assets/pikken/dice-${Number(d)}.svg" alt="die ${Number(d)}">`).join('')}</div></div>`; }).join('')}</div></div></details>`;
      }
    }
  }

  async function loadAndRender(){
    if(!UI.gameId){ setStatus('', false); setChip('Lobby'); return; }
    try{
      const state = await rpc('pikken_get_state_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId });
      const version = Number(state?.game?.state_version || -1);
      if(version !== UI.lastStateVersion){ UI.lastStateVersion = version; render(state); }
      setStatus('', false);
    }catch(err){ setStatus(normalizeError(err), true); }
  }

  function startPolling(){ stopPolling(); UI.pollTimer = setInterval(()=>{ if(!document.hidden) loadAndRender(); }, 1400); loadAndRender(); }
  function stopPolling(){ if(UI.pollTimer){ clearInterval(UI.pollTimer); UI.pollTimer=null; } }

  async function createLobby(){
    setStatus('Lobby maken…', false);
    const mode = qs('#pkPenaltyMode')?.value || 'wrong_loses';
    const startDice = Number(qs('#pkStartDice')?.value || 6);
    const out = await rpc('pikken_create_lobby_scoped', { session_token: sessionToken() || null, site_scope_input: getScope(), config_input: { penalty_mode: mode, start_dice: startDice } });
    UI.gameId = out.game_id; setParticipantToken(UI.gameId, true);
    history.replaceState(null,'',`pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
    startPolling();
  }
  async function joinLobby(){
    const code = String(qs('#pkJoinCode')?.value||'').trim().toUpperCase();
    if(!code) return setStatus('Vul een lobby code in.', true);
    setStatus('Lobby joinen…', false);
    const out = await rpc('pikken_join_lobby_scoped', { session_token: sessionToken() || null, site_scope_input: getScope(), lobby_code_input: code });
    UI.gameId = out.game_id; setParticipantToken(UI.gameId, true);
    history.replaceState(null,'',`pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
    startPolling();
  }
  async function setReady(ready){ if (!UI.gameId) return setStatus('Je zit nog niet in een lobby.', true); setStatus(ready?'Ready…':'Unready…', false); await rpc('pikken_set_ready_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId, ready_input: !!ready }); await loadAndRender(); }
  async function startGame(){ if (!UI.gameId) return setStatus('Je zit nog niet in een lobby.', true); setStatus('Starten…', false); await rpc('pikken_start_game_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId }); window.location.href = liveHref(UI.gameId); }
  async function placeBid(){ const count = Number(qs('#pkBidCount')?.value||0); const face = Number(qs('#pkBidFace')?.value||0); setStatus('Bieden…', false); const state = await rpc('pikken_place_bid_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId, bid_count_input: count, bid_face_input: face }); render(state); }
  async function rejectBid(){ setStatus('Afkeuren…', false); const state = await rpc('pikken_reject_bid_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId }); render(state); }
  async function vote(v){ setStatus('Stemmen…', false); const state = await rpc('pikken_cast_vote_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId, vote_input: !!v }); render(state); }
  async function leaveMatch(){ if(!UI.gameId) return setStatus('Je zit nu niet in een actieve match.', true); setStatus('Match verlaten…', false); await rpcFirst(['pikken_leave_game_scoped','pikken_leave_lobby_scoped'], { session_token: sessionToken()||null, game_id_input: UI.gameId }); setParticipantToken(UI.gameId, false); UI.gameId=''; stopPolling(); history.replaceState(null,'','pikken.html'); setStatus('Match verlaten.', false); const players = qs('#pkPlayers'); if (players) players.innerHTML = 'Nog geen lobby geladen.'; }
  async function destroyMatch(){ if(!UI.gameId) return setStatus('Je zit nu niet in een actieve match.', true); setStatus('Match verwijderen…', false); await rpcFirst(['pikken_destroy_game_scoped','pikken_destroy_lobby_scoped'], { session_token: sessionToken()||null, game_id_input: UI.gameId }); setParticipantToken(UI.gameId, false); UI.gameId=''; stopPolling(); history.replaceState(null,'','pikken.html'); setStatus('Match verwijderd.', false); const players = qs('#pkPlayers'); if (players) players.innerHTML = 'Nog geen lobby geladen.'; }
  async function kickSeat(seat){ if(!UI.gameId) return; setStatus(`Speler #${seat} kicken…`, false); await rpcFirst(['pikken_kick_player_scoped'], { session_token: sessionToken()||null, game_id_input: UI.gameId, seat_input: Number(seat), target_seat_input: Number(seat), seat_index_input: Number(seat) }); await loadAndRender(); }

  function boot(){
    const params = new URLSearchParams(location.search);
    UI.gameId = params.get('game_id') || '';
    qs('#pkCreateLobbyBtn')?.addEventListener('click', ()=>createLobby().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkJoinLobbyBtn')?.addEventListener('click', ()=>joinLobby().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkReadyBtn')?.addEventListener('click', ()=>setReady(true).catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkUnreadyBtn')?.addEventListener('click', ()=>setReady(false).catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkStartBtn')?.addEventListener('click', ()=>startGame().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkPlaceBidBtn')?.addEventListener('click', ()=>placeBid().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkRejectBtn')?.addEventListener('click', ()=>rejectBid().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkVoteApproveBtn')?.addEventListener('click', ()=>vote(true).catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkVoteRejectBtn')?.addEventListener('click', ()=>vote(false).catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkLeaveBtn')?.addEventListener('click', ()=>leaveMatch().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkDestroyBtn')?.addEventListener('click', ()=>destroyMatch().catch(e=>setStatus(normalizeError(e),true)));
    document.addEventListener('click', (ev)=>{ const btn = ev.target.closest('[data-kick-seat]'); if (btn && UI.gameId) kickSeat(btn.getAttribute('data-kick-seat')).catch(e=>setStatus(normalizeError(e),true)); });
    if(UI.gameId){ setParticipantToken(UI.gameId, true); startPolling(); } else { setStatus('', false); setChip('Lobby'); }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();