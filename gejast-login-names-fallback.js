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
  function namesFromPayload(raw){
    const rows = Array.isArray(raw)
      ? raw
      : (Array.isArray(raw?.players) ? raw.players
        : (Array.isArray(raw?.profiles) ? raw.profiles
        : (Array.isArray(raw?.names) ? raw.names
        : (Array.isArray(raw?.data) ? raw.data : []))));
    return uniqueNames(rows.map((row)=>{
      if (typeof row === 'string') return row;
      return row?.public_display_name || row?.chosen_username || row?.nickname || row?.display_name || row?.player_name || row?.name || row?.desired_name || row?.slug || '';
    }));
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
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/allowed_usernames?select=display_name,desired_name,name,slug,status,site_scope&order=display_name.asc&limit=500`, {
      method:'GET',
      mode:'cors',
      cache:'no-store',
      headers:{ apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, Accept:'application/json' }
    });
    const data = await parseResponse(res);
    return uniqueNames((Array.isArray(data) ? data : [])
      .filter((row)=>{
        const rowScope = String(row?.site_scope || '').trim().toLowerCase();
        return !rowScope || rowScope === scope;
      })
      .filter((row)=>{
        const status = String(row?.status || '').trim().toLowerCase();
        return !status || ['active','approved','activated','pending_activation','waiting_for_activation'].includes(status);
      })
      .map((row)=>row?.display_name || row?.desired_name || row?.name || row?.slug || ''));
  }

  async function robustLoginNames(scope){
    const merged = [];
    const tasks = [
      () => cfg.fetchScopedActivePlayerNames ? cfg.fetchScopedActivePlayerNames(scope) : [],
      () => postRpc('get_login_names_scoped', { site_scope_input: scope }).then(namesFromPayload),
      () => postRpc('get_all_site_players_public_scoped', { site_scope_input: scope }).then(namesFromPayload),
      () => postRpc('get_profiles_page_bundle_scoped', { site_scope_input: scope }).then(namesFromPayload),
      () => postRpc('get_login_names', {}).then(namesFromPayload),
      () => getAllowedUsernames(scope)
    ];
    for (const task of tasks){
      try {
        const rows = await task();
        if (Array.isArray(rows) && rows.length) merged.push(...rows);
      } catch (_) {}
    }
    return uniqueNames(merged);
  }

  async function refill(){
    if (typeof window.fillNames !== 'function') return;
    const scope = currentScope();
    const names = await robustLoginNames(scope);
    const selected = (document.getElementById('playerNameInput') || {}).value || '';
    if (names.length) {
      window.fillNames(names, selected);
      const box = document.getElementById('statusBox');
      if (box && !box.textContent.trim()) box.textContent = '';
    } else {
      const box = document.getElementById('statusBox');
      if (box && !box.textContent.trim()) box.textContent = 'Nog geen namen gevonden voor deze scope.';
    }
  }

  const originalGetLoginNames = window.getLoginNames;
  window.getLoginNames = async function(){
    const scope = currentScope();
    const names = await robustLoginNames(scope);
    return { names };
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ()=>{ setTimeout(refill, 0); }, { once:true });
  } else {
    setTimeout(refill, 0);
  }

  window.GEJAST_LOGIN_NAMES_FALLBACK = { robustLoginNames, refill };
})();