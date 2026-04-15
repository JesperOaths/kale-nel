(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const STORAGE_KEY = 'gejast_paardenrace_room_code_v447';
  const LIVE_QUERY_KEY = 'live';
  const ASSETS = {
    arena: './paardenrace-live-board-v447.png',
    cardBack: './paardenrace-card-back.png',
    horses: {
      hearts: './paardenrace-ace-hearts-v447.png',
      diamonds: './paardenrace-ace-diamonds-v447.png',
      clubs: './paardenrace-ace-clubs-v447.png',
      spades: './paardenrace-ace-spades-v447.png'
    }
  };
  const SUITS = ['spades','hearts','clubs','diamonds'];
  const SUIT_META = {
    hearts: { label:'♥ Harten', symbol:'♥', color:'#a11f35' },
    diamonds: { label:'♦ Ruiten', symbol:'♦', color:'#b06c00' },
    clubs: { label:'♣ Klaveren', symbol:'♣', color:'#245b2a' },
    spades: { label:'♠ Schoppen', symbol:'♠', color:'#1f1b1a' }
  };
  const BOARD_POINTS = {
    trackX: [14.55, 21.15, 27.22, 33.30, 39.52, 45.73, 51.89, 58.06, 64.21, 70.43, 76.51, 86.20],
    gateX: [18.92, 24.97, 31.05, 37.17, 43.35, 49.42, 55.56, 61.72, 67.90, 74.03],
    laneY: { spades: 40.90, hearts: 55.57, clubs: 70.24, diamonds: 84.88 },
    startMaskX: 14.55,
    gateY: 22.35,
    gateMaskY: 22.35,
    cardWidthPct: 4.55,
    gateWidthPct: 3.78,
    horseMaskWidthPct: 5.20,
    horseMaskHeightPct: 11.50,
    gateMaskWidthPct: 4.42,
    gateMaskHeightPct: 10.90
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
  function gotoLive(room, options={}){
    const href = liveHref(room);
    if(options.replace) window.location.replace(href); else window.location.href = href;
  }
  function cardBack(size='gate'){ return `<img src="${ASSETS.cardBack}" alt="Kaart achterkant" class="pr-card-back pr-${size}">`; }
  function aceHorseCard(suit){
    const src = ASSETS.horses[suit] || ASSETS.horses.hearts;
    return `<img src="${src}" alt="${suitLabel(suit)} aas" class="pr-ace-card">`;
  }
  function parseCard(cardCode=''){
    const raw = String(cardCode || '').trim().toUpperCase();
    const match = raw.match(/^(10|[2-9JQKAK])([HDCS])$/);
    if(!match){
      return { rank: raw || '—', suitKey: '', symbol: '•', isRed: false, raw };
    }
    const rank = match[1] === '1' ? '10' : match[1];
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
  function renderLiveBoard(match){
    if(!match || !match.horse_positions){
      return '<div class="pr-live-placeholder">Wachten op countdown of race-start.</div>';
    }
    const pos = match.horse_positions || {};
    const gates = Array.isArray(match.gate_cards) ? match.gate_cards : [];
    const resolvedSet = new Set(Array.isArray(match.resolved_gates) ? match.resolved_gates.map(Number) : []);

    const maskHtml = SUITS.map((suit)=>`
      <div class="pr-horse-mask" style="left:${BOARD_POINTS.startMaskX}%;top:${BOARD_POINTS.laneY[suit]}%"></div>
    `).join('');

    const gateHtml = BOARD_POINTS.gateX.map((x, idx)=>{
      const gateNo = idx + 1;
      if(!resolvedSet.has(gateNo)) return '';
      const cardCode = gates[idx] || '';
      return `<div class="pr-gate-reveal-slot" style="left:${x}%;top:${BOARD_POINTS.gateY}%">${renderFaceUpCard(cardCode, 'pr-gate-face')}</div>`;
    }).join('');

    const horseHtml = SUITS.map((suit)=>{
      const raw = Number(pos[suit] || 0);
      const idx = Math.max(0, Math.min(11, raw));
      const x = BOARD_POINTS.trackX[idx];
      const y = BOARD_POINTS.laneY[suit];
      return `<div class="pr-horse-slot" style="left:${x}%;top:${y}%">${aceHorseCard(suit)}</div>`;
    }).join('');

    return `
      <div class="pr-live-wrap">
        <div class="pr-live-stage">
          <img src="${ASSETS.arena}" alt="Paardenrace bord" class="pr-live-arena">
          <div class="pr-overlay">${maskHtml}${gateHtml}${horseHtml}</div>
        </div>
      </div>
    `;
  }
  window.GEJAST_PAARDENRACE = { rpc, sessionToken, getStoredRoomCode, setStoredRoomCode, clearStoredRoomCode, suitLabel, suitSymbol, suitColor, renderFaceUpCard, renderLiveBoard, gotoLive, liveHref };
})();
