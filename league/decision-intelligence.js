(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const num=v=>Number.isFinite(Number(v));
  const fmt=(v,d=1)=>num(v)?Number(v).toLocaleString(undefined,{maximumFractionDigits:d,minimumFractionDigits:0}):'—';
  const statusLabel=s=>({supported:'Measured',proxy:'Proxy',thin:'Thin sample',unavailable:'No evidence'}[s]||s||'Context');
  const statusTone=s=>s==='supported'?'good':s==='proxy'?'warn':s==='thin'?'neutral':'muted';
  const simpleValue=v=>{
    if(v==null)return '—';
    if(typeof v==='boolean')return v?'Yes':'No';
    if(typeof v==='number')return fmt(v,2);
    if(typeof v==='string')return v;
    if(Array.isArray(v))return v.slice(0,4).map(simpleValue).join(' · ');
    return '';
  };
  function evidenceRows(e){
    const rows=Array.isArray(e?.rows)?e.rows:[];
    return rows.slice(0,8).map(row=>{
      const bits=Object.entries(row||{}).filter(([k,v])=>!['matchId','checkpoints'].includes(k)&&v!=null&&typeof v!=='object').slice(0,5)
        .map(([k,v])=>'<span><b>'+esc(k.replace(/([A-Z])/g,' $1').replace(/_/g,' '))+'</b> '+esc(simpleValue(v))+'</span>').join('');
      const checkpoints=Array.isArray(row?.checkpoints)?'<small>'+row.checkpoints.map(x=>esc(x.sec+'s: '+(x.zone||'unknown')+(num(x.distance)?' · '+fmt(x.distance,0)+'u':''))).join(' · ')+'</small>':'';
      const match=row?.matchId?'<button class="button secondary tiny di-open-match" type="button" data-match-id="'+esc(row.matchId)+'">Open match</button>':'';
      return '<div class="di-evidence-row"><div>'+bits+checkpoints+'</div>'+match+'</div>';
    }).join('');
  }
  function scalarEvidence(e){
    if(!e||typeof e!=='object')return '';
    const skip=new Set(['rows','proxy']);
    const bits=Object.entries(e).filter(([k,v])=>!skip.has(k)&&v!=null&&!Array.isArray(v)&&typeof v!=='object').slice(0,6);
    if(!bits.length&&!e.proxy)return '';
    return '<div class="di-evidence-chips">'+(e.proxy?'<span class="di-proxy-note">'+esc(e.proxy)+'</span>':'')+
      bits.map(([k,v])=>'<span><b>'+esc(k.replace(/([A-Z])/g,' $1').replace(/_/g,' '))+'</b> '+esc(simpleValue(v))+'</span>').join('')+'</div>';
  }
  function analyticCard(a,index){
    const rows=evidenceRows(a?.evidence);
    return '<details class="di-card tone-'+statusTone(a?.status)+'" '+(index<5?'open':'')+'>'+
      '<summary><span class="di-index">'+String(index+1).padStart(2,'0')+'</span><div><strong>'+esc(a?.title||'Analysis')+'</strong><small>'+esc(statusLabel(a?.status))+' · n='+esc(a?.sample??0)+'</small></div><i></i></summary>'+
      '<div class="di-card-body"><p>'+esc(a?.summary||'No summary available.')+'</p>'+scalarEvidence(a?.evidence)+(rows?'<div class="di-evidence-list">'+rows+'</div>':'')+'</div></details>';
  }
  function shortlistCard(x,index){
    return '<article class="di-shortlist-card"><span>#'+(index+1)+' · '+esc(x.type||'Replay')+(num(x.minute)?' · '+fmt(x.minute,1)+'m':'')+'</span>'+
      '<strong>'+esc(x.reason||'Review this moment')+'</strong>'+
      '<small>'+esc(x.zone||'')+(num(x.score)?' · learning score '+fmt(x.score,0):'')+'</small>'+
      (x.matchId?'<button class="button secondary tiny di-open-match" type="button" data-match-id="'+esc(x.matchId)+'">Open match</button>':'')+'</article>';
  }
  function bind(box){
    box.querySelectorAll('.di-open-match').forEach(btn=>btn.addEventListener('click',()=>{
      const id=btn.dataset.matchId;
      if(!id)return;
      if(typeof window.openReplayReviewMatch==='function')window.openReplayReviewMatch(id,'fights');
      else {
        const target=document.getElementById('match-history');
        if(target)target.scrollIntoView({behavior:'smooth',block:'start'});
      }
    }));
  }
  window.renderDecisionIntelligence=function(report){
    const panel=document.getElementById('decisionIntelligencePanel'),box=document.getElementById('decisionIntelligence');
    if(!panel||!box)return;
    const d=report?.decisionIntelligence,analytics=Array.isArray(d?.analytics)?d.analytics:[];
    if(!analytics.length){panel.hidden=true;box.innerHTML='';return;}
    const h=d?.headline||{},short=Array.isArray(d?.replayShortlist)?d.replayShortlist:[];
    box.innerHTML=
      '<div class="di-headline">'+
        '<div><span>Decision intelligence v1</span><strong>'+esc(d.generatedFromGames||0)+' deep games · '+esc(d.selectedRole||'role')+'</strong><p>All 25 requested analyses are present. Measured signals and explicit proxies are separated so replay triage does not masquerade as causal proof.</p></div>'+
        '<div class="di-headline-stats">'+
          '<span><b>'+esc(h.supported||0)+'</b> measured</span><span><b>'+esc(h.proxy||0)+'</b> proxies</span><span><b>'+esc(h.thin||0)+'</b> thin</span><span><b>'+esc(h.unavailable||0)+'</b> unavailable</span>'+
        '</div>'+
      '</div>'+
      (short.length?'<div class="di-shortlist"><div class="section-subhead"><div><span>Automatic replay shortlist</span><strong>The moments with the highest learning value</strong></div><small>Prioritizes skipped-fight opportunity cost, fight entry, objective setup and repeat deaths.</small></div><div class="di-shortlist-grid">'+short.slice(0,10).map(shortlistCard).join('')+'</div></div>':'')+
      '<div class="di-all-head"><div><span>All 25 additions</span><strong>Decision, macro, session and replay analytics</strong></div><small>Open any row for evidence and linked matches.</small></div>'+
      '<div class="di-grid">'+analytics.map(analyticCard).join('')+'</div>'+
      '<p class="source-note"><b>Evidence policy:</b> '+esc(d.proxyPolicy||'Proxy outputs rank replay questions only.')+' Exact live wave size, hidden information, cooldown availability and player intent are not inferred when Riot data does not expose them.</p>';
    bind(box);panel.hidden=false;
  };
})();