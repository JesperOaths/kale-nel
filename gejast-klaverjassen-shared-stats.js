(function(){
  const cfg = window.GEJAST_CONFIG || {};
  function scope(){ try { return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch (_) { return 'friends'; } }
  function adminToken(){ try { return (window.GEJAST_ADMIN_SESSION && window.GEJAST_ADMIN_SESSION.getToken && window.GEJAST_ADMIN_SESSION.getToken()) || localStorage.getItem('jas_admin_session_v8') || sessionStorage.getItem('jas_admin_session_v8') || ''; } catch (_) { return ''; } }
  function headers(){ return { apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function rpc(name, payload){
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(payload || {}) });
    const txt = await res.text(); let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (_) { throw new Error(txt || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error((data && (data.message || data.error || data.details || data.hint)) || txt || `HTTP ${res.status}`);
    return data && data[name] !== undefined ? data[name] : data;
  }
  function groupByMetric(items){
    const out = new Map();
    (Array.isArray(items) ? items : []).forEach((row)=>{
      const key = row.metric_key || 'unknown';
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(row);
    });
    return out;
  }
  function renderMetricGroups(root, items, empty){
    if (!root) return;
    const groups = groupByMetric(items);
    if (!groups.size) { root.innerHTML = `<div class="kj-empty">${empty || 'Geen Klaverjassen shared stats gevonden.'}</div>`; return; }
    root.innerHTML = Array.from(groups.entries()).map(([metric, rows])=>{
      const label = rows[0]?.metric_label || metric;
      const top = rows.slice(0, 10).map((row,idx)=>`<div class="kj-row"><span class="kj-rank">${idx+1}</span><strong>${row.player_name || 'Onbekend'}</strong><em>${formatValue(row.metric_value)}</em></div>`).join('');
      return `<section class="kj-metric"><h3>${escapeHtml(label)}</h3>${top}</section>`;
    }).join('');
  }
  function escapeHtml(value){ return String(value ?? '').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function formatValue(value){ const n = Number(value); if (!Number.isFinite(n)) return '—'; return Math.abs(n % 1) > 0 ? n.toFixed(2) : String(Math.round(n)); }
  async function publicStats(options={}){ return rpc(cfg.KLAVERJASSEN_SHARED_STATS_RPC_V640 || 'get_klaverjassen_shared_stats_public_v640', { site_scope_input: options.scope || scope(), player_name_input: options.playerName || null, metric_key_input: options.metricKey || null, limit_input: options.limit || 100 }); }
  async function refresh(options={}){ return rpc(cfg.KLAVERJASSEN_SHARED_REFRESH_RPC_V640 || 'refresh_klaverjassen_phase8_all_v640', { site_scope_input: options.scope || scope() }); }
  async function adminAudit(options={}){ return rpc(cfg.ADMIN_KLAVERJASSEN_SHARED_AUDIT_RPC_V640 || 'admin_get_klaverjassen_shared_stats_audit_v640', { admin_session_token: options.adminSessionToken || adminToken(), site_scope_input: options.scope || scope() }); }
  window.GEJAST_KLAVERJASSEN_SHARED_STATS = { rpc, scope, publicStats, refresh, adminAudit, renderMetricGroups, formatValue };
})();
