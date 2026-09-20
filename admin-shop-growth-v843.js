(() => {
  'use strict';
  const ENDPOINT='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-admin-analytics-v843';
  const cfg=window.GEJAST_CONFIG||{};
  const API_KEY=cfg.SUPABASE_PUBLISHABLE_KEY||'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number(v||0);
  const int=v=>new Intl.NumberFormat('nl-NL',{maximumFractionDigits:0}).format(n(v));
  const dec=(v,d=1)=>new Intl.NumberFormat('nl-NL',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n(v));
  const eur=c=>new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(n(c)/100);
  const pct=v=>v==null?'—':(100*n(v)).toFixed(1)+'%';
  const dt=v=>{if(!v)return '—';try{return new Intl.DateTimeFormat('nl-NL',{dateStyle:'short',timeStyle:'short'}).format(new Date(v));}catch{return String(v)}};
  const token=()=>window.GEJAST_ADMIN_SESSION?.getToken?.()||'';
  let state=null;

  async function api(action,extra={}){
    const t=token();if(!t)throw new Error('No valid admin session.');
    const res=await fetch(ENDPOINT,{method:'POST',cache:'no-store',headers:{apikey:API_KEY,Authorization:'Bearer '+API_KEY,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({action,admin_session_token:t,...extra})});
    const p=await res.json().catch(()=>({}));
    if(res.status===401){window.GEJAST_ADMIN_SESSION?.clearBundle?.();window.GEJAST_ADMIN_SESSION?.redirectToAdminLogin?.('session_invalid','admin_shop_analytics.html');}
    if(!res.ok||!p?.ok)throw new Error(p?.detail||p?.error||('HTTP '+res.status));
    return p;
  }
  function setAdvancedStatus(msg,tone=''){const el=$('advancedStatus');if(el){el.textContent=msg;el.className='status '+tone;}}
  function deltaCell(m){
    if(!m)return '<span class="muted">—</span>';
    const rate=m.delta_rate,cls=rate==null?'':rate>0?'good':'bad',arrow=rate==null?'':rate>0?'▲ ':'▼ ';
    return '<strong>'+esc(String(typeof m.current==='number'?int(m.current):m.current))+'</strong><span class="'+cls+'">'+arrow+(rate==null?'—':Math.abs(rate*100).toFixed(1)+'%')+'</span><small>prev '+int(m.previous)+'</small>';
  }
  function moneyDeltaCell(m){
    if(!m)return '<span class="muted">—</span>';
    const rate=m.delta_rate,cls=rate==null?'':rate>0?'good':'bad',arrow=rate==null?'':rate>0?'▲ ':'▼ ';
    return '<strong>'+eur(m.current)+'</strong><span class="'+cls+'">'+arrow+(rate==null?'—':Math.abs(rate*100).toFixed(1)+'%')+'</span><small>prev '+eur(m.previous)+'</small>';
  }
  function renderComparison(){
    const m=state?.growth?.comparison?.metrics||{};
    const rows=[
      ['Visitors',m.visitors,false],['Sessions',m.sessions,false],['Product views',m.product_views,false],['Adds to cart',m.add_to_cart,false],
      ['Checkout starts',m.checkout_starts,false],['Orders created',m.orders_created,false],['Verified orders',m.paid_orders,false],
      ['Recognized sales',m.recognized_sales_cents,true],['Known contribution',m.known_contribution_cents,true]
    ];
    $('comparisonGrid').innerHTML=rows.map(([label,x,money])=>'<div class="compare-card"><span>'+esc(label)+'</span><div>'+ (money?moneyDeltaCell(x):deltaCell(x)) +'</div></div>').join('');
  }
  function renderSummaries(){
    const s=state?.growth?.summaries||{},w=s.week||{},m=s.month||{};
    $('businessSummary').innerHTML=[
      '<div class="summary-card"><span>Last 7 days</span><strong>'+int(w.paid_orders)+' paid · '+eur(w.sales_cents)+'</strong><small>'+int(w.units)+' units from '+int(w.orders)+' created orders</small></div>',
      '<div class="summary-card"><span>This month</span><strong>'+int(m.paid_orders)+' paid · '+eur(m.sales_cents)+'</strong><small>'+int(m.units)+' units from '+int(m.orders)+' created orders</small></div>',
      '<div class="summary-card"><span>Selected-range conversion</span><strong>'+pct(s.current_conversion_rate)+'</strong><small>created orders / sessions</small></div>',
      '<div class="summary-card"><span>Repeat-customer rate</span><strong>'+pct(s.repeat_customer_rate)+'</strong><small>all customers in selected range</small></div>'
    ].join('');
    const f=state?.growth?.forecast||{};
    $('forecastCards').innerHTML=[
      ['Daily sales run-rate',eur(f.daily_sales_run_rate_cents)],
      ['Daily orders run-rate',dec(f.daily_orders_run_rate,2)],
      ['Daily units run-rate',dec(f.daily_units_run_rate,2)],
      ['Projected extra sales this month',eur(f.projected_additional_sales_cents)],
      ['Projected extra orders',dec(f.projected_additional_orders,1)],
      ['Projected extra units',dec(f.projected_additional_units,1)]
    ].map(([l,v])=>'<div class="summary-card"><span>'+esc(l)+'</span><strong>'+esc(v)+'</strong></div>').join('');
  }
  function renderWaterfall(){
    const d=state?.data||{},o=d.orders||{},l=d.ledger||{},spend=(state?.growth?.campaign_spend||[]).reduce((s,r)=>s+n(r.amount_cents),0);
    const rows=[
      ['Recognized sales',n(o.recognized_sales_cents),1],
      ['Product COGS',n(o.paid_known_product_cost_cents),-1],
      ['Supplier shipping',n(o.paid_known_shipping_cost_cents),-1],
      ['Import allowance',n(o.paid_import_allowance_cents),-1],
      ['General ledger costs',n(l.costs_cents),-1],
      ['Campaign spend',spend,-1],
      ['Ledger income',n(l.income_cents),1]
    ];
    let running=0;
    $('waterfallRows').innerHTML=rows.map(([label,val,sign])=>{running+=sign*val;return '<div class="waterfall-row"><span>'+esc(label)+'</span><strong class="'+(sign>0?'good':'bad')+'">'+(sign>0?'+':'−')+eur(val)+'</strong><small>running '+eur(running)+'</small></div>'}).join('')+
      '<div class="waterfall-row total"><span>Known operating result</span><strong>'+eur(running)+'</strong><small>before income tax; unknown historical costs remain excluded</small></div>';
  }
  function renderOpportunities(){
    const rows=state?.growth?.product_opportunities||[];
    $('opportunityRows').innerHTML=rows.length?rows.map(r=>'<tr><td><strong>'+esc(r.product_name)+'</strong><div class="muted">'+esc(r.collection||'')+'</div></td><td><span class="pill">'+esc(r.label)+'</span></td><td class="num">'+int(r.views)+'</td><td class="num">'+pct(r.view_to_cart)+'</td><td class="num">'+pct(r.view_to_paid)+'</td><td class="num">'+(r.current_margin_rate==null?'—':pct(r.current_margin_rate))+'</td><td>'+esc(r.reason)+'</td></tr>').join(''):'<tr><td colspan="7" class="muted">Not enough traffic to classify products yet.</td></tr>';
    const devices=state?.growth?.device_funnel||[],sources=state?.growth?.source_funnel||[];
    $('deviceFunnelRows').innerHTML=devices.length?devices.map(r=>'<tr><td>'+esc(r.device)+'</td><td class="num">'+int(r.sessions)+'</td><td class="num">'+int(r.product_views)+'</td><td class="num">'+int(r.adds)+'</td><td class="num">'+int(r.checkout_starts)+'</td><td class="num">'+int(r.orders_created)+'</td><td class="num">'+pct(r.session_to_order)+'</td></tr>').join(''):'<tr><td colspan="7" class="muted">No device funnel data.</td></tr>';
    $('sourceFunnelRows').innerHTML=sources.length?sources.slice(0,30).map(r=>'<tr><td>'+esc(r.source)+'</td><td class="num">'+int(r.sessions)+'</td><td class="num">'+int(r.product_views)+'</td><td class="num">'+int(r.adds)+'</td><td class="num">'+int(r.checkout_starts)+'</td><td class="num">'+int(r.orders_created)+'</td><td class="num">'+pct(r.session_to_order)+'</td></tr>').join(''):'<tr><td colspan="7" class="muted">No acquisition funnel data.</td></tr>';
  }
  function renderMarketing(){
    const rows=state?.growth?.campaign_performance||[];
    $('campaignRows').innerHTML=rows.length?rows.map(r=>'<tr><td>'+esc(r.source)+'</td><td>'+esc(r.medium||'—')+'</td><td>'+esc(r.campaign)+'</td><td class="num">'+eur(r.spend_cents)+'</td><td class="num">'+int(r.created_orders)+'</td><td class="num">'+int(r.verified_orders)+'</td><td class="num">'+eur(r.recognized_sales_cents)+'</td><td class="num">'+(r.roas==null?'—':dec(r.roas,2)+'×')+'</td><td class="num">'+(r.cac_cents==null?'—':eur(r.cac_cents))+'</td></tr>').join(''):'<tr><td colspan="9" class="muted">No campaign spend or attributed orders in this range.</td></tr>';
    const spend=state?.growth?.campaign_spend||[];
    $('campaignSpendRows').innerHTML=spend.length?spend.map(r=>'<tr><td>'+esc(r.occurred_on)+'</td><td>'+esc(r.utm_source||'direct')+'</td><td>'+esc(r.utm_medium||'')+'</td><td>'+esc(r.utm_campaign||'')+'</td><td>'+esc(r.note||'')+'</td><td class="num">'+eur(r.amount_cents)+'</td><td><button class="alt" data-delete-campaign="'+r.id+'">Delete</button></td></tr>').join(''):'<tr><td colspan="7" class="muted">No campaign spend entered.</td></tr>';
  }
  function renderRetention(){
    const r=state?.growth?.retention||{},rates=r.rates||{},eligible=r.eligible||{};
    $('retentionCards').innerHTML=[30,60,90,180].map(d=>'<div class="summary-card"><span>'+d+'-day repeat</span><strong>'+pct(rates[d])+'</strong><small>'+int(eligible[d])+' eligible customers</small></div>').join('')+
      '<div class="summary-card"><span>Median repeat gap</span><strong>'+(r.median_days_between_orders==null?'—':dec(r.median_days_between_orders,1)+' d')+'</strong></div>'+
      '<div class="summary-card"><span>P90 repeat gap</span><strong>'+(r.p90_days_between_orders==null?'—':dec(r.p90_days_between_orders,1)+' d')+'</strong></div>';
  }
  function renderBundles(){
    const rows=state?.growth?.bundle_suggestions||[];
    $('bundleRows').innerHTML=rows.length?rows.map(r=>'<tr><td>'+esc(r.product_a)+'</td><td>'+esc(r.product_b)+'</td><td class="num">'+int(r.paid_orders)+'</td><td class="num">'+(r.current_pair_price_cents==null?'—':eur(r.current_pair_price_cents))+'</td><td class="num">'+(r.max_discount_for_20pct_margin_cents==null?'—':eur(r.max_discount_for_20pct_margin_cents))+'</td><td class="num">'+(r.example_bundle_price_cents==null?'—':eur(r.example_bundle_price_cents))+'</td></tr>').join(''):'<tr><td colspan="6" class="muted">No verified multi-product baskets yet.</td></tr>';
    const products=state?.growth?.margin_simulator_products||[];
    $('simProduct').innerHTML='<option value="">Choose product…</option>'+products.map((p,i)=>'<option value="'+i+'">'+esc(p.product_name)+'</option>').join('');
    $('simVariant').innerHTML='<option value="">Choose variant…</option>';
  }
  function updateSimulator(){
    const products=state?.growth?.margin_simulator_products||[],p=products[Number($('simProduct').value)],variants=p?.variants||[],v=variants[Number($('simVariant').value)];
    const proposed=Math.round(Number($('simPrice').value||0)*100),qty=Math.max(1,Math.round(Number($('simQty').value||1)));
    if(!v||!Number.isFinite(proposed)||proposed<=0){$('simResult').innerHTML='<span class="muted">Choose a variant and proposed retail price.</span>';return}
    const cost=n(v.production_cost_cents),profit=(proposed-cost)*qty,rate=proposed?((proposed-cost)/proposed):null;
    $('simResult').innerHTML='<div class="summary-card"><span>Production cost</span><strong>'+eur(cost*qty)+'</strong></div><div class="summary-card"><span>Gross product profit</span><strong>'+eur(profit)+'</strong></div><div class="summary-card"><span>Gross margin</span><strong>'+pct(rate)+'</strong></div><div class="summary-card"><span>Revenue at '+qty+' units</span><strong>'+eur(proposed*qty)+'</strong></div>';
  }
  function renderShippingAndSla(){
    const rows=state?.growth?.shipping_leakage||[];
    $('shippingLeakageRows').innerHTML=rows.length?rows.map(r=>'<tr><td><code>'+esc(String(r.order_id).slice(0,8))+'…</code></td><td>'+esc(r.payment_reference||'')+'</td><td>'+esc(r.country||'—')+'</td><td class="num">'+eur(r.shipping_revenue_cents)+'</td><td class="num">'+(r.supplier_shipping_cost_cents==null?'?':eur(r.supplier_shipping_cost_cents))+'</td><td class="num '+(n(r.shipping_margin_cents)<0?'bad':'good')+'">'+(r.shipping_margin_cents==null?'?':eur(r.shipping_margin_cents))+'</td></tr>').join(''):'<tr><td colspan="6" class="muted">No verified shipping economics in this range.</td></tr>';
    const s=state?.growth?.sla||{};
    const cards=[
      ['Payment p50',s.payment?.p50_hours==null?'—':dec(s.payment.p50_hours,1)+' h','p90 '+(s.payment?.p90_hours==null?'—':dec(s.payment.p90_hours,1)+' h')],
      ['Paid ≤24h',pct(s.payment?.within_24h),'≤1h '+pct(s.payment?.within_1h)+' · ≤6h '+pct(s.payment?.within_6h)],
      ['Production p50',s.production?.p50_hours==null?'—':dec(s.production.p50_hours,1)+' h','p90 '+(s.production?.p90_hours==null?'—':dec(s.production.p90_hours,1)+' h')],
      ['Production ≤12h',pct(s.production?.within_12h),'≤1h '+pct(s.production?.within_1h)+' · ≤4h '+pct(s.production?.within_4h)],
      ['Ship p50',s.shipping?.p50_days==null?'—':dec(s.shipping.p50_days,1)+' d','p90 '+(s.shipping?.p90_days==null?'—':dec(s.shipping.p90_days,1)+' d')],
      ['Ship ≤10d',pct(s.shipping?.within_10d),'≤3d '+pct(s.shipping?.within_3d)+' · ≤5d '+pct(s.shipping?.within_5d)]
    ];
    $('slaCards').innerHTML=cards.map(([l,v,sm])=>'<div class="summary-card"><span>'+esc(l)+'</span><strong>'+esc(v)+'</strong><small>'+esc(sm)+'</small></div>').join('');
  }
  function renderHistory(){
    const alerts=state?.growth?.supplier_cost_alerts||[];
    $('costAlertRows').innerHTML=alerts.length?alerts.map(r=>'<tr><td>'+dt(r.captured_at)+'</td><td>'+esc(r.product_name)+'</td><td>'+esc(r.size||'')+'</td><td class="num '+(n(r.production_cost_change_cents)>0?'bad':'good')+'">'+(r.production_cost_change_cents==null?'—':(n(r.production_cost_change_cents)>=0?'+':'')+eur(r.production_cost_change_cents))+'</td><td class="num">'+(n(r.retail_change_cents)>=0?'+':'')+eur(r.retail_change_cents)+'</td><td class="num">'+(r.current_margin_cents==null?'—':eur(r.current_margin_cents))+'</td></tr>').join(''):'<tr><td colspan="6" class="muted">No price/cost changes recorded yet.</td></tr>';
    const hist=state?.growth?.price_cost_history||[];
    $('historyRows').innerHTML=hist.length?hist.slice(0,200).map(r=>'<tr><td>'+dt(r.captured_at)+'</td><td>'+esc(r.product_name)+'</td><td>'+esc(r.size||'')+'</td><td class="num">'+eur(r.retail_cents)+'</td><td class="num">'+(r.production_cost_cents==null?'?':eur(r.production_cost_cents))+'</td><td class="num">'+(r.gross_margin_cents==null?'?':eur(r.gross_margin_cents))+'</td><td class="num">'+(r.fx_usd_eur==null?'—':dec(r.fx_usd_eur,4))+'</td><td>'+esc((r.changed_fields||[]).join(', '))+'</td></tr>').join(''):'<tr><td colspan="8" class="muted">History begins with the first v843 cost refresh.</td></tr>';
    const fx=state?.growth?.fx_history||[];
    $('fxRows').innerHTML=fx.length?fx.slice(0,60).map((r,i)=>{const next=fx[i+1],d=next?100*(n(r.fx_usd_eur)-n(next.fx_usd_eur))/n(next.fx_usd_eur):null;return '<tr><td>'+dt(r.captured_at)+'</td><td class="num">'+dec(r.fx_usd_eur,5)+'</td><td class="num">'+(d==null?'—':(d>=0?'+':'')+d.toFixed(2)+'%')+'</td></tr>'}).join(''):'<tr><td colspan="3" class="muted">FX history begins with v843 cost snapshots.</td></tr>';
  }
  function healthBadge(ok,label,detail){return '<div class="health-item '+(ok?'ok':'warn')+'"><strong>'+esc(label)+'</strong><span>'+esc(detail||'')+'</span></div>'}
  function renderHealth(){
    const h=state?.growth?.health||{},q=state?.growth?.data_quality||[],a=state?.growth?.anomalies||[];
    $('healthGrid').innerHTML=[
      healthBadge(!h.catalog_error,'Catalog cache',h.catalog_generated_at?'updated '+dt(h.catalog_generated_at):'not generated'),
      healthBadge(!h.cost_cache_stale,'Cost cache',h.cost_cache_generated_at?'updated '+dt(h.cost_cache_generated_at):'not generated'),
      healthBadge(!!h.last_shop_event_at,'Telemetry',h.last_shop_event_at?'last '+dt(h.last_shop_event_at):'no events'),
      healthBadge(h.payment_enabled,'Payments',(h.payment_provider||'unknown')+(h.payment_enabled?' enabled':' disabled')),
      healthBadge(h.email_configured,'Email',h.email_configured?'configured':'not configured'),
      healthBadge(h.production_connection_configured,'Production connection',h.production_connection_configured?'configured':'not configured'),
      healthBadge(!h.latest_webhook_error,'Latest webhook',h.latest_webhook_at?dt(h.latest_webhook_at):'no webhook events'),
      healthBadge(h.failed_admin_logins_30d<5,'Admin login security',int(h.failed_admin_logins_30d)+' failed / 30d')
    ].join('');
    $('qualityRowsV843').innerHTML=q.map(r=>'<tr><td>'+esc(r.key.replaceAll('_',' '))+'</td><td class="num">'+int(r.count)+'</td><td><span class="pill">'+esc(r.severity)+'</span></td></tr>').join('');
    $('anomalyRows').innerHTML=a.length?a.map(r=>'<div class="attention-item '+esc(r.severity||'medium')+'"><div class="meta"><span>'+esc(r.kind||'anomaly')+'</span><span>'+esc(r.severity||'')+'</span></div><div>'+esc(r.label||'')+(r.delta_rate!=null?' · '+(r.delta_rate>=0?'+':'')+(100*r.delta_rate).toFixed(1)+'% vs previous period':'')+'</div></div>').join(''):'<div class="muted">No material anomalies detected against the previous equal-length period.</div>';
  }
  const centers={NL:[5.3,52.2],BE:[4.7,50.8],DE:[10.4,51.1],FR:[2.2,46.2],GB:[-2.5,54.2],US:[-98.5,39.8],CA:[-106.3,56.1],AU:[133.8,-25.3],NZ:[174.8,-41.5],ES:[-3.7,40.4],IT:[12.6,42.8],PT:[-8.2,39.6],SE:[15,62],NO:[8,61],DK:[9.5,56],PL:[19.1,52.1],AT:[14.1,47.6],CH:[8.2,46.8],IE:[-8,53.4],CZ:[15.5,49.8]};
  function renderGeo(){
    const rows=state?.data?.countries||[],max=Math.max(1,...rows.map(r=>n(r.orders)));
    $('geoMap').innerHTML=rows.map(r=>{const c=centers[String(r.country||'').toUpperCase()];if(!c)return '';const x=((c[0]+180)/360*100),y=((90-c[1])/180*100),s=10+22*Math.sqrt(n(r.orders)/max);return '<div class="geo-dot" style="left:'+x+'%;top:'+y+'%;width:'+s+'px;height:'+s+'px" title="'+esc(r.country)+': '+int(r.orders)+' orders · '+eur(r.paid_sales_cents)+'"><span>'+esc(r.country)+'</span></div>'}).join('');
    $('geoList').innerHTML=rows.length?rows.map(r=>'<li><span>'+esc(r.country)+'</span><strong>'+int(r.orders)+' · '+eur(r.paid_sales_cents)+'</strong></li>').join(''):'<li class="muted">No country data.</li>';
  }
  function renderHeatmap(){
    const rows=state?.growth?.hour_day_heatmap||[],days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],map=new Map(rows.map(r=>[r.weekday+'|'+r.hour,r])),max=Math.max(1,...rows.map(r=>n(r.sessions)+n(r.orders)*2));
    let html='<div class="heat-corner"></div>'+Array.from({length:24},(_,h)=>'<div class="heat-hour">'+String(h).padStart(2,'0')+'</div>').join('');
    for(const d of days){html+='<div class="heat-day">'+d+'</div>';for(let h=0;h<24;h++){const r=map.get(d+'|'+h)||{},score=n(r.sessions)+n(r.orders)*2,alpha=score?Math.max(.12,score/max):.03;html+='<div class="heat-cell" style="--heat:'+alpha+'" title="'+d+' '+String(h).padStart(2,'0')+':00 · '+int(r.sessions)+' sessions · '+int(r.orders)+' paid orders · '+eur(r.sales_cents)+'"></div>'}}
    $('heatmap').innerHTML=html;
  }
  function renderLifecycle(){
    const rows=state?.growth?.product_lifecycle||[],agg=new Map();
    for(const r of rows){const k=r.product_name,a=agg.get(k)||{product_name:k,days:new Set(),views:0,adds:0,paid_units:0,revenue:0,last_day:''};a.days.add(r.day);a.views+=n(r.views);a.adds+=n(r.adds);a.paid_units+=n(r.paid_units);a.revenue+=n(r.paid_revenue_cents);if(r.day>a.last_day)a.last_day=r.day;agg.set(k,a)}
    const out=[...agg.values()].sort((a,b)=>b.revenue-a.revenue||b.views-a.views);
    $('lifecycleRows').innerHTML=out.length?out.map(r=>'<tr><td>'+esc(r.product_name)+'</td><td class="num">'+int(r.days.size)+'</td><td class="num">'+int(r.views)+'</td><td class="num">'+int(r.adds)+'</td><td class="num">'+int(r.paid_units)+'</td><td class="num">'+eur(r.revenue)+'</td><td>'+esc(r.last_day)+'</td></tr>').join(''):'<tr><td colspan="7" class="muted">No lifecycle data in this range.</td></tr>';
  }
  function renderGoals(){
    const rows=state?.growth?.goals||[];
    const fmt=(r)=>r.metric.includes('_cents')?eur(r.target_value):r.metric.includes('rate')?pct(r.target_value):int(r.target_value);
    const cur=(r)=>r.metric.includes('_cents')?eur(r.current_value):r.metric.includes('rate')?pct(r.current_value):int(r.current_value);
    $('goalRows').innerHTML=rows.length?rows.map(r=>'<tr><td>'+esc(r.period_month)+'</td><td>'+esc(r.metric.replaceAll('_',' '))+'</td><td class="num">'+fmt(r)+'</td><td class="num">'+cur(r)+'</td><td><div class="goal-track"><div style="width:'+Math.min(100,Math.max(0,100*n(r.progress)))+'%"></div></div><small>'+pct(r.progress)+'</small></td><td><button class="alt" data-delete-goal="'+r.id+'">Delete</button></td></tr>').join(''):'<tr><td colspan="6" class="muted">No goals configured.</td></tr>';
  }
  function renderAnnotations(){
    const rows=state?.growth?.annotations||[];
    $('annotationRows').innerHTML=rows.length?rows.map(r=>'<tr><td>'+dt(r.occurred_at)+'</td><td>'+esc(r.category)+'</td><td><strong>'+esc(r.title)+'</strong><div class="muted">'+esc(r.note||'')+'</div></td><td><button class="alt" data-delete-annotation="'+r.id+'">Delete</button></td></tr>').join(''):'<tr><td colspan="4" class="muted">No annotations in this range.</td></tr>';
  }
  function renderSecurity(){
    const s=state?.growth?.security||{},sessions=s.active_sessions||[],logins=s.recent_login_attempts||[];
    $('securityCards').innerHTML=[
      ['Active admin sessions',int(sessions.length)],['Failed logins / 30d',int(s.failed_logins_30d)],['Successful logins / 30d',int(s.successful_logins_30d)]
    ].map(([l,v])=>'<div class="summary-card"><span>'+esc(l)+'</span><strong>'+esc(v)+'</strong></div>').join('');
    $('sessionRows').innerHTML=sessions.length?sessions.map(r=>'<tr><td>admin #'+esc(r.admin_id)+'</td><td>'+dt(r.created_at)+'</td><td>'+dt(r.last_used_at)+'</td><td>'+dt(r.expires_at)+'</td></tr>').join(''):'<tr><td colspan="4" class="muted">No active sessions.</td></tr>';
    $('loginRows').innerHTML=logins.length?logins.slice(0,50).map(r=>'<tr><td>'+dt(r.attempted_at)+'</td><td>'+esc(r.username)+'</td><td><span class="pill '+(r.success?'good':'bad')+'">'+(r.success?'success':'failed')+'</span></td></tr>').join(''):'<tr><td colspan="3" class="muted">No recent login attempts.</td></tr>';
  }
  function csvEscape(v){const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s}
  function downloadCsv(name,rows){
    if(!rows?.length){setAdvancedStatus('Nothing to export for '+name+'.','warn');return}
    const keys=[...new Set(rows.flatMap(r=>Object.keys(r||{})))],lines=[keys.join(',')];
    for(const row of rows)lines.push(keys.map(k=>csvEscape(typeof row[k]==='object'?JSON.stringify(row[k]):row[k])).join(','));
    const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='bruis-shop-'+name+'-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  function doExport(){
    const type=$('exportType').value,g=state?.growth||{},d=state?.data||{};
    const sources={products:d.products||[],orders:d.order_economics||[],ledger:d.ledger?.entries||[],daily:d.daily||[],campaigns:g.campaign_performance||[],attribution:state?.intelligence?.attribution||[],lifecycle:g.product_lifecycle||[],price_history:g.price_cost_history||[],shipping_leakage:g.shipping_leakage||[],annotations:g.annotations||[]};
    downloadCsv(type,sources[type]||[]);
  }
  function renderAll(){
    if(!state)return;
    renderComparison();renderSummaries();renderWaterfall();renderOpportunities();renderMarketing();renderRetention();renderBundles();renderShippingAndSla();renderHistory();renderHealth();renderGeo();renderHeatmap();renderLifecycle();renderGoals();renderAnnotations();renderSecurity();
    setAdvancedStatus('v843 growth intelligence loaded.','ok');
  }
  async function mutate(action,payload,msg){
    try{setAdvancedStatus('Saving…');await api(action,payload);setAdvancedStatus(msg,'ok');window.dispatchEvent(new CustomEvent('bruis:shop-admin-refresh'));}catch(e){setAdvancedStatus(e?.message||'Action failed.','warn');}
  }
  function amountToCents(v){const s=String(v||'').trim().replace(',','.');if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;const c=Math.round(Number(s)*100);return c>0?c:null}
  function bind(){
    $('simProduct')?.addEventListener('change',()=>{const ps=state?.growth?.margin_simulator_products||[],p=ps[Number($('simProduct').value)];$('simVariant').innerHTML='<option value="">Choose variant…</option>'+(p?.variants||[]).map((v,i)=>'<option value="'+i+'">'+esc(v.size||v.variant_id)+' · current '+eur(v.retail_cents)+'</option>').join('');if(p?.variants?.[0])$('simPrice').value=(n(p.variants[0].retail_cents)/100).toFixed(2);updateSimulator()});
    ['simVariant','simPrice','simQty'].forEach(id=>$(id)?.addEventListener('input',updateSimulator));
    $('exportBtn')?.addEventListener('click',doExport);
    $('campaignForm')?.addEventListener('submit',e=>{e.preventDefault();const cents=amountToCents($('campaignAmount').value);if(cents==null)return setAdvancedStatus('Enter a valid campaign amount.','warn');mutate('campaign_spend_add',{occurred_on:$('campaignDate').value,utm_source:$('campaignSource').value,utm_medium:$('campaignMedium').value,utm_campaign:$('campaignName').value,amount_cents:cents,note:$('campaignNote').value},'Campaign spend added.')});
    $('goalForm')?.addEventListener('submit',e=>{e.preventDefault();let target=Number($('goalTarget').value);const metric=$('goalMetric').value;if(metric.includes('_cents'))target=Math.round(target*100);else if(metric.includes('rate'))target=target/100;mutate('goal_upsert',{period_month:$('goalMonth').value+'-01',metric,target_value:target,note:$('goalNote').value},'Goal saved.')});
    $('annotationForm')?.addEventListener('submit',e=>{e.preventDefault();mutate('annotation_add',{occurred_at:new Date($('annotationTime').value).toISOString(),category:$('annotationCategory').value,title:$('annotationTitle').value,note:$('annotationNote').value},'Annotation added.')});
    document.addEventListener('click',e=>{
      const c=e.target.closest?.('[data-delete-campaign]');if(c&&confirm('Delete this campaign spend entry?'))mutate('campaign_spend_delete',{id:Number(c.dataset.deleteCampaign)},'Campaign spend deleted.');
      const g=e.target.closest?.('[data-delete-goal]');if(g&&confirm('Delete this goal?'))mutate('goal_delete',{id:Number(g.dataset.deleteGoal)},'Goal deleted.');
      const a=e.target.closest?.('[data-delete-annotation]');if(a&&confirm('Delete this annotation?'))mutate('annotation_delete',{id:Number(a.dataset.deleteAnnotation)},'Annotation deleted.');
    });
    const now=new Date();if($('campaignDate'))$('campaignDate').value=now.toISOString().slice(0,10);if($('goalMonth'))$('goalMonth').value=now.toISOString().slice(0,7);if($('annotationTime'))$('annotationTime').value=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  }
  window.addEventListener('bruis:shop-admin-loaded',e=>{state=e.detail||null;renderAll()});
  document.addEventListener('DOMContentLoaded',bind,{once:true});
})();