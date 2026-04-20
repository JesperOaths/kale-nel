(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const STORAGE_KEY = 'gejast_paardenrace_room_code_v506';
  const LIVE_QUERY_KEY = 'live';
  const SUITS = ['spades','hearts','clubs','diamonds'];
  const SUIT_META = {
    hearts: { label:'♥ Harten', symbol:'♥', color:'#a11f35' },
    diamonds: { label:'♦ Ruiten', symbol:'♦', color:'#a11f35' },
    clubs: { label:'♣ Klaveren', symbol:'♣', color:'#1f1b1a' },
    spades: { label:'♠ Schoppen', symbol:'♠', color:'#1f1b1a' }
  };

  function scope(){
    try { if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.getScope === 'function') return window.GEJAST_SCOPE_UTILS.getScope(); } catch(_){}
    try { return new URLSearchParams(window.location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch(_){}
    return 'friends';
  }
  function scopedHref(path){
    try {
      const url = new URL(path, window.location.href);
      if (scope() === 'family') url.searchParams.set('scope', 'family');
      return `${url.pathname.split('/').pop()}${url.search}${url.hash}`;
    } catch (_) { return path; }
  }
  function sessionToken(){ return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; }
  async function rpc(fn, args={}, options={}){
    const token = sessionToken();
    const body = Object.assign({}, args, { session_token: token || null, session_token_input: token || null });
    const controller = new AbortController();
    const timeoutMs = Math.max(900, Number(options.timeoutMs || 3600));
    const timer = setTimeout(()=>controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method:'POST',
        headers:{
          apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '',
          Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`,
          'Content-Type':'application/json',
          Accept:'application/json',
          'Cache-Control':'no-store, no-cache, max-age=0',
          Pragma:'no-cache'
        },
        cache:'no-store', mode:'cors', body: JSON.stringify(body), signal: controller.signal
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch(_) { data = text; }
      if (!res.ok) {
        const msg = data && typeof data === 'object' ? (data.message || data.error || data.details || data.hint || JSON.stringify(data)) : (text || `HTTP ${res.status}`);
        throw new Error(msg);
      }
      return data && data[fn] !== undefined ? data[fn] : data;
    } catch(err) {
      if (err && (err.name === 'AbortError' || /abort/i.test(String(err)))) throw new Error('timeout');
      throw err;
    } finally { clearTimeout(timer); }
  }

  function getStoredRoomCode(){ return localStorage.getItem(STORAGE_KEY) || ''; }
  function setStoredRoomCode(code){ if (code) localStorage.setItem(STORAGE_KEY, String(code).trim().toUpperCase()); }
  function clearStoredRoomCode(){ localStorage.removeItem(STORAGE_KEY); }
  function suitLabel(s){ return (SUIT_META[String(s||'').toLowerCase()] || {}).label || '—'; }
  function suitSymbol(s){ return (SUIT_META[String(s||'').toLowerCase()] || {}).symbol || '•'; }
  function suitColor(s){ return (SUIT_META[String(s||'').toLowerCase()] || {}).color || '#1f1b1a'; }
  function liveHref(room){
    const code = encodeURIComponent(String(room||'').trim().toUpperCase());
    const url = new URL('./paardenrace_live.html', window.location.href);
    url.searchParams.set('room', code);
    url.searchParams.set(LIVE_QUERY_KEY, code);
    if (scope() === 'family') url.searchParams.set('scope', 'family');
    return `${url.pathname.split('/').pop()}${url.search}`;
  }
  function gotoLive(room, options={}){ const href = liveHref(room); if (options.replace) window.location.replace(href); else window.location.href = href; }

  function parseCard(cardCode=''){
    const raw = String(cardCode || '').trim().toUpperCase();
    const match = raw.match(/^(10|[2-9JQKA])([HDCS])$/);
    if (!match) return { rank: raw || '—', suitKey:'', symbol:'•', isRed:false, raw };
    const rank = match[1];
    const suitKey = ({ H:'hearts', D:'diamonds', C:'clubs', S:'spades' })[match[2]] || '';
    return { rank, suitKey, symbol:suitSymbol(suitKey), isRed: suitKey === 'hearts' || suitKey === 'diamonds', raw };
  }
  function renderFaceUpCard(cardCode, extraClass=''){
    const parsed = parseCard(cardCode);
    const tint = parsed.isRed ? ' red' : '';
    return `<div class="pr-open-card${tint}${extraClass ? ` ${extraClass}` : ''}"><div class="pr-open-card-corner top">${parsed.rank}<span>${parsed.symbol}</span></div><div class="pr-open-card-center">${parsed.symbol}</div><div class="pr-open-card-corner bottom">${parsed.rank}<span>${parsed.symbol}</span></div></div>`;
  }
  function renderCardBack(extraClass=''){ return `<div class="pr-card-back${extraClass ? ` ${extraClass}` : ''}"><span>GEJAST</span></div>`; }
  function getDrawRemaining(match){ const deck = Array.isArray(match?.draw_deck) ? match.draw_deck : []; const idx = Number(match?.draw_index || 0); return Math.max(0, deck.length - idx); }
  function resolvedGateSet(match){
    const source = Array.isArray(match?.resolved_gates) && match.resolved_gates.length
      ? match.resolved_gates
      : (Array.isArray(match?.revealed_gates) ? match.revealed_gates : []);
    return new Set(source.map(Number));
  }
  function normalizedGateEvents(match){ return Array.isArray(match?.gate_events) ? match.gate_events : []; }
  function gateEventMap(match){
    const map = new Map();
    normalizedGateEvents(match).forEach((row)=>{
      const no = Number(row?.gate_no || 0);
      if (!no) return;
      map.set(no, row);
    });
    return map;
  }
  function getGridColumnForProgress(progress){ const value = Number(progress || 0); if (value <= 0) return 0; if (value >= 11) return 11; return value; }
  function horseMarker(suit){ return `<span class="pr-horse-token" style="color:${suitColor(suit)}">${suitSymbol(suit)}</span>`; }
  function compactGateCard(cardCode, resolved){
    if (!resolved) return `<div class="pr-gate-mini pr-gate-mini--back"></div>`;
    const parsed = parseCard(cardCode);
    return `<div class="pr-gate-mini ${parsed.isRed ? 'red' : ''}" title="${suitLabel(parsed.suitKey)}"><span>${parsed.symbol}</span></div>`;
  }
  function gateSuitCaption(cardCode, resolved, eventRow=null){
    if (!resolved) return '<div class="pr-gate-suit-caption">Dicht</div>';
    const parsed = parseCard(cardCode);
    const stepSuit = String(eventRow?.suit || parsed.suitKey || '').toLowerCase();
    const stepText = stepSuit ? ` · ${suitSymbol(stepSuit)} -1` : '';
    return `<div class="pr-gate-suit-caption ${parsed.isRed ? 'red' : ''}">${parsed.symbol} ${suitLabel(parsed.suitKey).replace(/^[♥♦♣♠]\s*/, '')}${stepText}</div>`;
  }
  function renderRaceMinimap(match){
    if (!match || !match.horse_positions) return '<div class="pr-minimap-empty">Wachten op racebord…</div>';
    const positions = match.horse_positions || {};
    const gates = Array.isArray(match.gate_cards) ? match.gate_cards : [];
    const resolved = resolvedGateSet(match);
    const events = gateEventMap(match);
    const gateCells = Array.from({ length: 12 }, (_, col)=>{
      if (col === 0 || col === 11) return '<span class="pr-minimap-cell pr-minimap-cell--blank"></span>';
      const gateNo = col;
      const row = events.get(gateNo) || null;
      const title = row?.suit ? `${suitLabel(row.suit)} gaat 1 terug` : '';
      return `<span class="pr-minimap-cell pr-minimap-gate-cell" title="${title}">${compactGateCard(gates[gateNo - 1] || '', resolved.has(gateNo))}</span>`;
    }).join('');
    const gateRow = `<div class="pr-minimap-row pr-minimap-row--gates"><div class="pr-minimap-label">G</div><div class="pr-minimap-track">${gateCells}</div></div>`;
    const suitRows = SUITS.map((suit)=>{
      const progress = Math.max(0, Math.min(11, Number(positions[suit] || 0)));
      const cells = Array.from({ length: 12 }, (_, col)=>{
        const classes = ['pr-minimap-cell'];
        if (col === 0) classes.push('is-start');
        if (col === 11) classes.push('is-finish');
        const horse = progress === col ? `<span class="pr-minimap-horse" style="color:${suitColor(suit)}">${suitSymbol(suit)}</span>` : '';
        return `<span class="${classes.join(' ')}">${horse}</span>`;
      }).join('');
      return `<div class="pr-minimap-row" data-suit="${suit}"><div class="pr-minimap-label" style="color:${suitColor(suit)}">${suitSymbol(suit)}</div><div class="pr-minimap-track">${cells}</div></div>`;
    }).join('');
    return `<div class="pr-minimap">${gateRow}${suitRows}</div>`;
  }
  function renderTrackRow(suit, progress){
    const cells = Array.from({ length: 12 }, (_, col)=>{
      const classes = ['pr-track-cell'];
      if (col === 0) classes.push('is-start');
      if (col === 11) classes.push('is-finish');
      const marker = col === progress ? horseMarker(suit) : '';
      return `<div class="${classes.join(' ')}" data-col="${col}">${marker}</div>`;
    }).join('');
    return `<div class="pr-board-row"><div class="pr-board-label" style="color:${suitColor(suit)}">${suitSymbol(suit)}</div><div class="pr-board-track">${cells}</div></div>`;
  }
  function liveBoardFingerprint(match){
    return JSON.stringify({
      last: match?.last_draw_card || '',
      winner: match?.winner_suit || '',
      positions: match?.horse_positions || {},
      gates: match?.gate_cards || [],
      resolved: Array.from(resolvedGateSet(match).values()),
      drawIndex: Number(match?.draw_index || 0),
      stage: String(match?.stage || ''),
      events: normalizedGateEvents(match)
    });
  }
  function renderLiveBoard(match){
    if (!match || !match.horse_positions) return '<div class="pr-live-placeholder">Wachten op countdown of race-start.</div>';
    const positions = match.horse_positions || {};
    const gates = Array.isArray(match.gate_cards) ? match.gate_cards : [];
    const resolved = resolvedGateSet(match);
    const events = gateEventMap(match);
    const remaining = getDrawRemaining(match);
    const lastCard = match.last_draw_card || '';
    const gateRow = Array.from({ length: 10 }, (_, idx)=>{
      const gateNo = idx + 1;
      const isResolved = resolved.has(gateNo);
      const card = gates[idx] || '';
      const eventRow = events.get(gateNo) || null;
      return `<div class="pr-board-gate-slot"><div class="pr-board-gate-stack">${isResolved ? renderFaceUpCard(card, 'pr-board-gate-face') : renderCardBack('pr-board-gate-back')}${gateSuitCaption(card, isResolved, eventRow)}</div></div>`;
    }).join('');
    const trackRows = SUITS.map((suit)=>renderTrackRow(suit, getGridColumnForProgress(positions[suit]))).join('');
    return `<div class="pr-live-wrap"><div class="pr-board-topline"><div class="pr-board-kpi"><span>Kaarten over</span><strong>${remaining}</strong></div><div class="pr-board-kpi"><span>Gates open</span><strong>${resolved.size}/10</strong></div><div class="pr-board-kpi pr-board-kpi--card"><span>Laatste kaart</span><div class="pr-board-lastcard">${lastCard ? renderFaceUpCard(lastCard, 'pr-last-card') : '<div class="pr-last-card-empty">—</div>'}</div></div></div><div class="pr-board-shell-lite"><div class="pr-board-gates"><div class="pr-board-label pr-board-label--gate">G</div><div class="pr-board-gate-track">${gateRow}</div></div><div class="pr-board-rows">${trackRows}</div></div></div>`;
  }
  function summarizeLiveRoom(room, match, players, viewer){
    const verified = (Array.isArray(players) ? players : []).filter((p)=>p && p.wager_verified).length;
    const ready = (Array.isArray(players) ? players : []).filter((p)=>p && p.is_ready).length;
    const totalPot = (Array.isArray(players) ? players : []).reduce((sum, p)=>sum + Number(p?.wager_bakken || 0), 0);
    const pendingGate = Math.max(0, 10 - resolvedGateSet(match).size);
    const winnerSuit = String(match?.winner_suit || '').trim().toLowerCase();
    const drawCard = String(match?.last_draw_card || '').trim().toUpperCase();
    const deckLeft = getDrawRemaining(match);
    const stage = String(room?.stage || 'lobby');
    const latestGateEvent = normalizedGateEvents(match).length ? normalizedGateEvents(match)[normalizedGateEvents(match).length - 1] : null;
    const headline = winnerSuit ? `${suitLabel(winnerSuit)} heeft gewonnen`
      : stage === 'countdown' ? `Countdown ${Number(room?.countdown_remaining_seconds || 0)}s`
      : stage === 'nominations' ? 'Verdeel nu de nominaties'
      : stage === 'finished' ? 'Race afgerond'
      : drawCard ? `Laatste kaart: ${drawCard}`
      : 'Klaar voor de volgende kaart';
    const subline = latestGateEvent?.suit
      ? `Gate ${latestGateEvent.gate_no} open · ${suitLabel(latestGateEvent.suit)} gaat 1 terug`
      : winnerSuit
        ? `Totale pot ${totalPot} Bakken · ${deckLeft} kaarten over`
        : `${verified}/${(players || []).length || 0} verified · ${ready}/${(players || []).length || 0} ready · ${pendingGate} gates nog dicht`;
    return { headline, subline, totalPot, verified, ready, pendingGate, winnerSuit, deckLeft, drawCard, stage, isHost: !!viewer?.is_host };
  }

  window.GEJAST_PAARDENRACE = {
    rpc, sessionToken, getStoredRoomCode, setStoredRoomCode, clearStoredRoomCode,
    suitLabel, suitSymbol, suitColor, parseCard, renderFaceUpCard, renderCardBack,
    renderRaceMinimap, renderLiveBoard, summarizeLiveRoom,
    gotoLive, liveHref, scopedHref, scope,
    getDrawRemaining, resolvedGateSet, normalizedGateEvents, gateEventMap, getGridColumnForProgress, liveBoardFingerprint
  };
})();