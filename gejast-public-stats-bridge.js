(function(){
  function qs(name, fallback=''){try{return new URLSearchParams(location.search).get(name)||fallback;}catch(_){return fallback;}}
  function scope(){return qs('scope','friends')==='family'?'family':'friends';}
  function game(){return (qs('game','klaverjas')||'klaverjas').toLowerCase();}
  function ensurePanel(){
    let panel=document.getElementById('gejastSharedStatsPanel'); if(panel) return panel;
    const host=document.querySelector('.sheet')||document.querySelector('.card')||document.querySelector('main')||document.body;
    panel=document.createElement('section'); panel.id='gejastSharedStatsPanel';
    panel.style.cssText='margin:14px 0;padding:14px;border:1px solid rgba(0,0,0,.08);border-radius:18px;background:#fff';
    panel.innerHTML='<h2 style="margin:0 0 8px;font-size:18px">Gedeelde stats</h2><div data-shared-stats-body style="color:#6b6257;font-size:14px">Laden...</div>';
    const iframe=host.querySelector('iframe'); if(iframe) host.insertBefore(panel, iframe); else host.appendChild(panel);
    return panel;
  }
  function fmt(n){if(n==null||n==='')return '—'; const x=Number(n); return Number.isFinite(x)?(Math.round(x*10)/10).toString():String(n);}
  async function boot(){
    const shared=window.GEJAST_SHARED_STATS; if(!shared||!shared.leaderboard) return;
    const panel=ensurePanel(); const body=panel.querySelector('[data-shared-stats-body]');
    try{
      const data=await shared.leaderboard({scope:scope(),gameKey:game(),limit:5});
      const rows=Array.isArray(data.items)?data.items:[];
      if(!rows.length){body.textContent=data.note||'Geen gedeelde stats beschikbaar. Draai de v661 SQL en refresh de cache.';return;}
      body.innerHTML=rows.map((r,i)=>`<div style="display:grid;grid-template-columns:40px 1fr auto;gap:8px;padding:8px 0;border-top:${i?'1px solid rgba(0,0,0,.06)':'0'}"><b>#${r.rank_in_game||i+1}</b><span>${r.player_name||'Onbekend'}<small style="display:block;color:#8a7a55">${r.games_played||0} potjes · ${fmt(r.win_pct)}% winst</small></span><strong>${fmt(r.elo_rating)}</strong></div>`).join('');
    }catch(err){body.textContent='Gedeelde stats konden niet laden: '+(err&&err.message||err);}
  }
  window.GEJAST_PUBLIC_STATS_BRIDGE={boot};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
