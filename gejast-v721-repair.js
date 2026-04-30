(function(){
  const VERSION='v721';
  const TERMINAL=new Set(['finished','closed','deleted','abandoned','archived']);
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fn,{once:true}); else fn(); }
  function txt(v){ return String(v==null?'':v); }
  function normRoom(raw){ let v=txt(raw).trim(); if(!v) return ''; v=v.replace(/\+/g,' '); for(let i=0;i<5 && /%[0-9a-f]{2}/i.test(v);i++){ try{ const d=decodeURIComponent(v); if(d===v) break; v=d.replace(/\+/g,' '); }catch(_){ break; } } return v.toUpperCase().replace(/\s+/g,' ').replace(/[^A-Z0-9 _-]/g,'').trim(); }
  function esc(v){ return txt(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function clearPikkenStore(){ try{ localStorage.removeItem('gejast_pikken_participant_v687'); localStorage.removeItem('gejast_pikken_participant_v632'); }catch(_){} }
  function phaseOf(payload){ return txt(payload&&payload.game&&(payload.game.state&&payload.game.state.phase || payload.game.status) || '').toLowerCase(); }
  function patchPikkenContract(){
    const api=window.GEJAST_PIKKEN_CONTRACT; if(!api || api.__v721Patched) return; api.__v721Patched=true;
    const oldGet=api.getState&&api.getState.bind(api);
    if(oldGet) api.getState=async function(gameId, code){ const p=await oldGet(gameId, code); const ph=phaseOf(p); if(TERMINAL.has(ph)){ clearPikkenStore(); try{ sessionStorage.setItem('gejast_pikken_last_terminal_v721', JSON.stringify({gameId,ph,at:Date.now()})); }catch(_){} } return p; };
    const oldStart=api.startGame&&api.startGame.bind(api);
    api.startGame=async function(gameId){
      if(api.rpc){ try{ return await api.rpc('pikken_start_game_scoped_v721', { session_token: api.sessionToken&&api.sessionToken(), session_token_input: api.sessionToken&&api.sessionToken(), game_id_input: gameId, site_scope_input: api.scope&&api.scope() }, 4200); }catch(err){ if(!/could not find|schema cache|does not exist|function/i.test(txt(err&&err.message))) throw err; } }
      return oldStart ? oldStart(gameId) : Promise.reject(new Error('Pikken start-RPC ontbreekt.'));
    };
  }
  function displayCode(code){ const m=txt(code).trim().match(/^DESPINOZA\s*(\d+)$/i); return m?'Despinoza '+m[1]:txt(code); }
  function liveHref(id){ const api=window.GEJAST_PIKKEN_CONTRACT; return './pikken_live.html?client_match_id='+encodeURIComponent(txt(id))+(api&&api.scope&&api.scope()==='family'?'&scope=family':''); }
  async function refreshPikkenFeeds(){
    if(!/pikken\.html/i.test(location.pathname)) return;
    const api=window.GEJAST_PIKKEN_CONTRACT; if(!api) return;
    try{ api.cleanupStale&&api.cleanupStale().catch(()=>{}); }catch(_){}
    const lobbyBox=document.getElementById('pkLobbyFeed'), liveBox=document.getElementById('pkLiveFeed');
    try{
      const raw=await api.openLobbies(); const rows=Array.isArray(raw)?raw:(raw&&(raw.rows||raw.lobbies||raw.items||raw.matches))||[];
      if(lobbyBox) lobbyBox.innerHTML=rows.length?rows.map(r=>`<article class="feed-card"><div class="feed-head"><div><div class="feed-title">${esc(displayCode(r.lobby_code||r.code||''))}</div><div class="feed-meta">${esc(r.host_name||r.created_by_player_name||'Host')} · ${Number(r.player_count||0)} speler(s) · ${Number(r.ready_count||0)} ready</div></div><span class="pill wait">Lobby</span></div><div class="feed-actions"><button class="btn alt tiny" data-v721-join-code="${esc(r.lobby_code||r.code||'')}">Join</button></div></article>`).join(''):'<div class="muted">Geen open Pikken-lobbies.</div>';
    }catch(e){ if(lobbyBox) lobbyBox.innerHTML='<div class="muted">Open lobbies konden niet laden: '+esc(e.message||e)+'</div>'; }
    try{
      const raw=await api.liveMatches(); const rows=Array.isArray(raw)?raw:(raw&&(raw.rows||raw.matches||raw.items||raw.lobbies))||[];
      if(liveBox) liveBox.innerHTML=rows.length?rows.map(r=>`<article class="feed-card" data-live="1"><div class="feed-head"><div><div class="feed-title">${esc(displayCode(r.lobby_code||r.code||'Pikken'))}</div><div class="feed-meta">${esc(r.phase||r.status||'live')} · ronde ${Number(r.round_no||0)} · ${Number(r.player_count||0)} speler(s)</div></div><span class="pill ok">Live</span></div><div class="feed-actions"><a class="btn alt tiny" href="${liveHref(r.game_id||r.id)}">Open live</a></div></article>`).join(''):'<div class="muted">Geen live Pikken-matches.</div>';
    }catch(e){ if(liveBox) liveBox.innerHTML='<div class="muted">Live matches konden niet laden: '+esc(e.message||e)+'</div>'; }
  }
  function patchPikkenPage(){
    if(!/pikken\.html/i.test(location.pathname)) return;
    document.querySelectorAll('details.accordion').forEach(d=>{ if(/regels/i.test(d.textContent||'')) d.remove(); });
    ['pkJoinFieldWrap','pkJoinWrap','pkJoinCode','pkJoinLobbyBtn'].forEach(id=>{ const el=document.getElementById(id); if(el){ el.classList.add('hidden'); el.style.display='none'; } });
    document.addEventListener('click', async ev=>{ const b=ev.target.closest('[data-v721-join-code]'); if(!b) return; ev.preventDefault(); const api=window.GEJAST_PIKKEN_CONTRACT; try{ const out=await api.joinLobby(b.getAttribute('data-v721-join-code')||''); const id=out&& (out.game_id||out.id||out.game&&out.game.id); if(id) location.href='./pikken.html?game_id='+encodeURIComponent(id)+(api.scope&&api.scope()==='family'?'&scope=family':''); }catch(e){ const s=document.getElementById('pkStatus'); if(s){ s.textContent=e.message||String(e); s.style.color='#8b2d20'; } } });
    refreshPikkenFeeds(); window.__gejastV721PikkenFeedTimer=window.__gejastV721PikkenFeedTimer||setInterval(()=>{ if(!document.hidden) refreshPikkenFeeds(); }, 1800);
  }
  function patchPikkenLive(){
    if(!/pikken_live\.html/i.test(location.pathname)) return;
    const check=()=>{
      document.querySelectorAll('section,.panel,div').forEach(n=>{ const h=n.querySelector&&n.querySelector('h2'); if(h && /pikken\s+statuslaag/i.test(h.textContent||'')) n.style.display='none'; });
      const ph=txt(document.getElementById('phasePill')&&document.getElementById('phasePill').textContent).trim().toLowerCase();
      const meta=txt(document.getElementById('metaLine')&&document.getElementById('metaLine').textContent).toLowerCase();
      if(TERMINAL.has(ph) || /finished|gesloten|abandoned|closed/.test(meta)){ clearPikkenStore(); const m=document.getElementById('metaLine'); if(m) m.textContent='Match is afgelopen; terug naar de lobby...'; setTimeout(()=>location.replace('./pikken.html'),700); }
    };
    check(); setInterval(check,700);
  }
  function patchPaardenrace(){
    const api=window.GEJAST_PAARDENRACE; if(!api || api.__v721Patched) return; api.__v721Patched=true; api.normalizeRoomCode=api.normalizeRoomCode||normRoom;
    const oldRpc=api.rpc&&api.rpc.bind(api); if(oldRpc) api.rpc=function(fn,args,options){ const next=Object.assign({}, args||{}); if(next.room_code_input!=null) next.room_code_input=normRoom(next.room_code_input); return oldRpc(fn,next,options); };
    api.liveHref=function(room){ const code=normRoom(room); const url=new URL('./paardenrace_live.html',location.href); if(code){ url.searchParams.set('room',code); url.searchParams.set('live',code); } try{ if(api.scope&&api.scope()==='family') url.searchParams.set('scope','family'); }catch(_){} return url.pathname.split('/').pop()+url.search; };
    api.gotoLive=function(room,options={}){ const href=api.liveHref(room); options&&options.replace?location.replace(href):location.href=href; };
  }
  function patchPaardenracePages(){
    if(!/paardenrace(_live)?\.html/i.test(location.pathname)) return;
    const params=new URLSearchParams(location.search); const raw=params.get('room')||params.get('live')||''; const clean=normRoom(raw);
    if(clean){ try{ localStorage.setItem('gejast_paardenrace_room_code_v687',clean); }catch(_){} if(raw!==clean){ params.set('room',clean); params.set('live',clean); history.replaceState(null,'',location.pathname.split('/').pop()+'?'+params.toString()); } }
    ['joinBtn'].forEach(id=>{ const el=document.getElementById(id); if(el){ el.classList.add('hidden'); el.style.display='none'; } });
    const inp=document.getElementById('roomCodeInput'); if(inp){ inp.readOnly=true; inp.setAttribute('aria-readonly','true'); inp.style.display='none'; }
  }
  function patchBadgeCss(){
    if(!/profiles\.html/i.test(location.pathname) || document.getElementById('gejast-v721-badges-css')) return;
    const s=document.createElement('style'); s.id='gejast-v721-badges-css';
    s.textContent='.badge-list{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))!important;gap:14px!important;padding:16px!important}.badge-row{display:grid!important;grid-template-rows:auto 1fr!important;grid-template-columns:1fr!important;gap:12px!important;min-height:315px!important;padding:14px!important}.badge-icon{width:min(180px,100%)!important;height:180px!important;object-fit:contain!important;justify-self:center!important}.badge-row>div:last-child{display:grid!important;gap:6px!important;align-content:start!important}.badge-desc{font-size:13px!important;line-height:1.35!important}.badge-req{font-size:12px!important;line-height:1.35!important;background:#fbf7ef!important;border:1px solid rgba(17,17,17,.06)!important;border-radius:12px!important;padding:8px!important}@media(max-width:560px){.badge-list{grid-template-columns:1fr!important}.badge-row{min-height:0!important}.badge-icon{height:210px!important;width:min(210px,100%)!important}}';
    document.head.appendChild(s);
  }
  function boot(){ patchPikkenContract(); patchPikkenPage(); patchPikkenLive(); patchPaardenrace(); patchPaardenracePages(); patchBadgeCss(); }
  ready(boot); setInterval(boot,900);
})();
