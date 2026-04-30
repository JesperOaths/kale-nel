(function(){
  const VERSION='v722';
  const TERMINAL=new Set(['closed','deleted','abandoned','archived']);
  const FINISHED=new Set(['finished']);
  const PIKKEN_KEYS=['gejast_pikken_participant_v687','gejast_pikken_participant_v632'];
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fn,{once:true}); else fn(); }
  function txt(v){ return String(v==null?'':v); }
  function esc(v){ return txt(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function phaseOf(payload){ return txt(payload&&payload.game&&(payload.game.state&&payload.game.state.phase || payload.game.status) || '').toLowerCase(); }
  function clearPikkenStore(){ try{ PIKKEN_KEYS.forEach(k=>localStorage.removeItem(k)); }catch(_){} }
  function normRoom(raw){ let value=txt(raw).trim().replace(/\+/g,' '); for(let i=0;i<5 && /%[0-9a-f]{2}/i.test(value);i++){ try{ const next=decodeURIComponent(value).replace(/\+/g,' '); if(next===value) break; value=next; }catch(_){ break; } } return value.toUpperCase().replace(/\s+/g,' ').replace(/[^A-Z0-9 _-]/g,'').trim(); }
  function patchPikkenContract(){
    const api=window.GEJAST_PIKKEN_CONTRACT; if(!api || api.__v722Patched) return; api.__v722Patched=true;
    const oldGet=api.getState&&api.getState.bind(api);
    if(oldGet) api.getState=async function(gameId, code){
      const p=await oldGet(gameId, code);
      const ph=phaseOf(p);
      if(TERMINAL.has(ph)){ clearPikkenStore(); }
      return p;
    };
    const oldCreate=api.createLobby&&api.createLobby.bind(api);
    if(oldCreate && api.rpc) api.createLobby=async function(config){
      const payload={session_token:api.sessionToken&&api.sessionToken(),session_token_input:api.sessionToken&&api.sessionToken(),config_input:config||{},site_scope_input:api.scope&&api.scope()};
      try { return await api.rpc('pikken_create_lobby_fast_v722', payload, 5000); } catch(err){ if(!/could not find|schema cache|does not exist|function/i.test(txt(err&&err.message))) throw err; return oldCreate(config); }
    };
    const oldJoin=api.joinLobby&&api.joinLobby.bind(api);
    if(oldJoin && api.rpc) api.joinLobby=async function(code){
      const payload={session_token:api.sessionToken&&api.sessionToken(),session_token_input:api.sessionToken&&api.sessionToken(),lobby_code_input:api.cleanCode?api.cleanCode(code):code,site_scope_input:api.scope&&api.scope()};
      try { return await api.rpc('pikken_join_lobby_fast_v722', payload, 5000); } catch(err){ if(!/could not find|schema cache|does not exist|function/i.test(txt(err&&err.message))) throw err; return oldJoin(code); }
    };
    const oldStart=api.startGame&&api.startGame.bind(api);
    api.startGame=async function(gameId){
      if(api.rpc){ try{ return await api.rpc('pikken_start_game_scoped_v722', { session_token: api.sessionToken&&api.sessionToken(), session_token_input: api.sessionToken&&api.sessionToken(), game_id_input: gameId, site_scope_input: api.scope&&api.scope() }, 5000); }catch(err){ if(!/could not find|schema cache|does not exist|function/i.test(txt(err&&err.message))) throw err; } }
      return oldStart ? oldStart(gameId) : Promise.reject(new Error('Pikken start-RPC ontbreekt.'));
    };
    if(api.rpc){
      api.cleanupStale=function(){ return api.rpc('cleanup_stale_pikken_rooms_v722',{site_scope_input:api.scope&&api.scope()},2200); };
      api.openLobbies=function(){ return api.rpc('get_pikken_open_lobbies_fast_v722',{site_scope_input:api.scope&&api.scope(),limit_input:30},3500); };
      api.liveMatches=function(){ return api.rpc('get_pikken_live_matches_fast_v722',{site_scope_input:api.scope&&api.scope(),limit_input:30},3500); };
      api.updateLobbyConfig=function(gameId, config){ return api.rpc('pikken_update_lobby_config_v722',{session_token:api.sessionToken&&api.sessionToken(),session_token_input:api.sessionToken&&api.sessionToken(),game_id_input:gameId,config_input:config||{},site_scope_input:api.scope&&api.scope()},3500); };
    }
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
      if(lobbyBox) lobbyBox.innerHTML=rows.length?rows.map(r=>`<article class="feed-card"><div class="feed-head"><div><div class="feed-title">${esc(displayCode(r.lobby_code||r.code||''))}</div><div class="feed-meta">${esc(r.host_name||r.created_by_player_name||'Host')} · ${Number(r.player_count||0)} speler(s) · ${Number(r.ready_count||0)} ready</div></div><span class="pill wait">Lobby</span></div><div class="feed-actions"><button class="btn alt tiny" data-v722-join-code="${esc(r.lobby_code||r.code||'')}">Join</button></div></article>`).join(''):'<div class="muted">Geen open Pikken-lobbies.</div>';
    }catch(e){ if(lobbyBox) lobbyBox.innerHTML='<div class="muted">Open lobbies konden niet laden: '+esc(e.message||e)+'</div>'; }
    try{
      const raw=await api.liveMatches(); const rows=Array.isArray(raw)?raw:(raw&&(raw.rows||raw.matches||raw.items||raw.lobbies))||[];
      if(liveBox) liveBox.innerHTML=rows.length?rows.map(r=>`<article class="feed-card" data-live="1"><div class="feed-head"><div><div class="feed-title">${esc(displayCode(r.lobby_code||r.code||'Pikken'))}</div><div class="feed-meta">${esc(r.phase||r.status||'live')} · ronde ${Number(r.round_no||0)} · ${Number(r.player_count||0)} speler(s)</div></div><span class="pill ok">Live</span></div><div class="feed-actions"><a class="btn alt tiny" href="${liveHref(r.game_id||r.id)}">Open live</a></div></article>`).join(''):'<div class="muted">Geen live Pikken-matches.</div>';
    }catch(e){ if(liveBox) liveBox.innerHTML='<div class="muted">Live matches konden niet laden: '+esc(e.message||e)+'</div>'; }
  }
  function patchPikkenPage(){
    if(!/pikken\.html/i.test(location.pathname)) return;
    ['pkJoinFieldWrap','pkJoinWrap','pkJoinCode','pkJoinLobbyBtn'].forEach(id=>{ const el=document.getElementById(id); if(el){ el.classList.add('hidden'); el.style.display='none'; } });
    document.querySelectorAll('details.accordion').forEach(d=>{ if(/regels/i.test(d.textContent||'')) d.remove(); });
    document.addEventListener('click', async ev=>{ const b=ev.target.closest('[data-v722-join-code]'); if(!b) return; ev.preventDefault(); const api=window.GEJAST_PIKKEN_CONTRACT; try{ const out=await api.joinLobby(b.getAttribute('data-v722-join-code')||''); const id=out&& (out.game_id||out.id||out.game&&out.game.id); if(id) location.href='./pikken.html?game_id='+encodeURIComponent(id)+(api.scope&&api.scope()==='family'?'&scope=family':''); }catch(e){ const s=document.getElementById('pkStatus'); if(s){ s.textContent=e.message||String(e); s.style.color='#8b2d20'; } } });
    refreshPikkenFeeds(); window.__gejastV722PikkenFeedTimer=window.__gejastV722PikkenFeedTimer||setInterval(()=>{ if(!document.hidden) refreshPikkenFeeds(); }, 1600);
  }
  function rankRows(payload){
    const rows=(Array.isArray(payload&&payload.players)?payload.players:[]).slice().sort((a,b)=>{
      const ad=Number(a.dice_count||0), bd=Number(b.dice_count||0);
      const aa=(a.alive && ad>0)?1:0, ba=(b.alive && bd>0)?1:0;
      if(ba!==aa) return ba-aa; if(bd!==ad) return bd-ad;
      return Number(a.seat||a.seat_index||0)-Number(b.seat||b.seat_index||0);
    });
    return rows.map((p,i)=>`<div class="v722-finish-row"><span>${i+1}. ${esc(p.name||p.player_name||'Speler')}</span><span>${Number(p.dice_count||0)} dobbel(s)</span></div>`).join('') || '<div class="v722-finish-row"><span>Geen spelers gevonden</span><span></span></div>';
  }
  function winnerName(payload){ const st=payload&&payload.game&&payload.game.state||{}; if(st.winner_name) return st.winner_name; const alive=(payload.players||[]).filter(p=>p.alive&&Number(p.dice_count||0)>0); return alive.length===1 ? (alive[0].name||alive[0].player_name||'Winnaar') : 'Winnaar'; }
  function showVictory(payload){
    if(document.getElementById('v722VictoryOverlay')) return;
    const winner=winnerName(payload);
    const overlay=document.createElement('div'); overlay.id='v722VictoryOverlay'; overlay.className='v722-victory-overlay';
    overlay.innerHTML=`<div class="v722-victory-card">
      <div class="v722-burst" aria-hidden="true">
        <span class="v722-balloon b1" style="left:8%;top:12%"></span><span class="v722-balloon b2" style="right:10%;top:18%"></span><span class="v722-balloon b3" style="left:18%;bottom:22%"></span>
        <span class="v722-streamer" style="left:-20px;top:42%;--r:18deg"></span><span class="v722-streamer" style="right:-20px;top:36%;--r:-15deg"></span>
        <span class="v722-die" style="left:12%;top:62%">6</span><span class="v722-die" style="right:16%;top:58%">pik</span><span class="v722-die" style="left:46%;top:8%">2</span>
        <img class="v722-logo" src="./logo.png" style="left:8%;top:6%" alt=""><img class="v722-logo" src="./logo.png" style="right:8%;bottom:8%" alt="">
      </div>
      <h2 class="v722-victory-title">Pikken afgelopen</h2>
      <div class="v722-victory-winner">${esc(winner)}</div>
      <div class="v722-victory-sub">Winnaar · match opgeslagen naar geschiedenis/stats zodra de server bevestigt</div>
      <div class="v722-finish-list">${rankRows(payload)}</div>
      <button class="btn v722-victory-close" type="button">Sluiten en terug naar lobby</button>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.v722-victory-close').addEventListener('click',()=>{ clearPikkenStore(); location.replace('./pikken.html'); });
  }
  async function saveFinishedOnce(payload){
    const api=window.GEJAST_PIKKEN_CONTRACT; if(!api||!api.recordCompleted) return;
    const id=payload&&payload.game&&payload.game.id || new URLSearchParams(location.search).get('client_match_id') || '';
    if(!id) return;
    const key='gejast_pikken_completed_saved_'+id;
    try{ if(localStorage.getItem(key)==='1') return; }catch(_){}
    try{ await api.recordCompleted(id); try{ localStorage.setItem(key,'1'); }catch(_){} }catch(_){}
  }
  function patchPikkenLive(){
    if(!/pikken_live\.html/i.test(location.pathname)) return;
    document.querySelectorAll('.rules-copy').forEach(n=>{ const panel=n.closest('.panel'); if(panel) panel.style.display='none'; });
    document.querySelectorAll('section,.panel,div').forEach(n=>{ const h=n.querySelector&&n.querySelector('h2'); if(h && /pikken\s+statuslaag/i.test(h.textContent||'')) n.style.display='none'; });
    let busy=false;
    async function inspect(){
      if(busy) return; busy=true;
      try{
        const api=window.GEJAST_PIKKEN_CONTRACT; const gameId=new URLSearchParams(location.search).get('client_match_id')||new URLSearchParams(location.search).get('game_id')||'';
        if(api&&api.getState&&gameId){
          const payload=await api.getState(gameId); const ph=phaseOf(payload);
          if(FINISHED.has(ph)){ showVictory(payload); saveFinishedOnce(payload); return; }
          if(TERMINAL.has(ph)){ clearPikkenStore(); const m=document.getElementById('metaLine'); if(m) m.textContent='Match is gesloten; terug naar lobby...'; setTimeout(()=>location.replace('./pikken.html'),700); }
        }
      }catch(e){
        const msg=txt(e&&e.message||e);
        if(/niet gevonden|missing|deleted|verwijderd|closed|gesloten/i.test(msg)){ clearPikkenStore(); setTimeout(()=>location.replace('./pikken.html'),700); }
      }finally{ busy=false; }
    }
    inspect(); setInterval(inspect,1200);
  }
  function patchPaardenrace(){
    const api=window.GEJAST_PAARDENRACE; if(!api || api.__v722Patched) return; api.__v722Patched=true; api.normalizeRoomCode=api.normalizeRoomCode||normRoom;
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
  function boot(){ patchPikkenContract(); patchPikkenPage(); patchPikkenLive(); patchPaardenrace(); patchPaardenracePages(); }
  ready(boot); setInterval(boot,900);
})();