(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const VERSION = 'v650';
  function $(id){ return document.getElementById(id); }
  function setStatus(message, warn){ const el=$('statusBox'); if(el){ el.textContent=message||''; el.style.color=warn?'#8b3a30':'#1f6d43'; } }
  function tag(state){ const cls=state==='ok'?'ok':state==='warn'?'warn':'wait'; return `<span class="tag ${cls}">${state}</span>`; }
  function escapeHtml(v){ return String(v??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function renderRows(target, rows){ const el=$(target); if(!el) return; el.innerHTML=(rows||[]).map((r)=>`<div class="row"><div><strong>${escapeHtml(r.name)}</strong><div style="color:#6b6257;font-size:13px;margin-top:3px">${escapeHtml(r.detail||'')}</div></div>${tag(r.state||'wait')}</div>`).join('') || '<div class="row"><div>No rows.</div><span class="tag wait">wait</span></div>'; }
  function getAdminToken(){ try { return (window.GEJAST_ADMIN_SESSION && window.GEJAST_ADMIN_SESSION.getToken && window.GEJAST_ADMIN_SESSION.getToken()) || sessionStorage.getItem('jas_admin_session_v8') || localStorage.getItem('jas_admin_session_v8') || ''; } catch(_) { return ''; } }
  async function postRpc(name, payload){
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:{ apikey:cfg.SUPABASE_PUBLISHABLE_KEY||'', Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY||''}`, 'Content-Type':'application/json', Accept:'application/json' }, body:JSON.stringify(payload||{}) });
    const txt = await res.text(); let data=null; try{ data=txt?JSON.parse(txt):null; }catch(_){ data=txt; }
    if(!res.ok) throw new Error((data && (data.message||data.error||data.hint)) || txt || `HTTP ${res.status}`);
    return data && data[name] !== undefined ? data[name] : data;
  }
  function runBrowserChecks(){
    const scripts = Array.from(document.scripts || []).map((s)=>s.src||'').filter(Boolean);
    const rows = [
      { name:'Page version', state: window.GEJAST_PAGE_VERSION === VERSION ? 'ok':'warn', detail:`window.GEJAST_PAGE_VERSION=${window.GEJAST_PAGE_VERSION||'missing'}` },
      { name:'Config availability', state: cfg && cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY ? 'ok':'warn', detail: cfg.SUPABASE_URL ? 'Supabase config present' : 'Supabase config missing' },
      { name:'Direct Make webhook removed', state: cfg.MAKE_WEBHOOK_URL ? 'warn':'ok', detail: cfg.MAKE_WEBHOOK_URL ? 'Browser still has a Make webhook URL' : 'Browser has no direct Make webhook URL' },
      { name:'Versioned local scripts', state: scripts.every((src)=>!src.includes(location.host) || /\?v\d+/.test(src) || !/\.js$/i.test(src)) ? 'ok':'warn', detail:`${scripts.length} script tags inspected` },
      { name:'Watermark', state: /v\d+\s*[·.-]?\s*Made by Bruis/i.test(document.body.innerText||'') ? 'ok':'warn', detail:'Visible branding/version marker checked' }
    ];
    renderRows('browserChecks', rows); $('rawOutput').textContent=JSON.stringify({ browser:rows }, null, 2); setStatus('Browser checks completed.');
  }
  async function loadServerAudit(){
    const token=getAdminToken();
    if(!token) { setStatus('No admin session token found in this browser.', true); return; }
    setStatus('Loading server audit...');
    try{
      const data=await postRpc('admin_get_deployment_verification_audit_v650', { admin_session_token: token });
      const rows=Array.isArray(data?.checks) ? data.checks : [];
      renderRows('serverChecks', rows.map((r)=>({ name:r.check_key||r.name, state:r.status||r.state||'wait', detail:r.detail||r.notes||'' })));
      $('rawOutput').textContent=JSON.stringify(data, null, 2);
      setStatus('Server audit loaded.');
    }catch(err){ setStatus(err.message || 'Server audit failed.', true); $('rawOutput').textContent=String(err && err.stack || err); }
  }
  document.addEventListener('DOMContentLoaded', ()=>{ $('runChecksBtn')?.addEventListener('click', runBrowserChecks); $('loadServerBtn')?.addEventListener('click', loadServerAudit); try { cfg.applyVersionLabel && cfg.applyVersionLabel(); } catch(_) {} runBrowserChecks(); });
  window.GEJAST_DEPLOYMENT_VERIFICATION = { runBrowserChecks, loadServerAudit };
})();
