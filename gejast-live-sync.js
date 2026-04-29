(function (global) {
  const SESSION_KEYS = ['jas_session_token_v11', 'jas_session_token_v10'];
  const LAST_WRITE = new Map();

  function cfg() {
    return global.GEJAST_CONFIG || {};
  }

  function getScope(siteScope) {
    if (siteScope) return siteScope;
    if (global.GEJAST_SCOPE_UTILS && typeof global.GEJAST_SCOPE_UTILS.getScope === 'function') {
      return global.GEJAST_SCOPE_UTILS.getScope();
    }
    return 'friends';
  }

  function getPlayerSessionToken() {
    if (cfg().getPlayerSessionToken && typeof cfg().getPlayerSessionToken === 'function') {
      return cfg().getPlayerSessionToken() || '';
    }
    for (const key of SESSION_KEYS) {
      const value = global.localStorage.getItem(key) || global.sessionStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }

  function rpcHeaders() {
    const c = cfg();
    return {
      apikey: c.SUPABASE_PUBLISHABLE_KEY || '',
      Authorization: `Bearer ${c.SUPABASE_PUBLISHABLE_KEY || ''}`,
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
    if (!res.ok) throw new Error(data?.message || data?.error || text || `HTTP ${res.status}`);
    return data;
  }

  async function rpc(name, payload, keepalive) {
    const c = cfg();
    const res = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      keepalive: !!keepalive,
      headers: rpcHeaders(),
      body: JSON.stringify(payload || {})
    });
    return parseResponse(res);
  }

  function stableFingerprint(gameType, clientMatchId, summaryPayload) {
    const summary = summaryPayload || {};
    return JSON.stringify({
      gameType: String(gameType || '').toLowerCase(),
      clientMatchId: String(clientMatchId || ''),
      finishedAt: summary.finished_at || null,
      liveStatus: summary?.live_state?.status || null,
      updatedAt: summary?.live_state?.updated_at || null,
      participants: Array.isArray(summary.participants) ? summary.participants : [],
      winnerNames: Array.isArray(summary.winner_names) ? summary.winner_names : [],
      roundCount: Array.isArray(summary.rounds) ? summary.rounds.length : 0,
      totals: summary.totals || summary.scoreboard || {}
    });
  }

  function normalizePayload(input) {
    const payload = Object.assign({}, input || {});
    const liveState = Object.assign({}, payload.live_state || {});
    const finished = !!(payload.finished_at || String(liveState.status || '').toLowerCase() === 'finished');
    liveState.status = finished ? 'finished' : (liveState.status || 'live');
    liveState.updated_at = liveState.updated_at || new Date().toISOString();
    payload.match_ref = payload.match_ref || input?.clientMatchId || input?.client_match_id || '';
    payload.live_state = liveState;
    payload.finished_at = finished ? (payload.finished_at || liveState.updated_at) : null;
    if (!Array.isArray(payload.participants)) payload.participants = [];
    if (!Array.isArray(payload.winner_names)) payload.winner_names = [];
    return payload;
  }

  async function writeSummary(options) {
    const opts = Object.assign({
      gameType: '',
      clientMatchId: '',
      summaryPayload: {},
      siteScope: null,
      force: false,
      throttleMs: 1500,
      keepalive: false
    }, options || {});

    const gameType = String(opts.gameType || '').trim().toLowerCase();
    const clientMatchId = String(opts.clientMatchId || '').trim();
    if (!gameType || !clientMatchId) throw new Error('gameType en clientMatchId zijn verplicht.');

    const payload = normalizePayload(opts.summaryPayload);
    const fingerprint = stableFingerprint(gameType, clientMatchId, payload);
    const mapKey = `${gameType}:${clientMatchId}`;
    const prev = LAST_WRITE.get(mapKey) || { ts: 0, fingerprint: '' };
    const now = Date.now();
    if (!opts.force && prev.fingerprint === fingerprint && (now - prev.ts) < Number(opts.throttleMs || 0)) {
      return { skipped: true, reason: 'deduped' };
    }

    const body = {
      session_token: getPlayerSessionToken() || null,
      game_type: gameType,
      client_match_id: clientMatchId,
      summary_payload: payload,
      site_scope_input: getScope(opts.siteScope)
    };

    try {
      const raw = await rpc('save_game_match_summary_scoped', body, opts.keepalive);
      LAST_WRITE.set(mapKey, { ts: now, fingerprint });
      return raw?.data || raw || { ok: true };
    } catch (_) {
      const raw = await rpc('save_game_match_summary', {
        session_token: body.session_token,
        game_type: gameType,
        client_match_id: clientMatchId,
        summary_payload: payload
      }, opts.keepalive);
      LAST_WRITE.set(mapKey, { ts: now, fingerprint });
      return raw || { ok: true };
    }
  }

  global.GEJAST_LIVE_SYNC = {
    writeSummary,
    stableFingerprint,
    normalizePayload
  };
})(typeof window !== 'undefined' ? window : globalThis);

