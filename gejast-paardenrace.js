(function(global){
  const cfg = global.GEJAST_CONFIG || {};
  const KEY = cfg.SUPABASE_PUBLISHABLE_KEY || '';
  const URL = cfg.SUPABASE_URL || '';
  const ROOM_KEY = 'gejast_paardenrace_room_code_v1';
  const LIVE_PATH = './paardenrace_live.html';
  function sessionToken(){ return cfg.getPlayerSessionToken ? cfg.getPlayerSessionToken() : ''; }
  function headers(){ return { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const txt = await res.text(); let data=null; try{ data = txt ? JSON.parse(txt) : null; } catch(_){ throw new Error(txt || `HTTP ${res.status}`); } if(!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || `HTTP ${res.status}`); return data; }
  async function rpc(name, body){ const res = await fetch(`${URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers: headers(), body: JSON.stringify(Object.assign({ session_token: sessionToken(), session_token_input: sessionToken() }, body || {})) }); const raw = await parse(res); return raw?.[name] ?? raw; }
  function getStoredRoomCode(){ return String(localStorage.getItem(ROOM_KEY) || '').trim().toUpperCase(); }
  function setStoredRoomCode(code){ const v = String(code || '').trim().toUpperCase(); if(v) localStorage.setItem(ROOM_KEY, v); else localStorage.removeItem(ROOM_KEY); return v; }
  function clearStoredRoomCode(){ localStorage.removeItem(ROOM_KEY); }
  function gotoLive(code){ const roomCode = setStoredRoomCode(code || getStoredRoomCode()); if(!roomCode) return; location.href = `${LIVE_PATH}?room=${encodeURIComponent(roomCode)}`; }
  function suitLabel(suit){ return ({ hearts:'Harten', diamonds:'Ruiten', clubs:'Klaveren', spades:'Schoppen' })[String(suit||'').toLowerCase()] || '—'; }
  function suitSymbol(suit){ return ({ hearts:'♥', diamonds:'♦', clubs:'♣', spades:'♠' })[String(suit||'').toLowerCase()] || '•'; }
  function raceCellClass(pos, step){ if (pos === 11 && step === 11) return 'horse'; if (pos === step) return 'horse'; return ''; }
  function renderBoard(match){ const state = match || {}; const positions = state.horse_positions || {}; const gates = state.gate_cards || []; const revealed = new Set((state.revealed_gates || []).map(Number)); const suits = ['hearts','diamonds','clubs','spades']; const laneTitle = { hearts:'Harten', diamonds:'Ruiten', clubs:'Klaveren', spades:'Schoppen' }; let html = '<div class="pr-board-wrap"><div class="pr-gates">'; html += '<div class="pr-gate-label">Gate</div>'; for(let n=1;n<=10;n++){ const code = gates[n-1] || ''; const suit = code ? ({H:'hearts',D:'diamonds',C:'clubs',S:'spades'})[String(code).slice(-1)] : ''; html += `<div class="pr-gate ${revealed.has(n)?'is-revealed':''}">${revealed.has(n)?`${suitSymbol(suit)}<span>${n}</span>`:`<span>${n}</span>`}</div>`; } html += '</div><div class="pr-lanes">'; suits.forEach((suit)=>{ const pos = Number(positions[suit] || 0); html += `<div class="pr-lane"><div class="pr-lane-label">${suitSymbol(suit)} ${laneTitle[suit]}</div>`; html += `<div class="pr-cell start ${raceCellClass(pos,0)}">Start</div>`; for(let step=1;step<=10;step++) html += `<div class="pr-cell ${raceCellClass(pos,step)}">${step}</div>`; html += `<div class="pr-cell finish ${raceCellClass(pos,11)}">Finish</div></div>`; }); html += '</div></div>'; return html; }
  function totalOwedForPlayer(summary, playerName){ const rows = Array.isArray(summary?.per_player) ? summary.per_player : []; const row = rows.find((r)=>String(r.player_name||'').toLowerCase()===String(playerName||'').toLowerCase()); return row ? Number(row.total_bakken_owed || 0) : 0; }
  global.GEJAST_PAARDENRACE = { rpc, sessionToken, getStoredRoomCode, setStoredRoomCode, clearStoredRoomCode, gotoLive, suitLabel, suitSymbol, renderBoard, totalOwedForPlayer };
})(window);
