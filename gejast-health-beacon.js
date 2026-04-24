(function(){
  if (window.__GEJAST_HEALTH_BEACON_V651) return;
  window.__GEJAST_HEALTH_BEACON_V651 = true;
  const cfg = window.GEJAST_CONFIG || {};
  function headers(){ return { apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  function page(){ return String(location.pathname || '').split('/').pop() || 'index.html'; }
  async function send(status, meta){
    if(!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) return;
    try {
      await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/record_runtime_smoke_check_v651`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify({
        release_version: window.GEJAST_PAGE_VERSION || cfg.VERSION || 'v651',
        check_key: `page_loaded:${page()}`,
        status: status || 'ok',
        page_path: location.pathname + location.search,
        meta: Object.assign({ title: document.title || '', ready_state: document.readyState }, meta || {})
      }) });
    } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ()=>send('ok'), { once:true }); else setTimeout(()=>send('ok'), 0);
  window.GEJAST_HEALTH_BEACON = { send };
})();
