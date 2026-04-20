(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtil = window.GEJAST_ACCOUNT_SCOPE || null;

  function normalizeName(value){
    return String(value || '').replace(/\s+/g, ' ').trim();
  }
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
    return String(row?.status || row?.account_status || row?.player_status || '').trim().toLowerCase();
  }
  function isActivatedStatus(status){
    return ['active', 'approved', 'activated'].includes(String(status || '').trim().toLowerCase());
  }
  function rowsFromPayload(raw){
    return Array.isArray(raw)
      ? raw
      : (Array.isArray(raw?.players) ? raw.players
        : (Array.isArray(raw?.profiles) ? raw.profiles
        : (Array.isArray(raw?.names) ? raw.names
        : (Array.isArray(raw?.data) ? raw.data : []))));
  }
  function activatedNamesFromStatusRows(raw, scope){
    const rows = rowsFromPayload(raw);
    const filtered = rows.filter((row)=>{
      if (!row || typeof row === 'string') return false;
      const rowScope = String(row?.site_scope || row?.scope || row?.site_scope_input || '').trim().toLowerCase();
      if (rowScope && rowScope !== scope) return false;
      return isActivatedStatus(rowStatus(row));
    });
    return uniqueNames(filtered.map(rowName));
  }
  async function postRpc(name, payload){
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method:'POST',
      mode:'cors',
      cache:'no-store',
      headers: headers(),
      body: JSON.stringify(payload || {})
    });
    return parseResponse(res);
  }
  async function getAllowedUsernames(scope){
    const res = await fetch(
      `${cfg.SUPABASE_URL}/rest/v1/allowed_usernames?select=display_name,desired_name,name,slug,status,site_scope&status=in.(active,approved,activated)&order=display_name.asc&limit=500`,
      {
        method:'GET',
        mode:'cors',
        cache:'no-store',
        headers:{
          apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '',
          Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`,
          Accept:'application/json'
        }
      }
    );
    const data = await parseResponse(res);
    return uniqueNames((Array.isArray(data) ? data : [])
      .filter((row)=>{
        const rowScope = String(row?.site_scope || '').trim().toLowerCase();
        return !rowScope || rowScope === scope;
      })
      .filter((row)=>isActivatedStatus(rowStatus(row)))
      .map(rowName));
  }

  async function robustActivatedLoginNames(scope){
    const authoritative = [];

    // 1) Strongest path: allowed_usernames with explicit activated-style status.
    try {
      const names = await getAllowedUsernames(scope);
      if (names.length) authoritative.push(...names);
    } catch (_) {}

    // 2) Scoped public/profile RPCs only if they themselves return status-bearing rows proving activation.
    const statusAwareTasks = [
      () => postRpc('get_all_site_players_public_scoped', { site_scope_input: scope }),
      () => postRpc('get_profiles_page_bundle_scoped', { site_scope_input: scope }),
      () => postRpc('get_login_names_scoped', { site_scope_input: scope })
    ];
    for (const task of statusAwareTasks){
      try {
        const raw = await task();
        const names = activatedNamesFromStatusRows(raw, scope);
        if (names.length) authoritative.push(...names);
      } catch (_) {}
    }

    // Intentionally do NOT trust unscoped get_login_names or generic string-only sources here.
    // If activation cannot be proven from the data, we return an empty list.
    return uniqueNames(authoritative);
  }

  function setStrictEmptyMessage(names){
    const box = document.getElementById('statusBox');
    if (!box) return;
    if (Array.isArray(names) && names.length) {
      if (/geen geactiveerde/i.test(box.textContent || '')) box.textContent = '';
      return;
    }
    if (!String(box.textContent || '').trim()) {
      box.textContent = 'Geen geactiveerde accounts gevonden voor deze scope.';
    }
  }

  async function refill(){
    if (typeof window.fillNames !== 'function') return;
    const scope = currentScope();
    const names = await robustActivatedLoginNames(scope);
    const selected = (document.getElementById('playerNameInput') || {}).value || '';
    window.fillNames(names, selected);
    setStrictEmptyMessage(names);
  }

  window.getLoginNames = async function(){
    const scope = currentScope();
    const names = await robustActivatedLoginNames(scope);
    return { names };
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ()=>{ setTimeout(refill, 0); }, { once:true });
  } else {
    setTimeout(refill, 0);
  }

  window.GEJAST_LOGIN_NAMES_FALLBACK = { robustActivatedLoginNames, refill };
})();