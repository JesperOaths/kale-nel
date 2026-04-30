(function(){
  const api = window.GEJAST_PIKKEN_CONTRACT;
  if (!api) { console.error('GEJAST_PIKKEN_CONTRACT missing'); return; }
  const PARTICIPANT_KEY = 'gejast_pikken_participant_v687';
  const LEGACY_PARTICIPANT_KEY = 'gejast_pikken_participant_v632';
  let state = { gameId:'', timer:null, busy:false, lastVersion:-1, cleanupCheckedAt:0 };
  const $ = (id)=>document.getElementById(id);
  const esc = (v)=>String(v ?? '').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  function setStatus(msg='', bad=false){ const el=$('pkStatus'); if(el){ el.textContent=msg; el.style.color=bad?'#7f2f1d':'#6b6257'; } }
  function loginUrl(){ const target = `pikken.html${api.scope()==='family'?'?scope=family':''}`; return `./login.html?return_to=${encodeURIComponent(target)}${api.scope()==='family'?'&scope=family':''}`; }
  function normalizeError(e){ const msg=String(e && e.message ? e.message : e || 'Onbekende fout'); if(/Niet ingelogd|not logged|session/i.test(msg)) return `Niet ingelogd. Log eerst in via ${loginUrl()}`; if(/timeout/i.test(msg)) return 'Pikken-backend niet bereikbaar. Run de v687 SQL; als hij faalt, stuur de exacte Supabase error.'; if(/could not find|schema cache|function/i.test(msg)) return 'Pikken backend-RPC ontbreekt of Supabase schema cache is nog oud. Draai de v687 SQL en refresh.'; return msg; }
  function setBusyButton(id,busy,label){ const b=$(id); if(!b) return; b.disabled=!!busy; if(label) b.textContent=busy?label:b.getAttribute('data-original-label')||b.textContent; }

  function getStoredGame(){
    try { return JSON.parse(localStorage.getItem(PARTICIPANT_KEY) || localStorage.getItem(LEGACY_PARTICIPANT_KEY) || 'null')?.game_id || ''; } catch (_) { return ''; }
  }
  function storeGame(id){ try { if(id){ localStorage.setItem(PARTICIPANT_KEY, JSON.stringify({ game_id:id, at:Date.now() })); localStorage.setItem(LEGACY_PARTICIPANT_KEY, JSON.stringify({ game_id:id, at:Date.now() })); } else { localStorage.removeItem(PARTICIPANT_KEY); localStorage.removeItem(LEGACY_PARTICIPANT_KEY); } } catch (_) {} }
  function gameFromUrl(){ try { const qs = new URLSearchParams(location.search); return qs.get('game_id') || qs.get('client_match_id') || ''; } catch (_) { return ''; } }
  function liveHref(id){ return `./pikken_live.html?client_match_id=${encodeURIComponent(String(id||''))}${api.scope()==='family'?'&scope=family':''}`; }
  function updateUrl(id){ if(!id) return; try { history.replaceState(null, '', `pikken.html?game_id=${encodeURIComponent(id)}${api.scope()==='family'?'&scope=family':''}`); } catch (_) {} }
  function bidText(bid){ const c=Number(bid?.count || bid?.bid_count || 0), f=Number(bid?.face || bid?.bid_face || 0); if(!c || !f) return '--'; return f===1?`${c} x pik`:`${c} x ${f}`; }
  function revealLine(lr){
    const loser = lr?.loser_name || (lr?.loser_id ? `speler ${lr.loser_id}` : 'onbekend');
    const after = Number.isFinite(Number(lr?.loser_dice_after)) ? ` - nu ${Number(lr.loser_dice_after)} dobbel(s)` : '';
    const next = lr?.next_round ? ` Volgende ronde: ${Number(lr.next_round)}.` : '';
    return `Verliezer: ${loser}${after}.${next} Handen blijven verborgen; alleen je eigen dobbelstenen zijn zichtbaar.`;
  }
  function faceOrder(face){ return Number(face) === 1 ? 7 : Number(face||0); }
  function sortedDice(dice){ return (Array.isArray(dice)?dice:[]).map(Number).filter(Boolean).sort((a,b)=>faceOrder(a)-faceOrder(b)); }
  function die(face){ const n=Number(face||0); return `<img class="die ${n===1?'pik':''}" src="./assets/pikken/dice-${n || 'hidden'}.svg" alt="die ${n||''}">`; }
  function extractMyHand(payload){
    const direct = payload?.my_hand || payload?.hand || payload?.dice || payload?.viewer?.my_hand || payload?.viewer?.hand || payload?.viewer?.dice;
    if (Array.isArray(direct) && direct.length) return direct;
    const viewerSeat = Number(payload?.viewer?.seat || payload?.viewer?.seat_index || 0);
    const viewerId = String(payload?.viewer?.player_id || payload?.viewer?.id || '');
    const viewerName = String(payload?.viewer?.player_name || payload?.viewer?.name || '').toLowerCase();
    const hands = payload?.hands || payload?.round_hands || payload?.game?.state?.hands || payload?.game?.state?.round_hands;
    if (Array.isArray(hands)) {
      const row = hands.find((h)=>Number(h.seat || h.seat_index || 0) === viewerSeat)
        || hands.find((h)=>viewerId && String(h.player_id || h.id || '') === viewerId)
        || hands.find((h)=>viewerName && String(h.player_name || h.name || '').toLowerCase() === viewerName);
      const dice = row?.dice_values || row?.dice || row?.hand || row?.my_hand;
      if (Array.isArray(dice) && dice.length) return dice;
    } else if (hands && typeof hands === 'object') {
      const dice = hands[String(viewerSeat)] || hands[viewerName] || hands[viewerId];
      if (Array.isArray(dice) && dice.length) return dice;
    }
    return [];
  }
  function phaseOf(payload){ return String(payload?.game?.state?.phase || payload?.game?.status || payload?.game?.status || 'lobby').toLowerCase(); }
  function viewerActive(payload){
    const viewer = payload?.viewer || {};
    const players = Array.isArray(payload?.players) ? payload.players : [];
    if (viewer.is_host) return true;
    if (!players.length) return false;
    const viewerId = String(viewer.player_id || viewer.id || '');
    const viewerSeat = Number(viewer.seat || viewer.seat_index || 0);
    const viewerName = String(viewer.player_name || viewer.name || '').toLowerCase();
    return players.some((p)=>{
      const pid = String(p.player_id || p.id || '');
      const seat = Number(p.seat || p.seat_index || 0);
      const name = String(p.player_name || p.name || '').toLowerCase();
      return (viewerId && pid === viewerId) || (viewerSeat && seat === viewerSeat) || (viewerName && name === viewerName);
    });
  }
  function renderControls(payload){
    const game = payload?.game || {}; const viewer = payload?.viewer || {}; const phase = phaseOf(payload); const inLobby = !!game.id && phase === 'lobby';
    ['pkCreateWrap','pkJoinWrap','pkJoinFieldWrap'].forEach((id)=>{ const el=$(id); if(el) el.classList.toggle('hidden', inLobby); });
    const sticky=$('pkLobbySticky'); if(sticky) sticky.classList.toggle('hidden', !inLobby);
    const role=$('pkLobbyRolePill'); if(role){ role.textContent = viewer.is_host ? 'Host' : 'Deelnemer'; role.className = `pill ${viewer.is_ready?'ok':'wait'}`; }
    const note=$('pkLobbyStickyNote'); if(note) note.textContent = viewer.is_ready ? 'Je staat ready.' : 'Je staat unready.';
    const ready=$('pkReadyBtn'); if(ready){ ready.className = `btn ${viewer.is_ready?'ready-active':'alt'}`; ready.disabled = !inLobby || !!viewer.is_ready; }
    const unready=$('pkUnreadyBtn'); if(unready){ unready.className = `btn ${viewer.is_ready?'alt':'unready-active'}`; unready.disabled = !inLobby || !viewer.is_ready; }
    const destroy=$('pkDestroyBtn'); if(destroy) destroy.classList.toggle('hidden', !(inLobby && viewer.is_host));
    const start=$('pkStartBtn'); if(start) start.classList.toggle('hidden', !(inLobby && viewer.is_host));
  }
  function renderPlayers(payload){
    const box=$('pkPlayers'); if(!box) return;
    const game=payload?.game || {}, viewer=payload?.viewer || {}, phase=phaseOf(payload), players=Array.isArray(payload?.players)?payload.players:[], votes=Array.isArray(payload?.votes)?payload.votes:[];
    const turn=Number(game?.state?.current_turn_seat||0), voteTurn=Number(game?.state?.vote_turn_seat||0);
    box.innerHTML = players.length ? players.map((p)=>{
      const seat=Number(p.seat||p.seat_index||0); const alive=!!p.alive || phase==='lobby'; const vote=votes.find((v)=>Number(v.seat||v.seat_index||0)===seat); const voteStatus=String(vote?.status||'waiting');
      const pill = phase==='voting' ? (voteStatus==='approved'?'goedgekeurd':voteStatus==='rejected'?'afgekeurd':'wacht') : (p.is_host?'Host':p.is_ready?'Ready':'Niet ready');
      const pillCls = phase==='voting' ? (voteStatus==='approved'?'ok':voteStatus==='rejected'?'bad':'wait') : (p.is_host || p.is_ready ? 'ok' : 'wait');
      return `<div class="player-row ${alive?'':'dead'} ${(phase==='bidding'&&seat===turn)||(phase==='voting'&&seat===voteTurn)?'turn':''}"><div><div><strong>${esc(p.name||p.player_name||'Speler')}</strong> <span class="muted">#${seat}</span></div><div class="muted">${alive?'Levend':'Uit'} - ${Number(p.dice_count||0)} dobbelstenen</div></div><span class="pill ${pillCls}">${esc(pill)}</span></div>`;
    }).join('') : '<div class="muted">Nog geen spelers.</div>';
  }
  function renderDice(payload){
    const wrap=$('pkMyDice'); if(!wrap) return;
    const dice=sortedDice(extractMyHand(payload));
    const phase = phaseOf(payload);
    wrap.innerHTML = dice.length ? dice.map(die).join('') + '<div class="muted" style="width:100%;margin-top:6px">1 is pik en telt als joker. Baseer je bod op je eigen stenen plus wat je van de tafel verwacht.</div>' : `<div class="muted">${phase==='lobby'?'Dobbelstenen worden gegooid zodra de host start.':'Geen hand ontvangen van de backend. Refresh of laat de host de ronde opnieuw starten.'}</div>`;
  }
  function renderActionPanels(payload){
    const game=payload?.game || {}, viewer=payload?.viewer || {}, phase=phaseOf(payload); const mySeat=Number(viewer.seat||viewer.seat_index||0); const alive=!!viewer.alive || phase==='lobby';
    const myTurn = phase === 'bidding' && mySeat === Number(game?.state?.current_turn_seat||0) && alive;
    const bidderSeat = Number(game?.state?.bid?.bidder_seat || 0);
    const myVote = phase === 'voting' && mySeat !== bidderSeat && mySeat === Number(game?.state?.vote_turn_seat||0) && alive;
    const bp=$('pkBidPanel'); if(bp) bp.style.display = myTurn ? 'block' : 'none';
    const vp=$('pkVotePanel'); if(vp) vp.style.display = myVote ? 'block' : 'none';
    const rb=$('pkRejectBtn'); if(rb) rb.disabled = !myTurn || !game?.state?.bid;
  }
  function renderReveal(payload){
    const wrap=$('pkReveal'); if(!wrap) return;
    const lr=payload?.game?.state?.last_reveal || null;
    if(!lr){ wrap.style.display='none'; wrap.innerHTML=''; return; }
    wrap.style.display='block';
    wrap.innerHTML = `<details class="accordion" open><summary><span>Laatste reveal: ${esc(bidText(lr.bid))}</span><span class="muted">${lr.bid_true?'gehaald':'niet gehaald'} - ${Number(lr.counted_total||0)}</span></summary><div class="detail"><div class="muted">${esc(revealLine(lr))}</div></div></details>`;
  }
  function render(payload){
    if(!payload || !payload.game){ return; }
    const game=payload.game, phase=phaseOf(payload);
    if(!viewerActive(payload)){
      storeGame('');
      state.gameId='';
      stopPolling();
      try{ history.replaceState(null,'','pikken.html'); }catch(_){}
      setStatus('Je zit niet meer in deze Pikken-match.');
      loadFeeds();
      return;
    }
    state.gameId = game.id || state.gameId; storeGame(state.gameId); updateUrl(state.gameId);
    if (state.gameId && phase !== 'lobby') {
      window.location.replace(liveHref(state.gameId));
      return;
    }
    const code=$('pkLobbyCode'); if(code) code.textContent = game.lobby_code || game.code || '--';
    const live=$('pkLiveLink'); if(live){ live.href = liveHref(state.gameId); live.style.display = state.gameId ? '' : 'none'; }
    const sum=$('pkMatchSummary'); if(sum){ sum.textContent = phase==='lobby' ? `Lobby ${game.lobby_code || game.code || ''} - ${payload.players?.length || 0} speler(s)` : `${phase} - ronde ${Number(game?.state?.round_no||0)}`; }
    const bid=$('pkBidText'); if(bid) bid.textContent = bidText(game?.state?.bid);
    const bidBy=$('pkBidBy'); if(bidBy) bidBy.textContent = game?.state?.bid ? `door ${game.state.bid.bidder_name || '--'}` : '';
    renderControls(payload); renderPlayers(payload); renderDice(payload); renderActionPanels(payload); renderReveal(payload);
    setStatus('');
  }
  async function refresh(force=false){
    if(!state.gameId) return;
    if(state.busy) return; state.busy=true;
    try { const payload=await api.getState(state.gameId); const v=Number(payload?.game?.state_version ?? payload?.state_version ?? -1); if(force || v !== state.lastVersion){ state.lastVersion=v; render(payload); } }
    catch(e){ setStatus(e.message || 'Pikken laden mislukt.', true); }
    finally{ state.busy=false; }
  }
  function startPolling(){ stopPolling(); state.timer=setInterval(()=>{ if(!document.hidden) refresh(false); }, 1200); refresh(true); }
  function stopPolling(){ if(state.timer){ clearInterval(state.timer); state.timer=null; } }
  async function loadFeeds(){
    const lobbyBox=$('pkLobbyFeed'), liveBox=$('pkLiveFeed');
    if (Date.now() - state.cleanupCheckedAt > 60000) {
      state.cleanupCheckedAt = Date.now();
      api.cleanupStale && api.cleanupStale().catch(()=>{});
    }
    try { const l=await api.openLobbies(); const rows=Array.isArray(l)?l:(l.rows||l.items||l.lobbies||l.matches||[]); if(lobbyBox) lobbyBox.innerHTML = rows.length ? rows.map((r)=>`<article class="feed-card"><div class="feed-head"><div><div class="feed-title">Code ${esc(r.lobby_code||r.code||'')}</div><div class="feed-meta">${esc(r.host_name||r.created_by_player_name||'Host')} - ${Number(r.player_count||0)} speler(s) - ${Number(r.ready_count||0)} ready</div></div><span class="pill wait">Lobby</span></div><div class="feed-actions"><button class="btn alt tiny" data-join-code="${esc(r.lobby_code||r.code||'')}">Join</button></div></article>`).join('') : '<div class="muted">Geen open Pikken-lobbies.</div>'; } catch(e){ if(lobbyBox) lobbyBox.innerHTML='<div class="muted">Open lobbies konden niet laden: '+esc(e.message||e)+'</div>'; }
    try { const l=await api.liveMatches(); const rows=Array.isArray(l)?l:(l.rows||l.items||l.lobbies||l.matches||[]); if(liveBox) liveBox.innerHTML = rows.length ? rows.map((r)=>`<article class="feed-card"><div class="feed-head"><div><div class="feed-title">${esc(r.lobby_code||r.code||'Pikken')}</div><div class="feed-meta">${esc(r.phase||r.status||'live')} - ronde ${Number(r.round_no||0)} - ${Number(r.player_count||0)} speler(s)</div></div><span class="pill ok">Live</span></div><div class="feed-actions"><a class="btn alt tiny" href="${liveHref(r.game_id||r.id)}">Open live</a></div></article>`).join('') : '<div class="muted">Geen live Pikken-matches.</div>'; } catch(e){ if(liveBox) liveBox.innerHTML='<div class="muted">Live matches konden niet laden: '+esc(e.message||e)+'</div>'; }
  }
  async function createLobby(){
    try { api.requireSession && api.requireSession(); } catch(e){ setStatus(normalizeError(e), true); return; }
    setStatus('Lobby maken...'); setBusyButton('pkCreateLobbyBtn', true, 'Maken...');
    try {
      const mode=$('pkPenaltyMode')?.value || 'wrong_loses';
      const out=await api.createLobby({ penalty_mode:mode, start_dice:6, prev_winner_window_hours:12 });
      const id = out?.game_id || out?.id || out?.game?.id || out?.gameId || '';
      if(!id) throw new Error('Lobby is aangemaakt maar de backend gaf geen game_id terug: '+JSON.stringify(out).slice(0,240));
      state.gameId=id; storeGame(state.gameId); updateUrl(state.gameId);
      await refresh(true); startPolling(); loadFeeds(); setStatus('Lobby aangemaakt. Deel de code met de andere spelers.');
    } catch(e){ setStatus(normalizeError(e), true); }
    finally{ setBusyButton('pkCreateLobbyBtn', false); }
  }
  async function joinLobby(code){
    try { api.requireSession && api.requireSession(); } catch(e){ setStatus(normalizeError(e), true); return; }
    const value=api.cleanCode(code || $('pkJoinCode')?.value || ''); if(!value) return setStatus('Vul een lobbycode in.', true);
    setStatus('Lobby joinen...'); setBusyButton('pkJoinLobbyBtn', true, 'Joinen...');
    try{
      const out=await api.joinLobby(value); const id=out?.game_id || out?.id || out?.game?.id || '';
      if(!id) throw new Error('Join gelukt maar backend gaf geen game_id terug: '+JSON.stringify(out).slice(0,240));
      state.gameId=id; storeGame(state.gameId); updateUrl(state.gameId); await refresh(true); startPolling(); loadFeeds(); setStatus('Lobby gejoind.');
    }catch(e){ setStatus(normalizeError(e), true); }
    finally{ setBusyButton('pkJoinLobbyBtn', false); }
  }
  async function startGame(){ setStatus('Starten...'); await api.startGame(state.gameId); window.location.href = liveHref(state.gameId); }
  async function leave(){ if(!state.gameId) return; await api.leaveGame(state.gameId); storeGame(''); state.gameId=''; stopPolling(); try{ history.replaceState(null,'','pikken.html'); }catch(_){} setStatus('Lobby verlaten.'); await loadFeeds(); }
  async function destroy(){ if(!state.gameId) return; if(!confirm('Host: deze Pikken-lobby/match verwijderen?')) return; await api.destroyGame(state.gameId); storeGame(''); state.gameId=''; stopPolling(); try{ history.replaceState(null,'','pikken.html'); }catch(_){} setStatus('Lobby verwijderd.'); await loadFeeds(); }
  function wire(){ ['pkCreateLobbyBtn','pkJoinLobbyBtn'].forEach((id)=>{ const b=$(id); if(b && !b.getAttribute('data-original-label')) b.setAttribute('data-original-label', b.textContent); });
    $('pkCreateLobbyBtn')?.addEventListener('click', ()=>createLobby().catch((e)=>setStatus(normalizeError(e),true)));
    $('pkJoinLobbyBtn')?.addEventListener('click', ()=>joinLobby().catch((e)=>setStatus(normalizeError(e),true)));
    document.addEventListener('click', (ev)=>{ const btn=ev.target.closest('[data-join-code]'); if(btn) joinLobby(btn.getAttribute('data-join-code')).catch((e)=>setStatus(normalizeError(e),true)); });
    $('pkReadyBtn')?.addEventListener('click', ()=>api.setReady(state.gameId,true).then(()=>refresh(true)).catch((e)=>setStatus(normalizeError(e),true)));
    $('pkUnreadyBtn')?.addEventListener('click', ()=>api.setReady(state.gameId,false).then(()=>refresh(true)).catch((e)=>setStatus(normalizeError(e),true)));
    $('pkStartBtn')?.addEventListener('click', ()=>startGame().catch((e)=>setStatus(normalizeError(e),true)));
    $('pkLeaveBtn')?.addEventListener('click', ()=>leave().catch((e)=>setStatus(normalizeError(e),true)));
    $('pkDestroyBtn')?.addEventListener('click', ()=>destroy().catch((e)=>setStatus(normalizeError(e),true)));
    $('pkPlaceBidBtn')?.addEventListener('click', ()=>api.placeBid(state.gameId, Number($('pkBidCount')?.value||0), Number($('pkBidFace')?.value||0)).then((p)=>render(p)).catch((e)=>setStatus(normalizeError(e),true)));
    $('pkRejectBtn')?.addEventListener('click', ()=>api.rejectBid(state.gameId).then((p)=>render(p)).catch((e)=>setStatus(normalizeError(e),true)));
    $('pkVoteApproveBtn')?.addEventListener('click', ()=>api.castVote(state.gameId,true).then((p)=>render(p)).catch((e)=>setStatus(normalizeError(e),true)));
    $('pkVoteRejectBtn')?.addEventListener('click', ()=>api.castVote(state.gameId,false).then((p)=>render(p)).catch((e)=>setStatus(normalizeError(e),true)));
    document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) { refresh(true); loadFeeds(); } });
  }
  function boot(){ wire(); if(!api.sessionToken || !api.sessionToken()) setStatus('Niet ingelogd: maak/join werkt pas na login. Ga naar '+loginUrl(), true); state.gameId = gameFromUrl() || getStoredGame(); if(state.gameId) startPolling(); else { renderControls({},{}); } loadFeeds(); setInterval(()=>{ if(!document.hidden) loadFeeds(); }, 8000); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot, { once:true }); else boot();
})();
