(function (global) {
  const RPC = global.GEJAST_RPC_CONTRACT;
  const CTX = global.GEJAST_SCOPE_CONTEXT;
  const CACHE_KEY = 'gejast_admin_claims_bundle_v2';
  const CACHE_TTL = 8 * 1000;

  async function callFirstRpc(candidates, payload) {
    let lastErr = null;
    for (const name of candidates) {
      try {
        return await RPC.callRpc(name, payload);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Geen bruikbare admin-RPC gevonden.');
  }
  function readCache(){ try{ const raw=sessionStorage.getItem(CACHE_KEY); if(!raw) return null; const parsed=JSON.parse(raw); if(!parsed?.at || (Date.now()-Number(parsed.at))>CACHE_TTL) return null; return parsed.value||null; }catch(_){ return null; } }
  function writeCache(value){ try{ sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at:Date.now(), value })); }catch(_){} return value; }
  function stateBucket(row) {
    const bucket = String(row?.bucket || row?.status_bucket || '').toLowerCase();
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
  async function loadBundle({ scope = CTX.getScope(), force = false } = {}) {
    if(!force){ const cached=readCache(); if(cached) return cached; }
    const payload = { admin_session_token: CTX.getAdminSessionToken(), site_scope_input: scope };
    const [requests, history, expiredQueue] = await Promise.all([
      callFirstRpc(['admin_get_claim_requests', 'admin_list_claim_requests_action'], payload),
      callFirstRpc(['admin_get_claim_history', 'admin_list_claim_history_action'], payload),
      callFirstRpc(['admin_get_expired_activation_queue', 'admin_list_expired_activation_queue_action'], payload).catch(() => ({ items: [] }))
    ]);
    const requestRows = Array.isArray(requests) ? requests : (requests?.requests || requests?.items || []);
    const historyRows = Array.isArray(history) ? history : (history?.history || history?.items || []);
    const expiredRows = Array.isArray(expiredQueue) ? expiredQueue : (expiredQueue?.items || []);
    return writeCache({ requests: requestRows, history: historyRows, expired_queue: expiredRows, expiredQueue: expiredRows, counts: normalizeCounts(requestRows, historyRows, expiredRows) });
  }
  async function load(adminSessionToken, opts={}){ return loadBundle({ scope: opts.scope || CTX.getScope(), force: !!opts.force }); }
  global.GEJAST_ADMIN_CLAIMS_SOURCE = { loadBundle, load, stateBucket, normalizeCounts, callFirstRpc };
})(window);
