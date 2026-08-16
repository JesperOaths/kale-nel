(function(){
  const CFG=window.GEJAST_CONFIG||{};
  const VERSION='v794';
  const RPC={
    audit:'admin_get_game_group_b_audit_v661',
    generic:'get_game_group_b_bundle_v661'
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
    return rpc(RPC.generic,payload);
  }
  async function audit(opts={}){return await rpc(RPC.audit,{site_scope_input:normScope(opts.scope)});}
  function escapeHtml(v){return String(v==null?'':v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c));}
  function numberValue(value){const n=Number(value);return Number.isFinite(n)&&n>0?n:0;}
  function firstArray(...values){for(const value of values){if(Array.isArray(value)) return value;}return [];}
  function normalizeCompatPayload(data){
    if(!data||typeof data!=='object') return null;
    const game=normGame(data.game_key);
    const isCompat=String(data.version||'').toLowerCase()==='v687-compat'||Object.prototype.hasOwnProperty.call(data,'pikken_open')||Object.prototype.hasOwnProperty.call(data,'paardenrace_open');
    if(!isCompat) return null;
    const raw=game==='paardenrace'?data.paardenrace_open:data.pikken_open;
    const rows=Array.isArray(raw)?raw:firstArray(raw?.rows,raw?.items,raw?.lobbies,raw?.rooms);
    return {
      game,
      version:String(data.version||'v687-compat'),
      rows,
      totals:{
        open:rows.length,
        players:rows.reduce((sum,row)=>sum+numberValue(row&&row.player_count),0),
        ready:rows.reduce((sum,row)=>sum+numberValue(row&&row.ready_count),0)
      }
    };
  }
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
  function compatRowHtml(row,index,game){
    const code=row?.lobby_code||row?.room_code||row?.code||row?.id||'—';
    const status=row?.stage_label||row?.stage||row?.status||'open';
    const host=row?.host_name||'';
    const players=numberValue(row?.player_count);
    const ready=numberValue(row?.ready_count);
    const label=game==='paardenrace'?'kamer':'lobby';
    return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;border-top:1px solid rgba(0,0,0,.06);padding-top:7px"><span><b>#${index+1} ${escapeHtml(code)}</b><br><span>${escapeHtml(label)} · ${escapeHtml(status)}${host?` · host ${escapeHtml(host)}`:''}</span></span><span style="text-align:right;white-space:nowrap"><b>${escapeHtml(players)}</b> spelers<br>${escapeHtml(ready)} gereed</span></div>`;
  }
  function renderCompatPanel(compat,body){
    const isPaardenrace=compat.game==='paardenrace';
    const noun=isPaardenrace?'kamers':'lobby’s';
    const empty=isPaardenrace?'Geen open Paardenrace-kamers gevonden.':'Geen open Pikken-lobby’s gevonden.';
    body.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:10px"><div><b>${escapeHtml(compat.totals.open)}</b><br><span>open ${noun}</span></div><div><b>${escapeHtml(compat.totals.players)}</b><br><span>spelers</span></div><div><b>${escapeHtml(compat.totals.ready)}</b><br><span>gereed</span></div><div><b>${escapeHtml(compat.version)}</b><br><span>bron</span></div></div>`+
      (compat.rows.length?`<div style="display:grid;gap:7px">${compat.rows.slice(0,5).map((row,index)=>compatRowHtml(row,index,compat.game)).join('')}</div>`:`<div>${empty}</div>`);
  }
  function renderLegacyPanel(data,body){
    const totals=data.totals||{};
    const recent=Array.isArray(data.recent_games)?data.recent_games:[];
    const safety=Array.isArray(data.safety_notes)?data.safety_notes:[];
    body.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:10px"><div><b>${escapeHtml(totals.games||0)}</b><br><span>games</span></div><div><b>${escapeHtml(totals.players||0)}</b><br><span>spelers/entries</span></div><div><b>${escapeHtml(totals.active||0)}</b><br><span>actief/live</span></div><div><b>${escapeHtml(data.source||data.version||'legacy')}</b><br><span>bron</span></div></div>`+
      (recent.length?`<div style="display:grid;gap:6px">${recent.slice(0,5).map((r,i)=>`<div style="display:flex;justify-content:space-between;gap:10px;border-top:1px solid rgba(0,0,0,.06);padding-top:6px"><span>#${i+1} ${escapeHtml(r.status||r.phase||r.room_name||r.game_id||'game')}</span><b>${escapeHtml(r.created_at||r.updated_at||r.started_at||'')}</b></div>`).join('')}</div>`:`<div>Geen recente legacy-games gevonden.</div>`)+
      (safety.length?`<div style="margin-top:10px;color:#6b6257"><b>Safety:</b> ${safety.map(escapeHtml).join(' · ')}</div>`:'');
  }
  function renderPanel(data,target){
    const game=normGame(data&&data.game_key);
    const panel=target||ensurePanel(game);
    const body=panel.querySelector('[data-game-group-b-body]')||panel;
    if(!data||data.ok===false){body.innerHTML=`<div>${escapeHtml(data&&data.error||'Geen statusdata beschikbaar.')}</div>`;return;}
    const compat=normalizeCompatPayload(data);
    if(compat){renderCompatPanel(compat,body);return;}
    renderLegacyPanel(data,body);
  }
  async function bootPanel(opts={}){
    const game=normGame(opts.game);
    const panel=ensurePanel(game);
    try{const data=await bundle({gameKey:game,scope:opts.scope,limit:5});renderPanel(data,panel);}catch(err){renderPanel({ok:false,error:err.message||String(err),game_key:game},panel);}
  }
  window.GEJAST_GAME_GROUP_B_BRIDGE={VERSION,RPC,normScope,normGame,bundle,audit,normalizeCompatPayload,renderPanel,bootPanel};
})();
