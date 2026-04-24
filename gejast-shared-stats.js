(function(){
  const CFG=window.GEJAST_SHARED_STATS_CONFIG||{};
  const APP=window.GEJAST_CONFIG||{};
  const rpcNames=CFG.rpc||{};
  const CACHE_KEY=CFG.cache_key||'gejast_shared_stats_cache_v658';
  function scope(input){ const raw=String(input||'').trim().toLowerCase(); if(raw==='family') return 'family'; try{const qs=new URLSearchParams(location.search); if(qs.get('scope')==='family') return 'family';}catch(_){} return CFG.defaultScope||'friends'; }
  function limit(input){ const n=Number(input||CFG.defaultLimit||10); return Math.max(1,Math.min(100,Number.isFinite(n)?Math.floor(n):10)); }
  function headers(){ return {'Content-Type':'application/json',apikey:APP.SUPABASE_PUBLISHABLE_KEY||'',Authorization:`Bearer ${APP.SUPABASE_PUBLISHABLE_KEY||''}`,Accept:'application/json'}; }
  async function rpc(name,payload){
    if(!APP.SUPABASE_URL||!APP.SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase config missing');
    const res=await fetch(`${APP.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify(payload||{})});
    const txt=await res.text(); let data=null;
    try{data=txt?JSON.parse(txt):null;}catch(_){throw new Error(txt||`HTTP ${res.status}`);}
    if(!res.ok) throw new Error(data?.message||data?.error||data?.details||data?.hint||`HTTP ${res.status}`);
    return data&&data[name]!==undefined?data[name]:data;
  }
  function readCache(){try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'null')||null;}catch(_){return null;}}
  function writeCache(key,data){ const cache=readCache()||{}; cache[key]={written_at:new Date().toISOString(),data}; try{localStorage.setItem(CACHE_KEY,JSON.stringify(cache));}catch(_){} return data; }
  function cacheKey(kind,opts){ return `${kind}:${scope(opts&&opts.scope)}:${opts&&opts.gameKey||''}:${opts&&opts.playerName||''}:${limit(opts&&opts.limit)}`; }
  function localAudit(){ let raw=null; try{raw=localStorage.getItem(CACHE_KEY)}catch(_){} return {ok:true,version:CFG.version,cache_key:CACHE_KEY,has_cache:!!raw,cache_bytes:raw?raw.length:0,rpcs:rpcNames}; }
  async function summary(opts={}){ const payload={site_scope_input:scope(opts.scope),game_key_input:opts.gameKey||opts.game_key||null}; return writeCache(cacheKey('summary',opts),await rpc(rpcNames.summary||'get_shared_stats_summary_v658',payload)); }
  async function leaderboard(opts={}){ const payload={site_scope_input:scope(opts.scope),game_key_input:opts.gameKey||opts.game_key||null,limit_input:limit(opts.limit)}; return writeCache(cacheKey('leaderboard',opts),await rpc(rpcNames.leaderboard||'get_shared_stats_leaderboard_v658',payload)); }
  async function crossGame(opts={}){ const payload={site_scope_input:scope(opts.scope),limit_input:limit(opts.limit)}; return writeCache(cacheKey('crossGame',opts),await rpc(rpcNames.crossGame||'get_cross_game_player_summary_v658',payload)); }
  async function klaverjas(opts={}){ const payload={site_scope_input:scope(opts.scope),limit_input:limit(opts.limit)}; return writeCache(cacheKey('klaverjas',opts),await rpc(rpcNames.klaverjas||'get_klaverjas_shared_stats_v658',payload)); }
  async function adminAudit(opts={}){ return await rpc(rpcNames.adminAudit||'admin_get_shared_stats_audit_v658',{site_scope_input:scope(opts.scope)}); }
  async function refresh(opts={}){ return await rpc(rpcNames.refresh||'refresh_shared_stats_cache_v658',{site_scope_input:scope(opts.scope)}); }
  function escapeHtml(v){ return String(v==null?'':v).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function renderRows(node,items,empty){ if(!node) return; const rows=Array.isArray(items)?items:[]; if(!rows.length){node.innerHTML=`<div class="empty">${escapeHtml(empty||'Geen rijen gevonden.')}</div>`;return;} node.innerHTML=rows.map((r,i)=>`<div class="shared-stat-row"><strong>${escapeHtml(r.player_name||r.name||r.game_key||`#${i+1}`)}</strong><span>${escapeHtml(r.game_key||r.metric_key||r.site_scope||'')}</span><b>${escapeHtml(r.elo_rating??r.score??r.games_played??r.total_games??'')}</b></div>`).join(''); }
  window.GEJAST_SHARED_STATS={localAudit,summary,leaderboard,crossGame,klaverjas,adminAudit,refresh,renderRows,readCache,writeCache};
})();
