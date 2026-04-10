(function (global) {
  const SESSION_KEYS = ['jas_session_token_v11', 'jas_session_token_v10'];
  const COMPATIBLE_PARAM_RENAMES = {
    get_public_shared_player_stats_scoped: { game_key: 'game_key_input', player_name: 'player_name_input' },
    get_public_player_game_insights_scoped: { game_key: 'game_key_input', player_name: 'player_name_input' },
    paardenrace_update_selection_scoped: {
      room_code: 'room_code_input',
      selected_suit: 'selected_suit_input',
      session_token: 'session_token_input',
      wager_bakken: 'wager_bakken_input'
    }
  };
  const SCOPE_REQUIRED_RPCS = new Set([
    'get_all_site_players_public_scoped',
    'get_public_ladder_page_scoped',
    'get_public_player_unified_scoped',
    'get_public_shared_player_stats_scoped',
    'get_public_player_game_insights_scoped',
    'get_player_badge_bundle_scoped',
    'get_site_player_badge_cards_scoped',
    'get_homepage_boot_bundle_scoped',
    'get_player_page_bundle_scoped',
    'get_profiles_page_bundle_scoped',
    'get_drinks_page_bundle_public_scoped',
    'get_homepage_ladders_public_scoped',
    'get_drinks_homepage_public_scoped',
    'get_drinks_homepage_top5_public_scoped',
    'get_drink_player_public_scoped',
    'get_verified_drinks_history_public_scoped',
    'get_scope_audit_bundle_v352',
    'assert_scope_clean_v352'
  ]);

  function getConfig() {
    return global.GEJAST_CONFIG || {};
  }

  function getScope() {
    try {
      if (global.GEJAST_SCOPE_UTILS && typeof global.GEJAST_SCOPE_UTILS.getScope === 'function') {
        return global.GEJAST_SCOPE_UTILS.getScope();
      }
    } catch (_) {}
    return 'friends';
  }

  function getSessionToken() {
    const cfg = getConfig();
    if (typeof cfg.getPlayerSessionToken === 'function') {
      return cfg.getPlayerSessionToken() || '';
    }
    for (const key of SESSION_KEYS) {
      const value = global.localStorage.getItem(key) || global.sessionStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }

  function rpcHeaders() {
    const cfg = getConfig();
    return {
      apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '',
      Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  async function parseResponse(res) {
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      throw new Error(text || `HTTP ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(data?.message || data?.error || text || `HTTP ${res.status}`);
    }
    return data;
  }

  function withScopePayload(name, payload) {
    const next = Object.assign({}, payload || {});
    if (SCOPE_REQUIRED_RPCS.has(name) && next.site_scope_input == null) {
      next.site_scope_input = getScope();
    }
    return next;
  }

  function buildCompatPayload(name, payload) {
    const renameMap = COMPATIBLE_PARAM_RENAMES[name];
    if (!renameMap || !payload || typeof payload !== 'object') return null;
    let changed = false;
    const next = Object.assign({}, payload);
    for (const [oldKey, newKey] of Object.entries(renameMap)) {
      if (next[oldKey] !== undefined && next[newKey] === undefined) {
        next[newKey] = next[oldKey];
        delete next[oldKey];
        changed = true;
      }
    }
    return changed ? next : null;
  }

  function isCompatRetryable(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('schema cache') || message.includes('could not find the function');
  }

  async function fetchRpc(name, body, options) {
    const cfg = getConfig();
    const opts = Object.assign({ unwrapKey: null }, options || {});
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: rpcHeaders(),
      body: JSON.stringify(body)
    });
    const raw = await parseResponse(res);
    if (opts.unwrapKey && raw && raw[opts.unwrapKey] !== undefined) return raw[opts.unwrapKey];
    if (raw && raw[name] !== undefined) return raw[name];
    return raw;
  }

  async function callRpc(name, payload, options) {
    const body = withScopePayload(name, payload);
    try {
      return await fetchRpc(name, body, options);
    } catch (error) {
      const compatPayload = buildCompatPayload(name, body);
      if (compatPayload && isCompatRetryable(error)) {
        return await fetchRpc(name, compatPayload, options);
      }
      throw error;
    }
  }

  function collectNamesFromMatch(row) {
    const out = [];
    ['winner_names', 'loser_names', 'participants', 'participant_names', 'team_a_player_names', 'team_b_player_names', 'players'].forEach((key) => {
      const value = row?.[key];
      if (Array.isArray(value)) out.push(...value);
    });
    if (Array.isArray(row?.details)) {
      row.details.forEach((detail) => {
        if (detail?.player_name) out.push(detail.player_name);
        if (detail?.display_name) out.push(detail.display_name);
      });
    }
    return out.filter(Boolean);
  }

  function isAllowedName(name, scope) {
    try {
      if (global.GEJAST_SCOPE_UTILS && typeof global.GEJAST_SCOPE_UTILS.isAllowedName === 'function') {
        return global.GEJAST_SCOPE_UTILS.isAllowedName(name, scope || getScope());
      }
    } catch (_) {}
    return true;
  }

  function auditRowsInScope(rows, kind, scope) {
    const resolvedScope = scope || getScope();
    const violations = [];
    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
      if (kind === 'players') {
        const candidate = row?.player_name || row?.display_name || row?.chosen_username || row?.public_display_name || row?.nickname || '';
        if (candidate && !isAllowedName(candidate, resolvedScope)) {
          violations.push({ index, player_name: candidate, kind });
        }
        return;
      }
      if (kind === 'matches') {
        const names = collectNamesFromMatch(row);
        const bad = names.find((name) => !isAllowedName(name, resolvedScope));
        if (bad) {
          violations.push({ index, player_name: bad, kind });
        }
      }
    });
    return violations;
  }

  function enforcePageScope(allowedScopes, fallbackHref) {
    const allowed = Array.isArray(allowedScopes) ? allowedScopes : [allowedScopes];
    const scope = getScope();
    if (allowed.includes(scope)) return true;
    const href = fallbackHref || (global.GEJAST_SCOPE_UTILS && global.GEJAST_SCOPE_UTILS.defaultHome ? global.GEJAST_SCOPE_UTILS.defaultHome(scope) : './index.html');
    global.location.replace(href);
    return false;
  }

  global.GEJAST_SCOPED_RPC = {
    SCOPE_REQUIRED_RPCS,
    getScope,
    getSessionToken,
    rpcHeaders,
    parseResponse,
    callRpc,
    auditRowsInScope,
    collectNamesFromMatch,
    enforcePageScope
  };
})(window);
