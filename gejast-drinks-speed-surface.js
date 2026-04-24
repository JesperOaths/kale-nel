(function(root){
  const CANONICAL_SPEED_TYPES = [
    { key:'bier', label:'1 Bak', units:1 },
    { key:'2bakken', label:'2 Bakken', units:2 },
    { key:'ice', label:'Ice', units:2.8 },
    { key:'wijnfles', label:'Fles Wijn', units:9 },
    { key:'liter_bier', label:'Liter Bier', units:3 }
  ];
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function canonicalTypes(types){
    const byKey = new Map();
    (Array.isArray(types) ? types : []).forEach((row)=>{
      const key = String(row?.key || row?.speed_type_key || '').trim().toLowerCase();
      if (!key || key === 'shot') return;
      byKey.set(key, { key, label: row.label || row.speed_type_label || key, units: Number(row.units ?? row.unit_value ?? 0) || null, rows: Array.isArray(row.rows) ? row.rows : [] });
    });
    CANONICAL_SPEED_TYPES.forEach((row)=>{ if (!byKey.has(row.key)) byKey.set(row.key, { ...row, rows:[] }); });
    return CANONICAL_SPEED_TYPES.map((row)=>byKey.get(row.key)).filter(Boolean);
  }
  function normalizeLeaderboards(payload){
    const raw = payload || {};
    const groups = raw.leaderboards || raw.speed_leaderboards || raw.speed_top5_by_type || raw.rankings_by_type || [];
    return canonicalTypes(groups).map((group)=>({
      ...group,
      rows: (Array.isArray(group.rows) ? group.rows : [])
        .filter((row)=>String(row.status || 'verified').toLowerCase() === 'verified' || row.verified_at || row.duration_seconds)
        .sort((a,b)=>(Number(a.duration_seconds||999999)-Number(b.duration_seconds||999999)) || String(a.player_name||'').localeCompare(String(b.player_name||''))).slice(0,5)
    }));
  }
  function renderTop5(container, groups){
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return;
    const normalized = normalizeLeaderboards({ leaderboards: groups });
    el.innerHTML = normalized.map((group)=>`<div class="drinks-speed-card" data-speed-type="${esc(group.key)}"><strong>${esc(group.label)}</strong><div class="drinks-speed-card-list">${group.rows.length ? group.rows.map((row,i)=>`<div class="drinks-speed-row"><span>${i+1}. ${esc(row.player_name || row.display_name || 'Onbekend')}</span><b>${Number(row.duration_seconds || 0).toFixed(2)}s</b></div>`).join('') : '<span class="muted">Nog geen verified tijden.</span>'}</div></div>`).join('');
  }
  root.GEJAST_DRINKS_SPEED_SURFACE = { CANONICAL_SPEED_TYPES, canonicalTypes, normalizeLeaderboards, renderTop5 };
})(window);
