(function(){
  const api = window.GEJAST_KLAVERJAS_API;
  const params = new URLSearchParams(location.search);
  const matchId = params.get('match_id') || sessionStorage.getItem('klaverjas_repo_match_id_v596') || '';
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function fmtNames(arr){ return (Array.isArray(arr) ? arr : []).filter(Boolean).join(' · ') || '—'; }
  function computeFromRounds(rounds){
    const totalRoemW = rounds.reduce((s,r)=>s+Number(r.roem_w||r.roemW||0),0);
    const totalRoemZ = rounds.reduce((s,r)=>s+Number(r.roem_z||r.roemZ||0),0);
    const natW = rounds.filter(r => (r.nat_by||r.natBy)==='W').length;
    const natZ = rounds.filter(r => (r.nat_by||r.natBy)==='Z').length;
    const pitW = rounds.filter(r => (r.pit_by||r.pitBy)==='W').length;
    const pitZ = rounds.filter(r => (r.pit_by||r.pitBy)==='Z').length;
    const verzW = rounds.filter(r => (r.verzaakt_by||r.verzaaktBy)==='W').length;
    const verzZ = rounds.filter(r => (r.verzaakt_by||r.verzaaktBy)==='Z').length;
    const suits={W:{},Z:{}};
    rounds.forEach(r=>{ const team=r.bid_team||r.team||'W'; const key=(r.suit||'').trim()||'—'; suits[team][key]=(suits[team][key]||0)+1; });
    return { totalRoemW,totalRoemZ,natW,natZ,pitW,pitZ,verzW,verzZ,suits };
  }
  function takBuckets(rounds){
    const map = new Map();
    rounds.forEach((r, idx)=>{
      const tak = Number(r.tak_no||r.tak||Math.floor(idx/4)+1);
      if (!map.has(tak)) map.set(tak, []);
      map.get(tak).push(r);
    });
    return Array.from(map.entries()).map(([tak, items])=>({
      tak,
      totals:{ W:items.reduce((s,r)=>s+Number(r.awarded_ladder_w||r.fw||0),0), Z:items.reduce((s,r)=>s+Number(r.awarded_ladder_z||r.fz||0),0) },
      roemTotals:{ W:items.reduce((s,r)=>s+Number(r.roem_w||r.roemW||0),0), Z:items.reduce((s,r)=>s+Number(r.roem_z||r.roemZ||0),0) },
      rounds:items
    }));
  }
  async function render(){
    const app = document.getElementById('app');
    if (!matchId) { app.innerHTML = '<div class="empty">Geen match_id beschikbaar.</div>'; return; }
    try {
      const data = await api.getQuickStats(matchId);
      const match = data.match || {};
      const quick = data.quick_stats_payload || null;
      const snapshot = data.snapshot || null;
      const rounds = Array.isArray(data.rounds) ? data.rounds : Array.isArray(quick?.rounds) ? quick.rounds : [];
      const taks = takBuckets(rounds);
      const winner = match.winner_side || quick?.winner || '';
      const kruipenSide = match.kruipen_side || quick?.kruip?.danger || '';
      const naakt = !!(match.naakt_kruipen_side || quick?.kruip?.naakt);
      const metrics = computeFromRounds(rounds);
      app.innerHTML = `
        <section class="hero">
          <h1 class="title">Klaverjas quick stats</h1>
          <div class="muted">${snapshot ? 'Abandoned-match snapshot' : 'Volledige matchweergave'} · ${esc(match.status || 'active')}</div>
          <div>
            <span class="pill">Winnaars · <strong>${winner ? (winner === 'W' ? fmtNames(match.team_w_player_names) : fmtNames(match.team_z_player_names)) : 'gelijkspel'}</strong></span>
            <span class="pill">Voortgang · ${Math.round(Number(match.progress_ratio || quick?.progress_ratio || 0) * 100)}%</span>
            <span class="pill">Rondes · ${Number(match.total_rounds_played || quick?.round_count || rounds.length || 0)}/16</span>
            <span class="pill">ELO schaal · ${Number(match.elo_scale_applied || quick?.elo_scale || 0).toFixed(2)}</span>
            ${kruipenSide ? `<span class="pill">Kruipen · ${kruipenSide === 'W' ? 'wij' : 'zij'}${naakt ? ' (naakt)' : ''}</span>` : ''}
          </div>
          <div class="score">
            <div class="side"><div class="names">${fmtNames(match.team_w_player_names || quick?.players?.W || [])}</div><div class="total">${Number(match.final_score_w || quick?.totals?.W || 0)}</div></div>
            <div class="vs">tegen</div>
            <div class="side"><div class="names">${fmtNames(match.team_z_player_names || quick?.players?.Z || [])}</div><div class="total">${Number(match.final_score_z || quick?.totals?.Z || 0)}</div></div>
          </div>
        </section>
        <div class="grid">
          <section class="card"><h2>Hoofdstats</h2>
            <div class="row"><span>Totaal roem wij</span><span>+${metrics.totalRoemW}</span></div>
            <div class="row"><span>Totaal roem zij</span><span>+${metrics.totalRoemZ}</span></div>
            <div class="row"><span>Ruwe punten wij</span><span>${Number(match.final_raw_w || quick?.rawTotals?.W || 0)}</span></div>
            <div class="row"><span>Ruwe punten zij</span><span>${Number(match.final_raw_z || quick?.rawTotals?.Z || 0)}</span></div>
          </section>
          <section class="card"><h2>Specials & blunders</h2>
            <div class="row"><span>Nat wij / zij</span><span>${metrics.natW} / ${metrics.natZ}</span></div>
            <div class="row"><span>Pit wij / zij</span><span>${metrics.pitW} / ${metrics.pitZ}</span></div>
            <div class="row"><span>Verzaakt wij / zij</span><span>${metrics.verzW} / ${metrics.verzZ}</span></div>
            <div class="row"><span>Kruipen</span><span>${kruipenSide ? (kruipenSide === 'W' ? 'wij' : 'zij') : 'nee'}</span></div>
            <div class="row"><span>Naakt kruipen</span><span>${naakt ? 'ja' : 'nee'}</span></div>
          </section>
          <section class="card"><h2>Biedingen wij</h2>${Object.keys(metrics.suits.W).length ? Object.entries(metrics.suits.W).map(([k,v])=>`<div class="row"><span>${esc(k)}</span><span>${v}x</span></div>`).join('') : '<div class="row"><span>Geen</span><span>—</span></div>'}</section>
          <section class="card"><h2>Biedingen zij</h2>${Object.keys(metrics.suits.Z).length ? Object.entries(metrics.suits.Z).map(([k,v])=>`<div class="row"><span>${esc(k)}</span><span>${v}x</span></div>`).join('') : '<div class="row"><span>Geen</span><span>—</span></div>'}</section>
        </div>
        <section class="card" style="margin-top:16px"><h2>Takken & rondes</h2><div class="taks">${taks.map(t=>`<div class="tak"><div class="tak-title">Tak ${t.tak} · score ${t.totals.W} - ${t.totals.Z} · roem +${t.roemTotals.W} / +${t.roemTotals.Z}</div>${t.rounds.map(r=>`<div class="round"><div class="left">${Number(r.awarded_ladder_w||r.fw||0)} <span class="muted">(+${Number(r.roem_w||r.roemW||0)})</span></div><div class="center">${Number(r.bid_value||r.bid||0)}${esc((r.suit||'').trim())} ${(r.bid_team||r.team)==='W' ? '· wij biedt' : '· zij biedt'} ${(r.pit_by||r.pitBy)?'· pit':''} ${(r.nat_by||r.natBy)?'· nat':''} ${(r.verzaakt_by||r.verzaaktBy)?'· verzaakt':''}</div><div class="right"><span class="muted">(+${Number(r.roem_z||r.roemZ||0)})</span> ${Number(r.awarded_ladder_z||r.fz||0)}</div></div>`).join('')}</div>`).join('')}</div>
          <div class="actions"><a class="btn alt" href="./klaverjas_live_v596.html?match_id=${encodeURIComponent(matchId)}${api.getScope()==='family'?'&scope=family':''}">Live</a><button class="btn" type="button" onclick="history.back()">Terug</button></div>
        </section>`;
    } catch (err) {
      app.innerHTML = `<div class="empty">${esc(err.message || 'Quick stats laden mislukt.')}</div>`;
    }
  }
  render();
})();
