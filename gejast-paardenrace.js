(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const STORAGE_KEY = 'gejast_paardenrace_room_code_v429';
  const POLL_MS = 1200;
  const LANE_META = {
    hearts:{label:'♥ Harten', color:'#b21f35', icon:'♥'},
    diamonds:{label:'♦ Ruiten', color:'#a86a1a', icon:'♦'},
    clubs:{label:'♣ Klaveren', color:'#2f5b31', icon:'♣'},
    spades:{label:'♠ Schoppen', color:'#212121', icon:'♠'}
  };
  function sessionToken(){ return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; }
  async function rpc(fn, args={}){
    const token = sessionToken();
    const body = Object.assign({}, args, { session_token: token || null, session_token_input: token || null });
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method:'POST',
      headers:{
        apikey: cfg.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type':'application/json',
        Accept:'application/json',
        'Cache-Control':'no-store, no-cache, max-age=0',
        Pragma:'no-cache'
      },
      cache:'no-store',
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if(!res.ok){
      const msg = data && typeof data === 'object' ? (data.message || data.error || data.hint || JSON.stringify(data)) : (text || 'Onbekende fout');
      throw new Error(msg);
    }
    return data;
  }
  function getStoredRoomCode(){ return localStorage.getItem(STORAGE_KEY) || ''; }
  function setStoredRoomCode(code){ if(code) localStorage.setItem(STORAGE_KEY, String(code).trim().toUpperCase()); }
  function clearStoredRoomCode(){ localStorage.removeItem(STORAGE_KEY); }
  function suitLabel(s){ return (LANE_META[String(s||'').toLowerCase()]||{}).label || '—'; }
  function suitColor(s){ return (LANE_META[String(s||'').toLowerCase()]||{}).color || '#333'; }
  function suitIcon(s){ return (LANE_META[String(s||'').toLowerCase()]||{}).icon || '•'; }
  function cardSuit(card){
    const c = String(card||'').toUpperCase();
    const suit = c.slice(-1);
    return ({H:'hearts',D:'diamonds',C:'clubs',S:'spades'})[suit] || null;
  }
  function lanePositionPct(pos){
    const stops = [2,10,18,26,34,42,50,58,66,74,82,92];
    const idx = Math.max(0, Math.min(11, Number(pos||0)));
    return stops[idx];
  }
  function escapeHtml(v){ return String(v==null?'':v).replace(/[&<>"']/g, (m)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
  function renderTrack(match, players){
    if(!match || !match.horse_positions) return '<div class="muted">Nog geen actieve race.</div>';
    const pos = match.horse_positions || {};
    const gateCards = Array.isArray(match.gate_cards) ? match.gate_cards : [];
    const resolved = new Set(Array.isArray(match.resolved_gates) ? match.resolved_gates.map(Number) : []);
    const draws = Array.isArray(match.revealed_draw_cards) ? match.revealed_draw_cards : [];
    const bettorSummary = Array.isArray(players) ? players.map((p)=>`<div class="bet-row"><span class="bet-name">${escapeHtml(p.player_name||'—')}</span><span class="bet-meta">${escapeHtml(suitLabel(p.selected_suit))} · <strong>${Number(p.wager_bakken||0)} Bakken</strong></span></div>`).join('') : '';
    const lanes = ['hearts','diamonds','clubs','spades'].map((s,idx)=>{
      const pct = lanePositionPct(Number(pos[s]||0));
      return `<div class="track-lane lane-${s}" data-suit="${s}"><div class="horse-token" style="left:${pct}%"><span class="horse-token-inner" style="background:${suitColor(s)}">${escapeHtml(suitIcon(s))}</span></div></div>`;
    }).join('');
    const gates = Array.from({length:10}, (_,i)=>{
      const n = i+1; const open = resolved.has(n); const card = open ? (gateCards[i]||'') : '🂠';
      return `<div class="gate-slot ${open?'open':''}"><div class="gate-num">${n}</div><div class="gate-card">${escapeHtml(card || '🂠')}</div></div>`;
    }).join('');
    return `<div class="race-scene"><div class="gate-row">${gates}</div><div class="track-board"><img src="./paardenrace-track.png" alt="Paardenrace track" class="track-bg"/>${lanes}</div><div class="recent-cards"><strong>Laatste kaarten:</strong> ${draws.slice(-8).map((c)=>`<span class="recent-card">${escapeHtml(c)}</span>`).join('') || '<span class="muted">nog geen</span>'}</div><div class="bets-panel"><div class="bets-title">Inzetten in deze race</div>${bettorSummary || '<div class="muted">Nog geen bettors.</div>'}</div></div>`;
  }
  function gotoLive(room){ window.location.href = `./paardenrace_live.html?room=${encodeURIComponent(room)}`; }
  function getRoomFromQuery(){ try{ return new URLSearchParams(location.search).get('room') || ''; }catch(_){ return ''; } }
  window.GEJAST_PAARDENRACE = { rpc, sessionToken, getStoredRoomCode, setStoredRoomCode, clearStoredRoomCode, suitLabel, suitColor, suitIcon, cardSuit, lanePositionPct, renderTrack, gotoLive, getRoomFromQuery, POLL_MS, escapeHtml };
})();
