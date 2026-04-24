(function(global){
  'use strict';
  const cfg = global.GEJAST_CONFIG || {};
  const CACHE_PREFIX = 'gejast_player_selector_v637_';
  const DEFAULT_TTL_MS = 10 * 60 * 1000;

  function normalizeScope(scope){
    try {
      if (scope) return String(scope).toLowerCase() === 'family' ? 'family' : 'friends';
      if (global.GEJAST_SCOPE_UTILS && typeof global.GEJAST_SCOPE_UTILS.getScope === 'function') return normalizeScope(global.GEJAST_SCOPE_UTILS.getScope());
      if (global.GEJAST_ACCOUNT_SCOPE && typeof global.GEJAST_ACCOUNT_SCOPE.currentScope === 'function') return normalizeScope(global.GEJAST_ACCOUNT_SCOPE.currentScope());
      return new URLSearchParams(global.location.search || '').get('scope') === 'family' ? 'family' : 'friends';
    } catch (_) { return 'friends'; }
  }
  function uniqueNames(values){
    const seen = new Set();
    return (Array.isArray(values) ? values : [])
      .map((value)=>String(value || '').replace(/\s+/g,' ').trim())
      .filter((name)=>{ const key=name.toLowerCase(); if(!name || seen.has(key)) return false; seen.add(key); return true; })
      .sort((a,b)=>a.localeCompare(b,'nl'));
  }
  function cacheKey(kind, scope){ return `${CACHE_PREFIX}${kind}_${normalizeScope(scope)}`; }
  function readCache(kind, scope, ttlMs=DEFAULT_TTL_MS){
    const key = cacheKey(kind, scope);
    for (const store of [global.localStorage, global.sessionStorage]) {
      try {
        const raw = store && store.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (ttlMs && parsed.written_at && Date.now() - Number(parsed.written_at) > ttlMs) continue;
        return uniqueNames(parsed.names || parsed.values || parsed);
      } catch (_) {}
    }
    return [];
  }
  function writeCache(kind, scope, names){
    const clean = uniqueNames(names);
    const payload = JSON.stringify({ names: clean, written_at: Date.now(), scope: normalizeScope(scope), kind });
    for (const store of [global.localStorage, global.sessionStorage]) {
      try { store && store.setItem(cacheKey(kind, scope), payload); } catch (_) {}
    }
    try {
      if (kind === 'activated' && cfg.writeCachedLoginNames) cfg.writeCachedLoginNames(clean, normalizeScope(scope));
    } catch (_) {}
    return clean;
  }
  function headers(){
    return {
      apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '',
      Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`,
      'Content-Type':'application/json',
      Accept:'application/json'
    };
  }
  async function parseResponse(res){
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || text || `HTTP ${res.status}`);
    return data && data.get_player_selector_source_v1 !== undefined ? data.get_player_selector_source_v1 : data;
  }
  function withTimeout(promiseFactory, timeoutMs){
    if (typeof AbortController === 'undefined') return promiseFactory(null);
    const controller = new AbortController();
    const timer = global.setTimeout(()=>{ try { controller.abort(); } catch (_) {} }, timeoutMs || 6500);
    return promiseFactory(controller.signal).finally(()=>global.clearTimeout(timer));
  }
  async function callSelectorRpc(scope){
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase config ontbreekt.');
    return withTimeout((signal)=>fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/get_player_selector_source_v1`, {
      method:'POST',
      mode:'cors',
      cache:'no-store',
      headers:headers(),
      signal: signal || undefined,
      body:JSON.stringify({ session_token:null, site_scope_input:normalizeScope(scope) })
    }).then(parseResponse), 6500);
  }
  async function fallbackActivated(scope){
    try {
      if (cfg.getActivatedPlayerNamesForScope) {
        const names = await cfg.getActivatedPlayerNamesForScope(normalizeScope(scope));
        return uniqueNames(names);
      }
      if (cfg.fetchScopedActivePlayerNames) {
        const names = await cfg.fetchScopedActivePlayerNames(normalizeScope(scope));
        return uniqueNames(names);
      }
    } catch (_) {}
    try { return uniqueNames(cfg.readCachedLoginNames ? cfg.readCachedLoginNames(normalizeScope(scope)) : []); } catch (_) { return []; }
  }
  async function getSelector(scope, options={}){
    const resolvedScope = normalizeScope(scope);
    const useCache = options.useCache !== false;
    const cachedActivated = useCache ? readCache('activated', resolvedScope, options.cacheTtlMs || DEFAULT_TTL_MS) : [];
    const cachedRequestable = useCache ? readCache('requestable', resolvedScope, options.cacheTtlMs || DEFAULT_TTL_MS) : [];

    try {
      const live = await callSelectorRpc(resolvedScope);
      const activated = writeCache('activated', resolvedScope, live.activated_names || []);
      const requestable = writeCache('requestable', resolvedScope, live.requestable_names || []);
      return Object.assign({}, live, {
        ok:true,
        source:'rpc:get_player_selector_source_v1',
        scope: resolvedScope,
        activated_names: activated,
        requestable_names: requestable,
        cached:false
      });
    } catch (error) {
      const fallback = cachedActivated.length ? cachedActivated : await fallbackActivated(resolvedScope);
      return {
        ok:false,
        source:'cache-or-config-fallback',
        scope: resolvedScope,
        activated_names: uniqueNames(fallback),
        requestable_names: uniqueNames(cachedRequestable),
        cached:true,
        error: error && error.message ? error.message : String(error || 'selector failed')
      };
    }
  }
  async function getActivatedNames(scope, options={}){
    const data = await getSelector(scope, options);
    return uniqueNames(data.activated_names || []);
  }
  async function getRequestableNames(scope, options={}){
    const data = await getSelector(scope, options);
    return uniqueNames(data.requestable_names || []);
  }
  function fillSelect(select, names, options={}){
    const el = typeof select === 'string' ? document.querySelector(select) : select;
    if (!el) return [];
    const clean = uniqueNames(names);
    const previous = options.selected || el.value || '';
    if (!clean.length && options.preserveOnEmpty !== false) return [];
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = options.placeholder || 'Kies je naam';
    if (options.placeholderDisabled !== false) placeholder.disabled = true;
    const frag = document.createDocumentFragment();
    frag.appendChild(placeholder);
    clean.forEach((name)=>{
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      frag.appendChild(option);
    });
    el.replaceChildren(frag);
    if (previous && clean.map((n)=>n.toLowerCase()).includes(String(previous).toLowerCase())) {
      const match = clean.find((n)=>n.toLowerCase() === String(previous).toLowerCase());
      el.value = match || '';
    } else {
      el.value = '';
    }
    return clean;
  }
  function installSelect(select, options={}){
    const el = typeof select === 'string' ? document.querySelector(select) : select;
    if (!el || el.dataset.gejastPlayerSelectorInstalled === '1') return;
    el.dataset.gejastPlayerSelectorInstalled = '1';
    const scope = normalizeScope(options.scope);
    const kind = options.kind || 'activated';
    const cached = readCache(kind, scope, DEFAULT_TTL_MS);
    if (cached.length) fillSelect(el, cached, { placeholder:options.placeholder || 'Kies je naam', preserveOnEmpty:true });
    const loader = kind === 'requestable' ? getRequestableNames : getActivatedNames;
    loader(scope).then((names)=>fillSelect(el, names, { placeholder:options.placeholder || 'Kies je naam', preserveOnEmpty:true })).catch(()=>{});
  }

  global.GEJAST_PLAYER_SELECTOR = {
    normalizeScope, uniqueNames, readCache, writeCache, getSelector, getActivatedNames, getRequestableNames, fillSelect, installSelect
  };
})(window);
