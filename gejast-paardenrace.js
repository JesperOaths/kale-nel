(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const STORAGE_KEY = 'gejast_paardenrace_room_code_v425';
  function sessionToken(){ return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; }
  async function rpc(fn, args={}){
    const token = sessionToken();
    const body = Object.assign({}, args, {
      session_token: token || null,
      session_token_input: token || null
    });
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
  function suitLabel(s){ return ({hearts:'♥ Harten',diamonds:'♦ Ruiten',clubs:'♣ Klaveren',spades:'♠ Schoppen'})[String(s||'').toLowerCase()] || '—'; }
  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m]));
  }
  function parseCard(card){
    const raw = String(card || '').trim().toUpperCase();
    if(!raw) return { raw:'', suit:'', rank:'', symbol:'?', color:'#17130f', label:'Onbekend' };
    const suitCode = raw.slice(-1);
    const rank = raw.slice(0, -1) || '?';
    const suitMap = {
      H: { suit:'hearts', symbol:'♥', color:'#a11f35', label:'Harten' },
      D: { suit:'diamonds', symbol:'♦', color:'#b76b00', label:'Ruiten' },
      C: { suit:'clubs', symbol:'♣', color:'#245b2a', label:'Klaveren' },
      S: { suit:'spades', symbol:'♠', color:'#1c2f5c', label:'Schoppen' }
    };
    const suit = suitMap[suitCode] || { suit:'', symbol:'?', color:'#17130f', label:'Onbekend' };
    return { raw, rank, ...suit };
  }
  function cardFaceHtml(card, opts={}){
    const info = parseCard(card);
    const small = !!opts.small;
    const face = !!opts.face;
    if(!face){
      return `<div class="pr-card-face ${small ? 'small' : ''} is-back"><img src="./paardenrace-card-back.png" alt="Gesloten kaart" /></div>`;
    }
    return `
      <div class="pr-card-face ${small ? 'small' : ''} is-face" style="--card-accent:${info.color}">
        <div class="pr-card-corner top" style="color:${info.color}">${escapeHtml(info.rank)}<span>${escapeHtml(info.symbol)}</span></div>
        <div class="pr-card-core" style="color:${info.color}">${escapeHtml(info.rank)}${escapeHtml(info.symbol)}</div>
        <div class="pr-card-corner bottom" style="color:${info.color}">${escapeHtml(info.rank)}<span>${escapeHtml(info.symbol)}</span></div>
      </div>`;
  }
  function renderBoard(match, options={}){
    if(!match || !match.horse_positions) return '<div class="muted">Nog geen actieve race.</div>';
    const compact = !!options.compact;
    const pos = match.horse_positions || {};
    const gateCards = Array.isArray(match.gate_cards) ? match.gate_cards : (match.gate_cards || []);
    const resolved = new Set(Array.isArray(match.resolved_gates) ? match.resolved_gates.map((n)=>Number(n)) : []);
    const draws = Array.isArray(match.revealed_draw_cards) ? match.revealed_draw_cards : [];
    const drawIndex = Number(match.draw_index || draws.length || 0);
    const totalDrawCards = Array.isArray(match.draw_deck) ? match.draw_deck.length : 38;
    const remainingCount = Math.max(0, totalDrawCards - drawIndex);
    const laneY = { hearts: 22, diamonds: 40, clubs: 58, spades: 76 };
    const horseIcon = { hearts:'♥', diamonds:'♦', clubs:'♣', spades:'♠' };
    const labels = { hearts:'Harten', diamonds:'Ruiten', clubs:'Klaveren', spades:'Schoppen' };
    const stepXs = [8, 16, 23, 30, 37, 44, 51, 58, 65, 72, 79, 88];
    const gates = Array.from({length:10}, (_,idx)=>({ no: idx+1, x: stepXs[idx+1], y: 7.5, card: gateCards[idx] || '', open: resolved.has(idx+1) }));
    const horses = ['hearts','diamonds','clubs','spades'].map((s)=>{
      const raw = Number(pos[s] || 0);
      const clamped = Math.max(0, Math.min(11, raw));
      return { suit:s, x:stepXs[clamped], y:laneY[s], label:labels[s], icon:horseIcon[s], position:raw };
    });
    const recentCards = draws.slice(-8).reverse();
    const recent = recentCards.length ? recentCards.map((card)=>cardFaceHtml(card,{small:true,face:true})).join('') : '<span class="muted">Nog geen kaarten getrokken.</span>';
    const gateLegend = gates.map((g)=>`<div class="pr-gate-chip ${g.open?'is-open':''}">
      <strong>Gate ${g.no}</strong>
      <div class="pr-gate-chip-visual">${g.open ? cardFaceHtml(g.card,{small:true,face:true}) : cardFaceHtml('',{small:true,face:false})}</div>
    </div>`).join('');
    const horseLegend = horses.map((h)=>`<div class="pr-horse-chip ${h.suit}">
      <strong>${h.icon} ${h.label}</strong>
      <span>positie ${h.position >= 11 ? 'finish' : h.position}</span>
    </div>`).join('');
    const winnerSymbol = ({hearts:'♥',diamonds:'♦',clubs:'♣',spades:'♠'})[match.winner_suit] || '♥';
    const burstCards = Array.from({length:18}, (_,i)=>`<span class="burst-card" style="--dx:${[-220,-160,-80,0,80,160,220,-220,-150,-60,60,150,220,-130,-30,30,130,0][i]}px;--dy:${[-110,-200,-250,-270,-250,-200,-110,30,110,160,160,110,30,-40,-140,-140,-40,220][i]}px;animation-delay:${(i%6)*0.08}s">${winnerSymbol}</span>`).join('');
    return `
      <div class="pr-track-shell${compact ? ' compact' : ''}">
        <div class="pr-track-stage">
          <img class="pr-track-image" src="./paardenrace-track.png" alt="Paardenrace baan" />
          <div class="pr-deck-stack" title="Resterende trekstapel">
            <div class="pr-stack-count">${remainingCount}</div>
            <div class="pr-stack-cards">
              ${cardFaceHtml('',{face:false})}
              ${cardFaceHtml('',{face:false})}
              ${cardFaceHtml('',{face:false})}
            </div>
          </div>
          ${gates.map((g)=>`<div class="pr-gate-marker ${g.open?'is-open':''}" style="left:${g.x}%;top:${g.y}%">${g.open ? cardFaceHtml(g.card,{small:true,face:true}) : cardFaceHtml('',{small:true,face:false})}</div>`).join('')}
          ${horses.map((h)=>`<div class="pr-horse-marker ${h.suit}" style="left:${h.x}%;top:${h.y}%"><span class="pr-horse-badge">${h.icon}</span></div>`).join('')}
          ${match.winner_suit ? `<div class="pr-winner-overlay ${match.winner_suit}"><img src="./paardenrace-horses-sheet.png" alt="" class="pr-winner-horses" /><div class="pr-winner-burst">${burstCards}</div></div>` : ''}
        </div>
        <div class="pr-track-meta">
          <div class="pr-side-art"><img src="./paardenrace-cards-sheet.png" alt="Paardenrace kaarten" /></div>
          <div><div class="small">Laatste kaarten</div><div class="pr-card-row">${recent}</div></div>
          <div><div class="small">Gates</div><div class="pr-gate-grid">${gateLegend}</div></div>
          <div><div class="small">Paarden</div><div class="pr-horse-grid">${horseLegend}</div></div>
        </div>
      </div>`;
  }
  function gotoLive(room){ window.location.href = `./paardenrace_live.html?room=${encodeURIComponent(room)}`; }
  window.GEJAST_PAARDENRACE = { rpc, sessionToken, getStoredRoomCode, setStoredRoomCode, clearStoredRoomCode, suitLabel, renderBoard, gotoLive };
})();