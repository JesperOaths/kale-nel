(function(){
  const CFG=window.GEJAST_CONFIG||{};
  const VERSION='v661';
  const RPC={
    audit:'admin_get_game_group_b_audit_v661',
    generic:'get_game_group_b_bundle_v661',
    pikken:'get_pikken_phase_bundle_v661',
    paardenrace:'get_paardenrace_phase_bundle_v661'
  };
  function normScope(value){
    const raw=String(value||'').trim().toLowerCase();
    if(raw==='family') return 'family';
    try{const qs=new URLSearchParams(location.search); if(qs.get('scope')==='family') return 'family';}catch(_){}
    return 'friends';
  }
  function normGame(value){
    const raw=String(value||'').trim().toLowerCase();
    if(raw.includes('paard')||raw.includes('horse')) return 'paardenrace';
    if(raw.includes('pik')) return 'pikken';
    try{const qs=new URLSearchParams(location.search); const g=String(qs.get('game')||'').toLowerCase(); if(g.includes('paard')) return 'paardenrace'; if(g.includes('pik')) return 'pikken';}catch(_){}
    const path=String(location.pathname||'').toLowerCase();
    return path.includes('paarden')?'paardenrace':'pikken';
  }
  function headers(){return {'Content-Type':'application/json',apikey:CFG.SUPABASE_PUBLISHABLE_KEY||'',Authorization:`Bearer ${CFG.SUPABASE_PUBLISHABLE_KEY||''}`,Accept:'application/json'};}
  async function rpc(name,payload){
    if(!CFG.SUPABASE_URL||!CFG.SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase config missing');
    const res=await fetch(`${CFG.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify(payload||{})});
    const txt=await res.text(); let data=null;
    try{data=txt?JSON.parse(txt):null;}catch(_){throw new Error(txt||`HTTP ${res.status}`);}
    if(!res.ok) throw new Error(data?.message||data?.error||data?.details||data?.hint||`HTTP ${res.status}`);
    return data&&data[name]!==undefined?data[name]:data;
  }
  async function bundle(opts={}){
    const game=normGame(opts.gameKey||opts.game_key||opts.game);
    const payload={site_scope_input:normScope(opts.scope),game_key_input:game,limit_input:Math.max(1,Math.min(100,Number(opts.limit||20)||20))};
    const specific=game==='paardenrace'?RPC.paardenrace:RPC.pikken;
    try{return await rpc(specific,payload);}catch(err){
      if(!/could not find|schema cache|function|does not exist/i.test(String(err.message||err))) throw err;
      return await rpc(RPC.generic,payload);
    }
  }
  async function audit(opts={}){return await rpc(RPC.audit,{site_scope_input:normScope(opts.scope)});}
  function escapeHtml(v){return String(v==null?'':v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c));}
  function ensurePanel(game){
    let node=document.getElementById('gejastGameGroupBPanel');
    if(node) return node;
    node=document.createElement('section');
    node.id='gejastGameGroupBPanel';
    node.style.cssText='margin:14px 0;padding:14px;border:1px solid rgba(154,130,65,.22);border-radius:18px;background:#fffdf8;box-shadow:0 8px 18px rgba(0,0,0,.035)';
    node.innerHTML=`<h2 style="margin:0 0 8px;font-size:18px">${game==='paardenrace'?'Paardenrace':'Pikken'} statuslaag</h2><div data-game-group-b-body style="color:#6b6257;font-size:14px">Laden...</div>`;
    const host=document.querySelector('.shell')||document.querySelector('.sheet')||document.querySelector('.wrap')||document.querySelector('main')||document.body;
    const firstCard=host.querySelector('.card, .panel, iframe, section');
    if(firstCard&&firstCard.parentNode) firstCard.parentNode.insertBefore(node, firstCard.nextSibling); else host.appendChild(node);
    return node;
  }
  function renderPanel(data,target){
    const game=data&&data.game_key||'game';
    const panel=target||ensurePanel(game);
    const body=panel.querySelector('[data-game-group-b-body]')||panel;
    if(!data||data.ok===false){body.innerHTML=`<div>${escapeHtml(data&&data.error||'Geen data beschikbaar. Run de v661 SQL in Supabase.')}</div>`;return;}
    const totals=data.totals||{};
    const recent=Array.isArray(data.recent_games)?data.recent_games:[];
    const safety=Array.isArray(data.safety_notes)?data.safety_notes:[];
    body.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:10px"><div><b>${escapeHtml(totals.games||0)}</b><br><span>games</span></div><div><b>${escapeHtml(totals.players||0)}</b><br><span>spelers/entries</span></div><div><b>${escapeHtml(totals.active||0)}</b><br><span>actief/live</span></div><div><b>${escapeHtml(data.source||'v661')}</b><br><span>bron</span></div></div>`+
      (recent.length?`<div style="display:grid;gap:6px">${recent.slice(0,5).map((r,i)=>`<div style="display:flex;justify-content:space-between;gap:10px;border-top:1px solid rgba(0,0,0,.06);padding-top:6px"><span>#${i+1} ${escapeHtml(r.status||r.phase||r.room_name||r.game_id||'game')}</span><b>${escapeHtml(r.created_at||r.updated_at||r.started_at||'')}</b></div>`).join('')}</div>`:`<div>Geen recente games gevonden.</div>`)+
      (safety.length?`<div style="margin-top:10px;color:#6b6257"><b>Safety:</b> ${safety.map(escapeHtml).join(' · ')}</div>`:'');
  }
  async function bootPanel(opts={}){
    const game=normGame(opts.game);
    const panel=ensurePanel(game);
    try{const data=await bundle({gameKey:game,scope:opts.scope,limit:5});renderPanel(data,panel);}catch(err){renderPanel({ok:false,error:err.message||String(err)},panel);}
  }
  window.GEJAST_GAME_GROUP_B_BRIDGE={VERSION,RPC,normScope,normGame,bundle,audit,renderPanel,bootPanel};
})();
