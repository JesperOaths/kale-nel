(function(window){
  const api = {
    normalizeRows(rows){
      return Array.isArray(rows) ? rows : [];
    },
    scoreRows(rows){
      return Array.isArray(rows) ? rows : [];
    },
    renderInto(root, rows){
      if (!root) return;
      const items = Array.isArray(rows) ? rows : [];
      if (!items.length) {
        root.innerHTML = '<div class="ladder-empty">Nog geen data.</div>';
        return;
      }
      root.innerHTML = items.map((row) => {
        const label = String(row?.label || row?.title || row?.player_name || 'Onbekend');
        const value = String(row?.value || row?.score || row?.fairness_score || '');
        return `<div class="mini"><strong>${label}</strong><span>${value}</span></div>`;
      }).join('');
    }
  };
  window.GEJAST_FAIRNESS = Object.assign({}, window.GEJAST_FAIRNESS || {}, api);
})(window);
