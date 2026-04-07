(function(){
  const FAMILY_NAMES = ['Jesper','Emil','Anouk','Lilian','Sierk','Gunnar'];
  function norm(v){ return String(v||'').trim().toLowerCase(); }
  function getScope(){
    try{
      const qs = new URLSearchParams(location.search);
      const q = qs.get('scope');
      if (q === 'family') return 'family';
      if ((location.pathname||'').includes('/familie/')) return 'family';
    }catch(_){ }
    return 'friends';
  }
  function isAllowedName(name, scope=getScope()){
    const n = norm(name);
    if(!n) return scope !== 'family';
    const inFamily = FAMILY_NAMES.some(x=>norm(x)===n);
    return scope === 'family' ? inFamily : !inFamily;
  }
  function filterNames(names, scope=getScope()){
    return (Array.isArray(names)?names:[]).filter((n)=>isAllowedName(n, scope));
  }
  function filterPlayers(rows, scope=getScope()){
    return (Array.isArray(rows)?rows:[]).filter((row)=>{
      const name = row?.player_name || row?.display_name || row?.chosen_username || row?.public_display_name || row?.nickname || row?.real_name || row?.given_name || '';
      return isAllowedName(name, scope);
    });
  }
  function allNamesFromMatch(match){
    const out=[];
    ['winner_names','loser_names','participants','participant_names','team_a_player_names','team_b_player_names','players'].forEach((k)=>{
      const v = match?.[k]; if(Array.isArray(v)) out.push(...v);
    });
    if(Array.isArray(match?.details)) match.details.forEach((d)=>{ if(d?.player_name) out.push(d.player_name); if(d?.display_name) out.push(d.display_name); });
    return out.filter(Boolean);
  }
  function filterMatches(rows, scope=getScope()){
    return (Array.isArray(rows)?rows:[]).filter((row)=>{
      const names = allNamesFromMatch(row);
      return names.length ? names.every((n)=>isAllowedName(n, scope)) : true;
    });
  }
  function filterPairRows(rows, scope=getScope()){
    return (Array.isArray(rows)?rows:[]).filter((row)=>isAllowedName(row?.player_a, scope) && isAllowedName(row?.player_b, scope));
  }
  function defaultHome(scope=getScope()){
    return scope === 'family' ? './familie/index.html' : './index.html';
  }
  window.GEJAST_SCOPE_UTILS = { FAMILY_NAMES, norm, getScope, isAllowedName, filterNames, filterPlayers, filterMatches, filterPairRows, defaultHome };
})();
