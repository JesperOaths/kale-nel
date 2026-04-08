(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DRINKS_WORKFLOW = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const NORMALIZER = root.DRINK_TYPE_NORMALIZATION;

  const SESSION_KEYS = ['jas_session_token_v11', 'jas_session_token_v10'];

  function getConfig() {
    if (!root.GEJAST_CONFIG || !root.GEJAST_CONFIG.SUPABASE_URL || !root.GEJAST_CONFIG.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error('GEJAST_CONFIG ontbreekt of is incompleet.');
    }
    return root.GEJAST_CONFIG;
  }

  function getSessionToken() {
    if (root.GEJAST_CONFIG && typeof root.GEJAST_CONFIG.getPlayerSessionToken === 'function') {
      return root.GEJAST_CONFIG.getPlayerSessionToken() || '';
    }
    for (const key of SESSION_KEYS) {
      const value = root.localStorage.getItem(key) || root.sessionStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }

  function rpcHeaders() {
    const cfg = getConfig();
    return {
      apikey: cfg.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  async function parseJson(response) {
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      throw new Error(text || `HTTP ${response.status}`);
    }
    if (!response.ok) {
      const err = new Error(data?.message || data?.error || text || `HTTP ${response.status}`);
      err.status = response.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  async function callRpc(name, payload) {
    const cfg = getConfig();
    const response = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: rpcHeaders(),
      body: JSON.stringify(payload || {})
    });
    return parseJson(response);
  }

  function normalizeWorkflowError(error) {
    const rawMessage = String(error?.message || error || 'Onbekende fout');
    const upper = rawMessage.toUpperCase();
    const message =
      upper.includes('MISSING_SESSION') ? 'Niet ingelogd.' :
      upper.includes('NOT_ALLOWED') ? 'Deze actie is niet toegestaan.' :
      upper.includes('ALREADY_RESOLVED') ? 'Deze aanvraag is al afgehandeld.' :
      upper.includes('NOT_FOUND') ? 'Aanvraag niet gevonden.' :
      upper.includes('INVALID_KIND') ? 'Onbekend requesttype.' :
      upper.includes('INVALID_ACTION') ? 'Onbekende drinks-actie.' :
      rawMessage;
    const out = new Error(message);
    out.raw = error;
    out.code =
      upper.includes('MISSING_SESSION') ? 'MISSING_SESSION' :
      upper.includes('NOT_ALLOWED') ? 'NOT_ALLOWED' :
      upper.includes('ALREADY_RESOLVED') ? 'ALREADY_RESOLVED' :
      upper.includes('NOT_FOUND') ? 'NOT_FOUND' :
      upper.includes('INVALID_KIND') ? 'INVALID_KIND' :
      upper.includes('INVALID_ACTION') ? 'INVALID_ACTION' :
      'WORKFLOW_ERROR';
    return out;
  }

  function assertSessionToken() {
    const token = getSessionToken();
    if (!token) {
      throw normalizeWorkflowError(new Error('MISSING_SESSION'));
    }
    return token;
  }

  function assertRequestKind(requestKind) {
    const kind = String(requestKind || 'drink').trim().toLowerCase();
    if (!['drink', 'speed'].includes(kind)) {
      throw normalizeWorkflowError(new Error('INVALID_KIND'));
    }
    return kind;
  }

  function assertPositiveNumber(value, fieldName) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error(`${fieldName} moet groter dan 0 zijn.`);
    }
    return numeric;
  }

  function assertRequestId(requestId) {
    const numeric = Number(requestId);
    if (!Number.isInteger(numeric) || numeric <= 0) {
      throw new Error('Ongeldig request_id.');
    }
    return numeric;
  }

  function normalizePayloadKindAndType(requestKind, payload) {
    const kind = assertRequestKind(requestKind);
    const next = Object.assign({}, payload || {});
    if (next.event_type_key != null) {
      next.event_type_key = NORMALIZER.normalizeDrinkTypeKey(next.event_type_key, {
        allowShots: kind !== 'speed',
        fallback: 'bier'
      });
    }
    return { kind, payload: next };
  }

  async function callCanonicalAction(action, requestKind, payload) {
    const token = assertSessionToken();
    const normalized = normalizePayloadKindAndType(requestKind, payload);
    try {
      const result = await callRpc('canonical_drinks_action_v1', {
        session_token: token,
        action,
        request_kind: normalized.kind,
        payload: normalized.payload
      });
      if (result && result.ok === false) {
        throw new Error(result.error_code || result.message || 'WORKFLOW_ERROR');
      }
      return result;
    } catch (error) {
      throw normalizeWorkflowError(error);
    }
  }

  /**
   * Creates a new drink or speed request in canonical pending storage.
   * @param {Object} input
   * @param {'drink'|'speed'} input.requestKind
   * @param {string} input.eventTypeKey
   * @param {number} [input.quantity=1]
   * @param {number|null} [input.durationSeconds=null]
   * @param {number|null} [input.lat=null]
   * @param {number|null} [input.lng=null]
   * @param {number|null} [input.accuracy=null]
   * @param {string|null} [input.clientRequestId=null]
   * @returns {Promise<Object>}
   */
  async function createDrinkRequest(input) {
    const requestKind = assertRequestKind(input?.requestKind);
    const eventTypeKey = NORMALIZER.normalizeDrinkTypeKey(input?.eventTypeKey, {
      allowShots: requestKind !== 'speed',
      fallback: 'bier'
    });
    const quantity = assertPositiveNumber(input?.quantity == null ? 1 : input.quantity, 'Aantal');
    const payload = {
      event_type_key: eventTypeKey,
      quantity,
      duration_seconds: requestKind === 'speed' && input?.durationSeconds != null ? assertPositiveNumber(input.durationSeconds, 'Duur') : null,
      lat: input?.lat == null ? null : Number(input.lat),
      lng: input?.lng == null ? null : Number(input.lng),
      accuracy: input?.accuracy == null ? null : Number(input.accuracy),
      client_request_id: input?.clientRequestId || null
    };
    return callCanonicalAction('create', requestKind, payload);
  }

  /**
   * Marks a creator-owned request as explicitly submitted for verification.
   * @param {Object} input
   * @param {'drink'|'speed'} input.requestKind
   * @param {number} input.requestId
   * @returns {Promise<Object>}
   */
  async function submitForVerification(input) {
    return callCanonicalAction('submit', input?.requestKind, {
      request_id: assertRequestId(input?.requestId)
    });
  }

  /**
   * Records an approval vote for a pending drink or speed request.
   * @param {Object} input
   * @param {'drink'|'speed'} input.requestKind
   * @param {number} input.requestId
   * @param {number|null} [input.lat=null]
   * @param {number|null} [input.lng=null]
   * @param {number|null} [input.accuracy=null]
   * @returns {Promise<Object>}
   */
  async function approveDrink(input) {
    return callCanonicalAction('approve', input?.requestKind, {
      request_id: assertRequestId(input?.requestId),
      lat: input?.lat == null ? null : Number(input.lat),
      lng: input?.lng == null ? null : Number(input.lng),
      accuracy: input?.accuracy == null ? null : Number(input.accuracy)
    });
  }

  /**
   * Records a rejection vote for a pending drink or speed request.
   * @param {Object} input
   * @param {'drink'|'speed'} input.requestKind
   * @param {number} input.requestId
   * @param {number|null} [input.lat=null]
   * @param {number|null} [input.lng=null]
   * @param {number|null} [input.accuracy=null]
   * @param {string|null} [input.reason=null]
   * @returns {Promise<Object>}
   */
  async function rejectDrink(input) {
    return callCanonicalAction('reject', input?.requestKind, {
      request_id: assertRequestId(input?.requestId),
      lat: input?.lat == null ? null : Number(input.lat),
      lng: input?.lng == null ? null : Number(input.lng),
      accuracy: input?.accuracy == null ? null : Number(input.accuracy),
      reason: input?.reason || null
    });
  }

  /**
   * Cancels a creator-owned pending request.
   * @param {Object} input
   * @param {'drink'|'speed'} input.requestKind
   * @param {number} input.requestId
   * @returns {Promise<Object>}
   */
  async function cancelDrink(input) {
    return callCanonicalAction('cancel', input?.requestKind, {
      request_id: assertRequestId(input?.requestId)
    });
  }

  /**
   * Loads canonical pending data for drinks and/or speed.
   * @param {Object} [input]
   * @param {'drink'|'speed'|null} [input.requestKind=null]
   * @param {number|null} [input.viewerLat=null]
   * @param {number|null} [input.viewerLng=null]
   * @returns {Promise<{my_pending:Array,verification_queue:Array,recent_rejected:Array}>}
   */
  async function loadPending(input) {
    try {
      return await callRpc('get_canonical_pending_drinks_public', {
        session_token: getSessionToken() || null,
        viewer_lat: input?.viewerLat == null ? null : Number(input.viewerLat),
        viewer_lng: input?.viewerLng == null ? null : Number(input.viewerLng),
        request_kind: input?.requestKind || null
      });
    } catch (error) {
      throw normalizeWorkflowError(error);
    }
  }

  /**
   * Loads verified canonical drink records from the single verified source.
   * @param {Object} [input]
   * @param {'drink'|'speed'|null} [input.requestKind=null]
   * @param {string|null} [input.playerName=null]
   * @param {string|null} [input.eventTypeKey=null]
   * @param {number|null} [input.limit=40]
   * @returns {Promise<Array>}
   */
  async function loadVerifiedDrinks(input) {
    try {
      return await callRpc('get_canonical_verified_drinks_public', {
        request_kind: input?.requestKind || null,
        target_player_name: input?.playerName || null,
        canonical_event_type_key: input?.eventTypeKey ? NORMALIZER.normalizeDrinkTypeKey(input.eventTypeKey, { allowShots: true, fallback: 'bier' }) : null,
        limit_count: input?.limit == null ? 40 : Number(input.limit)
      });
    } catch (error) {
      throw normalizeWorkflowError(error);
    }
  }

  /**
   * Loads verified history for the canonical drinks lifecycle.
   * @param {Object} [input]
   * @param {'drink'|'speed'|null} [input.requestKind=null]
   * @param {number|null} [input.limit=100]
   * @returns {Promise<Array>}
   */
  async function loadHistory(input) {
    return loadVerifiedDrinks({
      requestKind: input?.requestKind || null,
      eventTypeKey: input?.eventTypeKey || null,
      playerName: input?.playerName || null,
      limit: input?.limit == null ? 100 : input.limit
    });
  }

  /**
   * Loads homepage drinks highlights from canonical verified storage.
   * @returns {Promise<Object>}
   */
  async function loadHomepageHighlights() {
    try {
      return await callRpc('get_canonical_drinks_homepage_public', {});
    } catch (error) {
      throw normalizeWorkflowError(error);
    }
  }

  /**
   * Loads canonical drinks profile data for one player.
   * @param {Object} input
   * @param {string} input.playerName
   * @returns {Promise<Object>}
   */
  async function loadPlayerProfile(input) {
    const playerName = String(input?.playerName || '').trim();
    if (!playerName) {
      throw new Error('playerName ontbreekt.');
    }
    try {
      return await callRpc('get_canonical_drinks_player_public', {
        player_name: playerName
      });
    } catch (error) {
      throw normalizeWorkflowError(error);
    }
  }

  /**
   * Loads canonical speed statistics.
   * @param {Object} [input]
   * @param {string|null} [input.playerName=null]
   * @returns {Promise<Object>}
   */
  async function loadSpeedStats(input) {
    try {
      return await callRpc('get_canonical_drinks_speed_stats_public', {
        session_token: getSessionToken() || null,
        target_player_name: input?.playerName || null
      });
    } catch (error) {
      throw normalizeWorkflowError(error);
    }
  }

  /**
   * Loads the canonical drinks dashboard bundle used by drinks.html.
   * @param {Object} [input]
   * @param {number|null} [input.viewerLat=null]
   * @param {number|null} [input.viewerLng=null]
   * @returns {Promise<Object>}
   */
  async function loadStats(input) {
    const [pending, verified, homepage, speedStats] = await Promise.all([
      loadPending({ requestKind: null, viewerLat: input?.viewerLat ?? null, viewerLng: input?.viewerLng ?? null }),
      loadVerifiedDrinks({ requestKind: 'drink', limit: 250 }),
      loadHomepageHighlights(),
      loadSpeedStats({})
    ]);

    return {
      pending,
      verified,
      homepage,
      speed: speedStats,
      visibleTypes: NORMALIZER.getVisibleDrinkTypes({ includeShots: false })
    };
  }

  return {
    createDrinkRequest,
    submitForVerification,
    approveDrink,
    rejectDrink,
    cancelDrink,
    loadVerifiedDrinks,
    loadPending,
    loadHistory,
    loadHomepageHighlights,
    loadPlayerProfile,
    loadSpeedStats,
    loadStats,
    normalizeWorkflowError
  };
});
