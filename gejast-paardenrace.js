(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const STORAGE_KEY = 'gejast_paardenrace_room_code_v450';
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
    hearts: { label:'♥ Harten', symbol:'♥', color:'#a11f35', fill:'#f6e5e8' },
    diamonds: { label:'♦ Ruiten', symbol:'♦', color:'#a11f35', fill:'#f8e9e0' },
    clubs: { label:'♣ Klaveren', symbol:'♣', color:'#1f1b1a', fill:'#ece9de' },
    spades: { label:'♠ Schoppen', symbol:'♠', color:'#1f1b1a', fill:'#ece8e0' }
  };
  const TRACK_X = [14.18, 21.18, 27.28, 33.36, 39.56, 45.72, 51.87, 58.03, 64.18, 70.35, 76.50, 84.86];
  const GATE_X = [19.07, 25.14, 31.20, 37.31, 43.44, 49.55, 55.66, 61.76, 67.91, 74.02];
  const LANE_Y = { spades: 40.86, hearts: 55.59, clubs: 70.24, diamonds: 84.90 };

  const BOARD_GEOMETRY = {
    cardPct: {
      horse: 5.15,
      gate: 4.86,
      deck: 5.4,
      discard: 6.0
    },
    deck: { x: 8.35, y: 25.55, widthPct: 5.4 },
    discard: { x: 90.55, y: 24.85, widthPct: 6.0 },
    gateSlots: GATE_X.map((x, idx)=>({ gateNo: idx + 1, x, y: 22.36, widthPct: 4.86 })),
    horseSlots: Object.fromEntries(SUITS.map((suit)=>[
      suit,
      TRACK_X.map((x, idx)=>({ pos: idx, x, y: LANE_Y[suit], widthPct: 5.15 }))
    ])),
    startMarkers: Object.fromEntries(SUITS.map((suit)=>[
      suit,
      { x: TRACK_X[0], y: LANE_Y[suit], widthPct: 5.15 }
    ]))
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
    return `<img src="${src}" alt="${suitLabel(suit)} aas" class="pr-ace-card" draggable="false">`;
  }
  function renderStartMarker(suit){
    const meta = SUIT_META[suit] || SUIT_META.hearts;
    const symbol = meta.symbol || '•';
    const color = meta.color || '#1f1b1a';
    const fill = meta.fill || '#f0ebe2';
    return `
      <svg class="pr-start-marker" viewBox="0 0 311 410" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="startGrad-${suit}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fffdf9"/>
            <stop offset="100%" stop-color="${fill}"/>
          </linearGradient>
        </defs>
        <rect x="8" y="8" width="295" height="394" rx="26" fill="url(#startGrad-${suit})" stroke="rgba(77,57,31,.16)" stroke-width="4"/>
        <circle cx="155.5" cy="185" r="74" fill="rgba(255,255,255,.84)" stroke="${color}" stroke-opacity=".24" stroke-width="10"/>
        <text x="155.5" y="202" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="86" font-weight="900" fill="${color}">${symbol}</text>
        <text x="155.5" y="300" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="30" font-weight="800" letter-spacing="4" fill="rgba(77,57,31,.72)">START</text>
      </svg>
    `;
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

    const gateHtml = BOARD_GEOMETRY.gateSlots.map((slot, idx)=>{
      const gateNo = slot.gateNo;
      const isResolved = resolved.has(gateNo);
      const inner = isResolved ? renderFaceUpCard(gates[idx] || '', 'pr-gate-face') : renderCardBack('pr-gate-back');
      return `<div class="pr-gate-slot ${isResolved ? 'is-revealed' : 'is-facedown'}" data-gate-no="${gateNo}" style="left:${slot.x}%;top:${slot.y}%">${inner}</div>`;
    }).join('');

    const startMarkerHtml = SUITS.map((suit)=>{
      const slot = BOARD_GEOMETRY.startMarkers[suit];
      return `<div class="pr-start-cover-slot" data-start-cover="${suit}" style="left:${slot.x}%;top:${slot.y}%">${renderStartMarker(suit)}</div>`;
    }).join('');

    const horseHtml = SUITS.map((suit)=>{
      const raw = Number(pos[suit] || 0);
      const idx = Math.max(0, Math.min(11, raw));
      const slot = BOARD_GEOMETRY.horseSlots[suit][idx];
      return `<div class="pr-horse-slot" data-suit="${suit}" data-pos="${idx}" style="left:${slot.x}%;top:${slot.y}%"><span class="pr-horse-mask" aria-hidden="true"></span>${aceHorseCard(suit)}</div>`;
    }).join('');

    return `
      <div class="pr-live-wrap" data-match-ref="${String(match.match_ref || '')}" data-draw-index="${Number(match.draw_index || 0)}">
        <div class="pr-live-stage" data-stage-root>
          <img src="${ASSETS.arena}" alt="Paardenrace bord" class="pr-live-arena">
          <div class="pr-overlay">
            <div class="pr-deck-slot" data-deck-slot style="left:${BOARD_GEOMETRY.deck.x}%;top:${BOARD_GEOMETRY.deck.y}%">${deckLayers}</div>
            <div class="pr-discard-slot ${discardCard ? 'has-card' : ''}" data-discard-slot style="left:${BOARD_GEOMETRY.discard.x}%;top:${BOARD_GEOMETRY.discard.y}%">${discardCard ? renderFaceUpCard(discardCard, 'pr-discard-face') : ''}</div>
            ${gateHtml}
            ${startMarkerHtml}
            ${horseHtml}
            <div class="pr-animation-layer" data-animation-layer></div>
          </div>
        </div>
      </div>
    `;
  }
  window.GEJAST_PAARDENRACE = {
    rpc, sessionToken, getStoredRoomCode, setStoredRoomCode, clearStoredRoomCode,
    suitLabel, suitSymbol, suitColor, parseCard, renderFaceUpCard, renderCardBack, renderLiveBoard,
    gotoLive, liveHref, getDrawRemaining, resolvedGateSet, getBoardGeometry: ()=> JSON.parse(JSON.stringify(BOARD_GEOMETRY))
  };
})();