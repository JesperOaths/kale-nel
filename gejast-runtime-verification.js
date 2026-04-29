(function(global){
  const cfg = global.GEJAST_CONFIG || {};
  const STATE = { lastReport: null };
  function token(){ try { return (global.GEJAST_ADMIN_SESSION && global.GEJAST_ADMIN_SESSION.getToken && global.GEJAST_ADMIN_SESSION.getToken()) || sessionStorage.getItem('jas_admin_session_v8') || localStorage.getItem('jas_admin_session_v8') || ''; } catch(_) { return ''; } }
  function headers(){ return { apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const text=await res.text(); let data=null; try{data=text?JSON.parse(text):null;}catch(_){throw new Error(text||`HTTP ${res.status}`);} if(!res.ok) throw new Error(data?.message||data?.error||data?.details||data?.hint||text||`HTTP ${res.status}`); return data; }
  async function rpc(name, payload){ const res=await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify(payload||{})}); const data=await parse(res); return data && data[name] !== undefined ? data[name] : data; }
  function esc(value){ const map={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}; return String(value??'').replace(/[&<>"']/g,(m)=>map[m]); }
  function statusClass(status){ const s=String(status||'unknown').toLowerCase(); if(s==='ok'||s==='pass'||s==='passed') return 'ok'; if(s==='bad'||s==='fail'||s==='failed'||s==='error') return 'bad'; if(s==='warn'||s==='warning') return 'warn'; return 'unknown'; }
  function browserChecks(){
    const scripts = Array.from(document.scripts || []).map(s=>s.src||'').filter(Boolean);
    const configScript = scripts.find(src=>/gejast-config\.js/i.test(src)) || '';
    const version = String(global.GEJAST_PAGE_VERSION || cfg.VERSION || '').trim();
    const directMake = String(cfg.MAKE_WEBHOOK_URL || '').trim();
    const checks = [
      { scope:'browser', check_key:'page_version_present', status: version ? 'ok' : 'bad', details: version || 'missing', evidence:{ version } },
      { scope:'browser', check_key:'config_cache_bust_matches_page', status: configScript.includes(String(version).replace(/^v/,'')) ? 'ok' : 'warn', details: configScript || 'gejast-config script not found', evidence:{ configScript, version } },
      { scope:'browser', check_key:'no_direct_make_webhook_in_config', status: directMake ? 'bad' : 'ok', details: directMake ? 'MAKE_WEBHOOK_URL still present in browser config' : 'browser config has no direct Make webhook URL', evidence:{ hasDirectMakeWebhook: !!directMake } },
      { scope:'browser', check_key:'admin_session_token_present', status: token() ? 'ok' : 'warn', details: token() ? 'admin token found in browser storage/session helper' : 'no admin token visible; admin RPC checks may fail', evidence:{ tokenPresent: !!token() } }
    ];
    return checks;
  }
  function normalizeRows(raw){ if(Array.isArray(raw)) return raw; if(Array.isArray(raw?.checks)) return raw.checks; if(Array.isArray(raw?.items)) return raw.items; if(Array.isArray(raw?.rows)) return raw.rows; return []; }
  function render(rows){
    const body=document.getElementById('resultsBody');
    const total=document.getElementById('metricTotal');
    const ok=document.getElementById('metricOk');
    const warn=document.getElementById('metricWarn');
    if(!body) return;
    const list=normalizeRows(rows);
    total && (total.textContent=String(list.length));
    ok && (ok.textContent=String(list.filter(r=>statusClass(r.status)==='ok').length));
    warn && (warn.textContent=String(list.filter(r=>statusClass(r.status)!=='ok').length));
    body.innerHTML=list.length ? list.map((row)=>{
      const cls=statusClass(row.status);
      return `<tr><td>${esc(row.scope||row.area||'runtime')}</td><td><strong>${esc(row.check_key||row.name||row.check||'check')}</strong></td><td><span class="pill ${cls}">${esc(row.status||'unknown')}</span></td><td>${esc(row.details||row.message||'')}</td><td><code>${esc(JSON.stringify(row.evidence||row.payload||{}))}</code></td></tr>`;
    }).join('') : '<tr><td colspan="5" class="muted">Geen checks teruggegeven.</td></tr>';
  }
  function setStatus(message){ const el=document.getElementById('statusBox'); if(el) el.textContent=message||''; }
  async function runBrowserOnly(){ const rows=browserChecks(); STATE.lastReport={ created_at:new Date().toISOString(), checks:rows }; render(rows); setStatus(`Browser-only checks klaar: ${rows.length}.`); return rows; }
  async function runAll(){
    const browser = browserChecks();
    let backend = [];
    try { backend = normalizeRows(await rpc('admin_get_runtime_verification_report_v648', { admin_session_token: token() })); }
    catch(err){ backend = [{ scope:'backend', check_key:'admin_runtime_verification_rpc', status:'warn', details: err.message || 'RPC failed', evidence:{ rpc:'admin_get_runtime_verification_report_v648' } }]; }
    const rows = browser.concat(backend);
    STATE.lastReport={ created_at:new Date().toISOString(), checks:rows };
    render(rows); setStatus(`Runtime verificatie klaar: ${rows.length} checks.`); return rows;
  }
  async function copyReport(){ const text=JSON.stringify(STATE.lastReport || { created_at:new Date().toISOString(), checks:browserChecks() }, null, 2); try{ await navigator.clipboard.writeText(text); setStatus('Rapport gekopieerd.'); }catch(_){ setStatus(text); } }
  function bind(){
    document.getElementById('runAllBtn')?.addEventListener('click',()=>runAll().catch(err=>setStatus(err.message||'Run mislukt.')));
    document.getElementById('runBrowserBtn')?.addEventListener('click',()=>runBrowserOnly().catch(err=>setStatus(err.message||'Browser-run mislukt.')));
    document.getElementById('copyBtn')?.addEventListener('click',()=>copyReport());
    runBrowserOnly().catch(()=>{});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind,{once:true}); else bind();
  global.GEJAST_RUNTIME_VERIFICATION = { runAll, runBrowserOnly, copyReport, browserChecks };
})(window);
