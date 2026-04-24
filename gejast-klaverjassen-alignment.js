(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const shared = window.GEJAST_SHARED_STATS_CONFIG || {};
  const gameCfg = (shared.games && shared.games.klaverjassen) || {};
  function adminToken(){try{return (window.GEJAST_ADMIN_SESSION&&window.GEJAST_ADMIN_SESSION.getToken&&window.GEJAST_ADMIN_SESSION.getToken())||localStorage.getItem('jas_admin_session_v8')||sessionStorage.getItem('jas_admin_session_v8')||'';}catch(_){return '';}}
  function headers(){return {'Content-Type':'application/json',apikey:cfg.SUPABASE_PUBLISHABLE_KEY||'',Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY||''}`,Accept:'application/json'};}
  async function rpc(name,payload){const res=await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify(payload||{})});const text=await res.text();let data=null;try{data=text?JSON.parse(text):null;}catch(_){throw new Error(text||`HTTP ${res.status}`);}if(!res.ok)throw new Error(data&&(data.message||data.error||data.details||data.hint)||text||`HTTP ${res.status}`);return data&&data[name]!==undefined?data[name]:data;}
  function scope(){try{return new URLSearchParams(location.search).get('scope')==='family'?'family':'friends';}catch(_){return 'friends';}}
  async function getAlignmentBundle(options={}){return rpc(gameCfg.alignmentBundleRpc||'get_klaverjassen_alignment_bundle_v644',{site_scope_input:options.scope||scope(),player_name_input:options.playerName||null});}
  async function getLadderAlignment(options={}){return rpc(gameCfg.ladderAlignmentRpc||'get_klaverjassen_ladder_alignment_v644',{site_scope_input:options.scope||scope(),limit_input:options.limit||50});}
  async function getAdminAudit(){return rpc(gameCfg.adminAuditRpc||'admin_get_klaverjassen_alignment_audit_v644',{admin_session_token:adminToken()});}
  async function refreshAdmin(){return rpc(gameCfg.refreshRpc||'admin_refresh_klaverjassen_alignment_v644',{admin_session_token:adminToken(),site_scope_input:scope()});}
  function escapeHtml(value){const map={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};return String(value??'').replace(/[&<>"']/g,ch=>map[ch]);}
  function renderRows(container,rows){if(!container)return;const list=Array.isArray(rows)?rows:[];if(!list.length){container.innerHTML='<div class="empty">Geen Klaverjassen alignment-data gevonden.</div>';return;}container.innerHTML=list.map(row=>`<div class="ks-row"><strong>${escapeHtml(row.player_name||row.name||'—')}</strong><span>${escapeHtml(row.metric_key||row.status||'alignment')}</span><b>${escapeHtml(row.metric_value??row.value??'—')}</b></div>`).join('');}
  window.GEJAST_KLAVERJASSEN_ALIGNMENT={rpc,getAlignmentBundle,getLadderAlignment,getAdminAudit,refreshAdmin,renderRows};
})();
