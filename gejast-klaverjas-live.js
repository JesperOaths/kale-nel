(function(){
  const api = window.GEJAST_KLAVERJAS_API;
  const params = new URLSearchParams(location.search);
  const matchId = params.get('match_id') || '';
  const $ = (id)=>document.getElementById(id);
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function tag(html, extra=''){ return `<span class="tag ${extra}">${html}</span>`; }
  function renderRound(r){
    const suit = r.suit === '♥' || r.suit === '♦' ? tag(r.suit, 'red') : tag(r.suit);
    const specials = [r.nat_by ? tag(`nat ${r.nat_by}`, 'red') : '', r.pit_by ? tag(`pit ${r.pit_by}`) : '', r.verzaakt_by ? tag(`verzaakt ${r.verzaakt_by}`, 'red') : ''].filter(Boolean).join('');
    return `<div class="row"><div class="side left">${suit}${r.bid_value ? tag(`${r.bid_value} ${esc(r.bid_team)}`) : ''}${specials}</div><div class="pts">${Number(r.awarded_ladder_w||0)} - ${Number(r.awarded_ladder_z||0)}</div><div class="side"><span class="muted">deler ${esc(r.dealer_player||'—')}</span><span class="muted">voor ${esc(r.forehand_player||'—')}</span></div></div>`;
  }
  async function load(){
    if (!matchId) { $('metaBox').textContent = 'Geen match_id in URL.'; $('roundsBox').innerHTML = '<div class="empty">Open deze pagina via een echte match-link.</div>'; return; }
    try {
      const data = await api.getLiveMatch(matchId);
      const match = data.match || {};
      const rounds = data.rounds || [];
      $('metaBox').textContent = `${match.status || 'active'} · ${new Date(match.started_at || Date.now()).toLocaleString('nl-NL')}`;
      $('statusPill').textContent = match.status || 'active';
      $('totalW').textContent = Number(match.final_score_w || 0);
      $('totalZ').textContent = Number(match.final_score_z || 0);
      $('roundCount').textContent = Number(match.total_rounds_played || 0);
      $('eloScale').textContent = Number(match.elo_scale_applied || 0).toFixed(2);
      $('teamW').textContent = (match.team_w_player_names || []).join(' · ') || '—';
      $('teamZ').textContent = (match.team_z_player_names || []).join(' · ') || '—';
      $('statsLink').href = `./klaverjas_quick_stats_v596_repo.html?match_id=${encodeURIComponent(matchId)}${api.getScope() === 'family' ? '&scope=family' : ''}`;
      $('scorerLink').href = `./klaverjas_scorer_v596_repo_ready.html?match_id=${encodeURIComponent(matchId)}${api.getScope() === 'family' ? '&scope=family' : ''}`;
      $('roundsBox').innerHTML = rounds.length ? rounds.map(renderRound).join('') : '<div class="empty">Nog geen gespeelde rondes.</div>';
    } catch (err) {
      $('metaBox').textContent = err.message || 'Live match laden mislukt.';
      $('roundsBox').innerHTML = '<div class="empty">Kon live match niet laden.</div>';
    }
  }
  load();
  setInterval(()=>{ if (!document.hidden) load(); }, 2500);
})();
