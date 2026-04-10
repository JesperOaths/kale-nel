(function(){
  if (window.GEJAST_PUSH_ADMIN_SOURCE) return;
  const cfg = window.GEJAST_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || '';
  const KEY = cfg.SUPABASE_PUBLISHABLE_KEY || '';
  const LIST_RPC = cfg.ADMIN_PUSH_DIAGNOSTICS_RPC_V3 || 'admin_get_web_push_diagnostics_v3';
  const QUEUE_RPC = cfg.ADMIN_ACTIVE_PUSH_RPC_V3 || 'admin_queue_active_web_push_v3';
  const SESSION_KEY = 'jas_admin_session_v8';
  function token(){ return (window.GEJAST_ADMIN_SESSION && window.GEJAST_ADMIN_SESSION.getToken && window.GEJAST_ADMIN_SESSION.getToken()) || sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || ''; }
  function headers(){ return { apikey:KEY, Authorization:`Bearer ${KEY}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch(_) { throw new Error(text || `HTTP ${res.status}`); } if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || `HTTP ${res.status}`); return data; }
  async function rpc(name, body){ return fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(body || {}) }).then(parse); }
  async function loadDiagnostics({ activeMinutes=5, scope='friends' }={}){
    return rpc(LIST_RPC, { admin_session_token: token(), active_minutes_input: activeMinutes, site_scope_input: scope });
  }
  async function queueActive({ title, body, targetUrl, activeMinutes=5, scope='friends' }={}){
    return rpc(QUEUE_RPC, { admin_session_token: token(), title_input:title || '', body_input:body || '', target_url_input:targetUrl || './index.html', active_minutes_input: activeMinutes, site_scope_input: scope });
  }
  window.GEJAST_PUSH_ADMIN_SOURCE = { loadDiagnostics, queueActive, token };
})();
