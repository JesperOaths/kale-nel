(function(){
  // Wave 5 mobile hardening: shared helpers used by the live presenter remain centralized here.
  const cfg = window.GEJAST_CONFIG || {};
  const STORAGE_KEY = 'gejast_paardenrace_room_code_v478';
  const LIVE_QUERY_KEY = 'live';
  const ASSETS = {
    arena: './paardenrace-live-board-v447.png',
    cardBack: './paardenrace-card-back.png',
    horses: {
      hearts: './paardenrace-ace-hearts-v449.png',
      diamonds: './paardenrace-ace-diamonds-v449.png',
      clubs: './paardenrace-ace-clubs-v449.png',
      spades: './paardenrace-ace-spades-v449.png'
    }
  };
  const SUITS = ['spades','hearts','clubs','diamonds'];
  const SUIT_META = {
    hearts: { label:'♥ Harten', symbol:'♥', color:'#a11f35' },
    diamonds: { label:'♦ Ruiten', symbol:'♦', color:'#a11f35' },
    clubs: { label:'♣ Klaveren', symbol:'♣', color:'#1f1b1a' },
    spades: { label:'♠ Schoppen', symbol:'♠', color:'#1f1b1a' }
  };
  const BOARD_CALIBRATION = {
    imageWidth: 1536,
    imageHeight: 1024,
    gateLeftPct: 18.23,
    gateTopPct: 17.09,
    gateWidthPct: 63.48,
    gateHeightPct: 17.68,
    trackLeftPct: 8.72,
    trackTopPct: 34.77,
    trackWidthPct: 82.50,
    trackHeightPct: 50.49,
    trackColumns: '1.5fr repeat(10, minmax(0, 1fr)) 1.5fr',
    horseCardWidthPct: 74,
    gateCardWidthPct: 72,
    deckLeftPct: 5.55,
    deckTopPct: 8.75,
    deckWidthPct: 7.7,
    discardRightPct: 9.25,
    discardTopPct: 16.2,
    discardWidthPct: 5.7
  };

  function scope(){
    try {
      if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.getScope === 'function'){
        return window.GEJAST_SCOPE_UTILS.getScope();
      }
    } catch(_){}
    try {
      return new URLSearchParams(window.location.search).get('scope') === 'family' ? 'family' : 'friends';
    } catch(_){}
    return 'friends';
  }
  function scopedHref(path){
    const url = new URL(path, window.location.href);
    if (scope() === 'family') url.searchParams.set('scope', 'family');
    return `${url.pathname.split('/').pop()}${url.search}`;
  }

  function sessionToken(){ return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; }
  async function rpc(fn, args={}){
    const token = sessionToken();
    const body = Object.assign({}, args, { session_token: token || null, session_token_input: token || null });
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method:'POST',
      headers:{
        'apikey': cfg.SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type':'application/json',
        'Accept':'application/json',
        'Cache-Control':'no-store, no-cache, max-age=0',
        'Pragma':'no-cache'
      },
      cache:'no-store',
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch(_) { data = text; }
    if(!res.ok){
      const msg = data && typeof data === 'object' ? (data.message || data.error || data.hint || JSON.stringify(data)) : (text || 'Onbekende fout');
      throw new Error(msg);
    }
    return data;
  }
  function getStoredRoomCode(){ return localStorage.getItem(STORAGE_KEY) || ''; }
  function setStoredRoomCode(code){ if(code) localStorage.setItem(STORAGE_KEY, String(code).trim().toUpperCase()); }
  function clearStoredRoomCode(){ localStorage.removeItem(STORAGE_KEY); }
  function suitLabel(s){ return (SUIT_META[String(s||'').toLowerCase()] || {}).label || '—'; }
  function suitSymbol(s){ return (SUIT_META[String(s||'').toLowerCase()] || {}).symbol || '•'; }
  function suitColor(s){ return (SUIT_META[String(s||'').toLowerCase()] || {}).color || '#333'; }
  function horseAsset(suit){ return ASSETS.horses[suit] || ASSETS.horses.hearts; }

  function liveHref(room){
    const code = encodeURIComponent(String(room||'').trim().toUpperCase());
    const url = new URL('./paardenrace_live.html', window.location.href);
    url.searchParams.set('room', code);
    url.searchParams.set(LIVE_QUERY_KEY, code);
    if (scope() === 'family') url.searchParams.set('scope', 'family');
    return `${url.pathname.split('/').pop()}${url.search}`;
  }
  function gotoLive(room, options={}){ const href = liveHref(room); if(options.replace) window.location.replace(href); else window.location.href = href; }

  function parseCard(cardCode=''){
    const raw = String(cardCode || '').trim().toUpperCase();
    const match = raw.match(/^(10|[2-9JQKA])([HDCS])$/);
    if(!match){ return { rank: raw || '—', suitKey: '', symbol: '•', isRed: false, raw }; }
    const rank = match[1];
    const suitKey = ({ H:'hearts', D:'diamonds', C:'clubs', S:'spades' })[match[2]] || '';
    const symbol = suitSymbol(suitKey);
    const isRed = suitKey === 'hearts' || suitKey === 'diamonds';
    return { rank, suitKey, symbol, isRed, raw };
  }
  function renderFaceUpCard(cardCode, extraClass=''){
    const parsed = parseCard(cardCode);
    const tint = parsed.isRed ? ' red' : '';
    return `
      <div class="pr-open-card${tint}${extraClass ? ` ${extraClass}` : ''}">
        <div class="pr-open-card-corner top">${parsed.rank}<span>${parsed.symbol}</span></div>
        <div class="pr-open-card-center">${parsed.symbol}</div>
        <div class="pr-open-card-corner bottom">${parsed.rank}<span>${parsed.symbol}</span></div>
      </div>
    `;
  }
  function renderCardBack(extraClass=''){
    return `<img src="${ASSETS.cardBack}" alt="Kaart achterkant" class="pr-card-back${extraClass ? ` ${extraClass}` : ''}">`;
  }
  function aceHorseCard(suit){
    const src = horseAsset(suit);
    return `<img src="${src}" alt="${suitLabel(suit)} aas" class="pr-ace-card" draggable="false">`;
  }
  function getDrawRemaining(match){
    const deck = Array.isArray(match?.draw_deck) ? match.draw_deck : [];
    const idx = Number(match?.draw_index || 0);
    return Math.max(0, deck.length - idx);
  }
  function resolvedGateSet(match){ return new Set(Array.isArray(match?.resolved_gates) ? match.resolved_gates.map(Number) : []); }
  function getGridColumnForProgress(progress){
    if (progress <= 0) return 0;
    if (progress >= 11) return 11;
    return progress;
  }

  function renderLiveBoard(match){
    if(!match || !match.horse_positions){
      return '<div class="pr-live-placeholder">Wachten op countdown of race-start.</div>';
    }
    const pos = match.horse_positions || {};
    const gates = Array.isArray(match.gate_cards) ? match.gate_cards : [];
    const resolved = resolvedGateSet(match);
    const remaining = getDrawRemaining(match);
    const discardCard = match.last_draw_card || '';
    const deckLayers = remaining > 0
      ? [0,1,2].map((i)=>`<div class="pr-stack-card" style="transform:translate(${i * -3}px, ${i * 3}px)">${renderCardBack('pr-deck-back')}</div>`).join('')
      : '';

    const gateHtml = Array.from({length:10}, (_, idx)=>{
      const gateNo = idx + 1;
      const isResolved = resolved.has(gateNo);
      const inner = isResolved ? renderFaceUpCard(gates[idx] || '', 'pr-gate-face') : renderCardBack('pr-gate-back');
      return `<div class="pr-gate-slot ${isResolved ? 'is-revealed' : 'is-facedown'}" data-gate-no="${gateNo}" data-resolved="${isResolved}">${inner}</div>`;
    }).join('');

    const laneHtml = SUITS.map((suit)=>{
      const raw = Number(pos[suit] || 0);
      const idx = Math.max(0, Math.min(11, raw));
      const cells = Array.from({length:12}, (_, col)=>{
        const classes = ['pr-track-cell'];
        if(col === 0) classes.push('is-start');
        if(col === 11) classes.push('is-finish');
        const horse = col === idx ? `<div class="pr-horse-slot" data-suit="${suit}" data-progress="${idx}">${aceHorseCard(suit)}</div>` : '';
        return `<div class="${classes.join(' ')}" data-col="${col}" data-progress-cell="${col}">${horse}</div>`;
      }).join('');
      return `<div class="pr-lane-grid" data-lane="${suit}">${cells}</div>`;
    }).join('');

    return `
      <div class="pr-live-wrap" data-match-ref="${String(match.match_ref || '')}" data-draw-index="${Number(match.draw_index || 0)}">
        <div class="pr-live-stage" data-stage-root>
          <img src="${ASSETS.arena}" alt="Paardenrace bord" class="pr-live-arena">
          <div class="pr-overlay" style="--gate-left:${BOARD_CALIBRATION.gateLeftPct}%;--gate-top:${BOARD_CALIBRATION.gateTopPct}%;--gate-width:${BOARD_CALIBRATION.gateWidthPct}%;--gate-height:${BOARD_CALIBRATION.gateHeightPct}%;--track-left:${BOARD_CALIBRATION.trackLeftPct}%;--track-top:${BOARD_CALIBRATION.trackTopPct}%;--track-width:${BOARD_CALIBRATION.trackWidthPct}%;--track-height:${BOARD_CALIBRATION.trackHeightPct}%;--deck-left:${BOARD_CALIBRATION.deckLeftPct}%;--deck-top:${BOARD_CALIBRATION.deckTopPct}%;--deck-width:${BOARD_CALIBRATION.deckWidthPct}%;--discard-right:${BOARD_CALIBRATION.discardRightPct}%;--discard-top:${BOARD_CALIBRATION.discardTopPct}%;--discard-width:${BOARD_CALIBRATION.discardWidthPct}%">
            <canvas class="pr-fx-canvas" data-fx-canvas></canvas>
            <div class="pr-deck-zone"><div class="pr-deck-slot" data-deck-slot>${deckLayers}</div></div>
            <div class="pr-discard-zone"><div class="pr-discard-slot ${discardCard ? 'has-card' : ''}" data-discard-slot>${discardCard ? renderFaceUpCard(discardCard, 'pr-discard-face') : ''}</div></div>
            <div class="pr-gate-grid">${gateHtml}</div>
            <div class="pr-track-lanes">${laneHtml}</div>
            <div class="pr-animation-layer" data-animation-layer></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderRaceMinimap(match){
    if (!match || !match.horse_positions) return '<div class="pr-minimap-empty">Wachten op racebord…</div>';
    const positions = match.horse_positions || {};
    const rows = SUITS.map((suit)=>{
      const progress = Math.max(0, Math.min(11, Number(positions[suit] || 0)));
      const cells = Array.from({ length: 12 }, (_, col)=>{
        const classes = ['pr-minimap-cell'];
        if (col === 0) classes.push('is-start');
        if (col === 11) classes.push('is-finish');
        const horse = progress === col ? `<span class="pr-minimap-horse" style="color:${suitColor(suit)}">${suitSymbol(suit)}</span>` : '';
        return `<span class="${classes.join(' ')}">${horse}</span>`;
      }).join('');
      return `<div class="pr-minimap-row" data-suit="${suit}">
        <div class="pr-minimap-label">${suitSymbol(suit)}</div>
        <div class="pr-minimap-track">${cells}</div>
      </div>`;
    }).join('');
    return `<div class="pr-minimap">${rows}</div>`;
  }

  function summarizeLiveRoom(room, match, players, viewer){
    const verified = (Array.isArray(players) ? players : []).filter((p)=>p && p.wager_verified).length;
    const ready = (Array.isArray(players) ? players : []).filter((p)=>p && p.is_ready).length;
    const totalPot = (Array.isArray(players) ? players : []).reduce((sum, p)=>sum + Number(p?.wager_bakken || 0), 0);
    const pendingGate = Math.max(0, 10 - (Array.isArray(match?.resolved_gates) ? match.resolved_gates.length : 0));
    const winnerSuit = String(match?.winner_suit || '').trim().toLowerCase();
    const drawCard = String(match?.last_draw_card || '').trim().toUpperCase();
    const deckLeft = getDrawRemaining(match);
    const stage = String(room?.stage || 'lobby');
    const headline = winnerSuit
      ? `${suitLabel(winnerSuit)} heeft gewonnen`
      : stage === 'countdown'
        ? `Countdown ${Number(room?.countdown_remaining_seconds || 0)}s`
        : stage === 'nominations'
          ? 'Verdeel nu de Bakken'
          : stage === 'finished'
            ? 'Race afgerond'
            : drawCard
              ? `Laatste kaart: ${drawCard}`
              : 'Klaar voor de volgende kaart';
    const subline = winnerSuit
      ? `Totale pot ${totalPot} Bakken · draw deck ${deckLeft} kaarten over`
      : `${verified}/${(players || []).length || 0} verified · ${ready}/${(players || []).length || 0} ready · ${pendingGate} gates nog dicht`;
    return {
      headline,
      subline,
      totalPot,
      verified,
      ready,
      pendingGate,
      winnerSuit,
      deckLeft,
      drawCard,
      stage,
      isHost: !!viewer?.is_host
    };
  }

  window.GEJAST_PAARDENRACE = {
    rpc, sessionToken, getStoredRoomCode, setStoredRoomCode, clearStoredRoomCode,
    suitLabel, suitSymbol, suitColor, parseCard, renderFaceUpCard, renderCardBack, renderLiveBoard,
    renderRaceMinimap, summarizeLiveRoom,
    gotoLive, liveHref, scopedHref, scope, getDrawRemaining, resolvedGateSet, getGridColumnForProgress,
    getBoardPoints: ()=> JSON.parse(JSON.stringify(BOARD_CALIBRATION)), horseAsset, aceHorseCard, ASSETS
  };
})();