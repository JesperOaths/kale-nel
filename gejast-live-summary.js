(function (global) {
  const RPC = global.GEJAST_RPC_CONTRACT;
  const CTX = global.GEJAST_SCOPE_CONTEXT;

  function currentScope(){ return CTX.getScope(); }
  function currentSessionToken(){ return CTX.getPlayerSessionToken(); }
  function normalizeName(value){ return String(value||'').trim().toLowerCase(); }
  function matchIdentityFromUrl(){ const params = new URLSearchParams(location.search); return { clientMatchId: params.get('client_match_id') || '', matchRef: params.get('match_ref') || '' }; }
  function itemFromPayload(data){ return data?.item || data || {}; }
  function summaryFromItem(item){ return item?.summary || item?.summary_payload || {}; }
  function participants(item){
    const summary = summaryFromItem(item);
    const rows = []
      .concat(Array.isArray(item?.participant_names) ? item.participant_names : [])
      .concat(Array.isArray(summary?.participants) ? summary.participants : [])
      .concat(Array.isArray(summary?.players) ? summary.players : []);
    return [...new Set(rows.map((v)=>String(v||'').trim()).filter(Boolean))];
  }
  function hostName(item){
    const summary = summaryFromItem(item);
    return String(summary?.submitter_meta?.submitted_by_name || summary?.submitter_name || item?.submitter_name || '').trim();
  }
  function isFinished(item){ return !!(item?.finished_at || summaryFromItem(item)?.finished_at || summaryFromItem(item)?.live_state?.status === 'finished'); }
  function metaText(item){ if(isFinished(item)){ const when = item.finished_at || summaryFromItem(item)?.finished_at; return when ? `Afgerond op ${new Date(when).toLocaleString('nl-NL')}` : 'Wedstrijd afgerond.'; } const updated = item.updated_at || summaryFromItem(item)?.live_state?.updated_at || Date.now(); return `Laatst bijgewerkt: ${new Date(updated).toLocaleString('nl-NL')}`; }
  function buildScopedHref(path, scope){ const url = new URL(path, location.href); if (scope || currentScope()) url.searchParams.set('scope', scope || currentScope()); return `${url.pathname.split('/').pop()}${url.search}`; }

  async function legacyRead({ gameType = null, clientMatchId = null, matchRef = null } = {}) {
    const token = CTX.getPlayerSessionToken();
    if (clientMatchId || matchRef) {
      const raw = await RPC.callRpc('get_live_match_summary_public', {
        game_type_input: gameType,
        match_ref_input: matchRef || clientMatchId
      });
      return {
        viewer: { viewer_name: null, site_scope: CTX.getScope() },
        matches: raw ? [itemFromPayload(raw)] : []
      };
    }
    const homepage = await loadHomepageState(token, CTX.getScope());
    const matches = [];
    Object.values(homepage || {}).forEach((rows) => {
      (Array.isArray(rows) ? rows : []).forEach((row) => matches.push(itemFromPayload(row)));
    });
    return { viewer: { viewer_name: null, site_scope: CTX.getScope() }, matches };
  }

  async function read({ gameType = null, clientMatchId = null, includeFinished = false } = {}) {
    const payload = {
      session_token: CTX.getPlayerSessionToken(),
      game_type_input: gameType,
      client_match_id_input: clientMatchId,
      site_scope_input: CTX.getScope(),
      include_finished: includeFinished
    };
    return RPC.callContract('contract_live_read_v1', payload, () => legacyRead({ gameType, clientMatchId }));
  }

  async function loadPublicSummary(gameType, matchRef, scope){
    const useScope = scope || currentScope();
    const raw = await read({ gameType, clientMatchId: matchRef, includeFinished: true }).catch(async()=>{
      const result = await legacyRead({ gameType, clientMatchId: matchRef, matchRef });
      return result;
    });
    const row = Array.isArray(raw?.matches) ? raw.matches[0] : itemFromPayload(raw);
    return itemFromPayload(row);
  }

  async function loadHomepageState(sessionToken='', scope){
    const payload = { session_token: sessionToken || CTX.getPlayerSessionToken(), site_scope_input: scope || CTX.getScope() };
    try {
      const raw = await RPC.callRpc('get_homepage_live_state_public_scoped', payload);
      return raw?.entries || raw?.by_game || raw || {};
    } catch (_) {
      const raw = await RPC.callRpc('get_homepage_live_state_public', { session_token: payload.session_token || null });
      return raw?.entries || raw?.by_game || raw || {};
    }
  }

  global.GEJAST_LIVE_SUMMARY = { currentScope, currentSessionToken, normalizeName, matchIdentityFromUrl, loadPublicSummary, itemFromPayload, summaryFromItem, participants, hostName, isFinished, metaText, buildScopedHref, loadHomepageState, read };
})(window);
