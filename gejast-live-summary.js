(function(){
  function cfg(){ return window.GEJAST_CONFIG || {}; }
  function headers(){ const c=cfg(); return { apikey:c.SUPABASE_PUBLISHABLE_KEY||'', Authorization:`Bearer ${c.SUPABASE_PUBLISHABLE_KEY||''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const t=await res.text(); let d=null; try{ d=t?JSON.parse(t):null; }catch{ throw new Error(t||`HTTP ${res.status}`); } if(!res.ok) throw new Error(d?.message||d?.error||`HTTP ${res.status}`); return d; }
  function currentScope(){ try{ return (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); }catch(_){ return 'friends'; } }
  function normalizeName(value){ return String(value||'').trim().toLowerCase(); }
  function currentSessionToken(){ try{ return (window.GEJAST_CONFIG && window.GEJAST_CONFIG.getPlayerSessionToken && window.GEJAST_CONFIG.getPlayerSessionToken()) || ''; }catch(_){ return ''; } }
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
  function metaText(item){ if(isFinished(item)){ const when = item.finished_at || summaryFromItem(item)?.finished_at; return when ? `Afgerond op ${new Date(when).toLocaleString('nl-NL')}` : 'Wedstrijd afgerond.'; } const updated = item.updated_at || summaryFromItem(item)?.live_state?.updated_at || Date.now(); return `Live bijgewerkt om ${new Date(updated).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}`; }
  function buildScopedHref(base, item, scope){
    try {
      const url = new URL(base, window.location.href);
      const clientMatchId = item?.client_match_id || item?.match_ref || summaryFromItem(item)?.match_ref || '';
      const matchRef = item?.match_ref || summaryFromItem(item)?.match_ref || '';
      if (clientMatchId) url.searchParams.set('client_match_id', clientMatchId);
      if (matchRef) url.searchParams.set('match_ref', matchRef);
      if ((scope || currentScope()) === 'family') url.searchParams.set('scope', 'family');
      return url.pathname.split('/').pop() + url.search;
    } catch (_) { return base; }
  }
  async function loadPublicSummary(gameType, opts={}){
    const c=cfg(); const scope = opts.siteScope || currentScope();
    const clientMatchId = String(opts.clientMatchId || '').trim();
    const matchRef = String(opts.matchRef || '').trim();
    try {
      const raw = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/get_live_match_summary_public_scoped`, { method:'POST', headers:headers(), body: JSON.stringify({ game_type_input: gameType, match_ref_input: matchRef || null, client_match_id_input: clientMatchId || null, site_scope_input: scope }) }).then(parse);
      return itemFromPayload(raw);
    } catch(err) {
      const legacyRef = matchRef || clientMatchId;
      const raw = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/get_live_match_summary_public`, { method:'POST', headers:headers(), body: JSON.stringify({ game_type_input: gameType, match_ref_input: legacyRef || null, client_match_id_input: clientMatchId || null }) }).then(parse);
      return itemFromPayload(raw);
    }
  }

  const PARTICIPANT_KEYS = {
    klaverjas: ['gejast_klaverjas_participant_v1','gejast_klaverjas_participant_v2','gejast_klaverjas_live_participant_v1'],
    boerenbridge: ['gejast_boerenbridge_participant_v1','gejast_boerenbridge_participant_v2','gejast_boerenbridge_live_participant_v1'],
    pikken: ['gejast_pikken_participant_v501'],
    paardenrace: ['gejast_paardenrace_participant_v1','gejast_paardenrace_live_participant_v1']
  };
  function readParticipantToken(gameKey){
    const keys = PARTICIPANT_KEYS[gameKey] || [];
    for (const key of keys){
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.game_id || parsed.client_match_id || parsed.match_ref || parsed.live_ref || parsed.room_code)) return parsed;
      } catch (_) {}
    }
    return null;
  }
  function homepageEntry(gameKey, opts={}){
    if (gameKey === 'klaverjas') return {
      label: 'Klaverjas Kijken',
      copy: 'Open live scoreblad van jouw huidige potje.',
      href: buildScopedHref('./klaverjas_live.html', opts.item || opts.token || {}, opts.scope || currentScope())
    };
    if (gameKey === 'boerenbridge') return {
      label: 'Boerenbridge begluren',
      copy: 'Open live scoreblad van jouw huidige potje.',
      href: buildScopedHref('./boerenbridge_live.html', opts.item || opts.token || {}, opts.scope || currentScope())
    };
    return null;
  }

  async function loadHomepageState(sessionToken='', scope){
    const c = cfg(); const useScope = scope || currentScope(); const token = sessionToken || currentSessionToken();
    try {
      const raw = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/get_homepage_live_state_public_scoped`, { method:'POST', headers:headers(), body: JSON.stringify({ session_token: token || null, site_scope_input: useScope }) }).then(parse);
      const entries = raw?.entries || raw?.by_game || raw || {};
      if (entries && Object.keys(entries).length) return entries;
    } catch (_) {}
    const fallback = {};
    const k = readParticipantToken('klaverjas');
    if (k && (k.game_id || k.client_match_id || k.match_ref)) fallback.klaverjas = homepageEntry('klaverjas', { token:k, scope:useScope });
    const b = readParticipantToken('boerenbridge');
    if (b && (b.game_id || b.client_match_id || b.match_ref)) fallback.boerenbridge = homepageEntry('boerenbridge', { token:b, scope:useScope });
    return fallback;
  }

  window.GEJAST_LIVE_SUMMARY = {
    currentScope, currentSessionToken, normalizeName, matchIdentityFromUrl, loadPublicSummary,
    itemFromPayload, summaryFromItem, participants, hostName, isFinished, metaText,
    buildScopedHref, loadHomepageState, readParticipantToken, homepageEntry
  };
})();