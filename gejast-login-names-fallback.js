(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtil = window.GEJAST_ACCOUNT_SCOPE || null;

  function normalizeName(value){ return String(value || '').replace(/\s+/g, ' ').trim(); }
  function uniqueNames(values){
    const seen = new Set();
    return (Array.isArray(values) ? values : [])
      .map(normalizeName)
      .filter((name)=>{
        const key = name.toLowerCase();
        if (!name || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a,b)=>a.localeCompare(b, 'nl'));
  }
  function currentScope(){
    try {
      if (scopeUtil && typeof scopeUtil.currentScope === 'function') return scopeUtil.currentScope();
      return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends';
    } catch (_) { return 'friends'; }
  }
  function headers(){
    return {
      apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '',
      Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }
  async function parseResponse(res){
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || `HTTP ${res.status}`);
    return data;
  }
  function rowName(row){
    if (typeof row === 'string') return row;
    return row?.public_display_name || row?.chosen_username || row?.nickname || row?.display_name || row?.player_name || row?.name || row?.desired_name || row?.slug || '';
  }
  function rowStatus(row){
    return String(row?.status || row?.account_status || row?.player_status || row?.request_status || '').trim().toLowerCase();
  }
  function hasPinSignal(row){
    if (!row || typeof row === 'string') return false;
    const booleans = [
      row.has_pin, row.pin_is_set, row.player_has_pin, row.pin_set,
      row.pin_hash_set, row.pin_hash_present, row.has_pin_hash, row.player_pin_hash_set
    ];
    if (booleans.some(Boolean)) return true;
    if (row.pin_hash || row.player_pin_hash) return true;
    return false;
  }
  function isCurrentActive(row){
    const status = rowStatus(row);
    return ['active','approved','activated','pending_activation'].includes(status);
  }
  function rowsFromPayload(raw){
    return Array.isArray(raw)
      ? raw
      : (Array.isArray(raw?.players) ? raw.players
        : (Array.isArray(raw?.profiles) ? raw.profiles
        : (Array.isArray(raw?.names) ? raw.names
        : (Array.isArray(raw?.data) ? raw.data : []))));
  }
  function activeNamesFromRows(raw, scope){
    const rows = rowsFromPayload(raw);
    return uniqueNames(rows.filter((row)=>{
      if (!row || typeof row === 'string') return false;
      const rowScope = String(row?.site_scope || row?.scope || '').trim().toLowerCase();
      if (rowScope && rowScope !== scope) return false;
      return hasPinSignal(row) || isCurrentActive(row);
    }).map(rowName));
  }
  function fallbackNamesFromRows(raw){
    const rows = rowsFromPayload(raw);
    return uniqueNames(rows.map(rowName));
  }
  async function postRpc(name, payload){
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method:'POST', mode:'cors', cache:'no-store', headers: headers(), body: JSON.stringify(payload || {})
    });
    return parseResponse(res);
  }
  async function getAllowedUsernames(scope){
    const res = await fetch(
      `${cfg.SUPABASE_URL}/rest/v1/allowed_usernames?select=display_name,desired_name,name,slug,status,site_scope,pin_is_set,has_pin,pin_set,pin_hash_set,player_has_pin,has_pin_hash&order=display_name.asc&limit=500`,
      {
        method:'GET', mode:'cors', cache:'no-store',
        headers:{ apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, Accept:'application/json' }
      }
    );
    const data = await parseResponse(res);
    return uniqueNames((Array.isArray(data) ? data : []).filter((row)=>{
      const rowScope = String(row?.site_scope || '').trim().toLowerCase();
      if (rowScope && rowScope !== scope) return false;
      return hasPinSignal(row) || isCurrentActive(row);
    }).map(rowName));
  }

  async function robustActiveLoginNames(scope){
    const strong = [];
    const soft = [];

    try {
      const names = await getAllowedUsernames(scope);
      if (names.length) strong.push(...names);
    } catch (_) {}

    const statusAwareTasks = [
      () => postRpc('get_login_names_scoped', { site_scope_input: scope }),
      () => postRpc('get_all_site_players_public_scoped', { site_scope_input: scope }),
      () => postRpc('get_profiles_page_bundle_scoped', { site_scope_input: scope })
    ];
    for (const task of statusAwareTasks){
      try {
        const raw = await task();
        const names = activeNamesFromRows(raw, scope);
        if (names.length) strong.push(...names);
        else soft.push(...fallbackNamesFromRows(raw));
      } catch (_) {}
    }

    if (cfg.fetchScopedActivePlayerNames && typeof cfg.fetchScopedActivePlayerNames === 'function'){
      try {
        const names = await cfg.fetchScopedActivePlayerNames(scope);
        if (Array.isArray(names) && names.length) soft.push(...names);
      } catch (_) {}
    }

    try {
      const raw = await postRpc('get_login_names', {});
      const names = fallbackNamesFromRows(raw);
      if (names.length) soft.push(...names);
    } catch (_) {}

    const strongNames = uniqueNames(strong);
    if (strongNames.length) return strongNames;

    // Final pragmatic fallback so the page still works today.
    return uniqueNames(soft);
  }

  async function refill(){
    if (typeof window.fillNames !== 'function') return;
    const scope = currentScope();
    const names = await robustActiveLoginNames(scope);
    const selected = (document.getElementById('playerNameInput') || {}).value || '';
    window.fillNames(names, selected);
    const box = document.getElementById('statusBox');
    if (box && !names.length && !String(box.textContent || '').trim()) {
      box.textContent = 'Nog geen logbare gebruikers gevonden voor deze scope.';
    }
  }

  window.getLoginNames = async function(){
    const scope = currentScope();
    const names = await robustActiveLoginNames(scope);
    return { names };
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ()=>setTimeout(refill, 0), { once:true });
  } else {
    setTimeout(refill, 0);
  }

  window.GEJAST_LOGIN_NAMES_FALLBACK = { robustActiveLoginNames, refill };
})();