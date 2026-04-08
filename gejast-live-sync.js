(function (global) {
  const RPC = global.GEJAST_RPC_CONTRACT;
  const CTX = global.GEJAST_SCOPE_CONTEXT;
  const LAST_WRITE = new Map();

  function normalizeName(value){ return String(value||'').trim(); }
  function normalizeParticipants(list){ return [...new Set((Array.isArray(list)?list:[]).map(normalizeName).filter(Boolean))]; }
  function normalizeSummary(summary){
    const out = Object.assign({}, summary || {});
    out.participants = normalizeParticipants(out.participants || out.players || []);
    if (out.players == null) out.players = out.participants;
    out.match_ref = String(out.match_ref || out.client_match_id || '').trim();
    out.submitter_meta = Object.assign({}, out.submitter_meta || {});
    if (out.submitter_meta.submitted_by_name) out.submitter_meta.submitted_by_name = normalizeName(out.submitter_meta.submitted_by_name);
    const isFinished = !!(out.finished_at || out.live_state?.status === 'finished');
    out.live_state = Object.assign({}, out.live_state || {}, { status: isFinished ? 'finished' : 'live', updated_at: new Date().toISOString() });
    return out;
  }
  function fingerprint(summary){
    const s = normalizeSummary(summary);
    return JSON.stringify({ ref: s.match_ref || '', fin: s.finished_at || null, host: s.submitter_meta?.submitted_by_name || '', parts: s.participants || [], totals: s.totals || s.scoreboard || {}, rounds: Array.isArray(s.rounds) ? s.rounds.length : 0, live: s.live_state?.status || 'live' });
  }
  async function legacyWrite({ gameType, clientMatchId, summaryPayload }) {
    return RPC.callRpc('save_game_match_summary', { session_token: CTX.getPlayerSessionToken(), game_type: gameType, client_match_id: String(clientMatchId), summary_payload: summaryPayload });
  }
  async function writeSummary({ gameType, clientMatchId, summaryPayload, minIntervalMs = 2500, force = false }) {
    const key = `${gameType}:${clientMatchId}`;
    const now = Date.now();
    const last = LAST_WRITE.get(key) || 0;
    if (!force && now - last < minIntervalMs) return { skipped: true, reason: 'throttled' };
    const payload = { session_token: CTX.getPlayerSessionToken(), game_type: gameType, client_match_id: String(clientMatchId), summary_payload: normalizeSummary(summaryPayload), site_scope_input: CTX.getScope() };
    const out = await RPC.callContractWriter('contract_live_write_v1', payload, () => legacyWrite({ gameType, clientMatchId, summaryPayload: payload.summary_payload }));
    LAST_WRITE.set(key, now);
    return out;
  }
  async function save(gameType, clientMatchId, summary, opts={}){ return writeSummary({ gameType, clientMatchId, summaryPayload: summary, force: !!opts.force, minIntervalMs: opts.minIntervalMs || 2500 }); }
  global.GEJAST_LIVE_SYNC = { normalizeSummary, fingerprint, save, writeSummary };
})(window);
