(function(global){
  const DESIGN = { width: 1400, height: 980 };
  const SUITS = ['hearts','diamonds','clubs','spades'];
  const SUIT_META = {
    hearts: { label:'Harten', short:'H', symbol:'♥', color:'#a14b42', chip:'Har' },
    diamonds: { label:'Ruiten', short:'D', symbol:'♦', color:'#b86e58', chip:'Rui' },
    clubs: { label:'Klaveren', short:'C', symbol:'♣', color:'#62775a', chip:'Kla' },
    spades: { label:'Schoppen', short:'S', symbol:'♠', color:'#566171', chip:'Sch' }
  };
  const CARD_RECTS = {
    hearts:   { sx: 193, sy: 86, sw: 118, sh: 168 },
    clubs:    { sx: 325, sy: 86, sw: 117, sh: 168 },
    diamonds: { sx: 456, sy: 86, sw: 118, sh: 168 },
    spades:   { sx: 588, sy: 86, sw: 117, sh: 168 }
  };
  const TRACK = {
    outerX: 248,
    gateY: 172,
    gateHeight: 84,
    cellWidth: 80,
    cellHeight: 104,
    cellGap: 10,
    rowGap: 16,
    laneStartY: 172 + 84 + 36,
    labelX: 98,
    labelWidth: 136,
    totalCols: 12,
    raceCols: 10
  };
  const POLL_MS = 2000;
  const COUNTDOWN_SECONDS = 4;
  const MAX_WAGER = 20;

  const state = {
    room: null,
    page: null,
    canvas: null,
    ctx: null,
    images: {},
    polling: 0,
    livePoll: 0,
    createInFlight: false,
    lastSummaryFingerprint: '',
    roomCode: '',
    forcedScope: '',
    currentGame: 'paardenrace'
  };

  function cfg(){ return global.GEJAST_CONFIG || {}; }
  function rpcHelper(){ return global.GEJAST_SCOPED_RPC || null; }
  function liveSync(){ return global.GEJAST_LIVE_SYNC || null; }
  function liveSummary(){ return global.GEJAST_LIVE_SUMMARY || null; }
  function currentScope(){
    if (state.forcedScope) return state.forcedScope;
    try { if (global.GEJAST_SCOPE_UTILS && typeof global.GEJAST_SCOPE_UTILS.getScope === 'function') return global.GEJAST_SCOPE_UTILS.getScope(); } catch(_) {}
    try { return new URLSearchParams(global.location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch(_) {}
    return 'friends';
  }
  function sessionToken(){
    const c = cfg();
    if (c && typeof c.getPlayerSessionToken === 'function') return c.getPlayerSessionToken() || '';
    const keys = ['jas_session_token_v11','jas_session_token_v10'];
    for (const key of keys){
      try {
        const value = global.localStorage.getItem(key) || global.sessionStorage.getItem(key);
        if (value) return value;
      } catch(_){}
    }
    return '';
  }
  function pageParams(){ try { return new URLSearchParams(global.location.search); } catch(_) { return new URLSearchParams(); } }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, (m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function num(v, fallback=0){ const n = Number(v); return Number.isFinite(n) ? n : fallback; }
  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
  function titleCase(s){ const t = SUIT_META[String(s||'').toLowerCase()]; return t ? t.label : String(s||''); }
  function initials(name){ const bits = String(name||'').trim().split(/\s+/).slice(0,2); return bits.map((b)=>b.charAt(0).toUpperCase()).join('') || '—'; }
  function fmtDate(v){ const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('nl-NL'); }
  function fmtClock(v){ const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'}); }
  function keyName(v){ return String(v||'').trim().toLowerCase(); }
  function ensurePageScope(href){ return currentScope() === 'family' ? appendScope(href) : href; }
  function appendScope(href){ try { const u = new URL(href, global.location.href); if (currentScope()==='family') u.searchParams.set('scope','family'); return u.pathname.split('/').pop() + u.search; } catch(_) { return href; } }
  function roomUrl(code){ const u = new URL(global.location.href); if (code) u.searchParams.set('room', code); if (currentScope()==='family') u.searchParams.set('scope','family'); return u.pathname.split('/').pop() + u.search; }
  function finger(obj){ try { return JSON.stringify(obj); } catch(_) { return String(Date.now()); } }

  async function parseResponse(res){
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch(_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || text || `HTTP ${res.status}`);
    return data;
  }
  async function callRpc(name, payload){
    const helper = rpcHelper();
    if (helper && typeof helper.callRpc === 'function') return helper.callRpc(name, payload || {});
    const c = cfg();
    const res = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method:'POST', mode:'cors', cache:'no-store',
      headers:{ apikey:c.SUPABASE_PUBLISHABLE_KEY||'', Authorization:`Bearer ${c.SUPABASE_PUBLISHABLE_KEY||''}`,'Content-Type':'application/json', Accept:'application/json' },
      body: JSON.stringify(Object.assign({}, payload||{}))
    });
    const raw = await parseResponse(res);
    return raw?.[name] || raw;
  }

  function loadImage(src){
    return new Promise((resolve, reject)=>{
      const img = new Image();
      img.decoding = 'async';
      img.onload = ()=>resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function ensureImages(){
    if (state.images.ready) return state.images;
    const [track, sheet, back] = await Promise.all([
      loadImage('./assets/paardenrace/paardenrace-track.png'),
      loadImage('./assets/paardenrace/paardenrace-cards-supplied.webp'),
      loadImage('./assets/paardenrace/paardenrace-card-back.png')
    ]);
    state.images = { ready:true, track, sheet, back };
    return state.images;
  }

  function fitCanvas(canvas){
    const ratio = Math.max(1, Math.min(2, global.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || DESIGN.width;
    const height = Math.round(width * (DESIGN.height / DESIGN.width));
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.scale(width / DESIGN.width, height / DESIGN.height);
    return ctx;
  }

  function fillRound(ctx, x, y, w, h, r, fill, stroke){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr,y);
    ctx.arcTo(x+w,y,x+w,y+h,rr);
    ctx.arcTo(x+w,y+h,x,y+h,rr);
    ctx.arcTo(x,y+h,x,y,rr);
    ctx.arcTo(x,y,x+w,y,rr);
    ctx.closePath();
    if (fill){ ctx.fillStyle = fill; ctx.fill(); }
    if (stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); }
  }

  function suitChip(ctx, suitKey, x, y, w, h){
    const meta = SUIT_META[suitKey] || SUIT_META.hearts;
    const g = ctx.createLinearGradient(x,y,x,y+h);
    g.addColorStop(0, 'rgba(255,255,255,0.92)');
    g.addColorStop(1, meta.color + '99');
    fillRound(ctx, x, y, w, h, h/2, g, 'rgba(0,0,0,0.05)');
    ctx.fillStyle = '#1a130e';
    ctx.font = '700 16px Inter, system-ui, sans-serif';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText(meta.chip, x + w/2, y + h/2 + 1);
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  }

  function drawMiniCard(ctx, cardCode, x, y, w, h, opts={}){
    const faceDown = !!opts.faceDown;
    if (faceDown) {
      if (state.images.back) ctx.drawImage(state.images.back, x, y, w, h);
      return;
    }
    const rank = String(cardCode||'').slice(0,-1) || '?';
    const suitLetter = String(cardCode||'').slice(-1).toUpperCase();
    const suitMap = { H:'hearts', D:'diamonds', C:'clubs', S:'spades' };
    const suitKey = suitMap[suitLetter] || 'spades';
    const meta = SUIT_META[suitKey];
    fillRound(ctx, x, y, w, h, 14, '#fffdf8', 'rgba(33,24,16,0.12)');
    ctx.fillStyle = meta.color;
    ctx.font = `700 ${Math.round(h*0.19)}px Georgia, serif`;
    ctx.fillText(rank, x + 12, y + 24);
    ctx.font = `700 ${Math.round(h*0.16)}px Georgia, serif`;
    ctx.fillText(meta.symbol, x + 12, y + 44);
    ctx.font = `700 ${Math.round(h*0.26)}px Georgia, serif`;
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText(meta.symbol, x + w/2, y + h/2 + 6);
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  }

  function drawHorseAce(ctx, suitKey, x, y, w, h){
    const rect = CARD_RECTS[suitKey];
    if (!rect || !state.images.sheet) return drawMiniCard(ctx, 'A' + (SUIT_META[suitKey]?.short || 'H'), x, y, w, h);
    ctx.drawImage(state.images.sheet, rect.sx, rect.sy, rect.sw, rect.sh, x, y, w, h);
  }

  function cellX(col){ return TRACK.outerX + col * (TRACK.cellWidth + TRACK.cellGap); }
  function laneY(index){ return TRACK.laneStartY + index * (TRACK.cellHeight + TRACK.rowGap); }
  function gateX(step){ return TRACK.outerX + (step) * (TRACK.cellWidth + TRACK.cellGap); }
  function horseX(position){ return cellX(clamp(num(position,0),0,11)); }

  function renderBoard(snapshot, opts={}){
    const canvas = state.canvas;
    if (!canvas) return;
    const ctx = fitCanvas(canvas);
    state.ctx = ctx;
    ctx.clearRect(0,0,DESIGN.width, DESIGN.height);
    if (state.images.track) ctx.drawImage(state.images.track, 0, 0, DESIGN.width, DESIGN.height);

    const room = snapshot || {};
    const match = room.match || {};
    const gateCards = Array.isArray(match.gate_cards) ? match.gate_cards : [];
    const revealed = Array.isArray(match.revealed_gate_cards) ? match.revealed_gate_cards : [];
    const positions = match.horse_positions || {};
    const players = Array.isArray(room.players) ? room.players : [];

    ctx.fillStyle = '#2a1a0a';
    ctx.font = '700 18px Georgia, serif';
    ctx.fillText('Poortkaarten', 84, 182);
    ctx.fillStyle = '#705f4d';
    ctx.font = '600 14px Inter, system-ui, sans-serif';
    ctx.fillText('Draai om zodra alle paarden deze stap hebben gehaald', 84, 204);
    fillRound(ctx, 1186, 156, 88, 44, 22, 'rgba(255,251,245,0.75)', 'rgba(33,24,16,0.06)');
    fillRound(ctx, 1282, 156, 94, 44, 22, 'rgba(255,251,245,0.75)', 'rgba(33,24,16,0.06)');
    ctx.fillStyle = '#6c5a48';
    ctx.font = '700 13px Inter, system-ui, sans-serif';
    ctx.fillText('START', 1214, 183);
    ctx.fillText('FINISH', 1308, 183);

    for (let i=0;i<10;i++){
      const x = gateX(i+1) + 11;
      const y = TRACK.gateY + 11;
      const isRevealed = revealed.some((r)=>num(r.step)===i+1);
      const face = isRevealed ? (revealed.find((r)=>num(r.step)===i+1)?.card_code || gateCards[i] || '') : '';
      drawMiniCard(ctx, face, x, y, 56, 80, { faceDown: !isRevealed });
    }

    SUITS.forEach((suitKey, index)=>{
      const y = laneY(index);
      const labelY = y + 10;
      fillRound(ctx, 80, y + 10, 154, 102, 24, 'rgba(255,255,255,0.62)', 'rgba(33,24,16,0.06)');
      suitChip(ctx, suitKey, 95, y + 54, 76, 22);
      ctx.fillStyle = '#23160a';
      ctx.font = '700 20px Georgia, serif';
      ctx.fillText(SUIT_META[suitKey].label, 183, y + 66);
      ctx.fillStyle = '#7e6f62';
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.fillText('lane', 187, y + 88);

      const pos = num(positions[suitKey], 0);
      drawHorseAce(ctx, suitKey, horseX(pos) + 2, y + 2, 74, 100);
    });

    // last drawn card
    const last = String(match.last_drawn_card || '');
    if (opts.showLastCard !== false) {
      const x = 83;
      const y = 238;
      fillRound(ctx, x, y, 140, 148, 24, 'rgba(255,255,255,0.58)', 'rgba(33,24,16,0.06)');
      ctx.fillStyle = '#2a1a0a';
      ctx.font = '700 18px Georgia, serif';
      ctx.fillText('Laatste kaart', x + 20, y + 28);
      if (last) drawMiniCard(ctx, last, x + 34, y + 42, 72, 100);
      else drawMiniCard(ctx, '', x + 34, y + 42, 72, 100, { faceDown:true });
    }

    // player picks
    if (players.length){
      const boxX = 83;
      const boxY = 402;
      const boxW = 160;
      const boxH = 420;
      fillRound(ctx, boxX, boxY, boxW, boxH, 26, 'rgba(255,255,255,0.58)', 'rgba(33,24,16,0.06)');
      ctx.fillStyle = '#2a1a0a';
      ctx.font = '700 18px Georgia, serif';
      ctx.fillText('Spelers', boxX + 20, boxY + 28);
      let py = boxY + 56;
      players.forEach((player)=>{
        fillRound(ctx, boxX + 12, py, boxW - 24, 58, 18, 'rgba(255,251,245,0.82)', 'rgba(33,24,16,0.06)');
        ctx.fillStyle = '#23160a';
        ctx.font = '700 15px Inter, system-ui, sans-serif';
        ctx.fillText(String(player.display_name || player.player_name || 'Speler').slice(0,14), boxX + 24, py + 24);
        ctx.fillStyle = '#7e6f62';
        ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.fillText(`${titleCase(player.selected_suit || '—')} · ${num(player.wager_bakken,0)} Bak`, boxX + 24, py + 42);
        if (player.selected_suit) suitChip(ctx, player.selected_suit, boxX + boxW - 86, py + 18, 54, 18);
        py += 66;
      });
    }
  }

  function summaryFromRoom(room){
    const players = Array.isArray(room?.players) ? room.players : [];
    const match = room?.match || {};
    return {
      match_ref: room?.active_match_ref || room?.match?.match_ref || room?.room_code || '',
      participants: players.map((p)=>String(p.display_name || p.player_name || '')).filter(Boolean),
      winner_names: Array.isArray(match.winner_names) ? match.winner_names : [],
      recap_text: room?.result?.recap_text || '',
      room_code: room?.room_code || '',
      room_status: room?.room_status || room?.status || '',
      players: players.map((p)=>({
        name: p.display_name || p.player_name || '',
        suit: p.selected_suit || null,
        wager_bakken: num(p.wager_bakken,0),
        ready: !!p.ready
      })),
      horse_positions: match.horse_positions || {},
      gate_cards: match.gate_cards || [],
      revealed_gate_cards: match.revealed_gate_cards || [],
      draw_index: num(match.draw_index,0),
      draw_total: Array.isArray(match.draw_deck) ? match.draw_deck.length : num(match.draw_total,0),
      last_drawn_card: match.last_drawn_card || null,
      first_finish_suit: match.first_finish_suit || null,
      first_claimed_finish_suit: match.first_claimed_finish_suit || null,
      live_state: { status: match.stage || room?.room_status || 'lobby', updated_at: room?.updated_at || new Date().toISOString() },
      finished_at: room?.finished_at || match.finished_at || null,
      summary: room?.result || {}
    };
  }

  async function writeLiveSummary(room){
    const sync = liveSync();
    if (!sync || typeof sync.writeSummary !== 'function') return;
    const summary = summaryFromRoom(room);
    const clientMatchId = summary.match_ref || room?.room_code || '';
    if (!clientMatchId) return;
    const fp = finger({ clientMatchId, summary });
    if (fp === state.lastSummaryFingerprint) return;
    state.lastSummaryFingerprint = fp;
    try {
      await sync.writeSummary({ gameType:'paardenrace', clientMatchId, siteScope: currentScope(), summaryPayload: summary, throttleMs: 500, force: false });
    } catch (err) {
      console.warn('Paardenrace live summary write failed', err);
    }
  }

  function viewerPlayer(room){
    const key = keyName(room?.viewer_name || '');
    const players = Array.isArray(room?.players) ? room.players : [];
    return players.find((p)=>keyName(p.display_name || p.player_name || '') === key) || null;
  }

  function setText(id, value){ const el = document.getElementById(id); if (el) el.textContent = value == null ? '' : String(value); }
  function setHtml(id, html){ const el = document.getElementById(id); if (el) el.innerHTML = html; }
  function setStatus(msg, tone){
    const el = document.getElementById('prStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = `pr-status ${tone || ''}`.trim();
  }

  function playerListHtml(room){
    const players = Array.isArray(room?.players) ? room.players : [];
    if (!players.length) return '<div class="pr-empty">Nog niemand in deze kamer.</div>';
    return players.map((p)=>{
      const mine = keyName(p.display_name||p.player_name||'') === keyName(room?.viewer_name||'');
      return `<div class="pr-player-row ${mine?'mine':''}">
        <div class="pr-player-main">
          <div class="pr-avatar">${esc(initials(p.display_name||p.player_name))}</div>
          <div>
            <div class="pr-player-name">${esc(p.display_name||p.player_name||'Speler')}${mine?' <span class="pr-you">jij</span>':''}</div>
            <div class="pr-player-meta">${p.selected_suit ? esc(titleCase(p.selected_suit)) : 'Geen suit'} · ${num(p.wager_bakken,0)} Bakken</div>
          </div>
        </div>
        <div class="pr-player-right">
          ${p.selected_suit ? `<span class="pr-suit-tag ${esc(p.selected_suit)}">${esc(SUIT_META[p.selected_suit]?.label || p.selected_suit)}</span>` : ''}
          <span class="pr-ready ${p.ready ? 'is-ready' : ''}">${p.ready ? 'Klaar' : 'Wacht'}</span>
        </div>
      </div>`;
    }).join('');
  }

  function resultPanelHtml(room){
    const result = room?.result || {};
    const mine = viewerPlayer(room);
    if (!mine) return '<div class="pr-empty">Log in om je eigen resultaat te zien.</div>';
    const owed = num(result?.personal?.total_bakken_owed, num(mine.wager_bakken,0));
    const own = num(result?.personal?.own_wager_bakken, num(mine.wager_bakken,0));
    const extra = num(result?.personal?.extra_received_bakken, 0);
    const winners = Array.isArray(result?.winner_names) ? result.winner_names : [];
    return `<section class="pr-you-owe">
      <h2>Jij moet drinken</h2>
      <div class="pr-total">${owed} Bak${owed===1?'':'ken'}</div>
      <dl>
        <div><dt>Eigen inzet</dt><dd>${own}</dd></div>
        <div><dt>Extra gekregen</dt><dd>${extra}</dd></div>
      </dl>
      <div class="pr-result-meta">${result?.winner_suit ? `Winnend paard: ${esc(titleCase(result.winner_suit))}` : 'Nog geen winnaar.'}${winners.length ? ` · Winnaars: ${esc(winners.join(', '))}` : ''}</div>
    </section>`;
  }

  function drawInfoHtml(room){
    const match = room?.match || {};
    const revealed = Array.isArray(match.revealed_gate_cards) ? match.revealed_gate_cards : [];
    const total = Array.isArray(match.draw_deck) ? match.draw_deck.length : num(match.draw_total,0);
    return `<div class="pr-kv-grid">
      <div><strong>Fase</strong><span>${esc(room?.room_status || match.stage || 'lobby')}</span></div>
      <div><strong>Kaarten</strong><span>${num(match.draw_index,0)} / ${total}</span></div>
      <div><strong>Laatste</strong><span>${esc(match.last_drawn_card || '—')}</span></div>
      <div><strong>Poorten open</strong><span>${revealed.length} / 10</span></div>
      <div><strong>Eerste finish</strong><span>${esc(titleCase(match.first_finish_suit || '—'))}</span></div>
      <div><strong>Claimed finish</strong><span>${esc(titleCase(match.first_claimed_finish_suit || '—'))}</span></div>
    </div>`;
  }

  function roomMetaHtml(room){
    return `<div class="pr-room-head">
      <div><strong>Kamer</strong><span>${esc(room?.room_code || '—')}</span></div>
      <div><strong>Status</strong><span>${esc(room?.room_status || room?.status || '—')}</span></div>
      <div><strong>Kijker</strong><span>${esc(room?.viewer_name || '—')}</span></div>
      <div><strong>Bijgewerkt</strong><span>${esc(fmtClock(room?.updated_at || Date.now()))}</span></div>
    </div>`;
  }

  function nominationHtml(room){
    const result = room?.result || {};
    const players = Array.isArray(room?.players) ? room.players : [];
    const mine = viewerPlayer(room);
    if (!mine) return '';
    if (!result.can_nominate) return '';
    const budget = num(result.nomination_budget_bakken, 0);
    const options = players.filter((p)=>keyName(p.display_name||p.player_name||'') !== keyName(mine.display_name||mine.player_name||''));
    return `<form method="dialog" id="prNominationFormInner">
      <h3>Winnaars nomineren</h3>
      <p>Verdeel exact ${budget} Bakken. Je mag andere winnaars wel kiezen, jezelf niet.</p>
      <div class="pr-nom-grid">${options.map((p)=>`<label class="pr-nom-row"><span>${esc(p.display_name||p.player_name||'')}</span><input type="number" min="0" max="${budget}" step="1" data-target="${esc(p.player_id || p.display_name || '')}" value="0"></label>`).join('')}</div>
      <div class="pr-dialog-actions"><button value="cancel" type="button" id="prNomCancel">Sluiten</button><button value="default" type="submit">Opslaan</button></div>
    </form>`;
  }

  async function loadRoomState(roomCode, silent){
    if (!roomCode) return null;
    try {
      const payload = await callRpc('paardenrace_get_room_state_scoped', { room_code_input: roomCode, session_token: sessionToken(), site_scope_input: currentScope() });
      state.room = payload || {};
      state.roomCode = roomCode;
      if (!silent) setStatus('', '');
      renderRoom();
      await writeLiveSummary(state.room);
      return state.room;
    } catch (err) {
      if (!silent) setStatus(err.message || 'Kamer laden mislukt.','error');
      return null;
    }
  }

  function startPolling(){
    stopPolling();
    state.polling = global.setInterval(()=>{ if (state.roomCode) loadRoomState(state.roomCode, true); }, POLL_MS);
  }
  function stopPolling(){ if (state.polling) global.clearInterval(state.polling); state.polling = 0; }

  async function createRoom(formData){
    if (state.createInFlight) return;
    state.createInFlight = true;
    setStatus('Kamer aanmaken…','info');
    try {
      const wager = clamp(num(formData.get('wager_bakken'),0), 1, MAX_WAGER);
      const selectedSuit = String(formData.get('selected_suit') || '').toLowerCase();
      if (!SUITS.includes(selectedSuit)) throw new Error('Kies precies één paard.');
      const room = await callRpc('paardenrace_create_room_scoped', { session_token: sessionToken(), site_scope_input: currentScope() });
      const code = room?.room_code || room?.room?.room_code || '';
      if (!code) throw new Error('Geen room_code ontvangen.');
      await callRpc('paardenrace_update_selection_scoped', { room_code_input: code, session_token: sessionToken(), selected_suit_input: selectedSuit, wager_bakken_input: wager, site_scope_input: currentScope() });
      state.roomCode = code;
      global.history.replaceState({}, '', roomUrl(code));
      closeSetup();
      await loadRoomState(code);
      setStatus('Kamer klaar. Deel de code en laat iedereen gereed melden.','ok');
      startPolling();
    } catch (err) {
      setStatus(err.message || 'Aanmaken mislukt.','error');
    } finally {
      state.createInFlight = false;
    }
  }

  async function joinRoom(formData){
    if (state.createInFlight) return;
    state.createInFlight = true;
    setStatus('Kamer joinen…','info');
    try {
      const roomCode = String(formData.get('room_code') || '').trim().toUpperCase();
      const wager = clamp(num(formData.get('wager_bakken'),0), 1, MAX_WAGER);
      const selectedSuit = String(formData.get('selected_suit') || '').toLowerCase();
      if (!roomCode) throw new Error('Vul een room code in.');
      if (!SUITS.includes(selectedSuit)) throw new Error('Kies precies één paard.');
      await callRpc('paardenrace_join_room_scoped', { room_code_input: roomCode, session_token: sessionToken(), site_scope_input: currentScope() });
      await callRpc('paardenrace_update_selection_scoped', { room_code_input: roomCode, session_token: sessionToken(), selected_suit_input: selectedSuit, wager_bakken_input: wager, site_scope_input: currentScope() });
      state.roomCode = roomCode;
      global.history.replaceState({}, '', roomUrl(roomCode));
      closeSetup();
      await loadRoomState(roomCode);
      setStatus('Je zit in de kamer.','ok');
      startPolling();
    } catch (err) {
      setStatus(err.message || 'Joinen mislukt.','error');
    } finally {
      state.createInFlight = false;
    }
  }

  async function setReady(value){
    if (!state.roomCode) return;
    try {
      setStatus(value ? 'Klaar melden…' : 'Klaarstatus verwijderen…','info');
      await callRpc('paardenrace_set_ready_scoped', { room_code_input: state.roomCode, session_token: sessionToken(), ready_input: !!value, site_scope_input: currentScope() });
      await callRpc('paardenrace_start_if_ready_scoped', { room_code_input: state.roomCode, session_token: sessionToken(), site_scope_input: currentScope() }).catch(()=>null);
      await loadRoomState(state.roomCode);
    } catch (err) {
      setStatus(err.message || 'Ready status mislukt.','error');
    }
  }

  async function drawNext(){
    if (!state.roomCode) return;
    try {
      setStatus('Volgende kaart…','info');
      const room = await callRpc('paardenrace_draw_next_card_scoped', { room_code_input: state.roomCode, session_token: sessionToken(), site_scope_input: currentScope() });
      state.room = room || state.room;
      renderRoom();
      await writeLiveSummary(state.room);
      setStatus('', '');
      if ((state.room?.room_status || '') === 'nominations') maybeOpenNomination();
    } catch (err) {
      setStatus(err.message || 'Kaart trekken mislukt.','error');
    }
  }

  function maybeOpenNomination(){
    const dialog = document.getElementById('prNominationDialog');
    if (!dialog || !state.room) return;
    const result = state.room.result || {};
    if (!result.can_nominate) return;
    dialog.innerHTML = nominationHtml(state.room);
    const form = dialog.querySelector('#prNominationFormInner');
    const cancel = dialog.querySelector('#prNomCancel');
    if (cancel) cancel.addEventListener('click', ()=>dialog.close());
    if (form) form.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      try {
        const assignments = {};
        let total = 0;
        form.querySelectorAll('input[data-target]').forEach((input)=>{
          const value = clamp(num(input.value,0),0,999);
          if (value > 0) assignments[input.getAttribute('data-target')] = value;
          total += value;
        });
        const budget = num((state.room?.result || {}).nomination_budget_bakken, 0);
        if (total !== budget) throw new Error(`Verdeel exact ${budget} Bakken.`);
        await callRpc('paardenrace_submit_nominations_scoped', { room_code_input: state.roomCode, session_token: sessionToken(), assignments_input: assignments, site_scope_input: currentScope() });
        dialog.close();
        await loadRoomState(state.roomCode);
      } catch (err) {
        setStatus(err.message || 'Nominaties opslaan mislukt.','error');
      }
    });
    if (!dialog.open) dialog.showModal();
  }

  function closeSetup(){
    const dialog = document.getElementById('prSetupDialog');
    if (dialog && dialog.open) dialog.close();
  }

  function setupDialogHtml(prefilledCode){
    return `<form method="dialog" id="prSetupForm" class="pr-setup-form">
      <h3>Start of join Paardenrace</h3>
      <p>Voer je inzet in, kies één paard en maak een kamer aan of join een bestaande kamer.</p>
      <div class="pr-field-grid">
        <label><span>Room code</span><input name="room_code" type="text" maxlength="8" value="${esc(prefilledCode || '')}" placeholder="Bijv. HAR749"></label>
        <label><span>Inzet (Bakken)</span><input name="wager_bakken" type="number" min="1" max="${MAX_WAGER}" step="1" value="1" required></label>
      </div>
      <div class="pr-suit-grid">${SUITS.map((s)=>`<label class="pr-suit-option"><input type="radio" name="selected_suit" value="${s}" ${s==='hearts'?'checked':''}><span>${esc(SUIT_META[s].label)}</span></label>`).join('')}</div>
      <div class="pr-dialog-actions">
        <button type="button" id="prJoinBtn">Room joinen</button>
        <button type="button" class="primary" id="prCreateBtn">Nieuwe room maken</button>
      </div>
    </form>`;
  }

  function openSetup(prefilledCode){
    const dialog = document.getElementById('prSetupDialog');
    if (!dialog) return;
    dialog.innerHTML = setupDialogHtml(prefilledCode || '');
    const form = dialog.querySelector('#prSetupForm');
    const joinBtn = dialog.querySelector('#prJoinBtn');
    const createBtn = dialog.querySelector('#prCreateBtn');
    if (joinBtn) joinBtn.addEventListener('click', ()=>joinRoom(new FormData(form)));
    if (createBtn) createBtn.addEventListener('click', ()=>createRoom(new FormData(form)));
    if (!dialog.open) dialog.showModal();
  }

  function updateActionButtons(room){
    const viewer = viewerPlayer(room);
    const actions = document.getElementById('prActions');
    if (!actions) return;
    const stage = String(room?.room_status || room?.match?.stage || 'lobby');
    const canDraw = stage === 'race';
    const readyState = !!viewer?.ready;
    actions.innerHTML = `
      <button class="pr-btn" id="prEditSelectionBtn">Keuze wijzigen</button>
      <button class="pr-btn ${readyState?'alt':''}" id="prReadyBtn">${readyState ? 'Niet klaar' : 'Klaar melden'}</button>
      <button class="pr-btn primary" id="prDrawBtn" ${canDraw ? '' : 'disabled'}>Volgende kaart</button>
      <button class="pr-btn" id="prRefreshBtn">Ververs</button>
    `;
    const editBtn = document.getElementById('prEditSelectionBtn');
    const readyBtn = document.getElementById('prReadyBtn');
    const drawBtn = document.getElementById('prDrawBtn');
    const refreshBtn = document.getElementById('prRefreshBtn');
    if (editBtn) editBtn.addEventListener('click', ()=>openSetup(state.roomCode || room?.room_code || ''));
    if (readyBtn) readyBtn.addEventListener('click', ()=>setReady(!readyState));
    if (drawBtn) drawBtn.addEventListener('click', drawNext);
    if (refreshBtn) refreshBtn.addEventListener('click', ()=>loadRoomState(state.roomCode));
  }

  function renderRoom(){
    const room = state.room || {};
    setHtml('prRoomMeta', roomMetaHtml(room));
    setHtml('prPlayerList', playerListHtml(room));
    setHtml('prDrawInfo', drawInfoHtml(room));
    setHtml('prResultPanel', resultPanelHtml(room));
    updateActionButtons(room);
    renderBoard(room, { showLastCard:true });
    if ((room?.room_status || '') === 'nominations' && (room?.result || {}).can_nominate) maybeOpenNomination();
  }

  async function initRoomPage(){
    state.page = 'room';
    state.canvas = document.getElementById('prBoard');
    await ensureImages().catch((err)=>setStatus(err.message || 'Assets laden mislukt.','error'));
    const params = pageParams();
    const roomCode = String(params.get('room') || '').trim().toUpperCase();
    if (!sessionToken()) setStatus('Log eerst in om mee te doen aan paardenrace.','error');
    if (roomCode) {
      const loaded = await loadRoomState(roomCode);
      if (!loaded) openSetup(roomCode); else startPolling();
    } else {
      openSetup('');
      renderBoard({ players:[], match:{ horse_positions:{ hearts:0, diamonds:0, clubs:0, spades:0 }, gate_cards:[], revealed_gate_cards:[] } }, { showLastCard:false });
    }
  }

  function liveSummaryMeta(item){
    const summary = item?.summary || item?.summary_payload || {};
    const players = Array.isArray(summary?.players) ? summary.players : [];
    return `<div class="pr-live-grid">
      <div><strong>Kamer</strong><span>${esc(summary.room_code || item?.match_ref || '—')}</span></div>
      <div><strong>Status</strong><span>${esc(summary.live_state?.status || '—')}</span></div>
      <div><strong>Spelers</strong><span>${players.map((p)=>p.name).join(', ') || (Array.isArray(summary.participants) ? summary.participants.join(', ') : '—')}</span></div>
      <div><strong>Laatste update</strong><span>${esc(fmtDate(summary.live_state?.updated_at || item?.updated_at))}</span></div>
    </div>`;
  }

  async function renderLiveFromItem(item){
    const summary = item?.summary || item?.summary_payload || {};
    const room = {
      room_code: summary.room_code || item?.match_ref || '',
      room_status: summary.live_state?.status || (item?.finished_at ? 'finished' : 'race'),
      updated_at: summary.live_state?.updated_at || item?.updated_at,
      players: (Array.isArray(summary.players) ? summary.players : []).map((p)=>({ display_name:p.name, selected_suit:p.suit, wager_bakken:p.wager_bakken, ready:p.ready })),
      match: {
        stage: summary.live_state?.status || 'race',
        gate_cards: summary.gate_cards || [],
        revealed_gate_cards: summary.revealed_gate_cards || [],
        horse_positions: summary.horse_positions || {},
        draw_index: summary.draw_index || 0,
        draw_deck: new Array(summary.draw_total || 0).fill(null),
        last_drawn_card: summary.last_drawn_card || '',
        first_finish_suit: summary.first_finish_suit || '',
        first_claimed_finish_suit: summary.first_claimed_finish_suit || '',
        winner_names: summary.winner_names || []
      },
      result: summary.summary || {}
    };
    state.room = room;
    renderBoard(room, { showLastCard:true });
    setHtml('prLiveMeta', liveSummaryMeta(item));
    setHtml('prLiveResult', resultPanelHtml(room));
  }

  async function refreshLive(){
    try {
      const params = pageParams();
      const matchRef = params.get('match_ref') || '';
      const clientMatchId = params.get('client_match_id') || matchRef || '';
      const helper = liveSummary();
      if (!helper || typeof helper.loadPublicSummary !== 'function') throw new Error('Live summary helper ontbreekt.');
      const item = await helper.loadPublicSummary('paardenrace', { matchRef, clientMatchId, siteScope: currentScope() });
      await renderLiveFromItem(item || {});
      setStatus('','');
    } catch (err) {
      setStatus(err.message || 'Live pagina laden mislukt.','error');
    }
  }

  async function initLivePage(){
    state.page = 'live';
    state.canvas = document.getElementById('prLiveBoard');
    await ensureImages().catch((err)=>setStatus(err.message || 'Assets laden mislukt.','error'));
    await refreshLive();
    if (state.livePoll) global.clearInterval(state.livePoll);
    state.livePoll = global.setInterval(refreshLive, POLL_MS);
  }

  function ladderRowHtml(row, idx){
    const name = row.player_name || row.display_name || 'Speler';
    return `<div class="pr-stand-row">
      <div class="rank">${idx+1}</div>
      <div class="name"><a href="${ensurePageScope(`./player.html?player=${encodeURIComponent(name)}&game=paardenrace`)}">${esc(name)}</a><span>${num(row.wins,0)} zeges · ${num(row.matches_played,0)} potjes</span></div>
      <div class="elo">${Math.round(num(row.elo_rating,1000))}</div>
    </div>`;
  }

  function recentMatchHtml(row){
    const winners = Array.isArray(row.winner_names) ? row.winner_names.join(', ') : '—';
    return `<details class="pr-recent-item"><summary><span>${esc(row.recap_text || 'Paardenrace')}</span><span>${esc(fmtDate(row.finished_at || row.created_at))}</span></summary><div class="pr-recent-body"><div>Winnaars: ${esc(winners)}</div><div>Match ref: ${esc(row.match_ref || '—')}</div></div></details>`;
  }

  async function initStatsPage(){
    try {
      const data = await callRpc('paardenrace_get_public_ladder_scoped', { site_scope_input: currentScope() });
      const ladder = Array.isArray(data?.ladder) ? data.ladder : [];
      const recent = Array.isArray(data?.recent_matches) ? data.recent_matches : [];
      setHtml('prStatsLadder', ladder.length ? ladder.map(ladderRowHtml).join('') : '<div class="pr-empty">Nog geen paardenrace-ladderdata.</div>');
      setHtml('prStatsRecent', recent.length ? recent.map(recentMatchHtml).join('') : '<div class="pr-empty">Nog geen gespeelde paardenraces.</div>');
    } catch (err) {
      setHtml('prStatsLadder', `<div class="pr-empty">${esc(err.message || 'Stats laden mislukt.')}</div>`);
      setHtml('prStatsRecent', '<div class="pr-empty">Nog geen recente paardenraces.</div>');
    }
  }

  function boot(){
    const page = document.body?.getAttribute('data-pr-page') || document.documentElement?.getAttribute('data-pr-page') || '';
    if (!page) return;
    if (page === 'room') initRoomPage();
    else if (page === 'live') initLivePage();
    else if (page === 'stats') initStatsPage();
  }

  global.GEJAST_PAARDENRACE = {
    SUITS,
    SUIT_META,
    renderBoard,
    ensureImages,
    callRpc,
    loadRoomState,
    initRoomPage,
    initLivePage,
    initStatsPage,
    summaryFromRoom
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})(window);
