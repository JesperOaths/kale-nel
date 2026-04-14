(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const STORAGE_KEY = 'gejast_paardenrace_room_code_v435';
  function sessionToken(){ return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; }
  const SESSIONLESS_RPC = new Set([
    'get_paardenrace_open_rooms_public'
  ]);
  async function rpc(fn, args={}){
    const token = sessionToken();
    if (cfg.touchPlayerActivity && token) { try { cfg.touchPlayerActivity(); } catch(_){} }
    const body = Object.assign({}, args);
    if (!SESSIONLESS_RPC.has(String(fn||''))) {
      if (!Object.prototype.hasOwnProperty.call(body, 'session_token')) body.session_token = token || null;
      if (!Object.prototype.hasOwnProperty.call(body, 'session_token_input')) body.session_token_input = token || null;
    }
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
  function renderBoard(match){
    if(!match || !match.horse_positions) return '<div class="muted">Nog geen actieve race.</div>';
    const pos = match.horse_positions || {};
    const gateCards = Array.isArray(match.gate_cards) ? match.gate_cards : (match.gate_cards || []);
    const resolved = new Set(Array.isArray(match.resolved_gates) ? match.resolved_gates : []);
    const draws = Array.isArray(match.revealed_draw_cards) ? match.revealed_draw_cards : [];
    const rows = ['hearts','diamonds','clubs','spades'].map((s)=>{
      const p = Number(pos[s]||0);
      let cells = '<span class="lane-cell">Start</span>';
      for(let i=1;i<=10;i++) cells += `<span class="lane-cell${p===i?' active':''}">${i}</span>`;
      cells += `<span class="lane-cell${p>=11?' active':''}">Finish</span>`;
      return `<div style="margin:8px 0"><strong>${suitLabel(s)}</strong><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${cells}</div></div>`;
    }).join('');
    const gates = Array.from({length:10}, (_,idx)=>`<span class="badge" style="margin:2px">Gate ${idx+1}: ${resolved.has(idx+1) ? (gateCards[idx]||'open') : 'gesloten'}</span>`).join('');
    return `<div><div class="small" style="margin-bottom:8px">Laatste kaarten: ${draws.slice(-5).join(', ') || 'nog geen'}</div>${gates}${rows}</div>`;
  }
  function gotoLive(room){ window.location.href = `./paardenrace_live.html?room=${encodeURIComponent(room)}`; }
  window.GEJAST_PAARDENRACE = { rpc, sessionToken, getStoredRoomCode, setStoredRoomCode, clearStoredRoomCode, suitLabel, renderBoard, gotoLive };
})();
