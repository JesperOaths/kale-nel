(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const session = window.GEJAST_ADMIN_SESSION || null;
  const $ = (id)=>document.getElementById(id);
  function adminToken(){ try { return (session && session.getToken && session.getToken()) || sessionStorage.getItem('jas_admin_session_v8') || localStorage.getItem('jas_admin_session_v8') || ''; } catch(_) { return ''; } }
  function headers(){ return { apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const txt=await res.text(); let data=null; try{ data=txt?JSON.parse(txt):null; }catch(_){ throw new Error(txt||`HTTP ${res.status}`); } if(!res.ok) throw new Error(data?.message||data?.error||data?.details||data?.hint||`HTTP ${res.status}`); return data; }
  async function rpc(name, payload){ const res=await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify(payload||{})}); const data=await parse(res); return data&&data[name]!==undefined?data[name]:data; }
  function esc(v){ return String(v??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function pill(status){ const s=String(status||'unknown').toLowerCase(); const cls=s.includes('ok')||s.includes('pass')?'ok':s.includes('warn')||s.includes('pending')?'warn':'bad'; return `<span class="pill ${cls}">${esc(status||'unknown')}</span>`; }
  function table(rows, cols){ if(!Array.isArray(rows)||!rows.length) return '<div class="small">Geen records gevonden.</div>'; return `<table><thead><tr>${cols.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${cols.map(c=>`<td>${c.render?c.render(row):esc(row[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }
  async function load(){
    const token=adminToken();
    if(!token){ setStatus('Geen adminsessie gevonden. Log in via de beheerhub.', 'warn'); return; }
    setStatus('Ops signalen laden...');
    const data = await rpc('admin_get_ops_observability_v651', { admin_session_token: token });
    $('openCount').textContent = String(data?.summary?.open_count ?? 0);
    $('dayCount').textContent = String(data?.summary?.last_24h_count ?? 0);
    $('smokeCount').textContent = String((data?.smoke_checks||[]).length);
    $('releaseVersion').textContent = data?.summary?.latest_release || 'v651';
    $('runtimeRows').innerHTML = table(data?.runtime_events || [], [
      {label:'Tijd', key:'created_at'},
      {label:'Severity', key:'severity', render:r=>pill(r.severity)},
      {label:'Page', key:'page_path'},
      {label:'Signaal', key:'event_key'},
      {label:'Details', key:'message'}
    ]);
    $('smokeRows').innerHTML = table(data?.smoke_checks || [], [
      {label:'Check', key:'check_key'},
      {label:'Status', key:'status', render:r=>pill(r.status)},
      {label:'Versie', key:'release_version'},
      {label:'Laatste update', key:'updated_at'}
    ]);
    setStatus('Ops observability geladen.', 'ok');
  }
  function setStatus(msg,tone){ const el=$('statusBox'); if(!el) return; el.textContent=msg||''; el.className=`status ${tone||''}`.trim(); }
  function boot(){ const btn=$('refreshBtn'); if(btn) btn.addEventListener('click',()=>load().catch(e=>setStatus(e.message||'Laden mislukt','warn'))); load().catch(e=>setStatus(e.message||'Laden mislukt','warn')); }
  window.GEJAST_OPS_OBSERVABILITY = { boot, load };
})();
