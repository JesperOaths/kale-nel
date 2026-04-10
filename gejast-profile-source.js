(function (global) {
  const RPC = global.GEJAST_RPC_CONTRACT;
  const CTX = global.GEJAST_SCOPE_CONTEXT;

  async function legacyLoadPlayerBundle({ playerName, gameKey }) {
    const scope = CTX.getScope();
    const [unified, sharedStats, gameInsights, drinks, badgeFacts] = await Promise.all([
      RPC.callRpc('get_public_player_unified_scoped', { player_name: playerName, site_scope_input: scope }),
      RPC.callRpc('get_public_shared_player_stats_scoped', { game_key: gameKey, player_name: playerName, site_scope_input: scope }),
      RPC.callRpc('get_public_player_game_insights_scoped', { game_key: gameKey, player_name: playerName, site_scope_input: scope }),
      RPC.callRpc('get_drink_player_public', { player_name: playerName }),
      RPC.callRpc('get_player_badge_facts_scoped', { player_name: playerName, site_scope_input: scope }).catch(() => ({}))
    ]);

    return {
      player_name: playerName,
      site_scope: scope,
      unified: unified || {},
      shared_stats: sharedStats || {},
      game_insights: gameInsights || {},
      drinks: drinks || {},
      badge_facts: badgeFacts || {}
    };
  }

  async function loadPlayerBundle({ playerName, gameKey = 'klaverjas' }) {
    return RPC.callContract('contract_profile_read_v1', {
      player_name: playerName,
      game_key: gameKey,
      site_scope_input: CTX.getScope()
    }, () => RPC.callRpc('get_player_page_bundle_scoped', {
      player_name: playerName,
      game_key: gameKey,
      site_scope_input: CTX.getScope()
    }).catch(() => legacyLoadPlayerBundle({ playerName, gameKey })));
  }

  async function loadPlayerGamePanels({ playerName, gameKey = 'klaverjas' }) {
    const bundle = await loadPlayerBundle({ playerName, gameKey }).catch(() => ({}));
    return {
      shared_stats: bundle?.shared_stats || {},
      game_insights: bundle?.game_insights || { cards: [] }
    };
  }

  async function loadProfilesPageBundle() {
    const scope = CTX.getScope();
    const raw = await RPC.callRpc('get_profiles_page_bundle_scoped', { site_scope_input: scope }).catch(async () => {
      const players = await loadProfilesList().catch(() => ({ players: [] }));
      return { site_scope: scope, players: players?.players || [], badge_cards: [] };
    });
    return raw || { site_scope: scope, players: [], badge_cards: [] };
  }

  async function loadProfilesList() {
    return RPC.callRpc('get_all_site_players_public_scoped', { site_scope_input: CTX.getScope() });
  }

  global.GEJAST_PROFILE_SOURCE = {
    loadPlayerBundle,
    loadPlayerGamePanels,
    loadProfilesPageBundle,
    loadProfilesList
  };
})(window);

