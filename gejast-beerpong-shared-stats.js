(function(){
  const api = window.GEJAST_BEERPONG || {};
  function qs(sel, root){ return (root || document).querySelector(sel); }
  function esc(value){ return String(value ?? '').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function num(value, digits){ const n = Number(value || 0); return Number.isFinite(n) ? n.toLocaleString('nl-NL', { maximumFractionDigits: digits ?? 1 }) : '0'; }
  function metricLabel(key){
    return ({
      matches_played:'Wedstrijden', wins:'Wins', win_percentage:'Win%', point_differential:'Puntensaldo',
      consistency_score:'Consistentie', volatility_score:'Volatiliteit', showed_up_rate:'Showed-up',
      king_of_the_hill_score:'King score', loser_streak_risk:'Loser risk', chaos_factor:'Chaos'
    })[key] || key;
  }
  function card(row){
    const metrics = row.metrics || row.metric_values || {};
    const name = row.player_name || row.name || 'Onbekend';
    const main = ['matches_played','wins','win_percentage','point_differential','consistency_score','chaos_factor'];
    return `<article class="bp-stat-card"><h3>${esc(name)}</h3><div class="bp-stat-grid">${main.map((key)=>`<div><span>${esc(metricLabel(key))}</span><strong>${num(metrics[key])}</strong></div>`).join('')}</div></article>`;
  }
  async function loadLeaderboard(target, options){
    const el = typeof target === 'string' ? qs(target) : target;
    if (!el || !api.rpc) return;
    el.innerHTML = '<div class="bp-muted">Beerpong stats laden…</div>';
    try {
      const payload = Object.assign({ site_scope_input: api.scope ? api.scope() : 'friends', limit_input: 25 }, options || {});
      const data = await api.rpc('get_beerpong_shared_leaderboard_v642', payload);
      const rows = Array.isArray(data) ? data : (Array.isArray(data?.rows) ? data.rows : []);
      el.innerHTML = rows.length ? rows.map(card).join('') : '<div class="bp-muted">Nog geen Beerpong shared stats.</div>';
    } catch (err) { el.innerHTML = `<div class="bp-error">${esc(err.message || err)}</div>`; }
  }
  async function loadMine(target){
    const el = typeof target === 'string' ? qs(target) : target;
    if (!el || !api.rpc) return;
    const name = api.playerName ? api.playerName() : '';
    if (!name) { el.innerHTML = '<div class="bp-muted">Geen speler herkend.</div>'; return; }
    try {
      const data = await api.rpc('get_beerpong_shared_stats_v642', { player_name_input:name, site_scope_input: api.scope ? api.scope() : 'friends' });
      el.innerHTML = card(data || { player_name:name, metrics:{} });
    } catch (err) { el.innerHTML = `<div class="bp-error">${esc(err.message || err)}</div>`; }
  }
  function installStyles(){
    if (document.getElementById('gejast-beerpong-shared-stats-style')) return;
    const style = document.createElement('style'); style.id = 'gejast-beerpong-shared-stats-style';
    style.textContent = '.bp-stat-card{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:20px;padding:16px;box-shadow:0 10px 24px rgba(0,0,0,.04)}.bp-stat-card h3{margin:0 0 12px;font-size:18px}.bp-stat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.bp-stat-grid div{background:#faf7ef;border-radius:14px;padding:10px}.bp-stat-grid span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8a7a55;font-weight:800}.bp-stat-grid strong{display:block;margin-top:4px;font-size:20px}.bp-muted,.bp-error{padding:14px;border-radius:16px;background:#fff;border:1px solid rgba(0,0,0,.08);color:#6b6257}.bp-error{color:#8b2d20}@media(max-width:640px){.bp-stat-grid{grid-template-columns:1fr 1fr}}';
    document.head.appendChild(style);
  }
  window.GEJAST_BEERPONG_SHARED_STATS = { VERSION:'v642', loadLeaderboard, loadMine, installStyles };
  document.addEventListener('DOMContentLoaded', installStyles, { once:true });
})();
