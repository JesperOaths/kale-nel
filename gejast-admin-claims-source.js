(function (global) {
  const CACHE_KEY = 'gejast_admin_claims_bundle_v3';
  const CACHE_TTL = 8 * 1000;

  function resolveCtx() {
    return global.GEJAST_SCOPE_CONTEXT || {
      getScope() { return 'friends'; },
      getAdminSessionToken() { return ''; }
    };
  }

  function resolveRpc() {
    return global.GEJAST_RPC_CONTRACT || null;
  }

  function resolveAdminRpc() {
    return global.GEJAST_ADMIN_RPC || null;
  }

  function directRpcHeaders() {
    const cfg = global.GEJAST_CONFIG || {};
    return {
      apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '',
      Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  async function directParse(res) {
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      throw new Error(text || `HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || text || `HTTP ${res.status}`);
    return data;
  }

  async function directCallRpc(name, payload) {
    const cfg = global.GEJAST_CONFIG || {};
    if (!cfg.SUPABASE_URL) throw new Error('Supabase-config ontbreekt.');
    const raw = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: directRpcHeaders(),
      body: JSON.stringify(payload || {})
    }).then(directParse);
    return raw?.[name] || raw;
  }

  function canRetryWithoutScope(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('schema cache') || message.includes('could not find the function') || message.includes('function public.');
  }

  async function invokeCompat(invoker, name, payload) {
    try {
      return await invoker(name, payload);
    } catch (error) {
      if (payload && payload.site_scope_input !== undefined && canRetryWithoutScope(error)) {
        const next = { ...payload };
        delete next.site_scope_input;
        return await invoker(name, next);
      }
      throw error;
    }
  }

  async function callFirstRpc(candidates, payload) {
    let lastErr = null;
    const rpc = resolveRpc();
    for (const name of candidates) {
      try {
        if (rpc && typeof rpc.callRpc === 'function') {
          return await invokeCompat((rpcName, rpcPayload) => rpc.callRpc(rpcName, rpcPayload), name, payload);
        }
        return await invokeCompat(directCallRpc, name, payload);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Geen bruikbare admin-RPC gevonden.');
  }

  function readCache() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.at || (Date.now() - Number(parsed.at)) > CACHE_TTL) return null;
      return parsed.value || null;
    } catch (_) {
      return null;
    }
  }

  function writeCache(value) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), value }));
    } catch (_) {}
    return value;
  }

  function stateBucket(row) {
    const bucket = String(row?.bucket || row?.status_bucket || row?.state_bucket || '').toLowerCase();
    if (bucket) return bucket;
    const state = String(row?.state || row?.request_state || row?.status || '').toLowerCase();
    if (['pending', 'requested', 'new'].includes(state)) return 'pending';
    if (['awaiting', 'approved_pending_activation', 'pending_activation'].includes(state)) return 'awaiting';
    if (['active', 'activated', 'approved_active'].includes(state)) return 'active';
    if (['rejected', 'revoked', 'returned'].includes(state)) return 'rejected';
    if (['expired'].includes(state)) return 'expired';
    return 'pending';
  }

  function normalizeCounts(rows, history, expiredQueue) {
    const all = [...(rows || []), ...(history || []), ...(expiredQueue || [])];
    const counts = { pending: 0, awaiting: 0, expired: 0, active: 0, rejected: 0 };
    all.forEach((item) => {
      const bucket = stateBucket(item);
      if (counts[bucket] !== undefined) counts[bucket] += 1;
    });
    return counts;
  }

  function normalizeBundle(raw) {
    const requestRows = Array.isArray(raw) ? raw : (raw?.requests || raw?.items || []);
    const historyRows = Array.isArray(raw?.history) ? raw.history : (raw?.history || raw?.items || []);
    const expiredRows = Array.isArray(raw?.expired_queue)
      ? raw.expired_queue
      : Array.isArray(raw?.expiredQueue)
        ? raw.expiredQueue
        : Array.isArray(raw?.items)
          ? raw.items
          : [];
    return {
      requests: Array.isArray(requestRows) ? requestRows : [],
      history: Array.isArray(historyRows) ? historyRows : [],
      expired_queue: Array.isArray(expiredRows) ? expiredRows : [],
      expiredQueue: Array.isArray(expiredRows) ? expiredRows : [],
      counts: raw?.counts || normalizeCounts(requestRows, historyRows, expiredRows)
    };
  }

  async function loadBundle({ scope = resolveCtx().getScope(), force = false } = {}) {
    if (!force) {
      const cached = readCache();
      if (cached) return cached;
    }

    const adminRpc = resolveAdminRpc();
    if (adminRpc && typeof adminRpc.secureRead === 'function') {
      try {
        const secured = await adminRpc.secureRead('claims', { site_scope_input: scope });
        return writeCache(normalizeBundle(secured || {}));
      } catch (_) {}
    }

    const payload = { admin_session_token: resolveCtx().getAdminSessionToken(), site_scope_input: scope };
    const [requests, history, expiredQueue] = await Promise.all([
      callFirstRpc(['admin_get_claim_requests', 'admin_list_claim_requests_action'], payload),
      callFirstRpc(['admin_get_claim_history', 'admin_list_claim_history_action'], payload),
      callFirstRpc(['admin_get_expired_activation_queue', 'admin_list_expired_activation_queue_action'], payload).catch(() => ({ items: [] }))
    ]);

    const bundle = normalizeBundle({
      requests: Array.isArray(requests) ? requests : (requests?.requests || requests?.items || []),
      history: Array.isArray(history) ? history : (history?.history || history?.items || []),
      expired_queue: Array.isArray(expiredQueue) ? expiredQueue : (expiredQueue?.items || [])
    });
    return writeCache(bundle);
  }

  async function load(adminSessionToken, opts = {}) {
    return loadBundle({ scope: opts.scope || resolveCtx().getScope(), force: !!opts.force });
  }

  global.GEJAST_ADMIN_CLAIMS_SOURCE = {
    loadBundle,
    load,
    stateBucket,
    normalizeCounts,
    callFirstRpc,
    resolveRpc,
    directCallRpc
  };
})(window);
