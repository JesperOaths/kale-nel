(function(){
  const fingerprints = new Map();
  function cfg(){ return window.GEJAST_CONFIG || {}; }
  function headers(){ const c=cfg(); return { apikey:c.SUPABASE_PUBLISHABLE_KEY||'', Authorization:`Bearer ${c.SUPABASE_PUBLISHABLE_KEY||''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const t=await res.text(); let d=null; try{ d=t?JSON.parse(t):null; }catch{ throw new Error(t||`HTTP ${res.status}`); } if(!res.ok) throw new Error(d?.message||d?.error||`HTTP ${res.status}`); return d; }
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
    return JSON.stringify({
      ref: s.match_ref || '',
      fin: s.finished_at || null,
      host: s.submitter_meta?.submitted_by_name || '',
      parts: s.participants || [],
      totals: s.totals || s.scoreboard || {},
      rounds: Array.isArray(s.rounds) ? s.rounds.length : 0,
      live: s.live_state?.status || 'live'
    });
  }
  async function save(gameType, clientMatchId, summary, opts={}){
    const c = cfg();
    const token = (c.getPlayerSessionToken && c.getPlayerSessionToken()) || '';
    if (!c.SUPABASE_URL || !c.SUPABASE_PUBLISHABLE_KEY || !token) return { skipped:true, reason:'missing-config-or-token' };
    const normalized = normalizeSummary(summary);
    const key = opts.stateKey || `${String(gameType||'')}:${String(clientMatchId||normalized.match_ref||'')}`;
    const fp = fingerprint(normalized);
    if (!opts.force && fingerprints.get(key) === fp) return { skipped:true, reason:'unchanged' };
    await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/save_game_match_summary`, {
      method:'POST', mode:'cors', cache:'no-store', headers:headers(),
      body: JSON.stringify({ session_token: token, game_type: String(gameType||''), client_match_id: String(clientMatchId || normalized.match_ref || ''), summary_payload: normalized })
    }).then(parse);
    fingerprints.set(key, fp);
    return { skipped:false, fingerprint:fp };
  }
  window.GEJAST_LIVE_SYNC = { normalizeSummary, fingerprint, save };
})();
