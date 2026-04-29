(function (global) {
  const RPC = global.GEJAST_RPC_CONTRACT;
  const CTX = global.GEJAST_SCOPE_CONTEXT;
  const PROFILES_BUNDLE_CACHE_KEY = 'gejast_profiles_bundle_v391';
  const PROFILES_BUNDLE_CACHE_TTL = 10 * 1000;

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }


  function normalizeName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function preferredPlayerName(player, fallbackName) {
    return String(
      player?.nickname ||
      player?.chosen_username ||
      player?.public_display_name ||
      player?.display_name ||
      player?.player_name ||
      fallbackName ||
      ''
    ).trim();
  }

  function canonicalPlayerName(player, fallbackName) {
    return String(player?.player_name || player?.display_name || fallbackName || '').trim();
  }

  function parseTime(value) {
    const ts = Date.parse(value || '');
    return Number.isFinite(ts) ? ts : null;
  }


  function profileImageUrl(value) {
    const helper = global.GEJAST_CONFIG && typeof global.GEJAST_CONFIG.normalizeProfileImageUrl === 'function'
      ? global.GEJAST_CONFIG.normalizeProfileImageUrl
      : null;
    if (helper) return helper(value);
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    if (raw.startsWith('/')) return raw;
    const base = String((global && global.GEJAST_CONFIG && global.GEJAST_CONFIG.SUPABASE_URL) || '').trim();
    if (/^storage\/v1\/object\/public\//i.test(raw) && base) return `${base}/${raw.replace(/^\/+/, '')}`;
    if (base && /^[A-Za-z0-9._-]+\/.+/.test(raw)) return `${base}/storage/v1/object/public/${raw.replace(/^\/+/, '')}`;
    return raw;
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
    const deltas = matches.map((match) => num(match?.elo_delta));
    const recentCutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    return {
      recent_form: matches.slice(0, 5).map((match) => detectResult(match, playerName)).filter(Boolean).join(' · ') || '—',
      activity_30d: matches.filter((match) => {
        const ts = parseTime(match?.finished_at || match?.played_at || match?.created_at);
        return ts != null && ts >= recentCutoff;
      }).length,
      biggest_gain: deltas.length ? Math.max(0, ...deltas) : 0,
      biggest_drop: deltas.length ? Math.min(0, ...deltas) : 0,
      volatility: deltas.length ? (deltas.reduce((sum, value) => sum + Math.abs(value), 0) / deltas.length) : 0,
      total_matches: num(game?.summary?.matches || game?.summary?.played || matches.length || overview?.total_matches)
    };
  }

  function pushInsight(cards, label, value, sub) {
    if (value == null || value === '') return;
    cards.push({ label, value: String(value), sub: sub ? String(sub) : '' });
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
    if (totalMatches > 0) pushInsight(cards, 'Winrate', `${Math.round((wins / Math.max(totalMatches, 1)) * 100)}%`, `${wins}/${totalMatches} gewonnen`);
    if (bestRank != null && bestRank !== '') pushInsight(cards, 'Beste klassering', bestRank);
    if (averageRank != null && averageRank !== '') pushInsight(cards, 'Gemiddelde plek', Number(averageRank).toFixed(1));
    if (pointsFor != null && pointsFor !== '') pushInsight(cards, 'Punten', Math.round(num(pointsFor)));
    if (favoritePartner) pushInsight(cards, 'Favoriete partner', favoritePartner);
    const latest = matches[0] || null;
    if (latest) {
      const latestResult = latest?.player_result === 'win' ? 'Winst' : latest?.player_result === 'draw' ? 'Gelijk' : latest?.player_result === 'loss' ? 'Verlies' : 'Gespeeld';
      pushInsight(cards, 'Laatste wedstrijd', latestResult, latest?.scoreline || latest?.recap_text || '');
    }
    return { cards };
  }


function readProfilesCache() {
  try {
    const raw = sessionStorage.getItem(PROFILES_BUNDLE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.at || (Date.now() - Number(parsed.at)) > PROFILES_BUNDLE_CACHE_TTL) return null;
    return parsed.value || null;
  } catch (_) {
    return null;
  }
}

function writeProfilesCache(value) {
  try {
    sessionStorage.setItem(PROFILES_BUNDLE_CACHE_KEY, JSON.stringify({ at: Date.now(), value }));
  } catch (_) {}
  return value;
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
    next.shared_stats = deriveSharedStats(next, gameKey);
    next.game_insights = deriveGameInsights(next, gameKey);
    return next;
  }

  function buildUnifiedFromPlayerRow(player, fallbackName) {
    const shown = preferredPlayerName(player, fallbackName);
    const original = canonicalPlayerName(player, fallbackName) || shown;
    const totalMatches = num(player?.total_matches);
    const totalWins = num(player?.total_wins);
    const bestRating = num(player?.best_rating) || 1000;
    const klMatches = num(player?.klaverjas_matches);
    const bbMatches = num(player?.boerenbridge_matches);
    const bpMatches = num(player?.beerpong_matches);
    const prMatches = num(player?.paardenrace_matches);
    function gameSummary(matches) {
      const played = num(matches);
      const proportionalWins = totalMatches > 0 ? Math.round((totalWins * played) / totalMatches) : 0;
      return {
        games_played: played,
        matches_played: played,
        wins: proportionalWins,
        losses: Math.max(0, played - proportionalWins),
        win_pct: played > 0 ? Math.round((100 * proportionalWins) / played) : 0,
        elo_rating: bestRating
      };
    }
    return {
      player_name: shown,
      canonical_player_name: original,
      overview: {
        total_matches: totalMatches,
        total_wins: totalWins,
        best_rating: bestRating,
        best_badge: player?.best_badge || '',
        profile_picture_url: player?.profile_picture_url || player?.avatar_url || player?.photo_url || '',
        favorite_game: player?.favorite_game || '',
        bio: player?.bio || '',
        klaverjas_matches: klMatches,
        boerenbridge_matches: bbMatches,
        beerpong_matches: bpMatches,
        paardenrace_matches: prMatches
      },
      games: {
        klaverjas: { player_name: shown, badge: player?.best_badge || '', summary: gameSummary(klMatches), matches: [] },
        boerenbridge: { player_name: shown, badge: player?.best_badge || '', summary: gameSummary(bbMatches), matches: [] },
        paardenrace: { player_name: shown, badge: player?.best_badge || '', summary: gameSummary(prMatches), matches: [] },
        beerpong: { player_name: shown, badge: player?.best_badge || '', summary: gameSummary(bpMatches), matches: [] }
      }
    };
  }

  function findPlayerInBundle(bundle, playerName) {
    const target = normalizeName(playerName);
    const players = safeArray(bundle?.players);
    return players.find((player) => {
      return [
        player?.player_name,
        player?.display_name,
        player?.public_display_name,
        player?.nickname,
        player?.chosen_username
      ].map(normalizeName).includes(target);
    }) || null;
  }

  async function loadSafeBase(playerName, scope) {
    const drinks = await RPC.callRpc('get_drink_player_public_scoped', { player_name: playerName, site_scope_input: scope })
      .catch(() => RPC.callRpc('get_drink_player_public', { player_name: playerName }).catch(() => ({ })));

    const unified = await RPC.callRpc('get_public_player_unified_scoped', { player_name: playerName, site_scope_input: scope }).catch(() => null);
    if (unified) {
      return {
        unified: unified || {},
        drinks: drinks || {},
        badge_facts: {}
      };
    }

    const fallbackBundle = await loadProfilesPageBundle().catch(async () => {
      const players = await loadProfilesList().catch(() => ({ players: [] }));
      return { players: players?.players || [] };
    });
    const playerRow = findPlayerInBundle(fallbackBundle, playerName);
    return {
      unified: buildUnifiedFromPlayerRow(playerRow, playerName),
      drinks: drinks || {},
      badge_facts: {}
    };
  }

  async function loadPlayerBundle({ playerName, gameKey = 'klaverjas' }) {
    const scope = CTX.getScope();
    const base = await loadSafeBase(playerName, scope);
    return normalizeBundle(base, playerName, scope, gameKey);
  }

  async function loadPlayerGamePanels({ playerName, gameKey = 'klaverjas' }) {
    const bundle = await loadPlayerBundle({ playerName, gameKey }).catch(() => ({ shared_stats: {}, game_insights: { cards: [] } }));
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

  async function fetchActivatedPlayers(scope) {
    try {
      const helper = global.GEJAST_CONFIG && (global.GEJAST_CONFIG.getActivatedPlayerNamesForScope || global.GEJAST_CONFIG.fetchScopedActivePlayerNames);
      if (!helper) return [];
      const names = await helper(scope || CTX.getScope());
      return safeArray(names).map((name) => ({ player_name: name, display_name: name, public_display_name: name }));
    } catch (_) {
      return [];
    }
  }

  async function fetchLoginNamesPlayers(scope) {
    try {
      const helper = global.GEJAST_CONFIG && global.GEJAST_CONFIG.readCachedLoginNames;
      const names = helper ? helper(scope || CTX.getScope()) : [];
      return safeArray(names).map((name) => ({ player_name: name, display_name: name, public_display_name: name }));
    } catch (_) {
      return [];
    }
  }

  function mergeProfilePlayers(bundlePlayers, allPlayers, activatedPlayers, loginNamePlayers) {
    const map = new Map();
    function absorb(rows) {
      safeArray(rows).forEach((player) => {
        const key = normalizeName(
          preferredPlayerName(player, player?.player_name || player?.display_name || player?.public_display_name || '')
        );
        if (!key) return;
        map.set(key, Object.assign({}, map.get(key) || {}, player));
      });
    }
    absorb(loginNamePlayers);
    absorb(activatedPlayers);
    absorb(allPlayers);
    absorb(bundlePlayers);
    return Array.from(map.values()).filter((player) => {
      const shown = preferredPlayerName(player, player?.player_name || player?.display_name || '');
      return !!normalizeName(shown);
    });
  }


  global.GEJAST_PROFILE_SOURCE = {
    loadPlayerBundle,
    loadPlayerGamePanels,
    loadProfilesPageBundle,
    loadProfilesList,
    fetchActivatedPlayers,
    fetchLoginNamesPlayers,
    mergeProfilePlayers,
    deriveSharedStats,
    deriveGameInsights,
    profileImageUrl
  };
})(window);
