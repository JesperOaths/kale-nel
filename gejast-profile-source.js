(function (global) {
  const RPC = global.GEJAST_RPC_CONTRACT;
  const CTX = global.GEJAST_SCOPE_CONTEXT;

  function scope(){ return CTX && typeof CTX.getScope === 'function' ? CTX.getScope() : 'friends'; }
  function keyName(v){ return String(v||'').trim().toLowerCase(); }

  async function legacyLoadPlayerBundle({ playerName, gameKey }) {
    const siteScope = scope();
    const [unified, sharedStats, gameInsights, drinks, paardenrace] = await Promise.all([
      RPC.callRpc('get_public_player_unified_scoped', { player_name: playerName, site_scope_input: siteScope }).catch(() => ({})),
      RPC.callRpc('get_public_shared_player_stats_scoped', { game_key: gameKey, player_name: playerName, site_scope_input: siteScope }).catch(() => ({})),
      RPC.callRpc('get_public_player_game_insights_scoped', { game_key: gameKey, player_name: playerName, site_scope_input: siteScope }).catch(() => ({ cards: [] })),
      RPC.callRpc('get_drink_player_public', { player_name: playerName }).catch(() => ({})),
      RPC.callRpc('paardenrace_get_public_player_summary_scoped', { player_name_input: playerName, site_scope_input: siteScope }).catch(() => ({}))
    ]);

    if (paardenrace && unified && unified.games) {
      unified.games.paardenrace = {
        player_name: playerName,
        badge: (paardenrace.summary && paardenrace.summary.badge) || 'Paardenrace',
        summary: paardenrace.summary || {},
        matches: paardenrace.matches || []
      };
      if (unified.overview) {
        unified.overview.paardenrace_matches = Number(paardenrace.summary?.matches_played || 0);
        unified.overview.total_matches = Number(unified.overview.total_matches || 0) + 0;
      }
    }

    return {
      player_name: playerName,
      site_scope: siteScope,
      unified: unified || {},
      shared_stats: sharedStats || {},
      game_insights: gameInsights || {},
      drinks: drinks || {},
      paardenrace: paardenrace || {}
    };
  }

  async function loadPlayerBundle({ playerName, gameKey = 'klaverjas' }) {
    return legacyLoadPlayerBundle({ playerName, gameKey });
  }

  async function loadProfilesList() {
    const siteScope = scope();
    const [playersPayload, paardenrace] = await Promise.all([
      RPC.callRpc('get_all_site_players_public_scoped', { site_scope_input: siteScope }).catch(() => ({ players: [] })),
      RPC.callRpc('paardenrace_get_public_ladder_scoped', { site_scope_input: siteScope }).catch(() => ({ ladder: [] }))
    ]);
    const players = Array.isArray(playersPayload?.players) ? playersPayload.players : [];
    const ladder = Array.isArray(paardenrace?.ladder) ? paardenrace.ladder : [];
    const byName = new Map(ladder.map((row) => [keyName(row.player_name || row.display_name || ''), row]));
    return players.map((row) => {
      const pr = byName.get(keyName(row.player_name || row.display_name || '')) || {};
      return Object.assign({}, row, {
        paardenrace_matches: Number(pr.matches_played || pr.games_played || row.paardenrace_matches || 0),
        paardenrace_wins: Number(pr.wins || row.paardenrace_wins || 0)
      });
    });
  }

  global.GEJAST_PROFILE_SOURCE = {
    loadPlayerBundle,
    loadProfilesList
  };
})(window);
