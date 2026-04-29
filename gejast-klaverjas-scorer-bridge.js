(function(){
  const api = window.GEJAST_KLAVERJAS_API;
  if (!api || !window.state || typeof window.snapshotPayload !== 'function') return;

  const params = new URLSearchParams(location.search);
  const statusEl = document.getElementById('messageBox') || document.getElementById('message') || document.querySelector('.message');
  const bridge = {
    matchId: params.get('match_id') || sessionStorage.getItem('klaverjas_repo_match_id_v596') || '',
    startedAt: params.get('started_at') || sessionStorage.getItem('klaverjas_repo_started_at_v596') || new Date().toISOString(),
    syncing: false,
    lastSyncHash: '',
    lastKnownRoundCount: 0,
    pollHandle: null
  };

  function setStatus(msg, isError=false){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#a93627' : '';
  }
  function snapshotHash(payload){ return JSON.stringify([payload.progressRounds, payload.totals, payload.rawTotals, payload.current, (payload.rounds||[]).length]); }
  function currentPlayerName(){
    try { return (window.GEJAST_CONFIG && window.GEJAST_CONFIG.getPlayerName && window.GEJAST_CONFIG.getPlayerName()) || null; } catch(_) { return null; }
  }
  function liveUrl(){
    const url = new URL('./klaverjas_live_v596.html', location.href);
    if (bridge.matchId) url.searchParams.set('match_id', bridge.matchId);
    if (api.getScope() === 'family') url.searchParams.set('scope', 'family');
    return `${url.pathname.split('/').pop()}${url.search}`;
  }
  function quickStatsUrl(){
    const url = new URL('./klaverjas_quick_stats_v596_repo.html', location.href);
    if (bridge.matchId) url.searchParams.set('match_id', bridge.matchId);
    if (api.getScope() === 'family') url.searchParams.set('scope', 'family');
    return `${url.pathname.split('/').pop()}${url.search}`;
  }

  function updatePlayersFromUrl(){
    const teamW = api.parseNames(params.get('team_w'));
    const teamZ = api.parseNames(params.get('team_z'));
    if (teamW.length === 2 && teamZ.length === 2) {
      state.players.W = teamW;
      state.players.Z = teamZ;
      if (typeof render === 'function') render();
    }
  }

  async function syncWholeMatch(statusOverride='active', announce=false){
    if (bridge.syncing) return null;
    const payload = window.snapshotPayload(true);
    const nextHash = snapshotHash(payload);
    if (statusOverride === 'active' && nextHash === bridge.lastSyncHash) return null;
    bridge.syncing = true;
    try {
      const result = await api.upsertMatchState({
        matchId: bridge.matchId || null,
        teamW: payload.players.W,
        teamZ: payload.players.Z,
        rounds: payload.rounds || [],
        snapshotPayload: payload,
        status: statusOverride,
        startedAt: bridge.startedAt
      });
      const match = result && result.match ? result.match : null;
      if (match && match.id) {
        bridge.matchId = match.id;
        bridge.startedAt = match.started_at || bridge.startedAt;
        sessionStorage.setItem('klaverjas_repo_match_id_v596', bridge.matchId);
        sessionStorage.setItem('klaverjas_repo_started_at_v596', bridge.startedAt);
        if (!params.get('match_id')) {
          const url = new URL(location.href);
          url.searchParams.set('match_id', bridge.matchId);
          history.replaceState({}, '', url.toString());
        }
        await api.setPresence(bridge.matchId, currentPlayerName(), 'scorer').catch(()=>null);
      }
      bridge.lastSyncHash = nextHash;
      bridge.lastKnownRoundCount = payload.progressRounds || 0;
      if (announce) setStatus(statusOverride === 'finished' ? 'Spel opgeslagen.' : 'Tussenstand opgeslagen.');
      return result;
    } catch (err) {
      setStatus(err.message || 'Klaverjas sync mislukt.', true);
      throw err;
    } finally { bridge.syncing = false; }
  }

  function hookButton(id, delay=120, status='active'){
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', ()=>{ setTimeout(()=>syncWholeMatch(status).catch(()=>null), delay); });
  }

  function installLiveLinks(){
    const dock = document.querySelector('.actions');
    if (!dock || document.getElementById('klavLiveBtn')) return;
    const live = document.createElement('a');
    live.id = 'klavLiveBtn';
    live.className = 'action mid';
    live.href = liveUrl();
    live.textContent = 'Live';
    dock.appendChild(live);
  }

  function patchWinnerClose(){
    const btn = document.getElementById('winnerCloseBtn');
    if (!btn) return;
    btn.addEventListener('click', async ()=>{
      try {
        await syncWholeMatch('finished', true);
        window.location.href = quickStatsUrl();
      } catch (_) { }
    });
  }

  function installUnloadSync(){
    window.addEventListener('beforeunload', ()=>{
      try {
        const payload = window.snapshotPayload(true);
        if ((payload.progressRounds || 0) >= 8 && bridge.matchId) {
          navigator.sendBeacon(
            `${(window.GEJAST_CONFIG||{}).SUPABASE_URL}/rest/v1/rpc/klaverjas_upsert_match_state_scoped`,
            new Blob([JSON.stringify({
              session_token: api.sessionToken() || null,
              match_id_input: bridge.matchId,
              site_scope_input: api.getScope(),
              team_w_player_names_input: payload.players.W,
              team_z_player_names_input: payload.players.Z,
              rounds_input: payload.rounds || [],
              payload_snapshot_input: payload,
              status_input: payload.completed ? 'finished' : 'abandoned',
              started_at_input: bridge.startedAt
            })], { type:'application/json' })
          );
        }
      } catch(_) {}
      try { api.clearPresence(bridge.matchId || null); } catch(_) {}
    });
  }

  updatePlayersFromUrl();
  installLiveLinks();
  hookButton('saveRoundBtn', 120, 'active');
  hookButton('saveRoundEdit', 120, 'active');
  document.querySelectorAll('[data-verzaakt]').forEach((btn)=>btn.addEventListener('click', ()=>setTimeout(()=>syncWholeMatch('active').catch(()=>null), 120)));
  patchWinnerClose();
  installUnloadSync();
  bridge.pollHandle = setInterval(()=>{ if (!document.hidden) api.setPresence(bridge.matchId || null, currentPlayerName(), 'scorer').catch(()=>null); }, 12000);
  setTimeout(()=>syncWholeMatch('active').catch(()=>null), 250);
  window.GEJAST_KLAVERJAS_BRIDGE = bridge;
})();
