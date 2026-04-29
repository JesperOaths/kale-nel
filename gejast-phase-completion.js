(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const VERSION = 'v647';
  function token(){ try { return (window.GEJAST_ADMIN_SESSION && window.GEJAST_ADMIN_SESSION.getToken && window.GEJAST_ADMIN_SESSION.getToken()) || localStorage.getItem('jas_admin_session_v8') || sessionStorage.getItem('jas_admin_session_v8') || ''; } catch(_) { return ''; } }
  function headers(){ return { 'Content-Type':'application/json', apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, Accept:'application/json' }; }
  async function parse(res){ const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch(_) { throw new Error(text || `HTTP ${res.status}`); } if(!res.ok) throw new Error((data && (data.message || data.error || data.details || data.hint)) || text || `HTTP ${res.status}`); return data; }
  async function rpc(name, payload){ const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(payload || {}) }); const data = await parse(res); return data && data[name] !== undefined ? data[name] : data; }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function pill(value, kind){ return `<span class="pill ${kind || ''}">${esc(value)}</span>`; }
  function boolPill(value){ return pill(value ? 'yes' : 'no', value ? 'ok' : 'warn'); }
  function setStatus(msg, bad){ const el=document.getElementById('statusBox'); if(el){ el.textContent=msg||''; el.style.color=bad?'#9b2f22':'#6b6257'; } }
  function normalizeRows(raw){ if(Array.isArray(raw)) return raw; if(Array.isArray(raw && raw.rows)) return raw.rows; if(Array.isArray(raw && raw.items)) return raw.items; if(Array.isArray(raw && raw.phases)) return raw.phases; return []; }
  function render(raw){
    const rows = normalizeRows(raw);
    const total = rows.length;
    const db = rows.filter(r=>r.db_applied || r.sql_applied || String(r.status||'').toLowerCase().includes('sql')).length;
    const fe = rows.filter(r=>r.frontend_packaged || r.frontend_package || r.has_frontend).length;
    const runtime = rows.filter(r=>r.needs_runtime_proof !== false && !r.runtime_verified).length;
    const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=String(v); };
    set('phaseTotal', total); set('phaseDb', db); set('phaseFrontend', fe); set('phaseRuntime', runtime);
    const body=document.getElementById('phaseRows'); if(!body) return;
    body.innerHTML = rows.length ? rows.map(r=>`<tr>
      <td><strong>${esc(r.phase_key || r.phase || r.name || '—')}</strong><div class="small">${esc(r.version || '')}</div></td>
      <td>${pill(r.status || 'registered', r.runtime_verified ? 'ok' : (r.needs_runtime_proof === false ? 'ok' : 'warn'))}</td>
      <td>${boolPill(!!(r.frontend_packaged || r.frontend_package || r.has_frontend))}<div class="small">${esc(r.frontend_owner || r.frontend_file || '')}</div></td>
      <td>${boolPill(!!(r.db_applied || r.sql_applied || r.has_sql))}<div class="small">${esc(r.sql_owner || r.rpc_owner || '')}</div></td>
      <td>${r.runtime_verified ? pill('verified','ok') : pill('needs proof','warn')}<div class="small">${esc(r.runtime_note || '')}</div></td>
      <td><div class="small">${esc(r.notes || r.next_action || '')}</div></td>
    </tr>`).join('') : '<tr><td colspan="6">Geen phase rows returned.</td></tr>';
  }
  async function load(){
    setStatus('Audit laden…');
    try {
      const payload = { admin_session_token: token(), requested_version: VERSION };
      let data;
      try { data = await rpc('admin_get_phase_completion_audit_v647', payload); }
      catch(_) { data = await rpc('admin_get_phase_completion_registry_v647', payload); }
      render(data); setStatus('Audit geladen. Runtime proof blijft pas verified na echte pagina/device tests.');
    } catch(err) { setStatus(err && err.message ? err.message : 'Audit laden mislukt.', true); }
  }
  document.addEventListener('DOMContentLoaded', ()=>{ const btn=document.getElementById('refreshBtn'); if(btn) btn.addEventListener('click', load); load(); try { cfg.applyVersionLabel && cfg.applyVersionLabel(); } catch(_) {} });
  window.GEJAST_PHASE_COMPLETION = { load, rpc, render };
})();
