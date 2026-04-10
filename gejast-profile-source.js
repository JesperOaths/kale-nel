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

  function parseTime(value) {
    const ts = Date.parse(value || '');
    return Number.isFinite(ts) ? ts : null;
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

  async function loadSafeBase(playerName, scope) {
    const [unified, drinks] = await Promise.all([
      RPC.callRpc('get_public_player_unified_scoped', { player_name: playerName, site_scope_input: scope }),
      RPC.callRpc('get_drink_player_public_scoped', { player_name: playerName, site_scope_input: scope })
        .catch(() => RPC.callRpc('get_drink_player_public', { player_name: playerName }).catch(() => ({ })))
    ]);
    return {
      unified: unified || {},
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

  global.GEJAST_PROFILE_SOURCE = {
    loadPlayerBundle,
    loadPlayerGamePanels,
    loadProfilesPageBundle,
    loadProfilesList,
    deriveSharedStats,
    deriveGameInsights
  };
})(window);
