(function (global) {
  const SESSION_KEYS = ['jas_session_token_v11', 'jas_session_token_v10'];

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

  async function rpc(name, payload) {
    const c = cfg();
    const res = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: rpcHeaders(),
      body: JSON.stringify(payload || {})
    });
    return parseResponse(res);
  }

  function normalizeMatchRecord(item) {
    const row = item?.item || item || {};
    const summary = row.summary_payload || row.summary || {};
    return {
      game_type: row.game_type || summary.game_type || '',
      client_match_id: row.client_match_id || row.match_ref || summary.match_ref || '',
      match_ref: row.match_ref || row.client_match_id || summary.match_ref || '',
      created_at: row.created_at || summary.created_at || null,
      updated_at: row.updated_at || summary.live_state?.updated_at || row.finished_at || row.created_at || null,
      finished_at: row.finished_at || summary.finished_at || null,
      is_live: row.is_live === true || (!row.finished_at && !summary.finished_at && String(summary?.live_state?.status || '').toLowerCase() !== 'finished'),
      participants: Array.isArray(row.participants) ? row.participants : (Array.isArray(summary.participants) ? summary.participants : []),
      winner_names: Array.isArray(row.winner_names) ? row.winner_names : (Array.isArray(summary.winner_names) ? summary.winner_names : []),
      recap_text: row.recap_text || summary.recap_text || '',
      summary_payload: summary,
      submitter_name: row.submitter_name || summary?.submitter_meta?.submitted_by_name || null,
      viewer_role: row.viewer_role || null,
      href: row.href || null,
      manage_href: row.manage_href || null,
      live_href: row.live_href || null
    };
  }

  async function loadBundle(options) {
    const opts = Object.assign({
      gameType: null,
      clientMatchId: null,
      includeFinished: false,
      siteScope: null
    }, options || {});

    const payload = {
      session_token: getPlayerSessionToken() || null,
      site_scope_input: getScope(opts.siteScope),
      game_type_input: opts.gameType || null,
      client_match_id_input: opts.clientMatchId || null,
      include_finished: !!opts.includeFinished
    };

    try {
      const raw = await rpc('get_live_surface_bundle_scoped', payload);
      const data = raw?.data || raw;
      return {
        viewer_name: data?.viewer_name || null,
        site_scope: data?.site_scope || payload.site_scope_input,
        entries: data?.entries || data?.homepage?.entries || {},
        matches: Array.isArray(data?.matches) ? data.matches.map(normalizeMatchRecord) : [],
        match: data?.match ? normalizeMatchRecord(data.match) : null
      };
    } catch (_) {
      return legacyBundle(payload);
    }
  }

  async function legacyBundle(payload) {
    const siteScope = payload.site_scope_input;
    const token = payload.session_token;
    if (payload.client_match_id_input) {
      const raw = await rpc('get_live_match_summary_public', {
        game_type_input: payload.game_type_input,
        match_ref_input: payload.client_match_id_input,
        session_token: token
      });
      return {
        viewer_name: null,
        site_scope: siteScope,
        entries: {},
        matches: raw ? [normalizeMatchRecord(raw)] : [],
        match: raw ? normalizeMatchRecord(raw) : null
      };
    }

    const [liveRaw, homeRaw] = await Promise.all([
      rpc('get_live_match_summaries_scoped', {
        session_token: token,
        game_type_input: payload.game_type_input,
        site_scope_input: siteScope,
        client_match_id_input: null
      }),
      rpc('get_homepage_live_state_public', {
        session_token: token
      }).catch(() => ({}))
    ]);

    return {
      viewer_name: liveRaw?.viewer_name || null,
      site_scope: liveRaw?.site_scope || siteScope,
      entries: homeRaw?.entries || homeRaw?.by_game || {},
      matches: Array.isArray(liveRaw?.matches) ? liveRaw.matches.map(normalizeMatchRecord) : [],
      match: null
    };
  }

  async function loadHomepageEntries(options) {
    const bundle = await loadBundle(options);
    return {
      viewer_name: bundle.viewer_name,
      site_scope: bundle.site_scope,
      entries: bundle.entries || {}
    };
  }

  async function loadMatch(options) {
    const bundle = await loadBundle(Object.assign({}, options || {}, { includeFinished: true }));
    const match = bundle.match || bundle.matches[0] || null;
    return Object.assign({}, bundle, { match, item: match });
  }

  async function loadLiveMatches(options) {
    const bundle = await loadBundle(options);
    return {
      viewer_name: bundle.viewer_name,
      site_scope: bundle.site_scope,
      matches: bundle.matches || []
    };
  }

  global.GEJAST_LIVE_SUMMARY = {
    loadBundle,
    loadHomepageEntries,
    loadMatch,
    loadLiveMatches,
    normalizeMatchRecord
  };
})(typeof window !== 'undefined' ? window : globalThis);



