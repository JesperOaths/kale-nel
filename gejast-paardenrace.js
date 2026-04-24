(function(){
  if (window.GEJAST_PAARDENRACE && window.GEJAST_PAARDENRACE.__v667_complete) return;
  const cfg = window.GEJAST_CONFIG || {};
  const STORAGE_KEY = 'gejast_paardenrace_room_code_v667';
  const LEGACY_KEYS = ['gejast_paardenrace_room_code_v506'];
  const LIVE_QUERY_KEY = 'live';
  const SUITS = ['spades','hearts','clubs','diamonds'];
  const SUIT_META = {
    hearts: { label:'♥ Harten', symbol:'♥', color:'#a11f35', short:'Harten' },
    diamonds: { label:'♦ Ruiten', symbol:'♦', color:'#a11f35', short:'Ruiten' },
    clubs: { label:'♣ Klaveren', symbol:'♣', color:'#1f1b1a', short:'Klaveren' },
    spades: { label:'♠ Schoppen', symbol:'♠', color:'#1f1b1a', short:'Schoppen' }
  };
  function scope(){
    try { if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.getScope === 'function') return window.GEJAST_SCOPE_UTILS.getScope(); } catch(_){}
    try { return new URLSearchParams(window.location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch(_){}
    return 'friends';
  }
  function scopedHref(path){
    try { const url = new URL(path, window.location.href); if (scope()==='family') url.searchParams.set('scope','family'); return `${url.pathname.split('/').pop()}${url.search}${url.hash}`; } catch (_) { return path; }
  }
  function sessionToken(){ try { return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; } catch(_) { return ''; } }
  async function rpc(fn, args={}, options={}){
    const token = sessionToken();
    const body = Object.assign({}, args || {}, { session_token: token || null, session_token_input: token || null, site_scope_input: scope() });
    const timeoutMs = Math.max(900, Number(options.timeoutMs || 4500));
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method:'POST', mode:'cors', cache:'no-store', signal:controller.signal,
        headers:{ apikey:cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json', 'Cache-Control':'no-store, no-cache, max-age=0', Pragma:'no-cache' },
        body:JSON.stringify(body)
      });
      const text = await res.text(); let data=null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
      if (!res.ok) {
        const msg = data && typeof data === 'object' ? (data.message || data.error || data.details || data.hint || JSON.stringify(data)) : (text || `HTTP ${res.status}`);
        throw new Error(msg);
      }
      return data && data[fn] !== undefined ? data[fn] : data;
    } catch(err){ if (err && (err.name === 'AbortError' || /abort/i.test(String(err)))) throw new Error('timeout'); throw err; }
    finally { clearTimeout(timer); }
  }
  function getStoredRoomCode(){
    try { const current = localStorage.getItem(STORAGE_KEY); if (current) return current; for (const k of LEGACY_KEYS){ const legacy=localStorage.getItem(k); if (legacy) return legacy; } } catch(_){}
    return '';
  }
  function setStoredRoomCode(code){ try { if (code) localStorage.setItem(STORAGE_KEY, String(code).trim().toUpperCase()); } catch(_){} }
  function clearStoredRoomCode(){ try { localStorage.removeItem(STORAGE_KEY); LEGACY_KEYS.forEach(k=>localStorage.removeItem(k)); } catch(_){} }
  function suitKey(s){ const key=String(s||'').trim().toLowerCase(); return SUIT_META[key] ? key : ''; }
  function suitLabel(s){ return (SUIT_META[suitKey(s)] || {}).label || '—'; }
  function suitSymbol(s){ return (SUIT_META[suitKey(s)] || {}).symbol || '•'; }
  function suitColor(s){ return (SUIT_META[suitKey(s)] || {}).color || '#1f1b1a'; }
  function liveHref(room){ const code=encodeURIComponent(String(room||'').trim().toUpperCase()); const url=new URL('./paardenrace_live.html', window.location.href); url.searchParams.set('room', code); url.searchParams.set(LIVE_QUERY_KEY, code); if(scope()==='family') url.searchParams.set('scope','family'); return `${url.pathname.split('/').pop()}${url.search}`; }
  function gotoLive(room, options={}){ const href=liveHref(room); if(options.replace) window.location.replace(href); else window.location.href=href; }
  function parseCard(cardCode=''){
    const raw=String(cardCode||'').trim().toUpperCase(); const m=raw.match(/^(10|[2-9JQKA])([HDCS])$/); if(!m) return {rank:raw||'—', suitKey:'', symbol:'•', isRed:false, raw};
    const key={H:'hearts',D:'diamonds',C:'clubs',S:'spades'}[m[2]] || ''; return {rank:m[1], suitKey:key, symbol:suitSymbol(key), isRed:key==='hearts'||key==='diamonds', raw};
  }
  function renderFaceUpCard(cardCode, extraClass=''){
    const p=parseCard(cardCode), red=p.isRed?' red':''; return `<div class="pr-open-card${red}${extraClass?` ${extraClass}`:''}"><div class="pr-open-card-corner top">${p.rank}<span>${p.symbol}</span></div><div class="pr-open-card-center">${p.symbol}</div><div class="pr-open-card-corner bottom">${p.rank}<span>${p.symbol}</span></div></div>`;
  }
  function renderCardBack(extraClass=''){ return `<div class="pr-card-back${extraClass?` ${extraClass}`:''}"><span>GEJAST</span></div>`; }
  function getDrawRemaining(match){ const deck=Array.isArray(match && match.draw_deck) ? match.draw_deck : []; const idx=Number(match && match.draw_index || 0); return Math.max(0, deck.length - idx); }
  function resolvedGateSet(match){ const arr=Array.isArray(match && match.resolved_gates) ? match.resolved_gates : []; return new Set(arr.map(Number).filter(Boolean)); }
  function normalizedGateEvents(match){ return Array.isArray(match && match.gate_events) ? match.gate_events : []; }
  function gateEventMap(match){ const map=new Map(); normalizedGateEvents(match).forEach(row=>{ const no=Number(row && row.gate_no || 0); if(no) map.set(no,row); }); return map; }
  function getGridColumnForProgress(progress){ const n=Number(progress||0); if(n<=0) return 0; if(n>=11) return 11; return n; }
  function horseMarker(suit){ return `<span class="pr-horse-token" style="color:${suitColor(suit)}">${suitSymbol(suit)}</span>`; }
  function compactGateCard(cardCode, resolved){ if(!resolved) return `<div class="pr-gate-mini pr-gate-mini--back"></div>`; const p=parseCard(cardCode); return `<div class="pr-gate-mini ${p.isRed?'red':''}" title="${suitLabel(p.suitKey)}"><span>${p.symbol}</span></div>`; }
  function gateSuitCaption(cardCode, resolved, eventRow=null){ if(!resolved) return '<div class="pr-gate-suit-caption">Dicht</div>'; const p=parseCard(cardCode); const stepSuit=suitKey((eventRow && eventRow.suit) || p.suitKey); return `<div class="pr-gate-suit-caption ${p.isRed?'red':''}">${p.symbol} ${(SUIT_META[p.suitKey]||{}).short || '—'}${stepSuit?` · ${suitSymbol(stepSuit)} -1`:''}</div>`; }
  function renderRaceMinimap(match){
    if(!match || !match.horse_positions) return '<div class="pr-minimap-empty">Wachten op racebord…</div>';
    const positions=match.horse_positions||{}, gates=Array.isArray(match.gate_cards)?match.gate_cards:[], resolved=resolvedGateSet(match), events=gateEventMap(match);
    const gateCells=Array.from({length:12},(_,col)=>{ if(col===0||col===11) return '<span class="pr-minimap-cell pr-minimap-cell--blank"></span>'; const no=col, row=events.get(no)||null; return `<span class="pr-minimap-cell pr-minimap-gate-cell" title="${row && row.suit ? suitLabel(row.suit)+' gaat 1 terug' : ''}">${compactGateCard(gates[no-1]||'', resolved.has(no))}</span>`; }).join('');
    const gateRow=`<div class="pr-minimap-row pr-minimap-row--gates"><div class="pr-minimap-label">G</div><div class="pr-minimap-track">${gateCells}</div></div>`;
    const suitRows=SUITS.map(suit=>{ const progress=Math.max(0,Math.min(11,Number(positions[suit]||0))); const cells=Array.from({length:12},(_,col)=>{ const classes=['pr-minimap-cell']; if(col===0)classes.push('is-start'); if(col===11)classes.push('is-finish'); const horse=progress===col?`<span class="pr-minimap-horse" style="color:${suitColor(suit)}">${suitSymbol(suit)}</span>`:''; return `<span class="${classes.join(' ')}">${horse}</span>`; }).join(''); return `<div class="pr-minimap-row" data-suit="${suit}"><div class="pr-minimap-label" style="color:${suitColor(suit)}">${suitSymbol(suit)}</div><div class="pr-minimap-track">${cells}</div></div>`; }).join('');
    return `<div class="pr-minimap">${gateRow}${suitRows}</div>`;
  }
  function renderTrackRow(suit, progress){ const cells=Array.from({length:12},(_,col)=>{ const cls=['pr-track-cell']; if(col===0)cls.push('is-start'); if(col===11)cls.push('is-finish'); return `<div class="${cls.join(' ')}" data-col="${col}">${col===progress?horseMarker(suit):''}</div>`; }).join(''); return `<div class="pr-board-row"><div class="pr-board-label" style="color:${suitColor(suit)}">${suitSymbol(suit)}</div><div class="pr-board-track">${cells}</div></div>`; }
  function liveBoardFingerprint(match){ return JSON.stringify({ last:match&&match.last_draw_card||'', winner:match&&match.winner_suit||'', positions:match&&match.horse_positions||{}, gates:match&&match.gate_cards||[], resolved:Array.from(resolvedGateSet(match).values()), drawIndex:Number(match&&match.draw_index||0), stage:String(match&&match.stage||''), events:normalizedGateEvents(match) }); }
  function renderLiveBoard(match){
    if(!match || !match.horse_positions) return '<div class="pr-live-placeholder">Wachten op countdown of race-start.</div>';
    const positions=match.horse_positions||{}, gates=Array.isArray(match.gate_cards)?match.gate_cards:[], resolved=resolvedGateSet(match), events=gateEventMap(match), remaining=getDrawRemaining(match), lastCard=match.last_draw_card||'';
    const gateRow=Array.from({length:10},(_,idx)=>{ const no=idx+1, isResolved=resolved.has(no), card=gates[idx]||'', row=events.get(no)||null; return `<div class="pr-board-gate-slot"><div class="pr-board-gate-stack">${isResolved?renderFaceUpCard(card,'pr-board-gate-face'):renderCardBack('pr-board-gate-back')}${gateSuitCaption(card,isResolved,row)}</div></div>`; }).join('');
    const trackRows=SUITS.map(suit=>renderTrackRow(suit, getGridColumnForProgress(positions[suit]))).join('');
    return `<div class="pr-live-wrap"><div class="pr-board-topline"><div class="pr-board-kpi"><span>Kaarten over</span><strong>${remaining}</strong></div><div class="pr-board-kpi"><span>Gates open</span><strong>${resolved.size}/10</strong></div><div class="pr-board-kpi pr-board-kpi--card"><span>Laatste kaart</span><div class="pr-board-lastcard">${lastCard?renderFaceUpCard(lastCard,'pr-last-card'):'<div class="pr-last-card-empty">—</div>'}</div></div></div><div class="pr-board-shell-lite"><div class="pr-board-gates"><div class="pr-board-label pr-board-label--gate">G</div><div class="pr-board-gate-track">${gateRow}</div></div><div class="pr-board-rows">${trackRows}</div></div></div>`;
  }
  function summarizeLiveRoom(room, match, players, viewer){
    const list=Array.isArray(players)?players:[]; const verified=list.filter(p=>p&&p.wager_verified).length; const ready=list.filter(p=>p&&p.is_ready).length; const totalPot=list.reduce((s,p)=>s+Number(p&&p.wager_bakken||0),0); const pendingGate=Math.max(0,10-resolvedGateSet(match).size); const winnerSuit=suitKey(match&&match.winner_suit); const drawCard=String(match&&match.last_draw_card||'').trim().toUpperCase(); const deckLeft=getDrawRemaining(match); const stage=String(room&&room.stage||'lobby'); const latest=normalizedGateEvents(match).slice(-1)[0]||null;
    const headline=winnerSuit?`${suitLabel(winnerSuit)} heeft gewonnen`:stage==='countdown'?`Countdown ${Number(room&&room.countdown_remaining_seconds||0)}s`:stage==='nominations'?'Verdeel nu de nominaties':stage==='finished'?'Race afgerond':drawCard?`Laatste kaart: ${drawCard}`:'Klaar voor de volgende kaart';
    const subline=latest&&latest.suit?`Gate ${latest.gate_no} open · ${suitLabel(latest.suit)} gaat 1 terug`:winnerSuit?`Totale pot ${totalPot} Bakken · ${deckLeft} kaarten over`:`${verified}/${list.length||0} verified · ${ready}/${list.length||0} ready · ${pendingGate} gates nog dicht`;
    return {headline, subline, totalPot, verified, ready, pendingGate, winnerSuit, deckLeft, drawCard, stage, isHost:!!(viewer&&viewer.is_host)};
  }
  window.GEJAST_PAARDENRACE = { __v667_complete:true, rpc, sessionToken, getStoredRoomCode, setStoredRoomCode, clearStoredRoomCode, suitLabel, suitSymbol, suitColor, parseCard, renderFaceUpCard, renderCardBack, renderRaceMinimap, renderLiveBoard, summarizeLiveRoom, gotoLive, liveHref, scopedHref, scope, getDrawRemaining, resolvedGateSet, normalizedGateEvents, gateEventMap, getGridColumnForProgress, liveBoardFingerprint };
})();
