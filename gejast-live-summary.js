(function(){
  function cfg(){ return window.GEJAST_CONFIG || {}; }
  function headers(){ const c=cfg(); return { apikey:c.SUPABASE_PUBLISHABLE_KEY||'', Authorization:`Bearer ${c.SUPABASE_PUBLISHABLE_KEY||''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const t=await res.text(); let d=null; try{ d=t?JSON.parse(t):null; }catch{ throw new Error(t||`HTTP ${res.status}`); } if(!res.ok) throw new Error(d?.message||d?.error||`HTTP ${res.status}`); return d; }
  function currentScope(){ try{ return (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); }catch(_){ return 'friends'; } }
  function matchIdentityFromUrl(){ const params = new URLSearchParams(location.search); return { clientMatchId: params.get('client_match_id') || '', matchRef: params.get('match_ref') || '' }; }
  function itemFromPayload(data){ return data?.item || data || {}; }
  function summaryFromItem(item){ return item?.summary || item?.summary_payload || {}; }
  function isFinished(item){ return !!(item?.finished_at || summaryFromItem(item)?.finished_at || summaryFromItem(item)?.live_state?.status === 'finished'); }
  function metaText(item){ if(isFinished(item)){ const when = item.finished_at || summaryFromItem(item)?.finished_at; return when ? `Afgerond op ${new Date(when).toLocaleString('nl-NL')}` : 'Wedstrijd afgerond.'; } const updated = item.updated_at || summaryFromItem(item)?.live_state?.updated_at || Date.now(); return `Live bijgewerkt om ${new Date(updated).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}`; }
  async function loadPublicSummary(gameType, opts={}){
    const c=cfg();
    const scope = opts.siteScope || currentScope();
    const clientMatchId = opts.clientMatchId || '';
    const matchRef = opts.matchRef || '';
    try {
      const raw = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/get_live_match_summary_public_scoped`, { method:'POST', headers:headers(), body: JSON.stringify({ game_type_input: gameType, match_ref_input: matchRef || null, client_match_id_input: clientMatchId || null, site_scope_input: scope }) }).then(parse);
      return itemFromPayload(raw);
    } catch(err) {
      const legacyRef = matchRef || clientMatchId;
      const raw = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/get_live_match_summary_public`, { method:'POST', headers:headers(), body: JSON.stringify({ game_type_input: gameType, match_ref_input: legacyRef }) }).then(parse);
      return itemFromPayload(raw);
    }
  }
  window.GEJAST_LIVE_SUMMARY = { currentScope, matchIdentityFromUrl, loadPublicSummary, itemFromPayload, summaryFromItem, isFinished, metaText };
})();
