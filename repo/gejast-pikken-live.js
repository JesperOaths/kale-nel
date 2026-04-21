(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const liveSummary = window.GEJAST_LIVE_SUMMARY || {};
  const scopeUtils = window.GEJAST_SCOPE_UTILS || {};
  const BID_HISTORY_KEY = 'jas_pikken_bid_history_v501';
  const LOCAL_DICE_KEY = 'jas_pikken_live_local_dice_v1';

  function getScope(){
    try { return (scopeUtils.getScope && scopeUtils.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); }
    catch (_) { return 'friends'; }
  }
  function sessionToken(){ try { return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; } catch (_) { return ''; } }
  function headers(){ return { 'Content-Type':'application/json', apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, Accept:'application/json' }; }
  async function rpc(name, payload){
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', headers: headers(), body: JSON.stringify(payload || {}), cache:'no-store', mode:'cors' });
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (_) { throw new Error(txt || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || txt || `HTTP ${res.status}`);
    return data && data[name] !== undefined ? data[name] : data;
  }
  async function rpcVariants(name, variants){ let lastErr = null; for (const payload of variants){ try { return await rpc(name, payload); } catch (err){ lastErr = err; } } throw lastErr || new Error('RPC mislukt.'); }
  function payloadVariants(extra, options){
    const base = Object.assign({}, extra || {});
    const token = sessionToken() || null;
    const includeScope = options?.includeScope !== false;
    const scope = getScope();
    const variants = [
      Object.assign({}, base, includeScope ? { site_scope_input: scope } : {}, { session_token: token }),
      Object.assign({}, base, includeScope ? { site_scope_input: scope } : {}, { session_token_input: token }),
      Object.assign({}, base, { session_token: token }),
      Object.assign({}, base, { session_token_input: token }),
      Object.assign({}, base, includeScope ? { site_scope_input: scope, session_token: token, session_token_input: token } : { session_token: token, session_token_input: token })
    ];
    const seen = new Set();
    return variants.filter((item)=>{
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function qs(sel, root){ return (root || document).querySelector(sel); }
  function esc(v){ const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}; return String(v ?? '').replace(/[&<>"']/g,(m)=>map[m]); }
  function bidText(bid){ const count = Number(bid?.count || bid?.bid_count || 0); const face = Number(bid?.face || bid?.bid_face || 0); if (!count || !face) return '—'; return face === 1 ? `${count} × pik` : `${count} × ${face}`; }
  function penaltyLabel(raw){ return String(raw || '').toLowerCase() === 'right_loses' ? 'Fair' : 'Normal'; }
  function seatClass(index, total){ const map4=['top','right','bottom','left']; const map6=['top','extra2','right','bottom','left','extra1']; const map8=['top','extra2','right','extra3','bottom','extra4','left','extra1']; const table=total<=4?map4:total<=6?map6:map8; return table[index] || `extra${(index%4)+1}`; }
  function normalizeRows(payload){ if (Array.isArray(payload)) return payload; if (Array.isArray(payload?.rows)) return payload.rows; if (Array.isArray(payload?.items)) return payload.items; return []; }
  function normalizeError(err){
    const msg = String(err && err.message || err || 'Onbekende fout');
    if (/function public\.pikken_get_state_scoped\(text, uuid\) does not exist/i.test(msg) || /pikken\)getstate scoped/i.test(msg.replace(/_/g,''))) return 'De oude 2-argument Pikken state-reader ontbreekt op de database. Gebruik eerst de compat SQL voor de DB.';
    return msg;
  }
  function orderFace(face){ return face === 1 ? 7 : face; }
  function sortDiceFaces(dice){ return (Array.isArray(dice) ? dice : []).map((n)=>Number(n || 0)).filter(Boolean).sort((a,b)=>orderFace(a)-orderFace(b)); }
  function groupDice(dice){ const grouped=new Map(); sortDiceFaces(dice).forEach((face)=>{ if(!grouped.has(face)) grouped.set(face,[]); grouped.get(face).push(face); }); return Array.from(grouped.entries()).map(([face, arr])=>({ face, dice: arr })); }

  const params = new URLSearchParams(location.search);
  const gameId = params.get('client_match_id') || params.get('game_id') || '';
  const UI = { pollId:null, presenceId:null, currentState:null, bidHistory:[], lastSeenBidKey:'', lastRoundRendered:0, shakeArmed:false, lastShakeAt:0 };

  function bidHistoryStorage(){ try { return JSON.parse(localStorage.getItem(BID_HISTORY_KEY) || '{}'); } catch (_) { return {}; } }
  function loadLocalBidHistory(){ const store = bidHistoryStorage(); UI.bidHistory = Array.isArray(store[gameId]) ? store[gameId] : []; }
  function saveLocalBidHistory(){ try { const store = bidHistoryStorage(); store[gameId] = UI.bidHistory.slice(-50); localStorage.setItem(BID_HISTORY_KEY, JSON.stringify(store)); } catch (_) {} }
  function pushBidHistory(entry){ const key=`${entry.round_no}|${entry.seat}|${entry.label}`; if(UI.bidHistory.some((row)=>`${row.round_no}|${row.seat}|${row.label}`===key)) return; UI.bidHistory.push(entry); saveLocalBidHistory(); }
  function localDiceStorage(){ try { return JSON.parse(localStorage.getItem(LOCAL_DICE_KEY) || '{}'); } catch (_) { return {}; } }
  function saveLocalDiceStorage(store){ try { localStorage.setItem(LOCAL_DICE_KEY, JSON.stringify(store || {})); } catch (_) {} }
  function backendBidHistory(model){
    const raw=[]
      .concat(Array.isArray(model?.state?.game?.state?.bid_history)?model.state.game.state.bid_history:[])
      .concat(Array.isArray(model?.state?.game?.state?.round_bid_history)?model.state.game.state.round_bid_history:[])
      .concat(Array.isArray(model?.state?.bid_history)?model.state.bid_history:[])
      .concat(Array.isArray(model?.publicState?.game?.state?.bid_history)?model.publicState.game.state.bid_history:[])
      .concat(Array.isArray(model?.publicState?.bid_history)?model.publicState.bid_history:[]);
    return raw.map((row)=>({ round_no:Number(row.round_no||model.roundNo||0), seat:Number(row.seat||row.bidder_seat||row.seat_index||0), label:bidText({ count: row.count || row.bid_count, face: row.face || row.bid_face }) })).filter((row)=>row.seat && row.label && row.label !== '—');
  }
  function mergeBidHistory(model){ const backend=backendBidHistory(model); if(backend.length){ UI.bidHistory=backend; saveLocalBidHistory(); return; } const currentBid=model.bid; const bidderSeat=Number(currentBid?.bidder_seat||currentBid?.seat||currentBid?.seat_index||0); const key=`${model.roundNo}|${bidderSeat}|${bidText(currentBid)}`; if(bidderSeat && currentBid && bidText(currentBid)!=='—' && key!==UI.lastSeenBidKey){ UI.lastSeenBidKey=key; pushBidHistory({ round_no:model.roundNo, seat:bidderSeat, label:bidText(currentBid) }); } }

  async function getPresenceMap(){ if(!gameId) return {}; try{ const raw=await rpcVariants('get_pikken_presence_public',[{ game_id_input: gameId },{ game_id_input: gameId, site_scope_input: getScope() }]); const rows=normalizeRows(raw); const map={}; rows.forEach((row)=>{ const key=String(row.player_name || '').trim().toLowerCase(); if(key) map[key]=row; }); return map; }catch(_){ return {}; } }
  async function touchPresence(){ const token=sessionToken(); if(!token || !gameId) return; try{ await rpcVariants('pikken_touch_presence_scoped', payloadVariants({ game_id_input: gameId, page_kind_input:'live' })); }catch(_){ } }
  async function releasePresence(){ const token=sessionToken(); if(!token || !gameId) return; try{ await rpcVariants('pikken_release_presence_scoped', payloadVariants({ game_id_input: gameId })); }catch(_){ } }
  async function reconnectNow(){
    const meta = qs('#metaLine');
    try {
      if (meta) meta.textContent = 'Opnieuw verbinden…';
      await touchPresence();
      await refresh();
      if (meta && UI.currentState) meta.textContent = UI.currentState.metaText || 'Opnieuw verbonden.';
    } catch (err) {
      if (meta) meta.textContent = normalizeError(err);
      throw err;
    }
  }
  async function loadActorState(){ const token=sessionToken(); if(!token || !gameId) return null; try{ return await rpcVariants('pikken_get_state_scoped', payloadVariants({ game_id_input: gameId })); }catch(_){ return null; } }
  async function loadPublicState(){
    if(!gameId) return null;
    try { return await rpcVariants('pikken_get_live_state_public',[{ game_id_input: gameId, site_scope_input:getScope() },{ game_id_input: gameId }]); } catch (_) {}
    try { const identity=liveSummary.matchIdentityFromUrl ? liveSummary.matchIdentityFromUrl() : { clientMatchId:gameId, matchRef:'' }; const item=await liveSummary.loadPublicSummary('pikken', identity); return item ? { item } : null; } catch (_) { return null; }
  }
  function fallbackTurnSeat(model){ const players=(model.players||[]).filter((p)=>!!p.alive || model.phase==='lobby'); const activeSeat=Number(model.turnSeat||0); const bidderSeat=Number(model.bid?.bidder_seat||model.bid?.seat||0); if(model.phase!=='bidding' || !players.length || !bidderSeat || activeSeat!==bidderSeat) return activeSeat; const seats=players.map((p)=>Number(p.seat||p.seat_index||0)).filter(Boolean).sort((a,b)=>a-b); const idx=seats.indexOf(bidderSeat); return idx>=0 ? seats[(idx+1)%seats.length] : activeSeat; }

  function extractMyHandFromActorState(state){
    const viewer = state?.viewer || {};
    const players = Array.isArray(state?.players) ? state.players : [];
    const directCandidates = [
      state?.my_hand, state?.myHand, viewer?.my_hand, viewer?.myHand, viewer?.hand, viewer?.dice, viewer?.dice_values, viewer?.private_state?.dice, viewer?.private_state?.dice_values,
      state?.game?.state?.my_hand, state?.actor_state?.my_hand, state?.actor_state?.dice, state?.actor_state?.dice_values,
      state?.private_state?.my_hand, state?.private_state?.dice, state?.private_state?.dice_values
    ];
    for (const cand of directCandidates){ const dice = sortDiceFaces(cand); if (dice.length) return dice; }
    const mySeat = Number(viewer?.seat || viewer?.seat_index || 0);
    const myPlayerId = Number(viewer?.player_id || 0);
    const viewerName = String(viewer?.display_name || viewer?.player_name || '').trim().toLowerCase();
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
  function inferViewerIdentity(model){
    const viewer = model?.viewer || {};
    const token = sessionToken() || '';
    return {
      seat: Number(viewer?.seat || viewer?.seat_index || 0),
      playerId: Number(viewer?.player_id || 0),
      name: String(viewer?.display_name || viewer?.player_name || '').trim().toLowerCase(),
      tokenKey: token ? token.slice(0, 24) : ''
    };
  }
  function localDiceEntryKey(model){
    const identity = inferViewerIdentity(model);
    return [getScope(), gameId || '', identity.playerId || '', identity.seat || '', identity.name || '', identity.tokenKey || ''].join('|');
  }
  function clearLocalDice(model){
    try {
      const store = localDiceStorage();
      delete store[localDiceEntryKey(model)];
      saveLocalDiceStorage(store);
    } catch (_) {}
  }
  function loadLocalDiceEntry(model){
    try {
      const store = localDiceStorage();
      const entry = store[localDiceEntryKey(model)];
      return entry && typeof entry === 'object' ? entry : null;
    } catch (_) { return null; }
  }
  function saveLocalDiceEntry(model, entry){
    try {
      const store = localDiceStorage();
      store[localDiceEntryKey(model)] = entry;
      saveLocalDiceStorage(store);
    } catch (_) {}
  }
  function findViewerPlayer(model){
    const identity = inferViewerIdentity(model);
    const players = Array.isArray(model?.players) ? model.players : [];
    return players.find((player)=>{
      const seat = Number(player?.seat || player?.seat_index || 0);
      const playerId = Number(player?.player_id || 0);
      const name = String(player?.name || player?.player_name || '').trim().toLowerCase();
      return (identity.seat && seat === identity.seat) || (identity.playerId && playerId === identity.playerId) || (identity.name && name === identity.name);
    }) || null;
  }
  function inferMyDiceCount(model){
    const backendDice = sortDiceFaces(model?.backendMyHand || model?.myHand || []);
    if (backendDice.length) return backendDice.length;
    const player = findViewerPlayer(model);
    const playerCount = Number(player?.dice_count || player?.diceCount || player?.starting_dice || 0);
    if (playerCount > 0) return playerCount;
    const viewerCount = Number(model?.viewer?.dice_count || model?.viewer?.diceCount || 0);
    if (viewerCount > 0) return viewerCount;
    return 6;
  }
  function rollFaces(count){
    return sortDiceFaces(Array.from({ length: Math.max(0, Number(count || 0)) }, ()=>1 + Math.floor(Math.random() * 6)));
  }
  function getLocalOrRolledDice(model, options){
    const force = !!options?.force;
    if (model?.mode !== 'actor' || !sessionToken()) return [];
    const phase = String(model?.phase || '').toLowerCase();
    if (phase === 'lobby') {
      clearLocalDice(model);
      return [];
    }
    const roundNo = Number(model?.roundNo || 0);
    const diceCount = inferMyDiceCount(model);
    if (diceCount <= 0) return [];
    const existing = loadLocalDiceEntry(model);
    if (existing && Number(existing.roundNo || 0) === roundNo && Number(existing.count || 0) === diceCount && Array.isArray(existing.dice) && existing.dice.length === diceCount) {
      return sortDiceFaces(existing.dice);
    }
    if (!force) return [];
    const dice = rollFaces(diceCount);
    saveLocalDiceEntry(model, { roundNo, count: diceCount, dice, updatedAt: Date.now() });
    return dice;
  }
  function canThrowThisRound(model){
    if (!model || model.mode !== 'actor' || !sessionToken()) return false;
    if (String(model.phase || '').toLowerCase() === 'lobby') return false;
    if (sortDiceFaces(model.backendMyHand || []).length) return false;
    return !getLocalOrRolledDice(model).length;
  }
  function maybeThrowLocalDice(source){
    const model = UI.currentState;
    if (!model || !canThrowThisRound(model)) return false;
    const dice = getLocalOrRolledDice(model, { force:true });
    if (!dice.length) return false;
    model.myHand = dice;
    model.usingLocalDice = true;
    renderModel(model);
    const meta = qs('#metaLine');
    if (meta) meta.textContent = source === 'shake' ? 'Dobbelstenen gegooid via schudden.' : 'Dobbelstenen gegooid.';
    return true;
  }
  function faceLabel(face){ return Number(face) === 1 ? 'pik' : String(Number(face)); }

  function normalizeModel(source, presenceMap){
    if (source?.item) {
      const summary=(liveSummary.summaryFromItem ? liveSummary.summaryFromItem(source.item) : (source.item?.summary_payload || {})) || {};
      const st=summary.live_state || summary || {};
      const players=Array.isArray(st.players)?st.players:[];
      const votes=Array.isArray(st.votes)?st.votes:[];
      const backendMyHand = sortDiceFaces(st.my_hand || st.myHand || []);
      const model={ mode:'viewer', publicState:source, presenceMap, phase:String(st.phase || st.status || 'live'), roundNo:Number(st.round_no || 0), bid:st.bid || null, turnSeat:Number(st.current_turn_seat || st.turn_seat || 0), voteTurnSeat:Number(st.vote_turn_seat || 0), penaltyMode:st.penalty_mode, lobbyCode:st.lobby_code || '—', players, votes, viewer:{}, backendMyHand, myHand:backendMyHand, totals:st.dice_totals || {}, lastReveal:st.last_reveal || null, metaText: liveSummary.metaText ? liveSummary.metaText(source.item) : 'Live summary', usingLocalDice:false };
      model.turnSeat = fallbackTurnSeat(model);
      return model;
    }
    const state=source || {};
    const game=state.game || {};
    const backendMyHand = extractMyHandFromActorState(state);
    const model={ mode:'actor', state, presenceMap, phase:String(game?.state?.phase || 'lobby'), roundNo:Number(game?.state?.round_no || 0), bid:game?.state?.bid || null, turnSeat:Number(game?.state?.current_turn_seat || game?.state?.turn_seat || 0), voteTurnSeat:Number(game?.state?.vote_turn_seat || 0), penaltyMode:game?.penalty_mode || game?.config?.penalty_mode, lobbyCode:game?.lobby_code || '—', players:Array.isArray(state.players) ? state.players : [], votes:Array.isArray(state.votes) ? state.votes : [], viewer:state.viewer || {}, backendMyHand, myHand:backendMyHand, totals:state.dice_totals || {}, lastReveal:game?.state?.last_reveal || null, metaText:`Live bijgewerkt om ${new Date().toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}`, usingLocalDice:false };
    if (!model.myHand.length) {
      const localDice = getLocalOrRolledDice(model);
      if (localDice.length) {
        model.myHand = localDice;
        model.usingLocalDice = true;
      }
    }
    model.turnSeat = fallbackTurnSeat(model);
    return model;
  }

  function computeBidOptions(currentBid, totalDice){
    const total=Math.max(1, Number(totalDice || 0)); const options=[]; const seen=new Set();
    function add(count, face){ if(!count || !face) return; const label=face===1?`${count} × pik`:`${count} × ${face}`; const value=`${count}:${face}`; if(seen.has(value)) return; seen.add(value); options.push({ value, label, count, face }); }
    if(!currentBid){ for(let face=2; face<=6; face+=1) add(1, face); add(1, 1); return options; }
    const count=Number(currentBid.count || currentBid.bid_count || 0); const face=Number(currentBid.face || currentBid.bid_face || 0);
    if(face===1){ for(let nextCount=count+1; nextCount<=Math.ceil(total/2); nextCount+=1) add(nextCount,1); for(let nextCount=Math.max(count*2+1,1); nextCount<=total; nextCount+=1){ for(let nextFace=2; nextFace<=6; nextFace+=1) add(nextCount,nextFace); } return options; }
    for(let nextFace=face+1; nextFace<=6; nextFace+=1) add(count,nextFace); for(let nextCount=count+1; nextCount<=total; nextCount+=1){ for(let nextFace=2; nextFace<=6; nextFace+=1) add(nextCount,nextFace); } for(let pikCount=Math.ceil(count/2); pikCount<=Math.ceil(total/2); pikCount+=1) add(pikCount,1); return options;
  }
  function renderBidSelect(model){
    const countSelect=qs('#bidCountSelect');
    const faceSelect=qs('#bidFaceSelect');
    const btn=qs('#bidBtn');
    if(!countSelect || !faceSelect) return;
    const options=computeBidOptions(model.bid, Number(model.totals.current_total || 0));
    const counts=[...new Set(options.map((opt)=>Number(opt.count || 0)).filter(Boolean))].sort((a,b)=>a-b);
    const currentCount=Number(countSelect.value || 0);
    const selectedCount=counts.includes(currentCount) ? currentCount : (counts[0] || 0);
    countSelect.innerHTML=counts.length ? counts.map((count)=>`<option value="${count}">${count}</option>`).join('') : '<option value="">Geen biedingen</option>';
    if (selectedCount) countSelect.value=String(selectedCount);
    const faceOptions=options.filter((opt)=>Number(opt.count||0)===Number(selectedCount));
    const currentFace=Number(faceSelect.value || 0);
    const selectedFace=faceOptions.some((opt)=>Number(opt.face||0)===currentFace) ? currentFace : Number(faceOptions[0]?.face || 0);
    faceSelect.innerHTML=faceOptions.length ? faceOptions.map((opt)=>`<option value="${Number(opt.face)}">${esc(faceLabel(opt.face))}</option>`).join('') : '<option value="">Geen waarden</option>';
    if (selectedFace) faceSelect.value=String(selectedFace);
    if(btn) btn.disabled=!options.length || !selectedCount || !selectedFace;
  }
  function renderVotes(model){ const voteWrap=qs('#tableVotes'); if(!voteWrap) return; const votes=Array.isArray(model.votes) ? model.votes : []; if(!votes.length || model.phase !== 'voting'){ voteWrap.innerHTML=''; return; } voteWrap.innerHTML=votes.map((vote)=>{ const status=String(vote.status || 'waiting'); const icon=status==='approved'?'👍':status==='rejected'?'👎':'…'; return `<span class="table-vote">${icon} ${esc(vote.name || '')}</span>`; }).join(''); }
  function renderMyDice(model){
    const wrap = qs('#myDiceBody'); const note = qs('#diceStateNote'); const rollBtn = qs('#rollBtn');
    if (!wrap || !note) return;
    const dice = sortDiceFaces(model.myHand || []);
    const usingLocalDice = !!model.usingLocalDice;
    note.textContent = dice.length ? (usingLocalDice ? 'Je worp voor deze ronde staat vast.' : 'Je actieve hand voor deze ronde.') : (String(model.phase || '').toLowerCase() === 'lobby' ? 'Zodra de lobby start mag je één keer gooien voor je hand van die ronde.' : 'Je mag aan het begin van deze ronde één keer gooien. Daarna staat je worp vast.');
    if (rollBtn) {
      const canThrow = canThrowThisRound(model);
      rollBtn.disabled = !canThrow;
      rollBtn.textContent = canThrow ? 'Gooien' : (dice.length ? 'Al gegooid' : 'Wacht op ronde');
    }
    if (!dice.length) { wrap.innerHTML = '<div class="muted">Nog geen dobbelstenen zichtbaar. Dit wijst meestal op een backend-state gat: de hand komt nog niet mee of zit onder een andere sleutel.</div>'; return; }
    wrap.innerHTML = groupDice(dice).map((group)=>`<div class="dice-group"><div class="dice-group-head">${group.face === 1 ? 'pik' : group.face}</div><div class="dice-row">${group.dice.map((face)=>`<img class="die" src="./assets/pikken/dice-${Number(face)}.svg" alt="die ${Number(face)}">`).join('')}</div></div>`).join('');
  }
  function renderReveal(lastReveal){ const wrap=qs('#revealBody'); if(!wrap) return; if(!lastReveal){ wrap.textContent='Nog geen reveal.'; return; } const lrBid=lastReveal.bid || {}; wrap.innerHTML=`<div><strong>R${Number(lastReveal.round_no || 0)}</strong> · bod ${esc(bidText(lrBid))} · ${lastReveal.bid_true ? 'gehaald' : 'niet gehaald'} · geteld ${Number(lastReveal.counted_total || 0)}</div><div class="reveal-grid">${(Array.isArray(lastReveal.hands)?lastReveal.hands:[]).map((h)=>`<div class="reveal-card"><div><strong>${esc(h.name || 'Speler')}</strong> <span class="subline">#${Number(h.seat || 0)}</span></div><div class="dice-row">${(Array.isArray(h.dice)?h.dice:[]).map((d)=>`<img class="die" src="./assets/pikken/dice-${Number(d)}.svg" alt="die ${Number(d)}">`).join('')}</div></div>`).join('')}</div>`; }
  function renderSeats(model){
    const ring=qs('#seatRing'); if(!ring) return; Array.from(ring.querySelectorAll('.seat')).forEach((node)=>node.remove()); const players=model.players || [];
    players.forEach((p, idx)=>{ const seat=Number(p.seat || p.seat_index || 0); const meSeat=Number(model.viewer?.seat || model.viewer?.seat_index || 0); const alive=!!p.alive || String(model.phase || '').toLowerCase()==='lobby'; const presence=model.presenceMap[String(p.name || p.player_name || '').trim().toLowerCase()] || null; const disconnected=!!presence && presence.connected===false; const seatHistory=UI.bidHistory.filter((row)=>Number(row.round_no || 0)===Number(model.roundNo || 0) && Number(row.seat || 0)===seat).slice(-3); const vote=(model.votes || []).find((row)=>Number(row.seat || row.seat_index || 0)===seat); const voteIcon=model.phase==='voting' ? (vote?.status==='approved'?'👍':vote?.status==='rejected'?'👎':'…') : ''; const canKick=model.mode==='actor' && !!model.viewer?.is_host && meSeat!==seat; const div=document.createElement('div'); div.className=`seat ${seatClass(idx,players.length)} ${seat===meSeat?'me':''} ${(seat===model.turnSeat || seat===model.voteTurnSeat)?'turn':''} ${alive?'':'dead'} ${disconnected?'disconnected':''}`.trim(); div.innerHTML=`<div class="seat-top"><div><div class="seat-name">${esc(p.name || p.player_name || 'Speler')}</div><div class="seat-meta">stoel ${seat || '—'} · ${Number(p.dice_count || 0)} dobbel(s)${disconnected?' · offline':''}</div></div>${canKick?`<button class="seat-kick" type="button" data-kick-seat="${seat}">kick</button>`:''}</div><div class="seat-badges">${seat===model.turnSeat && model.phase==='bidding'?'<span class="pill ok">aan zet</span>':''}${seat===model.voteTurnSeat && model.phase==='voting'?'<span class="pill wait">stemt nu</span>':''}${!alive?'<span class="pill bad">uit</span>':''}${voteIcon?`<span class="pill ${vote?.status==='approved'?'ok':vote?.status==='rejected'?'bad':'wait'}">${voteIcon}</span>`:''}</div><div class="seat-history">${seatHistory.length?seatHistory.map((row)=>`<span>${esc(row.label)}</span>`).join(''):'<span>—</span>'}</div>`; ring.appendChild(div); });
    Array.from(ring.querySelectorAll('[data-kick-seat]')).forEach((btn)=>{ btn.addEventListener('click', ()=>kickSeat(Number(btn.getAttribute('data-kick-seat') || 0)).catch((e)=>alert(normalizeError(e)))); });
  }
  function renderModel(model){
    mergeBidHistory(model);
    const set=(id, value)=>{ const n=qs(`#${id}`); if(n) n.textContent=value; };
    set('metaLine', model.metaText); const phasePill=qs('#phasePill'); if(phasePill){ phasePill.textContent=model.phase || 'live'; phasePill.className=`pill ${model.phase==='finished'?'bad':model.phase==='bidding'?'ok':'wait'}`; }
    set('currentBid', bidText(model.bid)); set('bidBy', model.bid ? `door ${model.bid.bidder_name || model.players.find((p)=>Number(p.seat || p.seat_index || 0)===Number(model.bid.bidder_seat || model.bid.seat || 0))?.name || '—'}` : 'Nog geen bod'); set('roundNo', String(Number(model.roundNo || 0))); const activeSeat=model.phase==='voting' ? model.voteTurnSeat : model.turnSeat; set('turnName', model.players.find((p)=>Number(p.seat || p.seat_index || 0)===activeSeat)?.name || '—'); set('penaltyMode', penaltyLabel(model.penaltyMode)); set('diceFraction', `${Number(model.totals.current_total || 0)}/${Number(model.totals.start_total || 0)}`);
    renderVotes(model); renderSeats(model); renderReveal(model.lastReveal); renderMyDice(model); renderBidSelect(model);
    const mySeat=Number(model.viewer?.seat || model.viewer?.seat_index || 0); const meAlive=model.mode==='viewer' ? true : (!!model.viewer?.alive || model.phase==='lobby'); const myTurn=model.mode==='actor' && model.phase==='bidding' && mySeat===model.turnSeat && meAlive; const myVoteTurn=model.mode==='actor' && model.phase==='voting' && mySeat===model.voteTurnSeat && meAlive;
    const hasActorSession = !!sessionToken();
    const mc=qs('#mobileContext'); if(mc) mc.textContent=myTurn?'Kies een legale volgende bieding of keur af.':(myVoteTurn?'Stem zichtbaar met een duim.':(model.mode==='viewer'?'Spectator-modus. Probeer opnieuw verbinden als jij hier eigenlijk meespeelt.':'Volg de match live. Als je verbinding wegviel, probeer opnieuw verbinden.'));
    const bc=qs('#bidControls'); if(bc) bc.classList.toggle('hidden', !myTurn); const vc=qs('#voteControls'); if(vc) vc.classList.toggle('hidden', !myVoteTurn); const rejectBtn=qs('#rejectBtn'); if(rejectBtn) rejectBtn.disabled=!myTurn || !model.bid; const leaveBtn=qs('#leaveBtn'); if(leaveBtn) leaveBtn.classList.toggle('hidden', !(model.mode==='actor' && hasActorSession)); const destroyBtn=qs('#destroyBtn'); if(destroyBtn) destroyBtn.classList.toggle('hidden', !(model.mode==='actor' && !!model.viewer?.is_host));
  }
  async function refresh(){ if(!gameId){ const meta=qs('#metaLine'); if(meta) meta.textContent='Geen game_id in URL.'; return; } await touchPresence(); const [actorState, publicState, presenceMap] = await Promise.all([loadActorState(), loadPublicState(), getPresenceMap()]); const source = actorState || publicState; if(!source) throw new Error('Geen Pikken-state gevonden.'); UI.currentState = normalizeModel(source, presenceMap || {}); renderModel(UI.currentState); }
  async function act(name, payload){ await rpcVariants(name, payloadVariants(Object.assign({ game_id_input:gameId }, payload || {}))); await refresh(); }
  async function kickSeat(seat){ if(!seat) return; const player=(UI.currentState?.players || []).find((p)=>Number(p.seat || p.seat_index || 0)===Number(seat)); if(!player) return; if(!confirm(`Wil je ${player.name || player.player_name || 'deze speler'} uit de match gooien?`)) return; await rpcVariants('pikken_kick_player_scoped', [...payloadVariants({ game_id_input:gameId, seat_index_input:Number(seat), player_name_input: player?.name || player?.player_name || '' }), { session_token:sessionToken(), game_id_input:gameId, seat_index_input:Number(seat), seat_input:String(seat), target_seat_input: player?.name || player?.player_name || String(seat) }, { session_token_input:sessionToken(), game_id_input:gameId, seat_index_input:Number(seat), seat_input:String(seat), target_seat_input: player?.name || player?.player_name || String(seat) }]); await refresh(); }

  const rollBtn = qs('#rollBtn'); if (rollBtn) rollBtn.addEventListener('click', async ()=>{
    if (typeof window.DeviceMotionEvent !== 'undefined' && typeof window.DeviceMotionEvent.requestPermission === 'function' && !UI.shakeArmed) {
      try { const result = await window.DeviceMotionEvent.requestPermission(); UI.shakeArmed = result === 'granted'; } catch (_) {}
    }
    if (maybeThrowLocalDice('button')) return;
    refresh().catch((e)=>{ const meta=qs('#metaLine'); if(meta) meta.textContent = normalizeError(e); });
  });
  const reconnectBtn = qs('#reconnectBtn'); if (reconnectBtn) reconnectBtn.addEventListener('click', ()=>{ reconnectNow().catch(()=>{}); });
  const bidCountSelect = qs('#bidCountSelect'); if (bidCountSelect) bidCountSelect.addEventListener('change', ()=>{ if (UI.currentState) renderBidSelect(UI.currentState); });
  const bidBtn = qs('#bidBtn'); if (bidBtn) bidBtn.addEventListener('click', async ()=>{
    const count = Number(qs('#bidCountSelect')?.value || 0);
    const face = Number(qs('#bidFaceSelect')?.value || 0);
    if (!count || !face) return;
    try {
      await rpcVariants('pikken_place_bid_scoped', [
        { session_token: sessionToken() || null, game_id_input: gameId, bid_count_input: count, bid_face_input: face },
        { session_token_input: sessionToken() || null, game_id_input: gameId, bid_count_input: count, bid_face_input: face },
        { session_token: sessionToken() || null, game_id_input: gameId, bid_count: count, bid_face: face },
        { session_token: sessionToken() || null, game_id_input: gameId, count_input: count, face_input: face },
        { session_token: sessionToken() || null, session_token_input: sessionToken() || null, game_id_input: gameId, bid_count_input: count, bid_face_input: face },
        { session_token: sessionToken() || null, game_id_input: gameId, bid_count_input: count, bid_face_input: face, site_scope_input: getScope() }
      ]);
      await refresh();
    } catch (e) {
      alert(normalizeError(e));
    }
  });
  const rejectBtn = qs('#rejectBtn'); if(rejectBtn) rejectBtn.addEventListener('click', ()=>act('pikken_reject_bid_scoped').catch((e)=>alert(normalizeError(e))));
  const approveBtn = qs('#approveBtn'); if(approveBtn) approveBtn.addEventListener('click', ()=>act('pikken_cast_vote_scoped', { vote_input:true }).catch((e)=>alert(normalizeError(e))));
  const voteRejectBtn = qs('#voteRejectBtn'); if(voteRejectBtn) voteRejectBtn.addEventListener('click', ()=>act('pikken_cast_vote_scoped', { vote_input:false }).catch((e)=>alert(normalizeError(e))));
  const leaveBtn = qs('#leaveBtn'); if(leaveBtn) leaveBtn.addEventListener('click', async ()=>{ if(!confirm('Wil je de match verlaten?')) return; try{ await rpcVariants('pikken_leave_game_scoped', payloadVariants({ game_id_input: gameId })); await releasePresence(); location.href = `./pikken.html?scope=${encodeURIComponent(getScope())}`; } catch (e) { alert(normalizeError(e)); } });
  const destroyBtn = qs('#destroyBtn'); if(destroyBtn) destroyBtn.addEventListener('click', async ()=>{ if(!confirm('Host: wil je dit Pikken-spel stoppen en verwijderen?')) return; try{ await rpcVariants('pikken_destroy_game_scoped', payloadVariants({ game_id_input: gameId })); await releasePresence(); location.href = `./pikken.html?scope=${encodeURIComponent(getScope())}`; } catch (e) { alert(normalizeError(e)); } });

  window.addEventListener('beforeunload', ()=>{ releasePresence(); });
  loadLocalBidHistory();
  refresh().catch((e)=>{ const meta=qs('#metaLine'); if(meta) meta.textContent = normalizeError(e); });
  UI.pollId = setInterval(()=>{ if (!document.hidden) refresh().catch(()=>{}); }, 2200);
  UI.presenceId = setInterval(()=>{ if (!document.hidden) touchPresence().catch(()=>{}); }, 12000);
  document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) reconnectNow().catch(()=>{}); });
  window.addEventListener('online', ()=>{ reconnectNow().catch(()=>{}); });
  window.addEventListener('devicemotion', (event)=>{
    const model = UI.currentState;
    if (!canThrowThisRound(model)) return;
    const acc = event?.accelerationIncludingGravity || event?.acceleration || {};
    const magnitude = Math.max(Math.abs(Number(acc.x || 0)), Math.abs(Number(acc.y || 0)), Math.abs(Number(acc.z || 0)));
    const now = Date.now();
    if (magnitude < 18 || now - UI.lastShakeAt < 1200) return;
    UI.lastShakeAt = now;
    maybeThrowLocalDice('shake');
  });
})();
