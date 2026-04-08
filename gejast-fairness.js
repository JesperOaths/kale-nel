(function(){
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]; }); }
  function targetEl(explicit){
    if (explicit && explicit.nodeType===1) return explicit;
    if (typeof explicit === 'string' && explicit) return document.getElementById(explicit);
    return document.getElementById('fairnessCards') || document.getElementById('fairnessList') || document.getElementById('fairnessWrap');
  }
  function renderFairnessShared(rows, explicitTarget){
    var el = targetEl(explicitTarget);
    if (!el) return;
    var list = Array.isArray(rows) ? rows : [];
    if (!list.length){ el.innerHTML = '<div class="note">Nog geen fairplay-inzichten.</div>'; return; }
    el.innerHTML = list.map(function(row){
      var title = esc(row.title || row.label || row.player_name || row.name || 'Fairplay');
      var sub = esc(row.subtitle || row.sub || row.description || row.note || '');
      var value = esc(row.value_label || row.value || row.score || row.metric || '');
      return '<div class="item"><div><div class="item-title">'+title+'</div>'+(sub?'<div class="item-sub">'+sub+'</div>':'')+'</div>'+(value?'<div class="item-value">'+value+'</div>':'')+'</div>';
    }).join('');
  }
  window.GEJAST_RENDER_FAIRNESS = renderFairnessShared;
  window.renderFairness = window.renderFairness || function(rows, target){ renderFairnessShared(rows, target); };
})();
