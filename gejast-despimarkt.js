(function(){
  if (window.GEJAST_DESPIMARKT && window.GEJAST_DESPIMARKT.VERSION === 'v698') return;
  const cfg = window.GEJAST_CONFIG || {};
  const VERSION = 'v698';
  const RPC = {
    dashboard:'get_despimarkt_dashboard_v669', market:'get_despimarkt_market_v669', create:'create_despimarkt_market_v669', buy:'buy_despimarkt_position_v669',
    wallet:'get_despimarkt_wallet_v669', ladder:'get_despimarkt_ladder_v669', stats:'get_despimarkt_stats_v669',
    debts:'get_despimarkt_debts_v669', createDebt:'create_despimarkt_debt_v669', settleDebt:'settle_despimarkt_debt_v669',
    adminAudit:'admin_get_despimarkt_runtime_audit_v669', adminResolve:'admin_resolve_despimarkt_market_v669', adminRefund:'admin_refund_despimarkt_market_v669', adminDelete:'admin_delete_despimarkt_market_v669', adminAdjust:'admin_adjust_despimarkt_wallet_v669'
  };
  function qs(id){return document.getElementById(id);}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function money(v){const n=Number(v||0);return `C ${Math.round(Number.isFinite(n)?n:0)}`;}
  function num(v,fb=0){const n=Number(v);return Number.isFinite(n)?n:fb;}
  function pct(a,total){const t=num(total);return t>0?Math.round((num(a)/t)*100):0;}
  function scope(value){const raw=String(value||'').toLowerCase();if(raw==='family')return'family';try{const q=new URLSearchParams(location.search);if(q.get('scope')==='family')return'family';}catch(_){}return'friends';}
  function token(){try{if(cfg.getPlayerSessionToken)return String(cfg.getPlayerSessionToken()||'').trim();}catch(_){}return localStorage.getItem('jas_session_token_v11')||localStorage.getItem('jas_session_token_v10')||sessionStorage.getItem('jas_session_token_v11')||sessionStorage.getItem('jas_session_token_v10')||'';}
  function adminToken(){try{if(window.GEJAST_ADMIN_SESSION&&window.GEJAST_ADMIN_SESSION.getToken)return String(window.GEJAST_ADMIN_SESSION.getToken()||'').trim();}catch(_){}return localStorage.getItem('jas_admin_session_v8')||sessionStorage.getItem('jas_admin_session_v8')||'';}
  function headers(){return {'Content-Type':'application/json',apikey:cfg.SUPABASE_PUBLISHABLE_KEY||'',Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY||''}`,Accept:'application/json'};}
  async function parse(res){const txt=await res.text();let data=null;try{data=txt?JSON.parse(txt):null;}catch(_){throw new Error(txt||`HTTP ${res.status}`);}if(!res.ok)throw new Error(data?.message||data?.error||data?.details||data?.hint||`HTTP ${res.status}`);return data;}
  async function rpc(name,payload){if(!cfg.SUPABASE_URL||!cfg.SUPABASE_PUBLISHABLE_KEY)throw new Error('Supabase config ontbreekt.');const raw=await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify(payload||{})}).then(parse);return raw&&raw[name]!==undefined?raw[name]:raw;}
  async function restRows(table,query){
    if(!cfg.SUPABASE_URL||!cfg.SUPABASE_PUBLISHABLE_KEY) return [];
    const url = `${cfg.SUPABASE_URL}/rest/v1/${table}?${query}`;
    try{const rows=await fetch(url,{method:'GET',mode:'cors',cache:'no-store',headers:headers()}).then(parse);return Array.isArray(rows)?rows:[];}catch(_){return [];}
  }
  function marketHref(id){return `./despimarkt_market.html?market_id=${encodeURIComponent(id||'')}${scope()==='family'?'&scope=family':''}`;}
  function pageScope(){return scope();}
  function visibleWalletBalance(data){const w=data?.wallet||{};const balance=num(w.balance_cautes ?? w.balance ?? data?.balance_cautes ?? data?.balance, 100);const ledger=Array.isArray(data?.ledger)?data.ledger:[];return (!ledger.length && balance > 100) ? 100 : balance;}
  function isMarketish(row){return !!(row && typeof row==='object' && (row.market_id||row.id||row.slug||row.title||row.question||row.market_title));}
  function normalizeMarket(row){
    const m=row||{};const id=m.market_id||m.id||m.market_uuid||m.slug||'';
    const poolA=num(m.pool_a??m.outcome_a_pool??m.yes_pool??m.a_pool??m.option_a_pool??m.total_a??0);
    const poolB=num(m.pool_b??m.outcome_b_pool??m.no_pool??m.b_pool??m.option_b_pool??m.total_b??0);
    const total=num(m.total_pool??m.total_pot??m.pot_total??m.market_total??m.total_stake_cautes??(poolA+poolB));
    const status=String(m.status||m.market_status||'open').toLowerCase();
    return Object.assign({},m,{id,market_id:id,title:m.title||m.question||m.market_title||'Market',description:m.description||m.details||m.body||'',outcome_a:m.outcome_a||m.outcome_a_label||m.option_a||m.a_label||'A',outcome_b:m.outcome_b||m.outcome_b_label||m.option_b||m.b_label||'B',pool_a:poolA,pool_b:poolB,total_pool:total,total_pot:total,participant_count:num(m.participant_count??m.participants??m.player_count??0),total_positions:num(m.total_positions??m.position_count??0),status,closes_at:m.closes_at||m.close_at||m.close_at_text||m.ends_at||'',updated_at:m.updated_at||m.last_bet_at||m.created_at||'',badge:m.promotional_badge_text||m.badge||''});
  }
  function addMarkets(out,rows){if(!Array.isArray(rows))return;rows.forEach(r=>{const m=normalizeMarket(r);if(isMarketish(m) && (m.id||m.title))out.push(m);});}
  function extractMarkets(data){
    const out=[];const seen=new Set();
    function walk(node,key=''){
      if(!node || out.length>200)return;
      if(Array.isArray(node)){
        const wanted=/markets?|open_markets|active_markets|items|rows|data/i.test(key);
        const marketRows=node.filter(isMarketish);
        if(wanted||marketRows.length) addMarkets(out,marketRows.length?marketRows:node);
        return;
      }
      if(typeof node==='object'){
        ['markets','open_markets','active_markets','rows','items','data','open','live_markets'].forEach(k=>{if(node[k])walk(node[k],k);});
      }
    }
    if(Array.isArray(data)) walk(data,'markets'); else walk(data||{},'root');
    return out.filter(m=>{const key=String(m.id||m.slug||m.title).toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return true;});
  }
  function normalizePositions(data){
    const rows=data?.positions||data?.bets||data?.my_positions||data?.position_rows||[];
    if(!Array.isArray(rows))return [];
    return rows.map(p=>Object.assign({},p,{market_title:p.market_title||p.title||p.question||'Market',outcome:p.outcome_label||p.outcome||p.outcome_key||p.side||'positie',stake:num(p.stake_cautes??p.stake??p.amount??0),status:p.status||'open'}));
  }
  async function fallbackMarkets(opts={}){
    const sc=encodeURIComponent(scope(opts.scope));const lim=encodeURIComponent(Number(opts.limit||25));
    const filters=[
      `select=*&site_scope=eq.${sc}&status=not.in.(resolved,refunded,deleted,cancelled,void)&order=updated_at.desc.nullslast&limit=${lim}`,
      `select=*&site_scope=eq.${sc}&status=not.in.(resolved,refunded,deleted,cancelled,void)&order=created_at.desc.nullslast&limit=${lim}`,
      `select=*&site_scope=eq.${sc}&order=updated_at.desc.nullslast&limit=${lim}`,
      `select=*&site_scope=eq.${sc}&order=created_at.desc.nullslast&limit=${lim}`
    ];
    for(const q of filters){
      let rows=await restRows('despimarkt_market_totals_view',q); if(rows.length) return rows;
      rows=await restRows('despimarkt_markets',q); if(rows.length) return rows;
    }
    return [];
  }
  async function dashboard(opts={}){
    let data={};let rpcError=null;
    try{data=await rpc(RPC.dashboard,{session_token_input:token()||null,site_scope_input:scope(opts.scope),limit_input:Number(opts.limit||25)});}catch(e){rpcError=e;data={ok:false,error:e.message||String(e)};}
    let markets=extractMarkets(data);
    if(!markets.length){
      const rows=await fallbackMarkets(opts);
      if(rows.length){markets=rows.map(normalizeMarket);data=Object.assign({},data,{markets,open_markets:markets,active_markets:markets,source:(data.source||'')+'+rest_fallback'});}
    }
    if(!markets.length && rpcError) data.error=rpcError.message||String(rpcError);
    return data;
  }
  async function market(id,opts={}){
    let data={};
    try{data=await rpc(RPC.market,{market_id_input:id,session_token_input:token()||null,site_scope_input:scope(opts.scope)});}catch(e){data={ok:false,error:e.message||String(e)};}
    if(!data.market || !Object.keys(data.market||{}).length){
      const rows=await fallbackMarkets({limit:100,scope:opts.scope});
      const found=rows.map(normalizeMarket).find(m=>String(m.id)===String(id)||String(m.slug||'')===String(id));
      if(found)data.market=found;
    }
    return data;
  }
  async function createMarket(input){return rpc(RPC.create,{session_token_input:token(),site_scope_input:scope(input.scope),title_input:input.title,description_input:input.description||'',outcome_a_input:input.outcomeA||'Ja',outcome_b_input:input.outcomeB||'Nee',close_at_input:input.closeAt||null});}
  async function buyPosition(input){return rpc(RPC.buy,{session_token_input:token(),site_scope_input:scope(input.scope),market_id_input:input.marketId,outcome_input:input.outcome,stake_input:Number(input.stake||0)});}
  async function wallet(opts={}){return rpc(RPC.wallet,{session_token_input:token(),site_scope_input:scope(opts.scope),limit_input:Number(opts.limit||50)});}
  async function ladder(opts={}){return rpc(RPC.ladder,{site_scope_input:scope(opts.scope),limit_input:Number(opts.limit||50)});}
  async function stats(opts={}){return rpc(RPC.stats,{site_scope_input:scope(opts.scope)});}
  async function debts(opts={}){return rpc(RPC.debts,{session_token_input:token()||null,site_scope_input:scope(opts.scope),limit_input:Number(opts.limit||50)});}
  async function createDebt(input){return rpc(RPC.createDebt,{session_token_input:token(),site_scope_input:scope(input.scope),target_player_name_input:input.targetPlayer,amount_input:Number(input.amount||0),reason_input:input.reason||'',due_at_input:input.dueAt||null});}
  async function settleDebt(id){return rpc(RPC.settleDebt,{session_token_input:token(),debt_id_input:id});}
  async function adminAudit(opts={}){return rpc(RPC.adminAudit,{admin_session_token_input:adminToken(),site_scope_input:scope(opts.scope),limit_input:Number(opts.limit||50)});}
  async function adminResolve(input){return rpc(RPC.adminResolve,{admin_session_token_input:adminToken(),market_id_input:input.marketId,winning_outcome_input:input.outcome,reason_input:input.reason||'admin resolve'});}
  async function adminRefund(input){return rpc(RPC.adminRefund,{admin_session_token_input:adminToken(),market_id_input:input.marketId,reason_input:input.reason||'admin refund'});}
  async function adminDelete(input){return rpc(RPC.adminDelete,{admin_session_token_input:adminToken(),market_id_input:input.marketId,reason_input:input.reason||'admin delete'});}
  async function adminAdjust(input){return rpc(RPC.adminAdjust,{admin_session_token_input:adminToken(),site_scope_input:scope(input.scope),target_player_name_input:input.playerName,delta_input:Number(input.delta||0),reason_input:input.reason||'admin adjustment'});}
  function marketEmptyHtml(){return '<div class="empty-state"><b>Geen actieve markets teruggekregen.</b><br>De pagina leest nu eerst de v669 dashboard-RPC en probeert daarna de canonical market views/tables. Als er volgens admin wél markets bestaan, run dan de v698 SQL en herlaad hard.</div><div class="row"><a class="btn gold" href="./despimarkt_create.html">Nieuwe market</a><a class="btn alt" href="./despimarkt_market.html">Marketlijst verversen</a></div>';}
  function marketCard(row,opts={}){
    const m=normalizeMarket(row);const status=String(m.status||'open');const id=m.id||m.market_id||'';const total=m.total_pool||m.pool_a+m.pool_b;const admin=opts.admin&&id?`<div class="row market-actions"><button class="btn gold" data-admin-resolve="A" data-market="${esc(id)}">Resolve A</button><button class="btn" data-admin-resolve="B" data-market="${esc(id)}">Resolve B</button><button class="btn alt" data-admin-refund data-market="${esc(id)}">Refund</button><button class="btn bad" data-admin-delete data-market="${esc(id)}">Delete</button></div>`:'';
    return `<article class="market-card market-card-v698" data-market-id="${esc(id)}"><div class="split market-top"><div><div class="market-title">${esc(m.title||'Market')}</div><div class="meta">${esc(m.description||'')}</div></div><span class="pill ${status==='open'||status==='active'?'ok':status==='resolved'?'warn':'bad'}">${esc(status)}</span></div>${m.badge?`<span class="pill warn market-badge">${esc(m.badge)}</span>`:''}<div class="market-metrics"><div class="market-option"><span>${esc(m.outcome_a||'A')}</span><b>${money(m.pool_a)}</b><small>${pct(m.pool_a,total)}%</small></div><div class="market-option"><span>${esc(m.outcome_b||'B')}</span><b>${money(m.pool_b)}</b><small>${pct(m.pool_b,total)}%</small></div><div class="market-option"><span>Pot</span><b>${money(total)}</b><small>${num(m.participant_count)||num(m.total_positions)||0} posities</small></div></div><div class="split market-foot"><div class="meta">${m.closes_at?`Sluit: ${esc(m.closes_at)}`:'Open market'}${m.updated_at?` · bijgewerkt ${esc(m.updated_at)}`:''}</div><a class="btn alt" href="${marketHref(id)}">Open market</a></div>${admin}</article>`;
  }
  function renderMarkets(rows,target,opts={}){const el=typeof target==='string'?qs(target):target;if(!el)return;const list=Array.isArray(rows)?rows.map(normalizeMarket):[];el.innerHTML=list.length?list.map(m=>marketCard(m,opts)).join(''):marketEmptyHtml();}
  function renderPositions(rows,target){const el=typeof target==='string'?qs(target):target;if(!el)return;el.innerHTML=(rows&&rows.length)?rows.map(p=>`<div class="ledger-row split"><div><b>${esc(p.market_title||'Market')}</b><div class="meta">${esc(p.player_name||'Speler')} · ${esc(p.outcome)} · ${esc(p.status)}</div></div><b>${money(p.stake)}</b></div>`).join(''):'<div class="empty-state">Nog geen actieve posities/bets gevonden.</div>';}
  function renderWallet(data,target){const el=typeof target==='string'?qs(target):target;if(!el)return;const w=data.wallet||{};const ledger=Array.isArray(data.ledger)?data.ledger:[];el.innerHTML=`<div class="panel tinted-gold"><div class="eyebrow">Saldo</div><div class="balance">${money(visibleWalletBalance(data))}</div><div class="meta">${esc(w.player_name||data.player_name||'')}</div></div><div class="rowlist">${ledger.map(r=>`<div class="ledger-row split"><div><b>${esc(r.reason||'ledger')}</b><div class="meta">${esc(r.created_at||'')}</div></div><b>${money(r.delta_cautes??r.delta)}</b></div>`).join('')||'<div class="empty-state">Nog geen ledger.</div>'}</div>`;}
  async function loadHubPage(){const status=qs('status');try{if(status)status.textContent='Beurs laden...';const data=await dashboard({limit:25});const markets=extractMarkets(data);const positions=normalizePositions(data);if(qs('heroCoins'))qs('heroCoins').textContent=money(visibleWalletBalance(data));if(qs('heroLeader'))qs('heroLeader').textContent=data.leaderboard?.[0]?.player_name||'--';if(qs('heroMarkets'))qs('heroMarkets').textContent=String(data.totals?.open_markets??markets.filter(m=>!['resolved','refunded','deleted','cancelled','void'].includes(String(m.status||'open'))).length);renderMarkets(markets,qs('marketList')||qs('marketsBox')||qs('openMarketsBox'));renderPositions(positions,qs('positionsBox')||qs('betsBox'));if(qs('walletBox'))renderWallet(data,qs('walletBox'));if(status)status.textContent=markets.length?`Beurs geladen: ${markets.length} actieve market(s).`:(data.error?`Geen markets geladen: ${data.error}`:'Geen actieve markets teruggekregen.');}catch(e){if(status)status.textContent=e.message||String(e);}}
  function renderMarketDetail(data,box,statusEl,id){const m=normalizeMarket(data.market||{});const pos=normalizePositions({positions:data.positions||[]});if(!m.id&&!m.title){box.innerHTML=marketEmptyHtml();return;}box.innerHTML=`<section class="panel market-detail"><div class="split"><div><h1>${esc(m.title)}</h1><p>${esc(m.description||'')}</p></div><span class="pill ${m.status==='open'||m.status==='active'?'ok':'warn'}">${esc(m.status)}</span></div><div class="grid two market-buy-grid"><div class="panel tinted-gold"><h2>${esc(m.outcome_a)}</h2><div class="balance">${money(m.pool_a||0)}</div><button class="btn gold" data-buy="A">Koop A</button></div><div class="panel tinted-sky"><h2>${esc(m.outcome_b)}</h2><div class="balance">${money(m.pool_b||0)}</div><button class="btn" data-buy="B">Koop B</button></div></div><div class="field"><label>Inzet</label><input id="stakeInput" type="number" min="1" step="1" value="25"></div></section><section class="panel"><h2>Posities</h2>${pos.map(p=>`<div class="ledger-row split"><span>${esc(p.player_name)} · ${esc(p.outcome)} · ${esc(p.status)}</span><b>${money(p.stake)}</b></div>`).join('')||'<div class="empty-state">Nog geen posities.</div>'}</section>`;box.querySelectorAll('[data-buy]').forEach(btn=>btn.onclick=async()=>{try{if(statusEl)statusEl.textContent='Kopen...';await buyPosition({marketId:id,outcome:btn.dataset.buy,stake:Number(qs('stakeInput').value||0)});if(statusEl)statusEl.textContent='Positie gekocht.';const fresh=await market(id);renderMarketDetail(fresh,box,statusEl,id);}catch(e){if(statusEl)statusEl.textContent=e.message||String(e);}});}
  async function loadMarketPage(){const id=new URLSearchParams(location.search).get('market_id')||new URLSearchParams(location.search).get('id');const box=qs('marketBox'),status=qs('status');try{if(!id){const data=await dashboard({limit:50});renderMarkets(extractMarkets(data),box);if(status)status.textContent='Marketlijst geladen.';return;}const data=await market(id);renderMarketDetail(data,box,status,id);}catch(e){if(status)status.textContent=e.message||String(e);}}
  function loadCreatePage(){const form=qs('marketForm'),status=qs('status');if(!form)return;form.onsubmit=async(ev)=>{ev.preventDefault();try{if(status)status.textContent='Market maken...';const res=await createMarket({title:qs('titleInput').value,description:qs('descriptionInput').value,outcomeA:qs('outcomeAInput').value,outcomeB:qs('outcomeBInput').value,closeAt:qs('closeAtInput').value||null});const id=res?.market_id||res?.id||res?.market?.market_id||res?.market?.id;if(status)status.textContent='Market gemaakt.';if(id)location.href=marketHref(id);}catch(e){if(status)status.textContent=e.message||String(e);}};}
  async function loadWalletPage(){const status=qs('status');try{const data=await wallet({limit:100});renderWallet(data,qs('walletBox'));if(status)status.textContent='Wallet geladen.';}catch(e){if(status)status.textContent=e.message||String(e);}}
  async function loadDebtsPage(){const status=qs('status'),box=qs('debtBox'),form=qs('debtForm');async function refresh(){const data=await debts({limit:100});const rows=data.debts||data.rows||[];if(box)box.innerHTML=rows.length?rows.map(d=>`<div class="debt-row split"><div><b>${esc(d.target_player_name||d.debtor_name||d.player_name||'Speler')}</b><div class="meta">${esc(d.reason||'')}</div></div><button class="btn alt" data-settle="${esc(d.id||d.debt_id)}">Settle ${money(d.amount||d.amount_cautes)}</button></div>`).join(''):'<div class="empty-state">Geen open schulden.</div>';if(status)status.textContent='Schulden geladen.';}document.addEventListener('click',async(ev)=>{const b=ev.target.closest('[data-settle]');if(!b)return;try{await settleDebt(b.dataset.settle);await refresh();}catch(e){if(status)status.textContent=e.message||String(e);}});if(form)form.onsubmit=async(ev)=>{ev.preventDefault();try{await createDebt({targetPlayer:qs('targetInput').value,amount:qs('amountInput').value,reason:qs('reasonInput').value,dueAt:qs('dueAtInput').value||null});form.reset();await refresh();}catch(e){if(status)status.textContent=e.message||String(e);}};await refresh();}
  async function loadLadderPage(){try{const data=await ladder({limit:100});const rows=data.ladder||data.rows||data.leaderboard||[];const box=qs('ladderBox');if(box)box.innerHTML=rows.length?rows.map((r,i)=>`<div class="leader-row split"><span><b>#${i+1} ${esc(r.player_name||r.name)}</b><div class="meta">${esc(r.markets_joined||0)} markets · ${esc(r.markets_won||0)} wins</div></span><b>${money(r.balance_cautes??r.balance)}</b></div>`).join(''):'<div class="empty-state">Nog geen ladder.</div>';}catch(e){const box=qs('ladderBox');if(box)box.innerHTML=`<div class="empty-state">${esc(e.message||String(e))}</div>`;}}
  async function loadStatsPage(){try{const data=await stats({});const box=qs('statsBox');if(box)box.innerHTML=`<pre class="panel">${esc(JSON.stringify(data,null,2))}</pre>`;}catch(e){const box=qs('statsBox');if(box)box.innerHTML=`<div class="empty-state">${esc(e.message||String(e))}</div>`;}}
  async function loadAdminPage(){const status=qs('adminStatus')||qs('status');async function refresh(){const data=await adminAudit({limit:100});if(qs('adminRaw'))qs('adminRaw').textContent=JSON.stringify(data,null,2);renderMarkets(extractMarkets(data),qs('adminMarkets'),{admin:true});if(qs('walletAdminList'))qs('walletAdminList').innerHTML=(data.wallets||data.leaderboard||[]).map(w=>`<div class="wallet-row split"><b>${esc(w.player_name)}</b><span>${money(w.balance_cautes??w.balance)}</span></div>`).join('')||'<div class="empty-state">Geen wallets.</div>';if(status)status.textContent='Admin geladen.';}document.addEventListener('click',async(ev)=>{const a=ev.target.closest('[data-admin-resolve],[data-admin-refund],[data-admin-delete]');if(!a)return;try{const marketId=a.getAttribute('data-market');if(a.dataset.adminResolve)await adminResolve({marketId,outcome:a.dataset.adminResolve});else if(a.dataset.adminRefund!==undefined)await adminRefund({marketId});else await adminDelete({marketId});await refresh();}catch(e){if(status)status.textContent=e.message||String(e);}});const form=qs('adjustForm');if(form)form.onsubmit=async(ev)=>{ev.preventDefault();try{await adminAdjust({playerName:qs('adjustPlayerName').value,delta:qs('adjustDelta').value,reason:qs('adjustReason').value});await refresh();}catch(e){if(status)status.textContent=e.message||String(e);}};await refresh();}
  window.GEJAST_DESPIMARKT={VERSION,RPC,scope,token,adminToken,rpc,dashboard,market,createMarket,buyPosition,wallet,ladder,stats,debts,createDebt,settleDebt,adminAudit,adminResolve,adminRefund,adminDelete,adminAdjust,normalizeMarket,extractMarkets,renderMarkets,renderPositions,renderWallet,loadHubPage,loadCreatePage,loadMarketPage,loadWalletPage,loadDebtsPage,loadLadderPage,loadStatsPage,loadAdminPage,marketHref,money,pageScope};
})();
