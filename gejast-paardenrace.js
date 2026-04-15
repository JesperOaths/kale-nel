(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const STORAGE_KEY = 'gejast_paardenrace_room_code_v456';
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
    trackX: [14.95, 20.96, 27.21, 33.56, 39.91, 46.26, 52.64, 58.92, 65.35, 71.81, 78.29, 86.65],
    gateX: [20.96, 27.21, 33.56, 39.91, 46.26, 52.64, 58.92, 65.35, 71.81, 78.29],
    laneY: { spades: 39.08, hearts: 53.80, clubs: 67.62, diamonds: 80.74 },
    deckX: 9.90,
    deckY: 20.85,
    discardX: 89.55,
    discardY: 23.85,
    gateY: 22.05,
    horseWidthPct: 3.95,
    gateWidthPct: 4.15,
    deckWidthPct: 4.85,
    discardWidthPct: 4.85
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
  function renderStartCover(){
    return '';
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
      return `<div class="pr-gate-slot ${isResolved ? 'is-revealed' : 'is-facedown'}" data-gate-no="${gateNo}" style="left:${x}%;top:${BOARD_POINTS.gateY}%">${inner}</div>`;
    }).join('');

    const horseHtml = SUITS.map((suit)=>{
      const raw = Number(pos[suit] || 0);
      const idx = Math.max(0, Math.min(11, raw));
      const x = BOARD_POINTS.trackX[idx];
      const y = BOARD_POINTS.laneY[suit];
      return `<div class="pr-horse-slot" data-suit="${suit}" data-pos="${idx}" style="left:${x}%;top:${y}%">${aceHorseCard(suit)}</div>`;
    }).join('');

    return `
      <div class="pr-live-wrap" data-match-ref="${String(match.match_ref || '')}" data-draw-index="${Number(match.draw_index || 0)}">
        <div class="pr-live-stage" data-stage-root>
          <img src="${ASSETS.arena}" alt="Paardenrace bord" class="pr-live-arena">
          <div class="pr-overlay">
            <div class="pr-deck-slot" data-deck-slot style="left:${BOARD_POINTS.deckX}%;top:${BOARD_POINTS.deckY}%">${deckLayers}</div>
            <div class="pr-discard-slot ${discardCard ? 'has-card' : ''}" data-discard-slot style="left:${BOARD_POINTS.discardX}%;top:${BOARD_POINTS.discardY}%">${discardCard ? renderFaceUpCard(discardCard, 'pr-discard-face') : ''}</div>
            ${gateHtml}
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
    gotoLive, liveHref, getDrawRemaining, resolvedGateSet, getBoardPoints: ()=> JSON.parse(JSON.stringify(BOARD_POINTS))
  };
})();
