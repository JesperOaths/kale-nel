(function(global){
  const cfg = global.GEJAST_CONFIG || {};

  function currentScope(){
    try {
      if (global.GEJAST_SCOPE_CONTEXT && typeof global.GEJAST_SCOPE_CONTEXT.getScope === 'function') {
        return normalizeScope(global.GEJAST_SCOPE_CONTEXT.getScope());
      }
      const qs = new URLSearchParams(global.location.search || '');
      return normalizeScope(qs.get('scope'));
    } catch (_) { return 'friends'; }
  }

  function normalizeScope(value){
    if (cfg.normalizeScope) return cfg.normalizeScope(value);
    return String(value || '').trim().toLowerCase() === 'family' ? 'family' : 'friends';
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
    try { data = text ? JSON.parse(text) : null; }
    catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || text || `HTTP ${res.status}`);
    return data;
  }

  function retryable(error){
    const msg = String(error?.message || error || '');
    return /schema cache|could not find the function|no function matches|unexpected parameter|unknown parameter|does not exist|function public\.|argument/i.test(msg);
  }

  function scopedVariants(payload){
    const base = payload || {};
    const scope = currentScope();
    const out = [];
    const seen = new Set();
    const push = (value) => {
      const key = JSON.stringify(value);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(value);
    };
    push({ ...base, site_scope_input: base.site_scope_input ?? scope });
    push({ ...base, scope_input: base.scope_input ?? scope });
    push({ ...base, site_scope: base.site_scope ?? scope });
    push(base);
    return out;
  }

  async function postRpc(name, payload){
    const url = `${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`;
    const res = await global.fetch(url, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: headers(),
      body: JSON.stringify(payload || {})
    });
    return parseResponse(res);
  }

  async function callRpcCompat(name, payloadOrPayloads){
    const payloads = Array.isArray(payloadOrPayloads) ? payloadOrPayloads : [payloadOrPayloads || {}];
    let lastError = null;
    for (const payload of payloads) {
      for (const variant of scopedVariants(payload)) {
        try {
          return await postRpc(name, variant);
        } catch (error) {
          lastError = error;
          if (!retryable(error)) {
            const isOriginal = JSON.stringify(variant) == JSON.stringify(payload);
            if (isOriginal) throw error;
          }
        }
      }
    }
    throw lastError || new Error(`RPC ${name} kon niet worden aangeroepen.`);
  }

  global.GEJAST_ACCOUNT_SCOPE = { currentScope, normalizeScope, headers, parseResponse, postRpc, callRpcCompat };
})(window);
