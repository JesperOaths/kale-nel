(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtils = window.GEJAST_SCOPE_UTILS || {};
  const PARTICIPANT_KEY = 'gejast_pikken_participant_v502';

  function getScope(){ try { return (scopeUtils.getScope && scopeUtils.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); } catch(_){ return 'friends'; } }
  function sessionToken(){ try { return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; } catch(_){ return ''; } }
  function headers(){ return { apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { throw new Error(text || `HTTP ${res.status}`); } if(!res.ok) throw new Error(data?.message || data?.error || data?.hint || text || `HTTP ${res.status}`); return data; }
  async function rpc(name, payload){ const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', headers:headers(), body: JSON.stringify(payload || {}), cache:'no-store', mode:'cors' }); return parse(res); }
  async function rpcFirst(names, payloads){ let last = null; for (const variant of payloads){ for (const name of names){ try { return await rpc(name, variant); } catch (err) { last = err; } } } throw last || new Error('RPC mislukt.'); }
  function qs(sel, root){ return (root||document).querySelector(sel); }
  function esc(s){ const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}; return String(s??'').replace(/[&<>"']/g,m=>map[m]); }
  function normalizeError(err){ const msg = String(err && err.message || err || 'Onbekende fout'); if(/invalid input syntax for type uuid/i.test(msg)) return 'De lobby probeerde te laden zonder geldige game-id. Dat is nu afgevangen; open of maak eerst een echte lobby.'; return msg; }
  function isUuid(value){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||'').trim()); }
  function liveHref(gameId){ return `./pikken_live.html?client_match_id=${encodeURIComponent(String(gameId||''))}`; }
  function spectatorHref(gameId){ return `./pikken_spectator.html?client_match_id=${encodeURIComponent(String(gameId||''))}`; }
  function setParticipantToken(gameId, active){ try{ if(active && gameId){ localStorage.setItem(PARTICIPANT_KEY, JSON.stringify({ game_id:String(gameId), at:Date.now() })); } else { localStorage.removeItem(PARTICIPANT_KEY); } }catch(_){ } }
  function setStatus(text, isError){ const el = qs('#pkStatus'); if(!el) return; el.textContent = text || ''; el.style.color = isError ? '#7f2f1d' : '#6b6257'; }
  function setChip(text){ const el = qs('#pkStatusChip'); if(el) el.textContent = text || 'Lobby'; }

  const UI = { gameId:'', pollTimer:null };

  function render(state){
    const game = state?.game || {}; const viewer = state?.viewer || {}; const players = Array.isArray(state?.players) ? state.players : []; const phase = String(game?.state?.phase || 'lobby');
    setChip(phase); qs('#pkLobbyCode').textContent = game?.lobby_code || '—';
    const liveLink = qs('#pkLiveLink'); const spectatorLink = qs('#pkSpectatorLink'); const gid = game?.id || UI.gameId;
    if(liveLink){ liveLink.href = liveHref(gid); liveLink.style.display = gid ? '' : 'none'; }
    if(spectatorLink){ spectatorLink.href = spectatorHref(gid); }
    const list = qs('#pkPlayers');
    if (!players.length){ list.textContent = 'Nog geen spelers zichtbaar.'; return; }
    list.innerHTML = players.map((p)=>{ const seat = Number(p.seat||p.seat_index||0); const alive = !!p.alive || phase==='lobby'; const isSelf = !!p.is_self; return `<div class="player-row ${alive?'':'dead'}"><div><div><strong>${esc(p.name||p.player_name||'Speler')}</strong> <span class="muted">#${seat||'—'}</span></div><div class="muted">${alive?'in match':'uitgeschakeld'} · ${Number(p.dice_count||0)} dobbelstenen</div></div><div>${isSelf?'<span class="pill ok">jij</span>':''}</div><div>${!!viewer.is_host && !isSelf ? `<button class="btn alt" data-kick-seat="${seat}">Kick</button>` : ''}</div></div>`; }).join('');
  }

  async function loadAndRender(){ if(!isUuid(UI.gameId)) return; try { const state = await rpcFirst(['pikken_get_state_scoped'], [{ session_token: sessionToken() || null, game_id_input: UI.gameId }, { session_token: sessionToken() || null, game_id_input: UI.gameId, site_scope_input:getScope() }]); render(state); setStatus('', false); } catch(err){ setStatus(normalizeError(err), true); } }
  function stopPolling(){ if(UI.pollTimer){ clearInterval(UI.pollTimer); UI.pollTimer = null; } }
  function startPolling(){ stopPolling(); loadAndRender(); UI.pollTimer = setInterval(()=>{ if(!document.hidden) loadAndRender(); }, 1400); }

  async function createLobby(){ setStatus('Lobby maken…', false); const mode = qs('#pkPenaltyMode').value || 'wrong_loses'; const startDice = Number(qs('#pkStartDice').value || 6); const out = await rpcFirst(['pikken_create_lobby_scoped'], [{ session_token: sessionToken() || null, site_scope_input:getScope(), config_input:{ penalty_mode: mode, start_dice: startDice } }]); UI.gameId = String(out.game_id || ''); setParticipantToken(UI.gameId, true); history.replaceState(null,'',`pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`); startPolling(); }
  async function joinLobby(){ const code = String(qs('#pkJoinCode').value||'').trim().toUpperCase(); if(!code) return setStatus('Vul een lobby code in.', true); setStatus('Lobby joinen…', false); const out = await rpcFirst(['pikken_join_lobby_scoped'], [{ session_token: sessionToken() || null, site_scope_input:getScope(), lobby_code_input: code }]); UI.gameId = String(out.game_id || ''); setParticipantToken(UI.gameId, true); history.replaceState(null,'',`pikken.html?game_id=${encodeURIComponent(UI.gameId)}&scope=${encodeURIComponent(getScope())}`); startPolling(); }
  async function setReady(ready){ if(!isUuid(UI.gameId)) return setStatus('Maak of join eerst een lobby.', true); setStatus(ready?'Ready…':'Unready…', false); await rpcFirst(['pikken_set_ready_scoped'], [{ session_token: sessionToken()||null, game_id_input: UI.gameId, ready_input: !!ready }, { session_token: sessionToken()||null, game_id_input: UI.gameId, ready_input: !!ready, site_scope_input:getScope() }]); await loadAndRender(); }
  async function startGame(){ if(!isUuid(UI.gameId)) return setStatus('Geen geldige lobby om te starten.', true); setStatus('Starten…', false); await rpcFirst(['pikken_start_game_scoped'], [{ session_token: sessionToken()||null, game_id_input: UI.gameId }, { session_token: sessionToken()||null, game_id_input: UI.gameId, site_scope_input:getScope() }]); window.location.href = liveHref(UI.gameId); }
  async function leaveMatch(){ if(!isUuid(UI.gameId)) return; setStatus('Match verlaten…', false); await rpcFirst(['pikken_leave_game_scoped','pikken_leave_lobby_scoped'], [{ session_token: sessionToken()||null, game_id_input: UI.gameId }, { session_token: sessionToken()||null, game_id_input: UI.gameId, site_scope_input:getScope() }]); setParticipantToken(UI.gameId, false); stopPolling(); UI.gameId=''; history.replaceState(null,'','pikken.html'); qs('#pkPlayers').textContent='Nog geen lobby geladen.'; qs('#pkLobbyCode').textContent='—'; qs('#pkLiveLink').style.display='none'; setStatus('Match verlaten.', false); }
  async function destroyMatch(){ if(!isUuid(UI.gameId)) return; setStatus('Match slopen…', false); await rpcFirst(['pikken_destroy_game_scoped','pikken_destroy_lobby_scoped'], [{ session_token: sessionToken()||null, game_id_input: UI.gameId }, { session_token: sessionToken()||null, game_id_input: UI.gameId, site_scope_input:getScope() }]); setParticipantToken(UI.gameId, false); stopPolling(); UI.gameId=''; history.replaceState(null,'','pikken.html'); qs('#pkPlayers').textContent='Nog geen lobby geladen.'; qs('#pkLobbyCode').textContent='—'; qs('#pkLiveLink').style.display='none'; setStatus('Match verwijderd.', false); }
  async function kickSeat(seat){ if(!isUuid(UI.gameId)) return; setStatus(`Speler #${seat} kicken…`, false); await rpcFirst(['pikken_kick_player_scoped'], [{ session_token: sessionToken()||null, game_id_input: UI.gameId, seat_index_input: Number(seat), target_seat_input: Number(seat) }, { session_token: sessionToken()||null, game_id_input: UI.gameId, seat_index_input: Number(seat), target_seat_input: Number(seat), site_scope_input:getScope() }]); await loadAndRender(); }

  function boot(){
    const params = new URLSearchParams(location.search);
    const raw = params.get('game_id') || '';
    UI.gameId = isUuid(raw) ? raw : '';
    qs('#pkCreateLobbyBtn').addEventListener('click', ()=>createLobby().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkJoinLobbyBtn').addEventListener('click', ()=>joinLobby().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkReadyBtn').addEventListener('click', ()=>setReady(true).catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkUnreadyBtn').addEventListener('click', ()=>setReady(false).catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkStartBtn').addEventListener('click', ()=>startGame().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkLeaveBtn').addEventListener('click', ()=>leaveMatch().catch(e=>setStatus(normalizeError(e),true)));
    qs('#pkDestroyBtn').addEventListener('click', ()=>destroyMatch().catch(e=>setStatus(normalizeError(e),true)));
    document.addEventListener('click', (ev)=>{ const btn = ev.target.closest('[data-kick-seat]'); if (btn) kickSeat(btn.getAttribute('data-kick-seat')).catch(e=>setStatus(normalizeError(e),true)); });
    if (UI.gameId) { setParticipantToken(UI.gameId, true); startPolling(); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot, { once:true }); else boot();
})();
