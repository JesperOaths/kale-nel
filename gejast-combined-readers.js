(function (global) {
  const RPC = global.GEJAST_SCOPED_RPC;

  function unwrap(raw, key) {
    if (key && raw && raw[key] !== undefined) return raw[key];
    return raw || {};
  }

  async function loadHomepageBootBundle() {
    const sessionToken = RPC.getSessionToken();
    try {
      return await RPC.callRpc('get_homepage_boot_bundle_scoped', {
        session_token: sessionToken
      });
    } catch (_) {
      const [homepageState, extraPoll, ladders, drinksHome, drinksTop5, liveEntries] = await Promise.allSettled([
        RPC.callRpc('get_gejast_homepage_state', { session_token: sessionToken }).catch(() => RPC.callRpc('get_public_state', { session_token: sessionToken })),
        RPC.callRpc('get_site_poll_state', { poll_key_input: 'gejast_drinks_donderdag', session_token: sessionToken }),
        RPC.callRpc('get_homepage_ladders_public_scoped', {}),
        RPC.callRpc('get_drinks_homepage_public_scoped', {}),
        RPC.callRpc('get_drinks_homepage_top5_public_scoped', {}),
        RPC.callRpc('get_homepage_live_state_public', { session_token: sessionToken })
      ]);
      return {
        homepage_state: homepageState.status === 'fulfilled' ? homepageState.value : {},
        extra_poll_state: extraPoll.status === 'fulfilled' ? extraPoll.value : {},
        ladders: ladders.status === 'fulfilled' ? ladders.value : {},
        drinks_home: drinksHome.status === 'fulfilled' ? drinksHome.value : {},
        drinks_top5: drinksTop5.status === 'fulfilled' ? drinksTop5.value : {},
        live_entries: liveEntries.status === 'fulfilled' ? liveEntries.value : {},
        perf_hints: {
          defer_drinks_top5_rotation: true,
          defer_ladders_until_visible: RPC.getScope() === 'family' ? false : true,
          chunk_profile_cards: true
        }
      };
    }
  }

  async function loadPlayerPageBundle(playerName, gameKey) {
    try {
      return await RPC.callRpc('get_player_page_bundle_scoped', {
        player_name: playerName,
        game_key: gameKey || 'klaverjas'
      });
    } catch (_) {
      const [unified, shared, insights, drinks, badges] = await Promise.allSettled([
        RPC.callRpc('get_public_player_unified_scoped', { player_name: playerName }),
        RPC.callRpc('get_public_shared_player_stats_scoped', { game_key: gameKey || 'klaverjas', player_name: playerName }),
        RPC.callRpc('get_public_player_game_insights_scoped', { game_key: gameKey || 'klaverjas', player_name: playerName }),
        RPC.callRpc('get_drink_player_public_scoped', { player_name: playerName }),
        RPC.callRpc('get_player_badge_bundle_scoped', { player_name: playerName }).catch(() => ({}))
      ]);
      return {
        player_name: playerName,
        game_key: gameKey || 'klaverjas',
        unified: unified.status === 'fulfilled' ? unified.value : {},
        shared_stats: shared.status === 'fulfilled' ? shared.value : {},
        game_insights: insights.status === 'fulfilled' ? insights.value : {},
        drinks: drinks.status === 'fulfilled' ? drinks.value : {},
        badges: badges.status === 'fulfilled' ? badges.value : {},
        perf_hints: {
          defer_matches_accordion: true,
          defer_drinks_panel: true,
          chunk_match_render: true
        }
      };
    }
  }

  async function loadProfilesPageBundle() {
    try {
      return await RPC.callRpc('get_profiles_page_bundle_scoped', {});
    } catch (_) {
      const [players, badgeCards] = await Promise.allSettled([
        RPC.callRpc('get_all_site_players_public_scoped', {}),
        RPC.callRpc('get_site_player_badge_cards_scoped', {}).catch(() => ({ players: [] }))
      ]);
      return {
        players: unwrap(players.status === 'fulfilled' ? players.value : {}, 'players').players || unwrap(players.status === 'fulfilled' ? players.value : {}, 'players') || [],
        badge_cards: unwrap(badgeCards.status === 'fulfilled' ? badgeCards.value : {}, 'players').players || unwrap(badgeCards.status === 'fulfilled' ? badgeCards.value : {}, 'players') || [],
        perf_hints: {
          chunk_cards: true,
          lazy_avatars: true
        }
      };
    }
  }

  async function loadDrinksPageBundle(position) {
    const payload = {
      session_token: RPC.getSessionToken(),
      viewer_lat: position?.coords?.latitude || null,
      viewer_lng: position?.coords?.longitude || null
    };
    try {
      return await RPC.callRpc('get_drinks_page_bundle_public_scoped', payload);
    } catch (_) {
      const [page, fallback, history, speed] = await Promise.allSettled([
        RPC.callRpc('get_drinks_page_public', payload),
        RPC.callRpc('get_drinks_dashboard_fallback_public', {}),
        RPC.callRpc('get_verified_drinks_history_public_scoped', { limit_count: 25 }),
        RPC.callRpc('get_drink_speed_page_public', { session_token: payload.session_token })
      ]);
      return {
        page: page.status === 'fulfilled' ? page.value : {},
        dashboard: fallback.status === 'fulfilled' ? fallback.value : {},
        history: history.status === 'fulfilled' ? history.value : [],
        speed: speed.status === 'fulfilled' ? speed.value : {},
        perf_hints: {
          defer_location_breakdown: true,
          defer_top5_rotation: true,
          throttle_geo_refresh_ms: 15000
        }
      };
    }
  }

  async function loadScopeAuditBundle() {
    return RPC.callRpc('get_scope_audit_bundle_v352', {});
  }

  global.GEJAST_COMBINED_READERS = {
    loadHomepageBootBundle,
    loadPlayerPageBundle,
    loadProfilesPageBundle,
    loadDrinksPageBundle,
    loadScopeAuditBundle
  };
})(window);
