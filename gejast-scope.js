(function(){
  const FAMILY_NAMES = [
    'Jesper','Emil','Anouk','Lilian','Sierk','Gunnar','Evi','Anna','Caro',
    'Jesper Alberts','Anouk Alberts'
  ];
  let warnedMissingScope = false;

  function norm(v){ return String(v || '').trim().toLowerCase(); }
  function unique(values){
    const seen = new Set();
    return (Array.isArray(values) ? values : []).filter((value)=>{
      const key = norm(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function getScope(){
    try {
      const qs = new URLSearchParams(location.search);
      const q = qs.get('scope');
      if (q === 'family') return 'family';
      if ((location.pathname || '').includes('/familie/')) return 'family';
    } catch (_) {}
    return 'friends';
  }
  function rowScope(row){
    const candidates = [row?.site_scope, row?.scope, row?.player_site_scope, row?.viewer_scope];
    for (const value of candidates){
      const raw = String(value || '').trim().toLowerCase();
      if (raw === 'family' || raw === 'friends') return raw;
    }
    return '';
  }
  function warnLegacy(row, scope){
    if (warnedMissingScope) return;
    warnedMissingScope = true;
    try {
      console.warn('[GEJAST scope] Rij zonder expliciete site_scope ontvangen; fallback op naamfilter gebruikt.', { expectedScope: scope, sample: row });
    } catch (_) {}
  }
  function isFamilyName(name){
    const n = norm(name);
    return FAMILY_NAMES.some((x)=>norm(x) === n);
  }
  function isAllowedName(name, scope=getScope()){
    const n = norm(name);
    if (!n) return scope !== 'family';
    const inFamily = isFamilyName(n);
    return scope === 'family' ? inFamily : !inFamily;
  }
  function pickName(row){
    return row?.player_name || row?.display_name || row?.chosen_username || row?.public_display_name || row?.nickname || row?.real_name || row?.given_name || '';
  }
  function filterNames(names, scope=getScope()){
    return unique((Array.isArray(names) ? names : []).filter((name)=>isAllowedName(name, scope)));
  }
  function filterPlayers(rows, scope=getScope()){
    return (Array.isArray(rows) ? rows : []).filter((row)=>{
      const explicit = rowScope(row);
      if (explicit) return explicit === scope;
      warnLegacy(row, scope);
      return isAllowedName(pickName(row), scope);
    });
  }
  function allNamesFromMatch(match){
    const out = [];
    ['winner_names','loser_names','participants','participant_names','team_a_player_names','team_b_player_names','players'].forEach((k)=>{
      const v = match?.[k];
      if (Array.isArray(v)) out.push(...v);
    });
    if (Array.isArray(match?.details)) {
      match.details.forEach((d)=>{
        if (d?.player_name) out.push(d.player_name);
        if (d?.display_name) out.push(d.display_name);
      });
    }
    return out.filter(Boolean);
  }
  function filterMatches(rows, scope=getScope()){
    return (Array.isArray(rows) ? rows : []).filter((row)=>{
      const explicit = rowScope(row);
      if (explicit) return explicit === scope;
      warnLegacy(row, scope);
      const names = allNamesFromMatch(row);
      return names.length ? names.every((name)=>isAllowedName(name, scope)) : true;
    });
  }
  function filterPairRows(rows, scope=getScope()){
    return (Array.isArray(rows) ? rows : []).filter((row)=>{
      const explicit = rowScope(row);
      if (explicit) return explicit === scope;
      warnLegacy(row, scope);
      return isAllowedName(row?.player_a, scope) && isAllowedName(row?.player_b, scope);
    });
  }
  function defaultHome(scope=getScope()){
    return scope === 'family' ? './familie/index.html' : './index.html';
  }

  window.GEJAST_SCOPE_UTILS = {
    FAMILY_NAMES,
    norm,
    unique,
    getScope,
    rowScope,
    isFamilyName,
    isAllowedName,
    filterNames,
    filterPlayers,
    filterMatches,
    filterPairRows,
    defaultHome
  };
})();
