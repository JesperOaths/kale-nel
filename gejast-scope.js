(function(){
  if (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.__v672_scope_core) return;
  const FAMILY_NAMES = ['Jesper','Emil','Anouk','Lilian','Sierk','Gunnar','Evi','Anna','Caro','Jesper Alberts','Anouk Alberts'];
  const MEMBERSHIP_KEY = 'gejast_scope_memberships_cache_v672';
  let warnedMissingScope = false;
  function norm(v){ return String(v || '').trim().toLowerCase(); }
  function cleanScope(v){ return norm(v) === 'family' ? 'family' : 'friends'; }
  function unique(values){
    const seen = new Set();
    return (Array.isArray(values) ? values : []).filter((value)=>{
      const key = norm(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function readMembershipCache(){
    try {
      const raw = JSON.parse(localStorage.getItem(MEMBERSHIP_KEY) || 'null');
      if (raw && raw.at && (Date.now() - Date.parse(raw.at)) < 12 * 60 * 60 * 1000) return raw;
    } catch (_) {}
    return { rows:[], family_names:FAMILY_NAMES.slice() };
  }
  function getScope(){
    try {
      if (window.GEJAST_SCOPE_HARDENING && window.GEJAST_SCOPE_HARDENING.currentScope) return window.GEJAST_SCOPE_HARDENING.currentScope();
      const qs = new URLSearchParams(location.search);
      const q = qs.get('scope');
      if (q === 'family') return 'family';
      if ((location.pathname || '').includes('/familie/')) return 'family';
      const stored = JSON.parse(localStorage.getItem('gejast_scope_context_v672') || 'null');
      if (stored && stored.scope) return cleanScope(stored.scope);
    } catch (_) {}
    return 'friends';
  }
  function rowScope(row){
    const candidates = [row?.site_scope, row?.scope, row?.player_site_scope, row?.viewer_scope, row?.match_scope];
    for (const value of candidates){
      const raw = norm(value);
      if (raw === 'family' || raw === 'friends') return raw;
    }
    return '';
  }
  function warnLegacy(row, scope){
    if (warnedMissingScope) return;
    warnedMissingScope = true;
    try { console.warn('[GEJAST scope] Rij zonder expliciete site_scope ontvangen; fallback op naamfilter gebruikt.', { expectedScope: scope, sample: row }); } catch (_) {}
  }
  function explicitScopeForName(name){
    const n = norm(name);
    if (!n) return '';
    const rows = readMembershipCache().rows || [];
    for (const row of rows){
      const candidate = norm(row.player_name || row.display_name || row.name);
      if (candidate === n) return cleanScope(row.site_scope || row.scope);
    }
    return '';
  }
  function isFamilyName(name){
    const n = norm(name);
    const cache = readMembershipCache();
    const familyNames = Array.isArray(cache.family_names) && cache.family_names.length ? cache.family_names : FAMILY_NAMES;
    return familyNames.some((x)=>norm(x) === n);
  }
  function isAllowedName(name, scope=getScope()){
    const n = norm(name);
    if (!n) return scope !== 'family';
    const explicit = explicitScopeForName(n);
    if (explicit) return explicit === cleanScope(scope);
    const inFamily = isFamilyName(n);
    return cleanScope(scope) === 'family' ? inFamily : !inFamily;
  }
  function pickName(row){ return row?.player_name || row?.display_name || row?.chosen_username || row?.public_display_name || row?.nickname || row?.real_name || row?.given_name || row?.name || row?.creator_name || row?.debtor_name || row?.creditor_name || ''; }
  function filterNames(names, scope=getScope()){ return unique((Array.isArray(names) ? names : []).filter((name)=>isAllowedName(name, scope))); }
  function filterPlayers(rows, scope=getScope()){
    return (Array.isArray(rows) ? rows : []).filter((row)=>{
      const explicit = rowScope(row);
      if (explicit) return explicit === cleanScope(scope);
      warnLegacy(row, scope);
      return isAllowedName(pickName(row), scope);
    });
  }
  function allNamesFromMatch(match){
    const out = [];
    ['winner_names','loser_names','participants','participant_names','team_a_player_names','team_b_player_names','team_a_names','team_b_names','players'].forEach((k)=>{ const v = match?.[k]; if (Array.isArray(v)) out.push(...v); });
    if (Array.isArray(match?.details)) match.details.forEach((d)=>{ if (d?.player_name) out.push(d.player_name); if (d?.display_name) out.push(d.display_name); });
    return out.filter(Boolean);
  }
  function filterMatches(rows, scope=getScope()){
    return (Array.isArray(rows) ? rows : []).filter((row)=>{
      const explicit = rowScope(row);
      if (explicit) return explicit === cleanScope(scope);
      warnLegacy(row, scope);
      const names = allNamesFromMatch(row);
      return names.length ? names.every((name)=>isAllowedName(name, scope)) : true;
    });
  }
  function filterPairRows(rows, scope=getScope()){
    return (Array.isArray(rows) ? rows : []).filter((row)=>{
      const explicit = rowScope(row);
      if (explicit) return explicit === cleanScope(scope);
      warnLegacy(row, scope);
      return isAllowedName(row?.player_a, scope) && isAllowedName(row?.player_b, scope);
    });
  }
  function defaultHome(scope=getScope()){ return cleanScope(scope) === 'family' ? './familie/index.html' : './index.html'; }
  function scopedUrl(path, scope=getScope()){
    try {
      const url = new URL(path, location.href);
      if (cleanScope(scope) === 'family') url.searchParams.set('scope', 'family');
      else url.searchParams.delete('scope');
      return `${url.pathname.split('/').pop()}${url.search}${url.hash}`;
    } catch (_) { return path; }
  }
  window.GEJAST_SCOPE_UTILS = Object.assign({}, window.GEJAST_SCOPE_UTILS || {}, {
    __v672_scope_core:true,
    FAMILY_NAMES,
    norm,
    normalizeScope: cleanScope,
    unique,
    getScope,
    rowScope,
    isFamilyName,
    isAllowedName,
    filterNames,
    filterPlayers,
    filterMatches,
    filterPairRows,
    defaultHome,
    scopedUrl
  });
})();
