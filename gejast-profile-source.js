(function (global) {
  const RPC = global.GEJAST_RPC_CONTRACT;
  const CTX = global.GEJAST_SCOPE_CONTEXT;

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function parseTime(value) {
    const ts = Date.parse(value || '');
    return Number.isFinite(ts) ? ts : null;
  }

  function normalizeBundle(bundle, playerName, scope, gameKey) {
    const next = {
      player_name: playerName,
      site_scope: scope,
      unified: bundle?.unified || {},
      shared_stats: bundle?.shared_stats || {},
      game_insights: bundle?.game_insights || {},
      drinks: bundle?.drinks || {},
      badge_facts: bundle?.badge_facts || bundle?.badges || {}
    };
    if (!next.shared_stats || !Object.keys(next.shared_stats).length) {
      next.shared_stats = deriveSharedStats(next, gameKey);
    }
    if (!next.game_insights || !safeArray(next.game_insights.cards).length) {
      next.game_insights = deriveGameInsights(next, gameKey);
    }
    return next;
  }

  function detectResult(match, playerName) {
    const explicit = String(match?.player_result || '').toLowerCase();
    if (explicit === 'win') return 'W';
    if (explicit === 'draw') return 'G';
    if (explicit === 'loss' || explicit === 'lose') return 'V';
    const name = String(playerName || '').trim().toLowerCase();
    const winners = safeArray(match?.winner_names).map((value) => String(value || '').trim().toLowerCase());
    const losers = safeArray(match?.loser_names).map((value) => String(value || '').trim().toLowerCase());
    if (name && winners.includes(name)) return 'W';
    if (name && losers.includes(name)) return 'V';
    return '—';
  }

  function deriveSharedStats(bundle, gameKey) {
    const unified = bundle?.unified || {};
    const overview = unified?.overview || {};
    const game = unified?.games?.[gameKey] || {};
    const matches = safeArray(game?.matches);
    const playerName = unified?.player_name || unified?.canonical_player_name || bundle?.player_name || '';
    const deltas = matches.map((match) => num(match?.elo_delta)).filter((value) => value || value === 0);
    const recentCutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentForm = matches.slice(0, 5).map((match) => detectResult(match, playerName)).filter(Boolean).join(' · ') || '—';
    const activity30d = matches.filter((match) => {
      const ts = parseTime(match?.finished_at || match?.played_at || match?.created_at);
      return ts != null && ts >= recentCutoff;
    }).length;
    const biggestGain = deltas.length ? Math.max(...deltas, 0) : 0;
    const biggestDrop = deltas.length ? Math.min(...deltas, 0) : 0;
    const volatility = deltas.length ? (deltas.reduce((sum, value) => sum + Math.abs(value), 0) / deltas.length) : 0;
    return {
      recent_form: recentForm,
      activity_30d: activity30d,
      biggest_gain: biggestGain,
      biggest_drop: biggestDrop,
      volatility: volatility,
      total_matches: num(game?.summary?.matches || game?.summary?.played || matches.length || overview?.total_matches)
    };
  }

  function pushInsight(cards, label, value, sub) {
    if (value == null || value === '') return;
    cards.push({
      label,
      value: String(value),
      sub: sub ? String(sub) : ''
    });
  }

  function deriveGameInsights(bundle, gameKey) {
    const unified = bundle?.unified || {};
    const game = unified?.games?.[gameKey] || {};
    const summary = game?.summary || {};
    const matches = safeArray(game?.matches);
    const cards = [];
    const totalMatches = num(summary?.matches || summary?.played || matches.length);
    const wins = num(summary?.wins || summary?.total_wins);
    const bestRank = summary?.best_rank ?? summary?.rank ?? summary?.best_finish ?? null;
    const averageRank = summary?.avg_rank ?? summary?.average_rank ?? null;
    const pointsFor = summary?.total_points ?? summary?.points_for ?? summary?.avg_points ?? null;
    const favoritePartner = summary?.favorite_partner || summary?.most_common_partner || summary?.best_partner || '';
    const streak = summary?.best_streak ?? summary?.current_streak ?? null;
    if (totalMatches > 0) {
      pushInsight(cards, 'Winrate', `${Math.round((wins / Math.max(totalMatches, 1)) * 100)}%`, `${wins}/${totalMatches} gewonnen`);
    }
    if (bestRank != null && bestRank !== '') {
      pushInsight(cards, 'Beste klassering', bestRank);
    }
    if (averageRank != null && averageRank !== '') {
      pushInsight(cards, 'Gemiddelde plek', Number(averageRank).toFixed(1));
    }
    if (pointsFor != null && pointsFor !== '') {
      pushInsight(cards, 'Punten', Math.round(num(pointsFor)));
    }
    if (favoritePartner) {
      pushInsight(cards, 'Favoriete partner', favoritePartner);
    }
    if (streak != null && streak !== '') {
      pushInsight(cards, 'Beste reeks', streak);
    }
    const latest = matches[0] || null;
    if (latest) {
      const latestResult = latest?.player_result === 'win' ? 'Winst' : latest?.player_result === 'draw' ? 'Gelijk' : latest?.player_result === 'loss' ? 'Verlies' : '';
      pushInsight(cards, 'Laatste wedstrijd', latestResult || 'Gespeeld', latest?.scoreline || latest?.recap_text || '');
    }
    return { cards };
  }

  async function loadUnifiedDrinksAndBadges(playerName, scope) {
    const [unified, drinks, badgeFacts] = await Promise.all([
      RPC.callRpc('get_public_player_unified_scoped', { player_name: playerName, site_scope_input: scope }),
      RPC.callRpc('get_drink_player_public_scoped', { player_name: playerName, site_scope_input: scope })
        .catch(() => RPC.callRpc('get_drink_player_public', { player_name: playerName }).catch(() => ({}))),
      RPC.callRpc('get_player_badge_facts_scoped', { player_name: playerName, site_scope_input: scope }).catch(() => ({}))
    ]);
    return {
      unified: unified || {},
      drinks: drinks || {},
      badge_facts: badgeFacts || {}
    };
  }

  async function legacyLoadPlayerBundle({ playerName, gameKey }) {
    const scope = CTX.getScope();
    const base = await loadUnifiedDrinksAndBadges(playerName, scope);
    return normalizeBundle(base, playerName, scope, gameKey);
  }

  async function loadPlayerBundle({ playerName, gameKey = 'klaverjas' }) {
    const scope = CTX.getScope();
    try {
      const result = await RPC.callContract('contract_profile_read_v1', {
        player_name: playerName,
        game_key: gameKey,
        site_scope_input: scope
      }, () => RPC.callRpc('get_player_page_bundle_scoped', {
        player_name: playerName,
        game_key: gameKey,
        site_scope_input: scope
      }));
      return normalizeBundle(result || {}, playerName, scope, gameKey);
    } catch (_) {
      return legacyLoadPlayerBundle({ playerName, gameKey });
    }
  }

  async function loadPlayerGamePanels({ playerName, gameKey = 'klaverjas' }) {
    const bundle = await legacyLoadPlayerBundle({ playerName, gameKey }).catch(() => ({ shared_stats: {}, game_insights: { cards: [] } }));
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
    loadProfilesList,
    deriveSharedStats,
    deriveGameInsights
  };
})(window);
