(function(root){
  const cfg = root.GEJAST_CONFIG || {};
  function adminToken(){
    try { return (root.GEJAST_ADMIN_RPC && root.GEJAST_ADMIN_RPC.getSessionToken && root.GEJAST_ADMIN_RPC.getSessionToken()) || localStorage.getItem('jas_admin_session_v8') || sessionStorage.getItem('jas_admin_session_v8') || ''; }
    catch (_) { return ''; }
  }
  function headers(){ return { apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || text || `HTTP ${res.status}`);
    return data;
  }
  async function rpc(name, payload){
    if (!cfg.SUPABASE_URL) throw new Error('Supabase URL ontbreekt.');
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(payload || {}) });
    const data = await parse(res);
    return data && data[name] !== undefined ? data[name] : data;
  }
  function normalizeMeta(meta){ return Object.fromEntries(Object.entries(meta && typeof meta === 'object' ? meta : {}).filter(([,v]) => v !== undefined)); }
  async function validateJob(jobId, options={}){
    const id = Number(jobId || 0);
    if (!id) return { ok:false, reasons:['missing_job_id'], message:'Mailjob-id ontbreekt.' };
    return rpc(cfg.MAIL_VALIDATE_RPC_SAFE || 'admin_validate_outbound_email_job_v638', { admin_session_token: adminToken(), job_id_input: id, mark_failed_input: options.markFailed !== false });
  }
  async function wakeJob(jobId, meta={}){
    const id = Number(jobId || 0);
    if (!id) return { ok:false, skipped:true, reasons:['missing_job_id'], message:'Mailjob-id ontbreekt; Make is niet gewekt.' };
    return rpc(cfg.MAIL_WAKE_RPC_SAFE || 'admin_wake_outbound_email_job_safe_v638', { admin_session_token: adminToken(), job_id_input: id, meta_input: normalizeMeta(meta) });
  }
  async function wakeLatest(meta={}){
    return rpc(cfg.MAIL_WAKE_LATEST_RPC_SAFE || 'admin_wake_latest_valid_outbound_email_job_safe_v638', { admin_session_token: adminToken(), meta_input: normalizeMeta(meta) });
  }
  async function triggerMakeScenario(meta={}){
    const jobId = meta.job_id || meta.queue_job_id || meta.email_job_id || meta.outbound_email_job_id || meta.id || null;
    return jobId ? wakeJob(jobId, meta) : wakeLatest(meta);
  }
  root.GEJAST_MAIL_QUEUE_SAFETY = { rpc, validateJob, wakeJob, wakeLatest, triggerMakeScenario };
})(window);
