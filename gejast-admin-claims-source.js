(function(){
  const CACHE_KEY = 'gejast_admin_claims_bundle_v1';
  const CACHE_TTL = 8 * 1000;
  function cfg(){ return window.GEJAST_CONFIG || {}; }
  function headers(){ const c=cfg(); return { apikey:c.SUPABASE_PUBLISHABLE_KEY||'', Authorization:`Bearer ${c.SUPABASE_PUBLISHABLE_KEY||''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const t=await res.text(); let d=null; try{ d=t?JSON.parse(t):null; }catch{ throw new Error(t||`HTTP ${res.status}`); } if(!res.ok) throw new Error(d?.message||d?.error||d?.hint||`HTTP ${res.status}`); return d; }
  async function callFirstRpc(names, body){
    const c=cfg(); let lastError=null;
    for(const name of names){
      try {
        const raw = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(body||{}) }).then(parse);
        return raw?.[name] || raw || {};
      } catch(err){ lastError = err; }
    }
    throw lastError || new Error('RPC mislukt');
  }
  function readCache(){
    try{ const raw=sessionStorage.getItem(CACHE_KEY); if(!raw) return null; const parsed=JSON.parse(raw); if(!parsed?.at || (Date.now()-Number(parsed.at))>CACHE_TTL) return null; return parsed.value||null; }catch(_){ return null; }
  }
  function writeCache(value){ try{ sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at:Date.now(), value })); }catch(_){} return value; }
  function normalizeArray(data, keyA, keyB){ return Array.isArray(data) ? data : (data?.[keyA] || data?.[keyB] || data?.items || []); }
  async function load(adminSessionToken, opts={}){
    if(!opts.force){ const cached=readCache(); if(cached) return cached; }
    const body = { admin_session_token: adminSessionToken };
    const [requestsRaw, historyRaw, expiredRaw] = await Promise.all([
      callFirstRpc(['admin_get_claim_requests','admin_list_claim_requests_action'], body),
      callFirstRpc(['admin_get_claim_history','admin_list_claim_history_action'], body),
      callFirstRpc(['admin_get_expired_activation_queue','admin_list_expired_activation_queue_action'], body).catch(()=>({ items:[] }))
    ]);
    return writeCache({
      requests: normalizeArray(requestsRaw, 'requests', 'items'),
      history: normalizeArray(historyRaw, 'history', 'items'),
      expiredQueue: normalizeArray(expiredRaw, 'items', 'rows')
    });
  }
  window.GEJAST_ADMIN_CLAIMS_SOURCE = { load, callFirstRpc, headers, parse };
})();
