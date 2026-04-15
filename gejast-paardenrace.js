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
    hearts: { label:'♥ Harten', symbol:'♥', color:'#a11f35' },
    diamonds: { label:'♦ Ruiten', symbol:'♦', color:'#a11f35' },
    clubs: { label:'♣ Klaveren', symbol:'♣', color:'#1f1b1a' },
    spades: { label:'♠ Schoppen', symbol:'♠', color:'#1f1b1a' }
  };
  const BOARD_POINTS = {
    trackX: [14.23, 20.96, 27.15, 33.46, 39.91, 46.32, 52.70, 59.11, 65.56, 71.98, 78.39, 86.72],
    gateX: [20.96, 27.15, 33.46, 39.91, 46.32, 52.70, 59.11, 65.56, 71.98, 78.39],
    laneY: { spades: 39.75, hearts: 53.52, clubs: 67.38, diamonds: 80.27 },
    deckX: 8.05,
    deckY: 19.15,
    discardX: 89.55,
    discardY: 23.45,
    gateY: 24.18,
    horseWidthPct: 4.35,
    gateWidthPct: 4.28,
    deckWidthPct: 5.85,
    discardWidthPct: 5.55,
    startWidthPct: 4.55
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
  function renderStartCover(suit){
    const symbol = suitSymbol(suit);
    const color = suitColor(suit);
    return `<svg class="pr-start-cover" viewBox="0 0 311 410" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="strawBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f7efe0"/>
          <stop offset="100%" stop-color="#ead9b4"/>
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="308" height="407" rx="24" fill="url(#strawBg)" stroke="rgba(77,57,31,.20)" stroke-width="3"/>
      <g opacity="0.95" stroke="#d7b85e" stroke-width="7" stroke-linecap="round">
        <path d="M38 240 L118 126"/><path d="M62 256 L152 112"/><path d="M90 268 L182 124"/><path d="M142 278 L230 136"/><path d="M80 182 L236 280"/><path d="M56 204 L208 304"/><path d="M100 154 L250 252"/><path d="M54 312 L210 212"/><path d="M116 316 L268 212"/>
      </g>
      <circle cx="156" cy="120" r="52" fill="rgba(255,255,255,.76)" stroke="rgba(154,130,65,.52)" stroke-width="6"/>
      <text x="156" y="133" text-anchor="middle" font-size="54" font-weight="900" fill="${color}">${symbol}</text>
      <text x="156" y="326" text-anchor="middle" font-size="36" font-weight="900" fill="#7a6130">STAL</text>
    </svg>`;
  }
  function getDrawRemaining(match){
    const deck = Array.isArray(match?.draw_deck) ? match.draw_deck : [];
    const idx = Number(match?.draw_index || 0);
    return Math.max(0, deck.length - idx);
  }
  function resolvedGateSet(match){ return new Set(Array.isArray(match?.resolved_gates) ? match.resolved_gates.map(Number) : []); }
  function renderLiveBoard(match, options={}){
    if(!match || !match.horse_positions){
      return '<div class="pr-live-placeholder">Wachten op countdown of race-start.</div>';
    }
    const pos = match.horse_positions || {};
    const gates = Array.isArray(match.gate_cards) ? match.gate_cards : [];
    const resolved = resolvedGateSet(match);
    const remaining = getDrawRemaining(match);
    const discardCard = match.last_draw_card || '';
    const hideGates = !!options.hideGates;
    const hideHorses = !!options.hideHorses;

    const deckLayers = remaining > 0
      ? [0,1,2].map((i)=>`<div class="pr-stack-card" style="transform:translate(${i * -4}px, ${i * 4}px)">${renderCardBack('pr-deck-back')}</div>`).join('')
      : '';

    const gateHtml = BOARD_POINTS.gateX.map((x, idx)=>{
      const gateNo = idx + 1;
      const isResolved = resolved.has(gateNo);
      const inner = hideGates ? '' : (isResolved ? renderFaceUpCard(gates[idx] || '', 'pr-gate-face') : renderCardBack('pr-gate-back')); 
      return `<div class="pr-gate-slot ${isResolved ? 'is-revealed' : 'is-facedown'}" data-gate-no="${gateNo}" style="left:${x}%;top:${BOARD_POINTS.gateY}%">${inner}</div>`;
    }).join('');

    const startCoverHtml = SUITS.map((suit)=>{
      const x = BOARD_POINTS.trackX[0];
      const y = BOARD_POINTS.laneY[suit];
      return `<div class="pr-start-cover-slot" data-start-cover="${suit}" style="left:${x}%;top:${y}%">${renderStartCover(suit)}</div>`;
    }).join('');

    const horseHtml = SUITS.map((suit)=>{
      const raw = Number(pos[suit] || 0);
      const idx = Math.max(0, Math.min(11, raw));
      const x = BOARD_POINTS.trackX[idx];
      const y = BOARD_POINTS.laneY[suit];
      return `<div class="pr-horse-slot" data-suit="${suit}" data-pos="${idx}" style="left:${x}%;top:${y}%">${hideHorses ? '' : aceHorseCard(suit)}</div>`;
    }).join('');

    return `
      <div class="pr-live-wrap" data-match-ref="${String(match.match_ref || '')}" data-draw-index="${Number(match.draw_index || 0)}">
        <div class="pr-live-stage" data-stage-root>
          <img src="${ASSETS.arena}" alt="Paardenrace bord" class="pr-live-arena">
          <div class="pr-overlay">
            <div class="pr-deck-slot" data-deck-slot style="left:${BOARD_POINTS.deckX}%;top:${BOARD_POINTS.deckY}%">${deckLayers}</div>
            <div class="pr-discard-slot ${discardCard ? 'has-card' : ''}" data-discard-slot style="left:${BOARD_POINTS.discardX}%;top:${BOARD_POINTS.discardY}%">${discardCard ? renderFaceUpCard(discardCard, 'pr-discard-face') : ''}</div>
            ${gateHtml}
            ${startCoverHtml}
            ${horseHtml}
            <div class="pr-animation-layer" data-animation-layer></div>
          </div>
        </div>
      </div>
    `;
  }
  window.GEJAST_PAARDENRACE = {
    rpc, sessionToken, getStoredRoomCode, setStoredRoomCode, clearStoredRoomCode,
    suitLabel, suitSymbol, suitColor, parseCard, renderFaceUpCard, renderCardBack, renderLiveBoard, renderStartCover, aceHorseCard,
    gotoLive, liveHref, getDrawRemaining, resolvedGateSet, getBoardPoints: ()=> JSON.parse(JSON.stringify(BOARD_POINTS))
  };
})();
