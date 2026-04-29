(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GEJAST_ADMIN_BUCKETS = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function parseMaybeDate(value) {
    if (!value) return 0;
    const ts = Date.parse(String(value));
    return Number.isFinite(ts) ? ts : 0;
  }

  function hasActivationEvidence(row) {
    const item = row || {};
    return Boolean(
      item.has_pin ??
      item.pin_is_set ??
      item.player_has_pin ??
      item.pin_set ??
      item.pin_hash_set ??
      item.pin_hash_present ??
      item.has_pin_hash ??
      item.player_pin_hash_set ??
      item.activated ??
      item.activated_at ??
      item.activated_on ??
      item.link_used_at ??
      item.activation_used_at ??
      item.player_activation_used_at ??
      item.used_at ??
      item.pin_hash ??
      item.player_pin_hash ??
      false
    );
  }

  function isExpiredByTimestamp(row) {
    const item = row || {};
    const now = Date.now();
    const candidates = [
      item.expires_at,
      item.activation_expires_at,
      item.link_expires_at,
      item.player_activation_expires_at,
      item.expired_at
    ].map(parseMaybeDate).filter(Boolean);
    return candidates.some((ts) => ts <= now) && !hasActivationEvidence(item);
  }

  function deriveBucket(row) {
    const item = row || {};
    const states = [
      item.state_bucket,
      item.status,
      item.request_status
    ].map((value) => String(value || '').toLowerCase()).filter(Boolean);
    const decision = String(item.decision || '').toLowerCase();
    const hasPin = hasActivationEvidence(item);

    if (states.some((raw) => raw.includes('expired'))) return 'expired';
    if (isExpiredByTimestamp(item)) return 'expired';
    if (states.some((raw) => raw.includes('returned_to_claimable') || raw.includes('claimable_again') || raw.includes('claimable'))) return 'rejected';
    if (states.some((raw) => raw.includes('revok') || raw.includes('reject') || raw.includes('denied'))) return 'rejected';
    if (states.some((raw) => raw.includes('active') || raw.includes('activated'))) return 'active';
    if (states.some((raw) => raw.includes('approved') || raw.includes('await') || raw.includes('pending_activation') || raw.includes('awaiting_activation') || raw.includes('waiting'))) {
      return hasPin ? 'active' : 'awaiting';
    }
    if (decision === 'rejected' || decision === 'revoked') return 'rejected';
    if (hasPin) return 'active';
    return 'pending';
  }

  function normalizeRows(rows) {
    return (rows || []).map((row) => {
      const out = row && typeof row === 'object' ? { ...row } : { value: row };
      out.state_bucket = deriveBucket(out);
      out.has_pin = hasActivationEvidence(out);
      return out;
    });
  }

  function requestIdOf(row) {
    const raw = row?.request_id ?? row?.id ?? row?.claim_request_id ?? null;
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : String(raw);
  }

  function isLikelyExpired(row) {
    try {
      const bucket = deriveBucket(row);
      if (bucket !== 'awaiting') return false;
      const exp = row?.expires_at ? new Date(row.expires_at) : null;
      if (exp && !Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) return true;
      const approvedAt = new Date(row?.approved_at || row?.decision_at || row?.updated_at || row?.requested_at || row?.created_at || '');
      if (!Number.isNaN(approvedAt.getTime())) {
        return (Date.now() - approvedAt.getTime()) > (24 * 60 * 60 * 1000);
      }
    } catch (_) {}
    return false;
  }

  function mergeHistoryWithExpired(historyRows, expiredRows) {
    const byId = new Map();
    normalizeRows(historyRows).forEach((row) => {
      const key = requestIdOf(row);
      if (key != null) byId.set(String(key), row);
    });
    normalizeRows(expiredRows).forEach((row) => {
      const key = requestIdOf(row);
      if (key == null) return;
      const existing = byId.get(String(key)) || {};
      byId.set(String(key), {
        ...existing,
        ...row,
        state_bucket: 'expired',
        request_status: row.request_status || existing.request_status || 'activation_expired',
        status: row.status || existing.status || 'activation_expired'
      });
    });
    return Array.from(byId.values()).map((row) => (
      isLikelyExpired(row)
        ? { ...row, state_bucket: 'expired', request_status: 'activation_expired', status: 'activation_expired' }
        : row
    ));
  }

  function countBuckets(requestRows, historyRows, expiredRows) {
    const pending = normalizeRows(requestRows || []).filter((item) => item.state_bucket === 'pending').length;
    const mergedHistory = mergeHistoryWithExpired(historyRows || [], expiredRows || []);
    return {
      pending,
      awaiting: mergedHistory.filter((item) => item.state_bucket === 'awaiting').length,
      active: mergedHistory.filter((item) => item.state_bucket === 'active').length,
      rejected: mergedHistory.filter((item) => item.state_bucket === 'rejected').length,
      expired: mergedHistory.filter((item) => item.state_bucket === 'expired').length
    };
  }

  return {
    hasActivationEvidence,
    isExpiredByTimestamp,
    deriveBucket,
    normalizeRows,
    requestIdOf,
    isLikelyExpired,
    mergeHistoryWithExpired,
    countBuckets
  };
});
