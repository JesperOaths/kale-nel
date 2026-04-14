
(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const STORAGE_KEY = 'gejast_paardenrace_room_code_v446';
  const LIVE_QUERY_KEY = 'live';
  const ASSETS = {
    arena: './paardenrace-live-arena.png',
    cardBack: './paardenrace-card-back.png',
    horses: {
      hearts: './paardenrace-ace-hearts.png',
      diamonds: './paardenrace-ace-diamonds.png',
      clubs: './paardenrace-ace-clubs.png',
      spades: './paardenrace-ace-spades.png'
    }
  };
  const SUITS = ['hearts','diamonds','clubs','spades'];
  const SUIT_META = {
    hearts: { label:'♥ Harten', symbol:'♥', color:'#a11f35' },
    diamonds: { label:'♦ Ruiten', symbol:'♦', color:'#b06c00' },
    clubs: { label:'♣ Klaveren', symbol:'♣', color:'#245b2a' },
    spades: { label:'♠ Schoppen', symbol:'♠', color:'#1c2f5c' }
  };
  const TRACK_X = [18.8, 27.3, 33.9, 40.7, 47.5, 54.3, 61.1, 67.9, 74.7, 81.5, 88.4, 95.2];
  const GATE_X = [27.3, 33.9, 40.7, 47.5, 54.3, 61.1, 67.9, 74.7, 81.5, 88.4];
  const LANE_Y = { hearts:39.6, diamonds:56.9, clubs:74.0, spades:91.1 };
  const SYMBOL_X = 9.8;

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
  function aceHorseCard(suit, compact=false){
    const src = ASSETS.horses[suit] || ASSETS.horses.hearts;
    return `<img src="${src}" alt="${suitLabel(suit)} aas" class="pr-ace-card${compact?' compact':''}">`;
  }
  function renderLiveBoard(match){
    if(!match || !match.horse_positions){
      return '<div class="pr-live-placeholder">Wachten op countdown of race-start.</div>';
    }
    const pos = match.horse_positions || {};
    const draws = Array.isArray(match.revealed_draw_cards) ? match.revealed_draw_cards : [];
    const gates = Array.isArray(match.gate_cards) ? match.gate_cards : [];
    const resolvedSet = new Set(Array.isArray(match.resolved_gates) ? match.resolved_gates.map(Number) : []);
    const gateEvents = Array.isArray(match.gate_events) ? match.gate_events : [];

    const gateHtml = GATE_X.map((x, idx)=>{
      const gateNo = idx + 1;
      const open = resolvedSet.has(gateNo);
      const event = gateEvents.filter((e)=>Number(e.gate_no) === gateNo).slice(-1)[0];
      const label = open ? (event ? `${suitSymbol(event.suit)} ${suitLabel(event.suit)}` : 'Open') : `Gate ${gateNo}`;
      return `<div class="pr-gate-slot" style="left:${x}%">${open ? `<div class="pr-gate-open">${label}</div>` : cardBack('gate')}</div>`;
    }).join('');

    const horseHtml = SUITS.map((suit)=>{
      const raw = Number(pos[suit] || 0);
      const idx = Math.max(0, Math.min(11, raw));
      const x = TRACK_X[idx];
      const y = LANE_Y[suit];
      return `
        <div class="pr-lane-symbol" style="left:${SYMBOL_X}%;top:${y}%;color:${suitColor(suit)}">${suitSymbol(suit)}</div>
        <div class="pr-horse-slot" style="left:${x}%;top:${y}%">${aceHorseCard(suit)}</div>
      `;
    }).join('');

    const recentCards = draws.slice(-8).map((card)=>`<div class="pr-mini-card">${card}</div>`).join('') || '<div class="pr-mini-empty">Nog geen trek.</div>';
    const gateState = GATE_X.map((_, idx)=>{
      const gateNo = idx+1;
      const open = resolvedSet.has(gateNo);
      return `<div class="pr-gate-state ${open?'open':''}"><strong>Gate ${gateNo}</strong><span>${open ? 'Open' : 'Dicht'}</span></div>`;
    }).join('');

    return `
      <div class="pr-live-wrap">
        <div class="pr-live-stage">
          <img src="${ASSETS.arena}" alt="Paardenrace arena" class="pr-live-arena">
          <div class="pr-overlay">${gateHtml}${horseHtml}</div>
        </div>
        <div class="pr-live-meta">
          <div class="pr-meta-block"><div class="pr-meta-title">Laatste kaarten</div><div class="pr-mini-row">${recentCards}</div></div>
          <div class="pr-meta-block"><div class="pr-meta-title">Poortkaarten</div><div class="pr-gate-row">${gateState}</div></div>
        </div>
      </div>
    `;
  }
  window.GEJAST_PAARDENRACE = { rpc, sessionToken, getStoredRoomCode, setStoredRoomCode, clearStoredRoomCode, suitLabel, suitSymbol, suitColor, renderLiveBoard, gotoLive, liveHref };
})();
