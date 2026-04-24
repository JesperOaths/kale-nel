(function(){
  if (window.__GEJAST_CLIENT_ERROR_CAPTURE_V651) return;
  window.__GEJAST_CLIENT_ERROR_CAPTURE_V651 = true;
  const cfg = window.GEJAST_CONFIG || {};
  const queue = [];
  let sending = false;
  function clean(value, max){ return String(value == null ? '' : value).slice(0, max || 500); }
  function payload(kind, data){
    return {
      release_version: (window.GEJAST_PAGE_VERSION || cfg.VERSION || 'v651'),
      page_path: clean(location.pathname + location.search, 300),
      event_key: clean(kind, 120),
      severity: clean(data && data.severity || 'error', 24),
      message: clean(data && data.message || '', 900),
      source_file: clean(data && data.source_file || '', 300),
      line_no: Number(data && data.line_no || 0) || null,
      column_no: Number(data && data.column_no || 0) || null,
      user_agent: clean(navigator.userAgent || '', 400),
      meta: data && data.meta ? data.meta : {}
    };
  }
  function headers(){ return { apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function flush(){
    if (sending || !queue.length || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) return;
    sending = true;
    try {
      const item = queue.shift();
      await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/record_client_runtime_event_v651`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(item) });
    } catch (_) {
    } finally {
      sending = false;
      if (queue.length) setTimeout(flush, 1200);
    }
  }
  function record(kind, data){ queue.push(payload(kind, data || {})); if(queue.length > 10) queue.splice(0, queue.length - 10); setTimeout(flush, 250); }
  window.addEventListener('error', (event)=>record('window.error', { message:event.message, source_file:event.filename, line_no:event.lineno, column_no:event.colno, meta:{ name:event.error && event.error.name } }));
  window.addEventListener('unhandledrejection', (event)=>record('promise.unhandledrejection', { message:(event.reason && (event.reason.message || String(event.reason))) || 'Unhandled promise rejection', meta:{ reason_type: typeof event.reason } }));
  window.GEJAST_CLIENT_ERROR_CAPTURE = { record, flush };
})();
