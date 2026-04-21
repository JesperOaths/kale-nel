(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtils = window.GEJAST_SCOPE_UTILS || {};
  const PARTICIPANT_KEY = 'gejast_pikken_participant_v613';
  const LAST_CODE_KEY = 'gejast_pikken_last_code_v613';

  function getScope(){
    try { return (scopeUtils.getScope && scopeUtils.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); }
    catch(_){ return 'friends'; }
  }
  function sessionToken(){ try { return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; } catch(_){ return ''; } }
  function headers(){ return { apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { throw new Error(text || `HTTP ${res.status}`); } if(!res.ok) throw new Error(data?.message || data?.error || text || `HTTP ${res.status}`); return data; }
  async function rpc(name, payload){ const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', headers:headers(), body: JSON.stringify(payload || {}), cache:'no-store' }); return parse(res); }
  async function rpcFirst(names, payload){ let last = null; for (const name of names){ try { return await rpc(name, payload); } catch (err) { last = err; } } throw last || new Error('RPC mislukt.'); }
  async function rpcVariants(name, variants){ let last = null; for (const payload of variants || []){ try { return await rpc(name, payload); } catch (err) { last = err; } } throw last || new Error('RPC variant mislukt.'); }

  function qs(sel, root){ return (root||document).querySelector(sel); }
  function esc(s){ const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}; return String(s??'').replace(/[&<>"']/g,m=>map[m]); }
  function normalizeError(err){
    const msg = String(err && err.message || err || 'Onbekende fout');
    if(/invalid input syntax for type uuid/i.test(msg)) return 'Nog geen actieve match geselecteerd. Maak eerst een lobby of join er één.';
    if(/game_type\s+ongeldig/i.test(msg)) return 'Pikken live-samenvatting staat backend nog niet open voor dit spel. Draai de compat SQL en probeer opnieuw.';
    return msg;
  }

  function setParticipantToken(gameId, active){ try{ if(active && gameId){ localStorage.setItem(PARTICIPANT_KEY, JSON.stringify({game_id:String(gameId), at:Date.now()})); } else { localStorage.removeItem(PARTICIPANT_KEY); } }catch(_){ } }
  function getParticipantToken(){ try{ const raw = JSON.parse(localStorage.getItem(PARTICIPANT_KEY) || 'null'); return raw && raw.game_id ? String(raw.game_id) : ''; }catch(_){ return ''; } }
  function rememberLobbyCode(code){ try{ if(code) localStorage.setItem(LAST_CODE_KEY, String(code).trim().toUpperCase()); }catch(_){ } }
  function lastLobbyCode(){ try{ return String(localStorage.getItem(LAST_CODE_KEY) || '').trim().toUpperCase(); }catch(_){ return ''; } }
  function liveHref(gameId){ return `./pikken_live.html?client_match_id=${encodeURIComponent(String(gameId||''))}`; }
  function spectatorHref(gameId){ return `./pikken_spectator.html?client_match_id=${encodeURIComponent(String(gameId||''))}`; }
  function spectatorHrefForCode(code){ return `./pikken_spectator.html?lobby_code=${encodeURIComponent(String(code||'').trim().toUpperCase())}${getScope() === 'family' ? '&scope=family' : ''}`; }
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

  const UI = { gameId:'', lastStateVersion:-1, pollTimer:null, lastPlayers:[], feedTimer:null };
  let autoLiveRedirectDone = false;

  function renderMatchSummary(game, viewer, totals){
    const el = qs('#pkMatchSummary');
    if (!el) return;
    if (!(game?.id || UI.gameId)) {
      el.textContent = 'Nog geen actieve Pikken-match op dit apparaat.';
      return;
    }
    const phase = String(game?.state?.phase || 'lobby');
    const roundNo = Number(game?.state?.round_no || 0);
    const seat = Number(viewer?.seat || viewer?.seat_index || 0);
    const lobbyCode = String(game?.lobby_code || '').trim();
    el.textContent = `${lobbyCode ? `Code ${lobbyCode} · ` : ''}${phase}${roundNo ? ` · ronde ${roundNo}` : ''}${seat ? ` · stoel ${seat}` : ''}${totals?.current_total ? ` · ${Number(totals.current_total || 0)} dobbelstenen actief` : ''}`;
  }

  function feedCardMarkup(item, mode){
    const title = esc(item?.title || item?.lobby_code || item?.label || 'Pikken-tafel');
    const subtitle = esc(item?.subtitle || item?.status_text || item?.host_name || item?.phase || 'Beschikbaar');
    const code = esc(item?.lobby_code || '');
    const players = Number(item?.player_count || item?.players_count || item?.participant_count || 0);
    const gameId = item?.game_id || item?.id || item?.client_match_id || '';
    const playHref = gameId ? `./pikken.html?game_id=${encodeURIComponent(String(gameId))}${getScope() === 'family' ? '&scope=family' : ''}` : './pikken.html';
    const liveHrefValue = gameId ? spectatorHref(gameId) : (code ? spectatorHrefForCode(code) : './pikken_spectator.html');
    return `<article class="feed-card"><div class="feed-head"><div><div class="feed-title">${title}</div><div class="feed-meta">${subtitle}${code ? ` · code ${code}` : ''}${players ? ` · ${players} speler${players === 1 ? '' : 's'}` : ''}</div></div><span class="pill ${mode === 'live' ? 'ok' : 'wait'}">${mode === 'live' ? 'Live' : 'Lobby'}</span></div><div class="feed-actions">${mode === 'lobby' ? `<button class="btn alt tiny" type="button" data-join-code="${code}">Join</button>` : `<a class="btn alt tiny" href="${playHref}">Open</a>`}<a class="btn alt tiny" href="${liveHrefValue}">Spectate</a></div></article>`;
  }

  function renderLobbyFeed(items){
    const wrap = qs('#pkLobbyFeed');
    if (!wrap) return;
    if (!items.length) { wrap.innerHTML = '<div class="muted">Geen open Pikken-lobbies gevonden.</div>'; return; }
    wrap.innerHTML = items.map((item)=>feedCardMarkup(item, 'lobby')).join('');
  }

  function renderLiveFeed(items){
    const wrap = qs('#pkLiveFeed');
    if (!wrap) return;
    if (!items.length) { wrap.innerHTML = '<div class="muted">Geen actieve Pikken-matches gevonden.</div>'; return; }
    wrap.innerHTML = items.map((item)=>feedCardMarkup(item, 'live')).join('');
  }

  async function loadDiscoverFeeds(){
    try {
      const rows = await rpcFirst([
        'get_pikken_open_lobbies_public_scoped',
        'get_pikken_open_lobbies_public',
        'list_pikken_open_lobbies_public_scoped',
        'list_pikken_open_lobbies_public'
      ], { site_scope_input: getScope(), session_token: sessionToken() || null });
      const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.rows) ? rows.rows : (Array.isArray(rows?.items) ? rows.items : []));
      renderLobbyFeed(list);
    } catch (_) {
      renderLobbyFeed([]);
    }
    try {
      const rows = await rpcFirst(['get_live_match_summaries_scoped','get_live_match_summaries'], {
        session_token: sessionToken() || null,
        game_type_input: 'pikken',
        site_scope_input: getScope()
      });
      const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.items) ? rows.items : (Array.isArray(rows?.rows) ? rows.rows : []));
      renderLiveFeed(list.filter((item)=>String(item?.game_type || item?.type || 'pikken').toLowerCase().includes('pikken')));
    } catch (_) {
      renderLiveFeed([]);
    }
  }

  function restoreParticipantGame(){
    if (UI.gameId) return;
    const storedGameId = getParticipantToken();
    if (!storedGameId) return;
    UI.gameId = storedGameId;
    history.replaceState(null,'',`pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
    setStatus('Actieve Pikken-match teruggezet op dit apparaat.', false);
  }

  function render(state){
    const game = state?.game || {};
    const viewer = state?.viewer || {};
    const players = Array.isArray(state?.players) ? state.players : [];
    const votes = Array.isArray(state?.votes) ? state.votes : [];
    const phase = String(game?.state?.phase || 'lobby');
    const myHand = extractMyHandFromActorState(state);
    UI.lastPlayers = players.slice();

    setParticipantToken(game?.id || UI.gameId, phase && phase !== 'finished');
    setChip(phase);
    const liveLink = qs('#pkLiveLink'); if(liveLink){ liveLink.href = liveHref(game?.id || UI.gameId); liveLink.style.display = (game?.id || UI.gameId) ? '' : 'none'; }
    const spectatorLink = qs('#pkSpectatorLink'); if (spectatorLink) spectatorLink.href = spectatorHref(game?.id || UI.gameId);
    const lobby = qs('#pkLobbyCode'); if (lobby) lobby.textContent = game?.lobby_code || '—';
    const phaseEl = qs('#pkPhase'); if (phaseEl) phaseEl.textContent = phase;
    const roundEl = qs('#pkRoundNo'); if (roundEl) roundEl.textContent = String(Number(game?.state?.round_no || 0) || 0);

    const totals = state?.dice_totals || {};
    renderMatchSummary(game, viewer, totals);

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
    if (game?.lobby_code) rememberLobbyCode(game.lobby_code);

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

    const isParticipant = !!(viewer?.player_id || viewer?.display_name || viewer?.player_name || viewer?.seat || viewer?.seat_index);
    if (phase !== 'lobby' && game?.id && isParticipant && !autoLiveRedirectDone) {
      autoLiveRedirectDone = true;
      setStatus('Match gestart. Je gaat door naar de live tafel…', false);
      setTimeout(() => { window.location.href = liveHref(game.id); }, 450);
    }
  }

  async function loadAndRender(){
    if(!UI.gameId){ setStatus('', false); setChip('Lobby'); return; }
    try{
      const state = await rpc('pikken_get_state_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId });
      const version = Number(state?.game?.state_version || -1);
      if(version !== UI.lastStateVersion){ UI.lastStateVersion = version; render(state); }
      setStatus('', false);
    }catch(err){
      const message = normalizeError(err);
      if (/niet gevonden|game not found|invalid input syntax for type uuid/i.test(String(message || ''))) {
        resetLobbyState('');
        return;
      }
      setStatus(message, true);
    }
  }

  function startPolling(){ stopPolling(); UI.pollTimer = setInterval(()=>{ if(!document.hidden) loadAndRender(); }, 1400); loadAndRender(); }
  function stopPolling(){ if(UI.pollTimer){ clearInterval(UI.pollTimer); UI.pollTimer=null; } }
  function startFeedPolling(){ stopFeedPolling(); UI.feedTimer = setInterval(()=>{ if(!document.hidden) loadDiscoverFeeds(); }, 12000); loadDiscoverFeeds(); }
  function stopFeedPolling(){ if(UI.feedTimer){ clearInterval(UI.feedTimer); UI.feedTimer = null; } }

  async function createLobby(){
    const token = sessionToken();
    if(!token){
      resetLobbyState('Jij bent niet ingelogd. Log opnieuw in en probeer het daarna nog eens.');
      return;
    }
    setStatus('Lobby maken…', false);
    const mode = qs('#pkPenaltyMode')?.value || 'wrong_loses';
    const startDice = Number(qs('#pkStartDice')?.value || 6);
    const out = await rpc('pikken_create_lobby_scoped', { session_token: token, site_scope_input: getScope(), config_input: { penalty_mode: mode, start_dice: startDice } });
    UI.gameId = out.game_id; setParticipantToken(UI.gameId, true);
    if (out?.lobby_code) rememberLobbyCode(out.lobby_code);
    history.replaceState(null,'',`pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
    startPolling();
    loadDiscoverFeeds();
  }
  async function joinLobby(){
    const token = sessionToken();
    if(!token){
      resetLobbyState('Jij bent niet ingelogd. Log opnieuw in en probeer het daarna nog eens.');
      return;
    }
    const code = String(qs('#pkJoinCode')?.value||'').trim().toUpperCase();
    if(!code) return setStatus('Vul een lobby code in.', true);
    rememberLobbyCode(code);
    setStatus('Lobby joinen…', false);
    const out = await rpc('pikken_join_lobby_scoped', { session_token: token, site_scope_input: getScope(), lobby_code_input: code });
    UI.gameId = out.game_id; setParticipantToken(UI.gameId, true);
    history.replaceState(null,'',`pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`);
    startPolling();
    loadDiscoverFeeds();
  }
  async function setReady(ready){
    if (!UI.gameId) return setStatus('Je zit nog niet in een lobby.', true);
    setStatus(ready?'Ready…':'Unready…', false);
    await rpcVariants('pikken_set_ready_scoped', [
      { session_token: sessionToken()||null, game_id_input: UI.gameId, ready_input: !!ready, site_scope_input: getScope() },
      { session_token: sessionToken()||null, game_id_input: UI.gameId, ready_input: !!ready }
    ]);
    await loadAndRender();
  }
  async function startGame(){
    if (!UI.gameId) return setStatus('Je zit nog niet in een lobby.', true);
    setStatus('Starten…', false);
    await rpcVariants('pikken_start_game_scoped', [
      { session_token: sessionToken()||null, game_id_input: UI.gameId, site_scope_input: getScope() },
      { session_token: sessionToken()||null, game_id_input: UI.gameId }
    ]);
    autoLiveRedirectDone = true;
    window.location.href = liveHref(UI.gameId);
  }
  async function placeBid(){ const count = Number(qs('#pkBidCount')?.value||0); const face = Number(qs('#pkBidFace')?.value||0); setStatus('Bieden…', false); const state = await rpc('pikken_place_bid_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId, bid_count_input: count, bid_face_input: face }); render(state); }
  async function rejectBid(){ setStatus('Afkeuren…', false); const state = await rpc('pikken_reject_bid_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId }); render(state); }
  async function vote(v){ setStatus('Stemmen…', false); const state = await rpc('pikken_cast_vote_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId, vote_input: !!v }); render(state); }
  async function leaveMatch(){ if(!UI.gameId) return setStatus('Je zit nu niet in een actieve match.', true); setStatus('Match verlaten…', false); await rpcFirst(['pikken_leave_game_scoped','pikken_leave_lobby_scoped'], { session_token: sessionToken()||null, game_id_input: UI.gameId }); setParticipantToken(UI.gameId, false); UI.gameId=''; stopPolling(); history.replaceState(null,'','pikken.html'); renderMatchSummary(null, null, null); const players = qs('#pkPlayers'); if (players) players.innerHTML = '<div class="muted">Nog geen actieve tafel geladen.</div>'; setStatus('Match verlaten.', false); loadDiscoverFeeds(); }
  async function destroyMatch(){ if(!UI.gameId) return setStatus('Je zit nu niet in een actieve match.', true); setStatus('Match verwijderen…', false); await rpcFirst(['pikken_destroy_game_scoped','pikken_destroy_lobby_scoped'], { session_token: sessionToken()||null, game_id_input: UI.gameId }); setParticipantToken(UI.gameId, false); UI.gameId=''; stopPolling(); history.replaceState(null,'','pikken.html'); renderMatchSummary(null, null, null); const players = qs('#pkPlayers'); if (players) players.innerHTML = '<div class="muted">Nog geen actieve tafel geladen.</div>'; setStatus('Match verwijderd.', false); loadDiscoverFeeds(); }
  async function kickSeat(seat){
    if(!UI.gameId) return;
    const seatNo = Number(seat);
    const target = (UI.lastPlayers || []).find((player)=>Number(player?.seat || player?.seat_index || 0) === seatNo);
    const targetName = String(target?.name || target?.player_name || '').trim();
    if (!targetName) throw new Error('Kon deze spelernaam niet bepalen voor kick.');
    setStatus(`Speler #${seatNo} kicken…`, false);
    await rpcFirst(['pikken_kick_player_scoped'], {
      session_token: sessionToken()||null,
      game_id_input: UI.gameId,
      seat_index_input: seatNo,
      player_name_input: targetName,
      site_scope_input: getScope()
    });
    await loadAndRender();
  }

  function resetLobbyState(message){
    setParticipantToken(UI.gameId, false);
    UI.gameId = '';
    stopPolling();
    history.replaceState(null,'',`pikken.html${getScope() === 'family' ? '?scope=family' : ''}`);
    renderMatchSummary(null, null, null);
    const players = qs('#pkPlayers');
    if (players) players.innerHTML = '<div class="muted">Kies een open lobby hieronder of maak er zelf één.</div>';
    setStatus(message || '', false);
    loadDiscoverFeeds();
  }

  async function leaveMatchSafe(){
    if(!UI.gameId) return setStatus('Je zit nu niet in een actieve match.', true);
    setStatus('Match verlaten…', false);
    const token = sessionToken() || null;
    const variants = [
      { session_token: token, game_id_input: UI.gameId, site_scope_input: getScope() },
      { session_token: token, game_id_input: UI.gameId }
    ];
    try { await rpcVariants('pikken_leave_game_scoped', variants); }
    catch (_) { await rpcVariants('pikken_leave_lobby_scoped', variants); }
    resetLobbyState('Match verlaten.');
  }

  async function destroyMatchSafe(){
    if(!UI.gameId) return setStatus('Je zit nu niet in een actieve match.', true);
    setStatus('Match verwijderen…', false);
    const token = sessionToken() || null;
    const variants = [
      { session_token: token, game_id_input: UI.gameId, site_scope_input: getScope() },
      { session_token: token, game_id_input: UI.gameId }
    ];
    try { await rpcVariants('pikken_destroy_game_scoped', variants); }
    catch (_) { await rpcVariants('pikken_destroy_lobby_scoped', variants); }
    resetLobbyState('Match verwijderd.');
  }

  async function kickSeatSafe(seat){
    if(!UI.gameId) return;
    const seatNo = Number(seat);
    const target = (UI.lastPlayers || []).find((player)=>Number(player?.seat || player?.seat_index || 0) === seatNo);
    const targetName = String(target?.name || target?.player_name || '').trim();
    if (!targetName) throw new Error('Kon deze spelernaam niet bepalen voor kick.');
    setStatus(`Speler #${seatNo} kicken…`, false);
    await rpcVariants('pikken_kick_player_scoped', [
      {
        session_token: sessionToken()||null,
        game_id_input: UI.gameId,
        seat_index_input: seatNo,
        player_name_input: targetName,
        site_scope_input: getScope()
      },
      {
        session_token: sessionToken()||null,
        game_id_input: UI.gameId,
        seat_index_input: seatNo,
        player_name_input: targetName
      },
      {
        session_token: sessionToken()||null,
        game_id_input: UI.gameId,
        seat_index_input: seatNo,
        seat_input: String(seatNo),
        target_seat_input: targetName || String(seatNo)
      }
    ]);
    await loadAndRender();
  }

  function boot(){
    const params = new URLSearchParams(location.search);
    UI.gameId = params.get('game_id') || '';
    const joinInput = qs('#pkJoinCode');
    if (joinInput && !joinInput.value) joinInput.value = lastLobbyCode();
    restoreParticipantGame();
    qs('#pkCreateLobbyBtn')?.addEventListener('click', ()=>createLobby().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkJoinLobbyBtn')?.addEventListener('click', ()=>joinLobby().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkReadyBtn')?.addEventListener('click', ()=>setReady(true).catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkUnreadyBtn')?.addEventListener('click', ()=>setReady(false).catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkStartBtn')?.addEventListener('click', ()=>startGame().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkPlaceBidBtn')?.addEventListener('click', ()=>placeBid().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkRejectBtn')?.addEventListener('click', ()=>rejectBid().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkVoteApproveBtn')?.addEventListener('click', ()=>vote(true).catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkVoteRejectBtn')?.addEventListener('click', ()=>vote(false).catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkLeaveBtn')?.addEventListener('click', ()=>leaveMatchSafe().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkDestroyBtn')?.addEventListener('click', ()=>destroyMatchSafe().catch(e=>setStatus(normalizeError(e),true)));
    document.addEventListener('click', (ev)=>{
      const btn = ev.target.closest('[data-kick-seat]');
      if (btn && UI.gameId) kickSeatSafe(btn.getAttribute('data-kick-seat')).catch(e=>setStatus(normalizeError(e),true));
      const joinBtn = ev.target.closest('[data-join-code]');
      if (joinBtn) {
        const code = String(joinBtn.getAttribute('data-join-code') || '').trim().toUpperCase();
        const input = qs('#pkJoinCode');
        if (input) input.value = code;
        joinLobby().catch(e=>setStatus(normalizeError(e),true));
      }
    });
    window.addEventListener('online', ()=>{ if(UI.gameId) loadAndRender(); loadDiscoverFeeds(); });
    document.addEventListener('visibilitychange', ()=>{ if(!document.hidden){ if(UI.gameId) loadAndRender(); loadDiscoverFeeds(); } });
    startFeedPolling();
    if(UI.gameId){ setParticipantToken(UI.gameId, true); startPolling(); } else { setStatus('', false); setChip('Lobby'); renderMatchSummary(null, null, null); const players = qs('#pkPlayers'); if (players) players.innerHTML = '<div class="muted">Kies een open lobby hieronder of maak er zelf één.</div>'; }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
