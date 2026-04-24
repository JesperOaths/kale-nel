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
  function escapeHtml(value){ return String(value ?? '').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function formatValue(value){ const n = Number(value); if (!Number.isFinite(n)) return '—'; return Math.abs(n % 1) > 0 ? n.toFixed(2) : String(Math.round(n)); }
  function groupByMetric(items){
    const out = new Map();
    (Array.isArray(items) ? items : []).forEach((row)=>{ const key = row.metric_key || 'unknown'; if (!out.has(key)) out.set(key, []); out.get(key).push(row); });
    return out;
  }
  function renderMetricGroups(root, items, empty){
    if (!root) return;
    const groups = groupByMetric(items);
    if (!groups.size) { root.innerHTML = `<div class="pikken-empty">${empty || 'Geen Pikken shared stats gevonden.'}</div>`; return; }
    root.innerHTML = Array.from(groups.entries()).map(([metric, rows])=>{
      const label = rows[0]?.metric_label || metric;
      const top = rows.slice(0, 10).map((row,idx)=>`<div class="pikken-row"><span class="pikken-rank">${idx+1}</span><strong>${escapeHtml(row.player_name || 'Onbekend')}</strong><em>${formatValue(row.metric_value)}</em></div>`).join('');
      return `<section class="pikken-metric"><h3>${escapeHtml(label)}</h3>${top}</section>`;
    }).join('');
  }
  function renderProbability(root, payload){
    if (!root) return;
    const rows = Array.isArray(payload?.items) ? payload.items : [];
    if (!rows.length) { root.innerHTML = '<div class="pikken-empty">Geen live probability beschikbaar voor deze game.</div>'; return; }
    root.innerHTML = rows.map((row,idx)=>`<div class="pikken-row"><span class="pikken-rank">${idx+1}</span><strong>${escapeHtml(row.player_name || 'Onbekend')}</strong><em>${formatValue(row.win_probability_pct)}%</em></div>`).join('');
  }
  async function publicStats(options={}){ return rpc(cfg.PIKKEN_SHARED_STATS_RPC_V641 || 'get_pikken_shared_stats_public_v641', { site_scope_input: options.scope || scope(), player_name_input: options.playerName || null, metric_key_input: options.metricKey || null, limit_input: options.limit || 120 }); }
  async function refresh(options={}){ return rpc(cfg.PIKKEN_SHARED_REFRESH_RPC_V641 || 'refresh_pikken_phase9_all_v641', { site_scope_input: options.scope || scope() }); }
  async function probability(options={}){ return rpc(cfg.PIKKEN_PROBABILITY_RPC_V641 || 'get_pikken_live_probability_public_v641', { game_id_input: options.gameId || null, site_scope_input: options.scope || scope() }); }
  async function adminAudit(options={}){ return rpc(cfg.ADMIN_PIKKEN_SHARED_AUDIT_RPC_V641 || 'admin_get_pikken_shared_stats_audit_v641', { admin_session_token: options.adminSessionToken || adminToken(), site_scope_input: options.scope || scope() }); }
  window.GEJAST_PIKKEN_SHARED_STATS = { rpc, scope, publicStats, refresh, probability, adminAudit, renderMetricGroups, renderProbability, formatValue };
})();
