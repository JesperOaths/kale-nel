(function(){
  const api = window.GEJAST_BEERPONG || {};
  function esc(value){ return String(value ?? '').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function parseNames(value){ return String(value || '').split(/[,+/|;]/).map((x)=>x.trim()).filter(Boolean); }
  async function calculate(teamA, teamB){
    if (!api.rpc) throw new Error('Beerpong API ontbreekt.');
    return api.rpc('get_beerpong_live_odds_v642', { team_a_input: Array.isArray(teamA) ? teamA : parseNames(teamA), team_b_input: Array.isArray(teamB) ? teamB : parseNames(teamB), site_scope_input: api.scope ? api.scope() : 'friends' });
  }
  async function render(target, teamA, teamB){
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    el.innerHTML = '<div class="bp-muted">Odds laden…</div>';
    try {
      const data = await calculate(teamA, teamB);
      const a = Number(data?.team_a_win_probability || data?.team_a || 0);
      const b = Number(data?.team_b_win_probability || data?.team_b || 0);
      el.innerHTML = `<div class="bp-odds"><div><span>Team A</span><strong>${Math.round(a * 100)}%</strong></div><div><span>Team B</span><strong>${Math.round(b * 100)}%</strong></div><small>${esc(data?.basis || 'Gebaseerd op cached Beerpong performance rating.')}</small></div>`;
    } catch (err) { el.innerHTML = `<div class="bp-error">${esc(err.message || err)}</div>`; }
  }
  window.GEJAST_BEERPONG_ODDS = { VERSION:'v642', calculate, render, parseNames };
})();
