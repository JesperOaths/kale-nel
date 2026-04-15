(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const STORAGE_KEY = 'gejast_paardenrace_room_code_v454';
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
  const BOARD_POINTS = {
    stableLeftX: 10.75,
    stableTrackX: 16.88,
    trackX: [16.88, 21.28, 27.16, 33.02, 38.90, 44.78, 50.66, 56.54, 62.42, 68.30, 74.18, 88.92],
    gateX: [21.28, 27.16, 33.02, 38.90, 44.78, 50.66, 56.54, 62.42, 68.30, 74.18],
    laneY: { spades: 41.10, hearts: 55.86, clubs: 70.62, diamonds: 85.38 },
    deckX: 10.55,
    deckY: 17.55,
    discardX: 88.15,
    discardY: 23.55,
    gateY: 23.12,
    stableWidthPct: 11.8,
    strawWidthPct: 5.92,
    horseWidthPct: 6.18,
    gateWidthPct: 5.14,
    deckWidthPct: 5.65,
    discardWidthPct: 5.85
  };

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
    const data = text ? (()=>{ try { return JSON.parse(text); } catch { return text; } })() : null;
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
  function liveHref(room){ const code = encodeURIComponent(String(room||'').trim().toUpperCase()); return `./paardenrace_live.html?room=${code}&${LIVE_QUERY_KEY}=${code}`; }
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
    const src = ASSETS.horses[suit] || ASSETS.horses.hearts;
    return `<span class="pr-ace-frame"><img src="${src}" alt="${suitLabel(suit)} aas" class="pr-ace-card" draggable="false"></span>`;
  }
  function renderStartCover(suit='spades'){
    const meta = SUIT_META[suit] || SUIT_META.spades;
    return `<svg class="pr-start-cover" viewBox="0 0 311 410" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="strawBg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#fff2cf"/>
          <stop offset="55%" stop-color="#f0d59a"/>
          <stop offset="100%" stop-color="#d6b06d"/>
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="299" height="398" rx="24" fill="url(#strawBg)" stroke="rgba(109,72,18,.28)" stroke-width="4"/>
      <path d="M34 282 C88 235, 130 334, 188 264 S271 315, 286 256" fill="none" stroke="rgba(166,118,45,.38)" stroke-width="18" stroke-linecap="round"/>
      <path d="M26 208 C84 160, 140 240, 220 172 S277 222, 294 196" fill="none" stroke="rgba(216,181,94,.48)" stroke-width="12" stroke-linecap="round"/>
      <path d="M24 330 C108 266, 158 372, 286 318" fill="none" stroke="rgba(255,238,177,.38)" stroke-width="10" stroke-linecap="round"/>
      <circle cx="156" cy="132" r="42" fill="rgba(255,248,227,.95)" stroke="${meta.color}" stroke-width="5"/>
      <text x="156" y="147" text-anchor="middle" font-family="Georgia, serif" font-size="48" font-weight="700" fill="${meta.color}">${meta.symbol}</text>
      <text x="156" y="188" text-anchor="middle" font-family="Inter, sans-serif" font-size="22" font-weight="800" fill="rgba(91,61,24,.72)">STAL</text>
    </svg>`;
  }
  function getDrawRemaining(match){
    const deck = Array.isArray(match?.draw_deck) ? match.draw_deck : [];
    const idx = Number(match?.draw_index || 0);
    return Math.max(0, deck.length - idx);
  }
  function resolvedGateSet(match){ return new Set(Array.isArray(match?.resolved_gates) ? match.resolved_gates.map(Number) : []); }
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
      ? [0,1,2].map((i)=>`<div class="pr-stack-card" style="transform:translate(${i * -4}px, ${i * 4}px)">${renderCardBack('pr-deck-back')}</div>`).join('')
      : '';

    const gateHtml = BOARD_POINTS.gateX.map((x, idx)=>{
      const gateNo = idx + 1;
      const isResolved = resolved.has(gateNo);
      const inner = isResolved ? renderFaceUpCard(gates[idx] || '', 'pr-gate-face') : renderCardBack('pr-gate-back');
      return `<div class="pr-gate-slot ${isResolved ? 'is-revealed' : 'is-facedown'}" data-gate-no="${gateNo}" data-card-code="${gates[idx] || ''}" style="left:${x}%;top:${BOARD_POINTS.gateY}%">${inner}</div>`;
    }).join('');

    const stableHtml = SUITS.map((suit)=>{
      const y = BOARD_POINTS.laneY[suit];
      return `<div class="pr-stable-row" data-stable-row="${suit}" style="left:${BOARD_POINTS.stableLeftX}%;top:${y}%"></div>`;
    }).join('');

    const startCoverHtml = SUITS.map((suit)=>{
      const x = BOARD_POINTS.stableTrackX;
      const y = BOARD_POINTS.laneY[suit];
      return `<div class="pr-start-cover-slot" data-start-cover="${suit}" style="left:${x}%;top:${y}%">${renderStartCover(suit)}</div>`;
    }).join('');

    const horseHtml = SUITS.map((suit)=>{
      const raw = Number(pos[suit] || 0);
      const idx = Math.max(0, Math.min(11, raw));
      const x = BOARD_POINTS.trackX[idx];
      const y = BOARD_POINTS.laneY[suit];
      return `<div class="pr-horse-slot" data-suit="${suit}" data-pos="${idx}" style="left:${x}%;top:${y}%;width:${BOARD_POINTS.horseWidthPct}%">${aceHorseCard(suit)}</div>`;
    }).join('');

    return `
      <div class="pr-live-wrap" data-match-ref="${String(match.match_ref || '')}" data-draw-index="${Number(match.draw_index || 0)}">
        <div class="pr-live-stage" data-stage-root>
          <img src="${ASSETS.arena}" alt="Paardenrace bord" class="pr-live-arena">
          <div class="pr-overlay">
            <div class="pr-deck-slot" data-deck-slot style="left:${BOARD_POINTS.deckX}%;top:${BOARD_POINTS.deckY}%;width:${BOARD_POINTS.deckWidthPct}%">${deckLayers}</div>
            <div class="pr-discard-slot ${discardCard ? 'has-card' : ''}" data-discard-slot style="left:${BOARD_POINTS.discardX}%;top:${BOARD_POINTS.discardY}%;width:${BOARD_POINTS.discardWidthPct}%">${discardCard ? renderFaceUpCard(discardCard, 'pr-discard-face') : ''}</div>
            ${gateHtml}
            ${stableHtml}
            ${startCoverHtml}
            ${horseHtml}
            <svg class="pr-tendril-layer" data-tendril-layer viewBox="0 0 1536 1024" preserveAspectRatio="none"></svg>
            <div class="pr-animation-layer" data-animation-layer></div>
          </div>
        </div>
      </div>
    `;
  }
  window.GEJAST_PAARDENRACE = {
    rpc, sessionToken, getStoredRoomCode, setStoredRoomCode, clearStoredRoomCode,
    suitLabel, suitSymbol, suitColor, parseCard, renderFaceUpCard, renderCardBack, renderLiveBoard,
    gotoLive, liveHref, getDrawRemaining, resolvedGateSet, getBoardPoints: ()=> JSON.parse(JSON.stringify(BOARD_POINTS))
  };
})();
