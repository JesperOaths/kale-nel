(function(){
  const REQUEUE_OVERRIDE_KEY = 'gejast_recent_requeues_v1';

  function parseMaybeDate(value){
    if(!value) return 0;
    const n = Date.parse(String(value));
    return Number.isFinite(n) ? n : 0;
  }
  function requestIdOf(row){
    return String(row?.request_id || row?.claim_request_id || row?.id || '').trim();
  }
  function readRequeueOverrides(){
    try {
      const raw = sessionStorage.getItem(REQUEUE_OVERRIDE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const now = Date.now();
      const next = {};
      Object.entries(parsed || {}).forEach(([key, value]) => {
        const until = Number(value || 0);
        if (until > now) next[String(key)] = until;
      });
      if (JSON.stringify(parsed || {}) !== JSON.stringify(next)) {
        if (Object.keys(next).length) sessionStorage.setItem(REQUEUE_OVERRIDE_KEY, JSON.stringify(next));
        else sessionStorage.removeItem(REQUEUE_OVERRIDE_KEY);
      }
      return next;
    } catch(_) {
      return {};
    }
  }
  function isRecentlyRequeued(row){
    const id = requestIdOf(row);
    if (!id) return false;
    const map = readRequeueOverrides();
    return Number(map[id] || 0) > Date.now();
  }
  function hasActivationEvidence(row){
    const out = row || {};
    return Boolean(
      out.has_pin ?? out.pin_is_set ?? out.player_has_pin ?? out.pin_set ?? out.pin_hash_set ?? out.pin_hash_present ??
      out.has_pin_hash ?? out.player_pin_hash_set ?? out.activated ?? out.activated_at ?? out.activated_on ?? out.link_used_at ??
      out.activation_used_at ?? out.player_activation_used_at ?? out.used_at ?? out.pin_hash ?? out.player_pin_hash ??
      (String(out.state_bucket || '').toLowerCase() === 'active')
    );
  }
  function isExpiredByTimestamp(row){
    if (isRecentlyRequeued(row)) return false;
    const now = Date.now();
    const candidates = [row?.expires_at, row?.activation_expires_at, row?.link_expires_at, row?.player_activation_expires_at, row?.expired_at]
      .map(parseMaybeDate)
      .filter(Boolean);
    return candidates.some((ts)=>ts <= now) && !hasActivationEvidence(row);
  }
  function deriveBucket(row){
    const out = row || {};
    const states = [out.state_bucket, out.status, out.request_status]
      .map((value)=>String(value || '').toLowerCase())
      .filter(Boolean);
    const decision = String(out.decision || '').toLowerCase();
    const hasPin = hasActivationEvidence(out);
    const recentRequeue = isRecentlyRequeued(out);
    if (states.some((raw)=>raw.includes('returned_to_claimable') || raw.includes('claimable_again') || raw.includes('claimable'))) return 'rejected';
    if (states.some((raw)=>raw.includes('revok') || raw.includes('reject') || raw.includes('denied'))) return 'rejected';
    if (states.some((raw)=>raw.includes('active') || raw.includes('activated'))) return 'active';
    if (decision === 'rejected' || decision === 'revoked') return 'rejected';
    if (hasPin) return 'active';
    if (recentRequeue) return 'awaiting';
    if (states.some((raw)=>raw.includes('expired'))) return 'expired';
    if (isExpiredByTimestamp(out)) return 'expired';
    if (states.some((raw)=>raw.includes('approved') || raw.includes('await') || raw.includes('pending_activation') || raw.includes('pending activation') || raw.includes('awaiting_activation') || raw.includes('awaiting activation') || raw.includes('waiting'))) return 'awaiting';
    return 'pending';
  }
  function normalizeRows(rows){
    return (rows || []).map((row)=>{
      const out = row && typeof row === 'object' ? { ...row } : { value: row };
      const state_bucket = deriveBucket(out);
      return { ...out, hasPin: hasActivationEvidence(out), state_bucket };
    });
  }
  function normalizeExpiredRows(rows){ return normalizeRows(rows || []); }
  function requestKey(row){ return row?.request_id || row?.claim_request_id || row?.id || `${row?.display_name||''}|${row?.requester_email||''}|${row?.created_at||''}`; }
  function isLikelyExpired(row){
    if (isRecentlyRequeued(row)) return false;
    try {
      const bucket = deriveBucket(row);
      if (bucket !== 'awaiting') return false;
      const exp = row?.expires_at ? new Date(row.expires_at) : null;
      if (exp && !isNaN(exp) && exp.getTime() < Date.now()) return true;
    } catch(_){}
    return false;
  }
  function mergeHistoryWithExpired(historyRows, expiredRows){
    const byId = new Map();
    [...(historyRows || []), ...(expiredRows || [])].forEach((row)=>{
      const key = requestKey(row);
      if (!key) return;
      const existing = byId.get(key) || {};
      byId.set(key, { ...existing, ...row });
    });
    return Array.from(byId.values()).map((row)=>{
      if (isRecentlyRequeued(row)) {
        return { ...row, state_bucket:'awaiting', request_status:'pending_activation', status:'pending_activation' };
      }
      return isLikelyExpired(row) ? { ...row, state_bucket:'expired', request_status:'activation_expired', status:'activation_expired' } : row;
    });
  }
  function counts(requestRows, historyRows){
    const requests = normalizeRows(requestRows || []);
    const history = normalizeRows(historyRows || []);
    return {
      pending: requests.filter((item)=>deriveBucket(item)==='pending').length,
      awaiting: history.filter((item)=>deriveBucket(item)==='awaiting').length,
      active: history.filter((item)=>deriveBucket(item)==='active').length,
      rejected: history.filter((item)=>deriveBucket(item)==='rejected').length,
      expired: history.filter((item)=>deriveBucket(item)==='expired').length
    };
  }
  window.GEJAST_ADMIN_BUCKETS = { parseMaybeDate, hasActivationEvidence, isExpiredByTimestamp, deriveBucket, normalizeRows, normalizeExpiredRows, mergeHistoryWithExpired, counts, requestKey, isLikelyExpired, requestIdOf, isRecentlyRequeued };
})();