(function(global){
  const api = global.GEJAST_LIVE_SUMMARY || {};
  function currentScope(){
    try{ return (global.GEJAST_SCOPE_UTILS && typeof global.GEJAST_SCOPE_UTILS.getScope==='function' && global.GEJAST_SCOPE_UTILS.getScope()) || ((new URLSearchParams(global.location.search).get('scope')||'friends').toLowerCase()==='family'?'family':'friends'); }catch(_){ return 'friends'; }
  }
  function currentSessionToken(){
    try{ return (global.GEJAST_CONFIG && typeof global.GEJAST_CONFIG.getPlayerSessionToken==='function' && global.GEJAST_CONFIG.getPlayerSessionToken()) || ''; }catch(_){ return ''; }
  }
  function matchIdentityFromUrl(){ try{ const p=new URLSearchParams(global.location.search); return { clientMatchId:p.get('client_match_id')||'', matchRef:p.get('match_ref')||'' }; }catch(_){ return { clientMatchId:'', matchRef:''}; } }
  function itemFromPayload(data){ return data && (data.item || data.match) ? (data.item || data.match) : (data || {}); }
  function summaryFromItem(item){ const row=itemFromPayload(item); return row.summary_payload || row.summary || {}; }
  function participants(item){ const row=itemFromPayload(item), s=summaryFromItem(row); const vals=[].concat(Array.isArray(row.participants)?row.participants:[], Array.isArray(s.participants)?s.participants:[], Array.isArray(s.players)?s.players:[]); return [...new Set(vals.map(v=>String(v||'').trim()).filter(Boolean))]; }
  function hostName(item){ const row=itemFromPayload(item), s=summaryFromItem(row); return String(row.submitter_name || s.submitter_name || (s.submitter_meta && s.submitter_meta.submitted_by_name) || '').trim(); }
  function isFinished(item){ const row=itemFromPayload(item), s=summaryFromItem(row); return !!(row.finished_at || s.finished_at || String((s.live_state && s.live_state.status) || '').toLowerCase()==='finished'); }
  function metaText(item){ const row=itemFromPayload(item), s=summaryFromItem(row); if(isFinished(row)){ const when=row.finished_at || s.finished_at; return when ? `Afgerond op ${new Date(when).toLocaleString('nl-NL')}` : 'Wedstrijd afgerond.'; } const updated=row.updated_at || (s.live_state && s.live_state.updated_at) || row.created_at || null; return updated ? `Live bijgewerkt om ${new Date(updated).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}` : 'Live scoreblad'; }
  function buildScopedHref(base, item, scope){ try{ const url=new URL(base, global.location.href); const row=itemFromPayload(item), s=summaryFromItem(row); const clientMatchId=row.client_match_id || row.match_ref || s.match_ref || ''; const matchRef=row.match_ref || row.client_match_id || s.match_ref || ''; if(clientMatchId) url.searchParams.set('client_match_id', clientMatchId); if(matchRef) url.searchParams.set('match_ref', matchRef); if((scope||currentScope())==='family') url.searchParams.set('scope', 'family'); return url.pathname.split('/').pop()+url.search; }catch(_){ return base; } }
  async function loadPublicSummary(gameType, opts){ const identity = Object.assign({}, opts||{}); const bundle = await api.loadMatch({ gameType: gameType, clientMatchId: identity.clientMatchId || identity.matchRef || '', siteScope: identity.siteScope || currentScope() }); return bundle.match || bundle.item || {}; }
  async function loadHomepageState(sessionToken, scope){ const result = await api.loadHomepageEntries({ siteScope: scope || currentScope() }); return result.entries || {}; }
  Object.assign(api, { currentScope, currentSessionToken, matchIdentityFromUrl, itemFromPayload, summaryFromItem, participants, hostName, isFinished, metaText, buildScopedHref, loadPublicSummary, loadHomepageState });
  global.GEJAST_LIVE_SUMMARY = api;
})(typeof window !== 'undefined' ? window : globalThis);
