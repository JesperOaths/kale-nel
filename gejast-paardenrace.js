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
  function renderBoard(match, options={}){
    if(!match || !match.horse_positions) return '<div class="muted">Nog geen actieve race.</div>';
    const compact = !!options.compact;
    const pos = match.horse_positions || {};
    const gateCards = Array.isArray(match.gate_cards) ? match.gate_cards : (match.gate_cards || []);
    const resolved = new Set(Array.isArray(match.resolved_gates) ? match.resolved_gates.map((n)=>Number(n)) : []);
    const draws = Array.isArray(match.revealed_draw_cards) ? match.revealed_draw_cards : [];
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
    const recent = draws.slice(-8).map((card)=>`<span class="pr-card-chip">${card}</span>`).join('') || '<span class="muted">Nog geen kaarten getrokken.</span>';
    const gateLegend = gates.map((g)=>`<div class="pr-gate-chip ${g.open?'is-open':''}"><strong>Gate ${g.no}</strong>${g.open ? `<span>${g.card || 'open'}</span>` : '<span>gesloten</span>'}</div>`).join('');
    const horseLegend = horses.map((h)=>`<div class="pr-horse-chip ${h.suit}"><strong>${h.icon} ${h.label}</strong><span>positie ${h.position >= 11 ? 'finish' : h.position}</span></div>`).join('');
    return `
      <div class="pr-track-shell${compact ? ' compact' : ''}">
        <div class="pr-track-stage">
          <img class="pr-track-image" src="./paardenrace-track.png" alt="Paardenrace baan" />
          ${gates.map((g)=>`<div class="pr-gate-marker ${g.open?'is-open':''}" style="left:${g.x}%;top:${g.y}%">${g.open ? (g.card || g.no) : g.no}</div>`).join('')}
          ${horses.map((h)=>`<div class="pr-horse-marker ${h.suit}" style="left:${h.x}%;top:${h.y}%"><span>${h.icon}</span></div>`).join('')}
        </div>
        <div class="pr-track-meta">
          <div>
            <div class="small">Laatste kaarten</div>
            <div class="pr-card-row">${recent}</div>
          </div>
          <div>
            <div class="small">Gates</div>
            <div class="pr-gate-grid">${gateLegend}</div>
          </div>
          <div>
            <div class="small">Paarden</div>
            <div class="pr-horse-grid">${horseLegend}</div>
          </div>
        </div>
      </div>`;
  }
  function gotoLive(room){ window.location.href = `./paardenrace_live.html?room=${encodeURIComponent(room)}`; }
  window.GEJAST_PAARDENRACE = { rpc, sessionToken, getStoredRoomCode, setStoredRoomCode, clearStoredRoomCode, suitLabel, renderBoard, gotoLive };
})();
