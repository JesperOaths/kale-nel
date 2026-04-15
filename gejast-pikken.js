(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtils = window.GEJAST_SCOPE_UTILS || {};
  const PIKKEN_PARTICIPANT_KEY = 'gejast_pikken_participant_v1';

  function getScope(){
    try { return (scopeUtils.getScope && scopeUtils.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); }
    catch(_){ return 'friends'; }
  }
  function sessionToken(){ try { return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; } catch(_){ return ''; } }
  function headers(){ return { apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { throw new Error(text || `HTTP ${res.status}`); } if(!res.ok) throw new Error(data?.message || data?.error || text || `HTTP ${res.status}`); return data; }
  async function rpc(name, payload){ const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', headers:headers(), body: JSON.stringify(payload || {}), cache:'no-store' }); return parse(res); }

  function qs(sel, root){ return (root||document).querySelector(sel); }
  function esc(s){ const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}; return String(s??'').replace(/[&<>"']/g,m=>map[m]); }
  function normalizeError(err){
    const msg = String(err && err.message || err || 'Onbekende fout');
    if(/game_type\s+ongeldig/i.test(msg)) return 'Pikken backend raakt nog een oudere game_type-lookup buiten de huidige repo-patch. Ruwe fout: ' + msg;
    if(/column reference "?game_type"? is ambiguous/i.test(msg)) return 'Pikken backend raakt nog een dubbelzinnige game_type-verwijzing buiten de huidige compat-laag. Ruwe fout: ' + msg;
    return msg;
  }
  function setParticipantToken(gameId, active){ try{ if(active && gameId){ localStorage.setItem(PIKKEN_PARTICIPANT_KEY, JSON.stringify({game_id:String(gameId), at:Date.now()})); } else { localStorage.removeItem(PIKKEN_PARTICIPANT_KEY); } }catch(_){ } }
  function liveHref(gameId){ return `./pikken_live.html?client_match_id=${encodeURIComponent(String(gameId||''))}`; }

  const UI = { gameId:'', lastStateVersion:-1, pollTimer:null, roomCodeDirty:false, roomCodeTouchedAt:0 };

  function syncLobbyUrl(){
    const scope = encodeURIComponent(getScope());
    const href = UI.gameId ? `pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${scope}` : `pikken.html?scope=${scope}`;
    history.replaceState(null,'',href);
  }

  function markRoomCodeDirty(){ UI.roomCodeDirty = true; UI.roomCodeTouchedAt = Date.now(); }
  function shouldPreserveRoomCodeInput(){ const el = qs('#pkRoomCode'); return !!(el && (document.activeElement===el || UI.roomCodeDirty || Date.now()-UI.roomCodeTouchedAt < 2500)); }
  function roomCode(){ return String((qs('#pkRoomCode') && qs('#pkRoomCode').value) || qs('#pkLobbyCode')?.textContent || '').trim().toUpperCase(); }
  function setRoomCodeInputValue(value){ const el=qs('#pkRoomCode'); if(!el || shouldPreserveRoomCodeInput()) return; el.value = value || ''; UI.roomCodeDirty = false; }

  function setStatus(text, isError){ const el = qs('#pkStatus'); if(!el) return; el.textContent = text || ''; el.style.color = isError ? '#8a1022' : '#2f6d3c'; }
  function updateLiveLink(gameId){ const liveLink = qs('#pkLiveLink'); if(!liveLink) return; if(gameId){ liveLink.href = liveHref(gameId); liveLink.style.display = ''; } else { liveLink.href = './pikken_live.html'; liveLink.style.display = 'none'; } }
  function clearLobbyView(){
    stopPolling();
    qs('#pkRoomShell').style.display = 'none';
    qs('#pkLobbyCode').textContent = '—';
    qs('#pkRoomMeta').textContent = 'Nog geen room geladen.';
    qs('#pkLobbySummaryBox').textContent = 'Nog geen lobby info.';
    qs('#pkLobbyPlayers').innerHTML = '';
    qs('#pkPlayers').innerHTML = '';
    updateLiveLink('');
    setParticipantToken(UI.gameId, false);
    UI.gameId=''; UI.lastStateVersion=-1;
    const destroyBtn = qs('#pkDestroyBtn'); if(destroyBtn) destroyBtn.style.display = 'none';
    syncLobbyUrl();
  }

  function dieImg(face, cls){ const n=Number(face||0); const img=document.createElement('img'); img.className=cls||''; img.alt=n?`die ${n}`:'die'; img.src=n?`./assets/pikken/dice-${n}.svg`:'./assets/pikken/dice-hidden.svg'; return img; }
  function lobbyPlayerBadges(p, viewer, phase){
    const bits=[];
    if(Number(viewer?.seat||0) === Number(p.seat||0)) bits.push('<span class="badge">Jij</span>');
    if(Number(viewer?.is_host ? p.seat : -1) === Number(viewer?.seat||0)) bits.push('<span class="badge">Host</span>');
    bits.push(`<span class="badge ${p.ready ? 'good' : 'warn'}">${p.ready ? 'Ready' : 'Niet ready'}</span>`);
    bits.push(`<span class="badge ${p.alive ? 'good' : 'bad'}">${p.alive ? 'Levend' : 'Dood'}</span>`);
    if(String(phase||'') !== 'lobby') bits.push(`<span class="badge">${Number(p.dice_count||0)} dice</span>`);
    return bits.join(' ');
  }

  function applyCreateFallback(out){
    const gameId = String(out?.game_id || out?.client_match_id || '').trim();
    const lobbyCode = String(out?.lobby_code || out?.code || out?.join_code || roomCode()).trim().toUpperCase();
    if(gameId){
      UI.gameId = gameId;
      setParticipantToken(gameId, true);
      syncLobbyUrl();
    }
    if(lobbyCode){ qs('#pkLobbyCode').textContent = lobbyCode; setRoomCodeInputValue(lobbyCode); }
    updateLiveLink(gameId);
    qs('#pkRoomShell').style.display = '';
    qs('#pkPhase').textContent = 'lobby';
    qs('#pkRoundNo').textContent = '0';
    qs('#pkRoomMeta').textContent = `${getScope()==='family' ? 'family' : 'friends'} · lobby`;
  }

  function render(state){
    const game = state?.game || {};
    const viewer = state?.viewer || {};
    const players = Array.isArray(state?.players) ? state.players : [];
    const votes = Array.isArray(state?.votes) ? state.votes : [];
    const myHand = Array.isArray(state?.my_hand) ? state.my_hand : [];
    const phase = String(game?.state?.phase || 'lobby');
    const roundNo = Number(game?.state?.round_no || 0) || 0;
    setParticipantToken(game?.id || UI.gameId, phase && phase !== 'finished');
    UI.gameId = String(game?.id || UI.gameId || '');
    qs('#pkRoomShell').style.display = UI.gameId ? '' : 'none';
    updateLiveLink(UI.gameId);

    const bid = game?.state?.bid && game.state.bid !== null ? game.state.bid : null;
    const turnSeat = Number(game?.state?.current_turn_seat || 0);
    const voteTurnSeat = Number(game?.state?.vote_turn_seat || 0);
    const lastReveal = game?.state?.last_reveal || null;

    qs('#pkLobbyCode').textContent = game?.lobby_code || '—';
    setRoomCodeInputValue(game?.lobby_code || '');
    qs('#pkPhase').textContent = phase;
    qs('#pkRoundNo').textContent = String(roundNo);

    const totals = state?.dice_totals || {};
    qs('#pkDiceStart').textContent = String(Number(totals.start_total||0));
    qs('#pkDiceCurrent').textContent = String(Number(totals.current_total||0));
    qs('#pkDiceLost').textContent = String(Number(totals.lost_total||0));

    const readyCount = players.filter((p)=>!!p.ready).length;
    const aliveCount = players.filter((p)=>!!p.alive).length;
    const modeText = String(game?.config?.penalty_mode||'wrong_loses') === 'right_loses' ? 'Fair (goed verliest)' : 'Normal (fout verliest)';
    const hostSeat = Number(viewer?.is_host) ? Number(viewer?.seat||0) : Number((players[0]||{}).seat||0);
    qs('#pkRoomMeta').textContent = `${getScope()==='family' ? 'family' : 'friends'} · fase ${phase} · host stoel ${hostSeat || '—'}`;
    qs('#pkLobbySummaryBox').textContent = `${players.length} spelers · ${readyCount} ready · ${aliveCount} levend · variant ${modeText}`;

    qs('#pkBidText').textContent = bid ? (Number(bid.face)===1 ? `${bid.count} × pik` : `${bid.count} × ${bid.face}`) : '—';
    qs('#pkBidBy').textContent = bid ? `door ${bid.bidder_name || '—'}` : '';

    const playersHtml = players.map((p)=>{
      const seat = Number(p.seat||0);
      const alive = !!p.alive;
      const isTurn = phase === 'bidding' && seat === turnSeat;
      const isVoteTurn = phase === 'voting' && seat === voteTurnSeat;
      const vote = votes.find((v)=>Number(v.seat||0)===seat);
      const voteStatus = vote ? String(vote.status||'waiting') : 'waiting';
      const pillText = voteStatus === 'approved' ? 'goedgekeurd' : voteStatus === 'rejected' ? 'afgekeurd' : 'wacht';
      const pillClass = voteStatus === 'approved' ? 'pill ok' : voteStatus === 'rejected' ? 'pill bad' : 'pill wait';
      return `
        <div class="player-row ${alive?'':'dead'} ${isTurn||isVoteTurn?'turn':''}">
          <div class="left">
            <div class="name"><strong>${esc(p.name||'Speler')}</strong> <span class="small">#${seat}</span></div>
            <div class="small">${alive?'Levend':'Dood'} · ${Number(p.dice_count||0)} dobbelstenen</div>
          </div>
          <div class="right">${phase==='voting'?`<span class="${pillClass}">${pillText}</span>`:''}</div>
        </div>`;
    }).join('');
    qs('#pkPlayers').innerHTML = playersHtml;
    qs('#pkLobbyPlayers').innerHTML = players.map((p)=>`<div class="player-row"><div><strong>${esc(p.name||'Speler')}</strong> <span class="small">#${Number(p.seat||0)}</span></div><div>${lobbyPlayerBadges(p, viewer, phase)}</div></div>`).join('');

    const myDiceWrap = qs('#pkMyDice'); myDiceWrap.innerHTML = ''; myHand.forEach((face)=>{ const n=Number(face||0); myDiceWrap.appendChild(dieImg(n, `die ${n===1?'pik':''}`.trim())); });

    const myTurn = phase === 'bidding' && Number(viewer.seat||0) === turnSeat && !!viewer.alive;
    const myVoteTurn = phase === 'voting' && Number(viewer.seat||0) === voteTurnSeat && !!viewer.alive;
    qs('#pkBidPanel').style.display = myTurn ? 'block' : 'none';
    qs('#pkVotePanel').style.display = myVoteTurn ? 'block' : 'none';
    qs('#pkRejectBtn').disabled = !myTurn || !bid;
    qs('#pkStartBtn').disabled = !(viewer?.is_host && phase === 'lobby' && players.length > 1);
    const destroyBtn = qs('#pkDestroyBtn'); if(destroyBtn) destroyBtn.style.display = viewer?.is_host ? '' : 'none';

    const revealWrap = qs('#pkReveal');
    if(!lastReveal){ revealWrap.style.display='none'; revealWrap.innerHTML=''; }
    else {
      revealWrap.style.display='block';
      const lrBid = lastReveal.bid || {}; const lrBidTxt = (Number(lrBid.face)===1) ? `${lrBid.count} × pik` : `${lrBid.count} × ${lrBid.face}`;
      revealWrap.innerHTML = `<details class="accordion" open><summary><span>Laatste ronde (R${Number(lastReveal.round_no||0)}): bod ${esc(lrBidTxt)}</span><span class="small">${lastReveal.bid_true ? 'gehaald' : 'niet gehaald'} · geteld ${Number(lastReveal.counted_total||0)}</span></summary><div class="detail"><div class="small">Verliezers: ${esc(String(lastReveal.losing_kind||''))} · Starter: stoel ${Number(lastReveal.next_starter_seat||0)}</div><div class="reveal-grid">${(Array.isArray(lastReveal.hands)?lastReveal.hands:[]).map((h)=>{ const dice = Array.isArray(h.dice) ? h.dice : []; return `<div class="reveal-card"><div class="reveal-name"><strong>${esc(h.name||'Speler')}</strong> <span class="small">#${Number(h.seat||0)}</span></div><div class="dice-row">${dice.map((d)=>`<img class="die ${Number(d)===1?'pik':''}" src="./assets/pikken/dice-${Number(d)}.svg" alt="die ${Number(d)}">`).join('')}</div></div>`; }).join('')}</div></div></details>`;
    }
  }

  async function loadAndRender(){
    if(!UI.gameId) return;
    try{
      const state = await rpc('pikken_get_state_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId });
      const version = Number(state?.game?.state_version || -1);
      if(version !== UI.lastStateVersion){ UI.lastStateVersion = version; render(state); }
      setStatus('Lobby geladen.', false);
    } catch(err){
      const msg = normalizeError(err) || 'Laden mislukt.';
      if(/game niet gevonden|je zit niet in deze lobby/i.test(String(msg))){
        clearLobbyView();
        setStatus('Room bestaat niet meer of je zit er niet meer in.', false);
        return;
      }
      setStatus(msg, true);
    }
  }
  function startPolling(){ stopPolling(); UI.pollTimer = setInterval(()=>{ if(!document.hidden) loadAndRender(); }, 1200); loadAndRender(); }
  function stopPolling(){ if(UI.pollTimer){ clearInterval(UI.pollTimer); UI.pollTimer=null; } }

  async function createLobby(){
    const mode = qs('#pkPenaltyMode')?.value || 'wrong_loses';
    const desiredCode = roomCode();
    setStatus('Lobby maken…', false);
    const out = await rpc('pikken_create_lobby_scoped', { session_token: sessionToken() || null, site_scope_input: getScope(), config_input: { penalty_mode: mode, preferred_lobby_code: desiredCode || null } });
    applyCreateFallback(Object.assign({}, out || {}, { lobby_code: String(out?.lobby_code || desiredCode || '').toUpperCase() }));
    startPolling();
  }
  async function joinLobby(){ const code = roomCode(); if(!code) return setStatus('Vul een roomcode in.', true); setStatus('Lobby joinen…', false); const out = await rpc('pikken_join_lobby_scoped', { session_token: sessionToken() || null, site_scope_input: getScope(), lobby_code_input: code }); applyCreateFallback(Object.assign({}, out || {}, { lobby_code: code })); startPolling(); }
  async function leaveLobby(){
    if(!UI.gameId) return setStatus('Geen actieve room.', true);
    setStatus('Room verlaten…', false);
    const out = await rpc('pikken_leave_lobby_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId });
    clearLobbyView();
    setStatus(out?.disbanded ? 'Room is automatisch verwijderd omdat er niemand meer in zat.' : 'Je hebt de room verlaten.', false);
  }
  async function destroyLobby(){
    if(!UI.gameId) return setStatus('Geen actieve room.', true);
    setStatus('Room opheffen…', false);
    await rpc('pikken_destroy_lobby_scoped', { session_token: sessionToken() || null, game_id_input: UI.gameId });
    clearLobbyView();
    setStatus('Room is opgeheven.', false);
  }
  async function setReady(ready){ setStatus(ready?'Ready…':'Unready…', false); await rpc('pikken_set_ready_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId, ready_input: !!ready }); await loadAndRender(); }
  async function startGame(){ setStatus('Starten…', false); await rpc('pikken_start_game_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId }); await loadAndRender(); }
  async function placeBid(){ const count = Number(qs('#pkBidCount').value||0); const face = Number(qs('#pkBidFace').value||0); setStatus('Bieden…', false); const state = await rpc('pikken_place_bid_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId, bid_count_input: count, bid_face_input: face }); render(state); setStatus('Bod geplaatst.', false); }
  async function rejectBid(){ setStatus('Afkeuren…', false); const state = await rpc('pikken_reject_bid_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId }); render(state); setStatus('Bod afgekeurd.', false); }
  async function vote(v){ setStatus('Stemmen…', false); const state = await rpc('pikken_cast_vote_scoped', { session_token: sessionToken()||null, game_id_input: UI.gameId, vote_input: !!v }); render(state); setStatus('Stem opgeslagen.', false); }

  function boot(){
    const params = new URLSearchParams(location.search); UI.gameId = params.get('game_id') || ''; if(UI.gameId) setParticipantToken(UI.gameId, true); else clearLobbyView();
    const roomInput = qs('#pkRoomCode'); if(roomInput){ roomInput.addEventListener('input', markRoomCodeDirty); roomInput.addEventListener('focus', markRoomCodeDirty); roomInput.addEventListener('blur', ()=>{ UI.roomCodeTouchedAt = Date.now(); }); }
    qs('#pkCreateLobbyBtn').addEventListener('click', ()=>createLobby().catch(e=>setStatus(normalizeError(e)||'Maken mislukt.',true)));
    qs('#pkJoinLobbyBtn').addEventListener('click', ()=>joinLobby().catch(e=>setStatus(normalizeError(e)||'Join mislukt.',true)));
    qs('#pkRefreshBtn').addEventListener('click', ()=>loadAndRender().catch(e=>setStatus(normalizeError(e)||'Verversen mislukt.',true)));
    qs('#pkReadyBtn').addEventListener('click', ()=>setReady(true).catch(e=>setStatus(normalizeError(e)||'Ready mislukt.',true)));
    qs('#pkLeaveBtn').addEventListener('click', ()=>leaveLobby().catch(e=>setStatus(normalizeError(e)||'Verlaten mislukt.',true)));
    qs('#pkDestroyBtn').addEventListener('click', ()=>destroyLobby().catch(e=>setStatus(normalizeError(e)||'Opheffen mislukt.',true)));
    qs('#pkUnreadyBtn').addEventListener('click', ()=>setReady(false).catch(e=>setStatus(normalizeError(e)||'Unready mislukt.',true)));
    qs('#pkStartBtn').addEventListener('click', ()=>startGame().catch(e=>setStatus(normalizeError(e)||'Start mislukt.',true)));
    qs('#pkPlaceBidBtn').addEventListener('click', ()=>placeBid().catch(e=>setStatus(normalizeError(e)||'Bieden mislukt.',true)));
    qs('#pkRejectBtn').addEventListener('click', ()=>rejectBid().catch(e=>setStatus(normalizeError(e)||'Afkeuren mislukt.',true)));
    qs('#pkVoteApproveBtn').addEventListener('click', ()=>vote(true).catch(e=>setStatus(normalizeError(e)||'Stem mislukt.',true)));
    qs('#pkVoteRejectBtn').addEventListener('click', ()=>vote(false).catch(e=>setStatus(normalizeError(e)||'Stem mislukt.',true)));
    if(UI.gameId) startPolling();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot, { once:true }); else boot();
})();
