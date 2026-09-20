const text=v=>String(v??"").trim();
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dayMs=86400000;

function percentile(values,p){
  const rows=(Array.isArray(values)?values:[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!rows.length)return null;
  const idx=(rows.length-1)*clamp(p,0,1),lo=Math.floor(idx),hi=Math.ceil(idx);
  if(lo===hi)return rows[lo];
  return rows[lo]+(rows[hi]-rows[lo])*(idx-lo);
}
function amsterdamParts(value){
  const d=new Date(value); if(!Number.isFinite(d.getTime()))return null;
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Amsterdam",weekday:"short",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hour12:false}).formatToParts(d);
  const get=t=>parts.find(p=>p.type===t)?.value||"";
  return {weekday:get("weekday"),year:get("year"),month:get("month"),day:get("day"),hour:Number(get("hour"))};
}
function businessDay(value){
  const d=new Date(value); if(!Number.isFinite(d.getTime()))return "";
  const shifted=new Date(d.getTime()-6*3600000);
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Amsterdam",year:"numeric",month:"2-digit",day:"2-digit"}).format(shifted);
}
function previousRange(range){
  const a=Date.parse(range.from),b=Date.parse(range.to),span=Math.max(dayMs,b-a);
  return {from:new Date(a-span).toISOString(),to:new Date(a).toISOString()};
}
function supplierShippingEurCents(row){
  const shipping=num(row?.shipping_cents);
  if(shipping===0)return 0;
  const source=Number(row?.shipping_source_cents),currency=text(row?.shipping_source_currency).toLowerCase();
  if(!Number.isFinite(source)||source<0)return null;
  if(currency==="eur")return Math.round(source);
  if(currency==="usd"){
    const rate=Number(row?.fx_snapshot?.rate);
    if(Number.isFinite(rate)&&rate>0)return Math.round(source*rate);
  }
  return null;
}
function metricDelta(current,previous){
  const c=num(current),p=num(previous);
  return {current:c,previous:p,delta:c-p,delta_rate:p!==0?(c-p)/Math.abs(p):null};
}
function knownContribution(snapshot){
  const o=snapshot?.orders||{},l=snapshot?.ledger||{};
  return num(o.recognized_sales_cents)-num(o.paid_known_product_cost_cents)-num(o.paid_known_shipping_cost_cents)-num(o.paid_import_allowance_cents)-num(l.costs_cents)+num(l.income_cents);
}
function productMap(snapshot){return new Map((Array.isArray(snapshot?.products)?snapshot.products:[]).map(p=>[String(p.product_id||""),p]));}
function productOpportunities(snapshot,previousSnapshot,catalog){
  const prev=productMap(previousSnapshot),costs=new Map((Array.isArray(catalog?.products)?catalog.products:[]).map(p=>[String(p.product_id),p]));
  return (Array.isArray(snapshot?.products)?snapshot.products:[]).map(p=>{
    const views=num(p.views),adds=num(p.adds),paid=num(p.paid_units),rev=num(p.paid_revenue_cents),old=prev.get(String(p.product_id))||{},c=costs.get(String(p.product_id))||{};
    const conv=views?paid/views:0,cart=views?adds/views:0;
    const currentMargin=num(c.gross_product_margin_min_cents),price=num(c.retail_min_cents),marginRate=price?currentMargin/price:null;
    let label="insufficient data",priority=0,reason="More traffic is needed before classifying this product.";
    if(views>=8&&cart<0.05){label="high views / low cart";priority=4;reason="Traffic is reaching the product but few visitors add it to cart."}
    else if(views>=8&&conv<0.02){label="high views / low conversion";priority=4;reason="Product interest is not turning into paid units."}
    else if(paid>=2&&marginRate!=null&&marginRate<0.20){label="seller / weak margin";priority=5;reason="The product sells, but current gross product margin is under 20%."}
    else if(views<8&&paid>0&&marginRate!=null&&marginRate>=0.20){label="hidden gem";priority=3;reason="The product converts despite relatively little exposure."}
    else if(conv>=0.08&&paid>0){label="strong converter";priority=2;reason="Paid conversion is strong for observed traffic."}
    return {product_id:p.product_id,product_name:p.product_name,collection:p.collection,views,adds,paid_units:paid,paid_revenue_cents:rev,view_to_cart:cart,view_to_paid:conv,previous_views:num(old.views),previous_paid_units:num(old.paid_units),current_margin_cents:currentMargin||null,current_margin_rate:marginRate,label,priority,reason};
  }).sort((a,b)=>b.priority-a.priority||b.views-a.views).slice(0,100);
}
function retentionMetrics(allOrders){
  const byCustomer=new Map();
  for(const row of allOrders){
    const email=text(row?.customer_email).toLowerCase(); if(!email)continue;
    if(!byCustomer.has(email))byCustomer.set(email,[]);
    byCustomer.get(email).push(row);
  }
  const windows=[30,60,90,180];
  const counts=Object.fromEntries(windows.map(w=>[w,{eligible:0,repeat:0}]));
  const gaps=[];
  for(const orders of byCustomer.values()){
    orders.sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
    const first=Date.parse(orders[0]?.created_at); if(!Number.isFinite(first))continue;
    for(const w of windows){
      if(Date.now()-first>=w*dayMs){
        counts[w].eligible+=1;
        if(orders.slice(1).some(o=>Date.parse(o.created_at)-first<=w*dayMs))counts[w].repeat+=1;
      }
    }
    for(let i=1;i<orders.length;i++){
      const a=Date.parse(orders[i-1].created_at),b=Date.parse(orders[i].created_at);
      if(Number.isFinite(a)&&Number.isFinite(b)&&b>=a)gaps.push((b-a)/dayMs);
    }
  }
  return {rates:Object.fromEntries(windows.map(w=>[w,counts[w].eligible?counts[w].repeat/counts[w].eligible:null])),eligible:Object.fromEntries(windows.map(w=>[w,counts[w].eligible])),median_days_between_orders:percentile(gaps,.5),p90_days_between_orders:percentile(gaps,.9)};
}
function slaMetrics(orders){
  const payment=[],production=[],ship=[];
  const add=(arr,a,b,div)=>{const x=Date.parse(a),y=Date.parse(b);if(Number.isFinite(x)&&Number.isFinite(y)&&y>=x)arr.push((y-x)/div)};
  for(const o of orders){
    add(payment,o.created_at,o.payment_verified_at,3600000);
    add(production,o.payment_verified_at,o.submitted_to_printify_at,3600000);
    add(ship,o.submitted_to_printify_at,o.shipped_at,dayMs);
  }
  const pctWithin=(arr,limit)=>arr.length?arr.filter(x=>x<=limit).length/arr.length:null;
  return {
    payment:{count:payment.length,p50_hours:percentile(payment,.5),p90_hours:percentile(payment,.9),within_1h:pctWithin(payment,1),within_6h:pctWithin(payment,6),within_24h:pctWithin(payment,24)},
    production:{count:production.length,p50_hours:percentile(production,.5),p90_hours:percentile(production,.9),within_1h:pctWithin(production,1),within_4h:pctWithin(production,4),within_12h:pctWithin(production,12)},
    shipping:{count:ship.length,p50_days:percentile(ship,.5),p90_days:percentile(ship,.9),within_3d:pctWithin(ship,3),within_5d:pctWithin(ship,5),within_10d:pctWithin(ship,10)}
  };
}
function shippingLeakage(orders){
  return orders.filter(o=>o?.payment_verified_at).map(o=>{
    const revenue=num(o.shipping_cents),cost=supplierShippingEurCents(o);
    return {order_id:o.id,payment_reference:o.payment_reference||"",country:text(o?.shipping_address?.country),shipping_revenue_cents:revenue,supplier_shipping_cost_cents:cost,shipping_margin_cents:cost==null?null:revenue-cost,shipping_margin_rate:cost==null||revenue===0?null:(revenue-cost)/revenue};
  }).sort((a,b)=>num(a.shipping_margin_cents)-num(b.shipping_margin_cents));
}
function heatmap(events,orders){
  const map=new Map();
  const get=(weekday,hour)=>{const k=weekday+"|"+hour;if(!map.has(k))map.set(k,{weekday,hour,sessions:new Set(),product_views:0,adds:0,checkout_starts:0,orders:0,sales_cents:0});return map.get(k)};
  for(const e of events){
    const p=amsterdamParts(e.created_at); if(!p)continue; const r=get(p.weekday,p.hour);
    if(e.session_id)r.sessions.add(e.session_id);
    if(e.event_name==="product_view")r.product_views++;
    if(e.event_name==="add_to_cart")r.adds++;
    if(e.event_name==="checkout_start")r.checkout_starts++;
  }
  for(const o of orders.filter(o=>o?.payment_verified_at)){
    const p=amsterdamParts(o.payment_verified_at||o.created_at); if(!p)continue; const r=get(p.weekday,p.hour);r.orders++;r.sales_cents+=num(o.total_cents);
  }
  return [...map.values()].map(r=>({...r,sessions:r.sessions.size})).sort((a,b)=>a.weekday.localeCompare(b.weekday)||a.hour-b.hour);
}
function deviceFunnel(events){
  const map=new Map();
  for(const e of events){
    const key=text(e.device_type)||"unknown";
    const r=map.get(key)||{device:key,sessions:new Set(),product_views:0,adds:0,checkout_starts:0,orders_created:0};
    if(e.session_id)r.sessions.add(e.session_id);
    if(e.event_name==="product_view")r.product_views++;
    if(e.event_name==="add_to_cart")r.adds++;
    if(e.event_name==="checkout_start")r.checkout_starts++;
    if(e.event_name==="order_created")r.orders_created++;
    map.set(key,r);
  }
  return [...map.values()].map(r=>({...r,sessions:r.sessions.size,session_to_order:r.sessions.size?r.orders_created/r.sessions.size:null})).sort((a,b)=>b.sessions-a.sessions);
}
function sourceFunnel(events){
  const map=new Map();
  for(const e of events){
    const x=e.extra&&typeof e.extra==="object"?e.extra:{};
    let source=text(x.utm_source);
    if(!source){
      try{source=new URL(text(x.landing_referrer||e.referrer_url)).hostname.replace(/^www\./,"")}catch{}
    }
    source=source||"direct";
    const r=map.get(source)||{source,sessions:new Set(),product_views:0,adds:0,checkout_starts:0,orders_created:0};
    if(e.session_id)r.sessions.add(e.session_id);
    if(e.event_name==="product_view")r.product_views++;
    if(e.event_name==="add_to_cart")r.adds++;
    if(e.event_name==="checkout_start")r.checkout_starts++;
    if(e.event_name==="order_created")r.orders_created++;
    map.set(source,r);
  }
  return [...map.values()].map(r=>({...r,sessions:r.sessions.size,session_to_order:r.sessions.size?r.orders_created/r.sessions.size:null})).sort((a,b)=>b.sessions-a.sessions).slice(0,100);
}
function countryFunnel(events){
  const sessionCountry=new Map();
  for(const e of events){
    const x=e.extra&&typeof e.extra==="object"?e.extra:{};
    const country=text(x.country).toUpperCase();
    if(e.session_id&&/^[A-Z]{2}$/.test(country))sessionCountry.set(e.session_id,country);
  }
  const map=new Map();
  for(const e of events){
    const country=sessionCountry.get(e.session_id);if(!country)continue;
    const r=map.get(country)||{country,sessions:new Set(),product_views:0,adds:0,checkout_starts:0,checkout_submits:0,orders_created:0};
    if(e.session_id)r.sessions.add(e.session_id);
    if(e.event_name==="product_view")r.product_views++;
    if(e.event_name==="add_to_cart")r.adds++;
    if(e.event_name==="checkout_start")r.checkout_starts++;
    if(e.event_name==="checkout_submit")r.checkout_submits++;
    if(e.event_name==="order_created")r.orders_created++;
    map.set(country,r);
  }
  return [...map.values()].map(r=>({...r,sessions:r.sessions.size,submit_to_order:r.checkout_submits?r.orders_created/r.checkout_submits:null})).sort((a,b)=>b.checkout_submits-a.checkout_submits||b.sessions-a.sessions);
}
function lifecycle(events,orders){
  const map=new Map();
  const key=(day,name)=>day+"|||"+name;
  for(const e of events){
    if(!["product_view","add_to_cart"].includes(e.event_name))continue;
    const x=e.extra&&typeof e.extra==="object"?e.extra:{},name=text(x.product_name||e.event_label);if(!name)continue;
    const day=businessDay(e.created_at),k=key(day,name),r=map.get(k)||{day,product_name:name,views:0,adds:0,paid_units:0,paid_revenue_cents:0};
    if(e.event_name==="product_view")r.views++;else r.adds++;
    map.set(k,r);
  }
  for(const o of orders.filter(o=>o?.payment_verified_at)){
    const day=businessDay(o.payment_verified_at||o.created_at);
    for(const item of Array.isArray(o.line_items)?o.line_items:[]){
      const name=text(item?.name);if(!name)continue;const k=key(day,name),r=map.get(k)||{day,product_name:name,views:0,adds:0,paid_units:0,paid_revenue_cents:0};
      const q=Math.max(1,Math.round(num(item.qty)||1));r.paid_units+=q;r.paid_revenue_cents+=num(item.unit_price_cents)*q;map.set(k,r);
    }
  }
  return [...map.values()].sort((a,b)=>a.day.localeCompare(b.day)||a.product_name.localeCompare(b.product_name)).slice(-5000);
}
function forecast(orders,range){
  const from=Date.parse(range.from),to=Date.parse(range.to),days=Math.max(1,(to-from)/dayMs);
  const paid=orders.filter(o=>o?.payment_verified_at),sales=paid.reduce((s,o)=>s+num(o.total_cents),0),units=paid.reduce((s,o)=>s+(Array.isArray(o.line_items)?o.line_items.reduce((a,i)=>a+Math.max(1,Math.round(num(i.qty)||1)),0):0),0);
  const nowParts=amsterdamParts(new Date().toISOString()),year=Number(nowParts?.year),month=Number(nowParts?.month);
  const daysInMonth=new Date(Date.UTC(year,month,0)).getUTCDate(),dayOfMonth=Number(nowParts?.day)||1,remaining=Math.max(0,daysInMonth-dayOfMonth);
  const dailySales=sales/days,dailyOrders=paid.length/days,dailyUnits=units/days;
  return {observed_days:days,daily_sales_run_rate_cents:Math.round(dailySales),daily_orders_run_rate:dailyOrders,daily_units_run_rate:dailyUnits,month_remaining_days:remaining,projected_additional_sales_cents:Math.round(dailySales*remaining),projected_additional_orders:dailyOrders*remaining,projected_additional_units:dailyUnits*remaining};
}
function anomalies(snapshot,previousSnapshot,events,lastShopEventAt){
  const rows=[],e=snapshot?.events||{},pe=previousSnapshot?.events||{},o=snapshot?.orders||{},po=previousSnapshot?.orders||{};
  const check=(kind,label,current,previous,threshold=.5)=>{
    const c=num(current),p=num(previous); if(p<=0||c===p)return;
    const delta=(c-p)/p;if(Math.abs(delta)>=threshold)rows.push({kind,severity:Math.abs(delta)>=.8?"high":"medium",label,current:c,previous:p,delta_rate:delta});
  };
  check("traffic","Sessions",e.sessions,pe.sessions,.5);
  check("conversion","Orders created",o.orders_created,po.orders_created,.5);
  check("revenue","Recognized sales",o.recognized_sales_cents,po.recognized_sales_cents,.5);
  check("cart","Add to cart",e.add_to_cart,pe.add_to_cart,.5);
  const age=lastShopEventAt?(Date.now()-Date.parse(lastShopEventAt))/3600000:null;
  if(age!=null&&age>6)rows.push({kind:"telemetry",severity:age>24?"high":"medium",label:"No recent shop telemetry",age_hours:age});
  if(events.length===0&&num(e.sessions)>0)rows.push({kind:"telemetry",severity:"high",label:"Snapshot reports sessions but event query returned none."});
  return rows;
}
function marginSimulatorProducts(catalog){
  return (Array.isArray(catalog?.products)?catalog.products:[]).map(p=>({product_id:p.product_id,product_name:p.product_name,collection:p.collection,variants:(Array.isArray(p.variants)?p.variants:[]).filter(v=>v.available!==false).map(v=>({variant_id:v.id,size:v.size,retail_cents:v.retail_cents,production_cost_cents:v.production_cost_cents,gross_margin_cents:v.gross_product_margin_cents}))}));
}
function bundleSuggestions(basketPairs,catalog){
  const products=new Map((Array.isArray(catalog?.products)?catalog.products:[]).map(p=>[text(p.product_name).toLowerCase(),p]));
  return (Array.isArray(basketPairs)?basketPairs:[]).map(pair=>{
    const a=products.get(text(pair.product_a).toLowerCase()),b=products.get(text(pair.product_b).toLowerCase());
    const price=num(a?.retail_min_cents)+num(b?.retail_min_cents),cost=num(a?.production_cost_min_cents)+num(b?.production_cost_min_cents);
    const minimumAt20=cost>0?Math.ceil(cost/.8):0,maxDiscount=price>0&&minimumAt20>0?Math.max(0,price-minimumAt20):null;
    return {...pair,current_pair_price_cents:price||null,known_pair_cost_cents:cost||null,max_discount_for_20pct_margin_cents:maxDiscount,example_bundle_price_cents:maxDiscount==null?null:price-Math.min(maxDiscount,Math.round(price*.1))};
  });
}
function campaignMetrics(attribution,spendRows){
  const map=new Map();
  const ensure=(source,medium,campaign)=>{
    const k=[source||"direct",medium||"",campaign||"(none)"].join("|||");
    if(!map.has(k))map.set(k,{source:source||"direct",medium:medium||"",campaign:campaign||"(none)",spend_cents:0,created_orders:0,verified_orders:0,recognized_sales_cents:0});
    return map.get(k);
  };
  for(const a of Array.isArray(attribution)?attribution:[]){const r=ensure(a.source,a.medium,a.campaign);r.created_orders+=num(a.created_orders);r.verified_orders+=num(a.verified_orders);r.recognized_sales_cents+=num(a.recognized_sales_cents)}
  for(const s of spendRows){const r=ensure(text(s.utm_source)||"direct",text(s.utm_medium),text(s.utm_campaign)||"(none)");r.spend_cents+=num(s.amount_cents)}
  return [...map.values()].map(r=>({...r,roas:r.spend_cents>0?r.recognized_sales_cents/r.spend_cents:null,cac_cents:r.verified_orders>0?Math.round(r.spend_cents/r.verified_orders):null,cost_per_created_order_cents:r.created_orders>0?Math.round(r.spend_cents/r.created_orders):null})).sort((a,b)=>b.recognized_sales_cents-a.recognized_sales_cents||b.spend_cents-a.spend_cents);
}
function goalProgress(goals,snapshot,operations){
  const values={recognized_sales_cents:num(snapshot?.orders?.recognized_sales_cents),known_contribution_cents:knownContribution(snapshot),paid_orders:num(snapshot?.orders?.paid_orders),conversion_rate:num(snapshot?.events?.sessions)?num(snapshot?.orders?.orders_created)/num(snapshot?.events?.sessions):0,repeat_customer_rate:num(operations?.repeat_customer_rate)};
  const p=amsterdamParts(new Date().toISOString()),year=Number(p?.year),month=Number(p?.month),day=Number(p?.day)||1,daysInMonth=new Date(Date.UTC(year,month,0)).getUTCDate(),elapsed=Math.max(1,Math.min(daysInMonth,day))/Math.max(1,daysInMonth);
  return goals.map(g=>{
    const current=num(values[g.metric]),target=num(g.target_value),isRate=String(g.metric).includes("rate");
    const forecast=isRate?current:(elapsed>0?current/elapsed:current);
    return {...g,current_value:current,progress:target>0?current/target:null,forecast_value:forecast,forecast_progress:target>0?forecast/target:null};
  });
}
function weeklyMonthlySummary(orders,snapshot,operations){
  const now=Date.now(),week=orders.filter(o=>Date.parse(o.created_at)>=now-7*dayMs),monthParts=amsterdamParts(new Date().toISOString());
  const month=orders.filter(o=>{const p=amsterdamParts(o.created_at);return p&&p.year===monthParts?.year&&p.month===monthParts?.month});
  const summarize=rows=>{const paid=rows.filter(o=>o.payment_verified_at),sales=paid.reduce((s,o)=>s+num(o.total_cents),0),units=paid.reduce((s,o)=>s+(Array.isArray(o.line_items)?o.line_items.reduce((a,i)=>a+Math.max(1,Math.round(num(i.qty)||1)),0):0),0);return{orders:rows.length,paid_orders:paid.length,sales_cents:sales,units}};
  return {week:summarize(week),month:summarize(month),current_conversion_rate:num(snapshot?.events?.sessions)?num(snapshot?.orders?.orders_created)/num(snapshot?.events?.sessions):null,repeat_customer_rate:operations?.repeat_customer_rate??null};
}

export async function recordPriceCostHistory(sb,payload){
  const products=Array.isArray(payload?.products)?payload.products:[],rows=[];
  const {data:history,error}=await sb.from("shop_price_cost_history_v843").select("product_id,variant_id,retail_cents,production_cost_cents,source_cost_usd_cents,fx_usd_eur,captured_at").order("captured_at",{ascending:false}).limit(10000);
  if(error)throw error;
  const latest=new Map();
  for(const h of Array.isArray(history)?history:[]){const k=String(h.product_id)+"|"+String(h.variant_id);if(!latest.has(k))latest.set(k,h)}
  const fxRate=Number(payload?.fx?.rate);
  for(const p of products)for(const v of Array.isArray(p?.variants)?p.variants:[]){
    const k=String(p.product_id)+"|"+String(v.id),old=latest.get(k),changed=[];
    if(!old||num(old.retail_cents)!==num(v.retail_cents))changed.push("retail");
    if(!old||Number(old.production_cost_cents)!==Number(v.production_cost_cents))changed.push("production_cost");
    if(!old||Number(old.source_cost_usd_cents)!==Number(v.source_cost_usd_cents))changed.push("source_cost_usd");
    if(!old||(Number.isFinite(fxRate)&&Math.abs(Number(old.fx_usd_eur||0)-fxRate)>0.0000001))changed.push("fx");
    if(changed.length)rows.push({captured_at:payload.generated_at||new Date().toISOString(),product_id:text(p.product_id),variant_id:text(v.id),product_name:text(p.product_name),collection:text(p.collection)||"unknown",size:text(v.size)||null,retail_cents:num(v.retail_cents),production_cost_cents:v.production_cost_cents==null?null:num(v.production_cost_cents),gross_margin_cents:v.gross_product_margin_cents==null?null:num(v.gross_product_margin_cents),source_cost_usd_cents:v.source_cost_usd_cents==null?null:num(v.source_cost_usd_cents),fx_usd_eur:Number.isFinite(fxRate)?fxRate:null,changed_fields:changed});
  }
  if(rows.length){const {error:insertError}=await sb.from("shop_price_cost_history_v843").insert(rows);if(insertError)throw insertError}
  return rows.length;
}

export async function buildGrowthIntelligence(sb,{range,snapshot,previousSnapshot,operations,previousOperations,intelligence,catalogCosts}){
  const prevRange=previousRange(range);
  const [ordersRes,allOrdersRes,eventsRes,spendRes,goalsRes,annotationsRes,historyRes,loginRes,sessionsRes,paymentRes,webhookRes,catalogRes]=await Promise.all([
    sb.from("shop_orders").select("id,status,created_at,payment_verified_at,submitted_to_printify_at,shipped_at,total_cents,shipping_cents,shipping_address,shipping_source_currency,shipping_source_cents,fx_snapshot,customer_email,line_items,payment_reference,last_error,tracking").gte("created_at",range.from).lt("created_at",range.to).order("created_at",{ascending:false}).limit(10000),
    sb.from("shop_orders").select("id,created_at,payment_verified_at,total_cents,customer_email,line_items").order("created_at",{ascending:true}).limit(20000),
    sb.from("site_visitor_events").select("created_at,event_name,event_label,session_id,device_type,browser_name,referrer_url,extra").like("page_path","/shop%").gte("created_at",range.from).lt("created_at",range.to).order("created_at",{ascending:false}).limit(20000),
    sb.from("shop_campaign_spend_v843").select("*").gte("occurred_on",range.from.slice(0,10)).lte("occurred_on",new Date(Date.parse(range.to)-1).toISOString().slice(0,10)).order("occurred_on",{ascending:false}).limit(5000),
    sb.from("shop_goals_v843").select("*").order("period_month",{ascending:false}).limit(500),
    sb.from("shop_annotations_v843").select("*").gte("occurred_at",range.from).lt("occurred_at",range.to).order("occurred_at",{ascending:false}).limit(500),
    sb.from("shop_price_cost_history_v843").select("*").order("captured_at",{ascending:false}).limit(5000),
    sb.from("admin_login_attempts").select("username,attempted_at,success").gte("attempted_at",new Date(Date.now()-30*dayMs).toISOString()).order("attempted_at",{ascending:false}).limit(500),
    sb.from("admin_sessions").select("id,admin_id,created_at,last_used_at,expires_at").gt("expires_at",new Date().toISOString()).order("last_used_at",{ascending:false}).limit(100),
    sb.from("shop_payment_settings").select("provider,enabled,updated_at").eq("id",1).maybeSingle(),
    sb.from("shop_webhook_events").select("created_at,processed_at,processed,last_error,event_type").order("created_at",{ascending:false}).limit(20),
    sb.from("shop_catalog_cache_v828").select("generated_at,last_error").eq("id",1).maybeSingle(),
  ]);
  for(const r of [ordersRes,allOrdersRes,eventsRes,spendRes,goalsRes,annotationsRes,historyRes,loginRes,sessionsRes,paymentRes,webhookRes,catalogRes])if(r.error)throw r.error;
  const orders=Array.isArray(ordersRes.data)?ordersRes.data:[],allOrders=Array.isArray(allOrdersRes.data)?allOrdersRes.data:[],events=Array.isArray(eventsRes.data)?eventsRes.data:[],spend=Array.isArray(spendRes.data)?spendRes.data:[],goals=Array.isArray(goalsRes.data)?goalsRes.data:[],annotations=Array.isArray(annotationsRes.data)?annotationsRes.data:[],history=Array.isArray(historyRes.data)?historyRes.data:[],logins=Array.isArray(loginRes.data)?loginRes.data:[],activeSessions=Array.isArray(sessionsRes.data)?sessionsRes.data:[],webhooks=Array.isArray(webhookRes.data)?webhookRes.data:[];

  const priceAlerts=[];
  const byVariant=new Map();
  for(const h of history){const k=text(h.product_id)+"|"+text(h.variant_id);if(!byVariant.has(k))byVariant.set(k,[]);if(byVariant.get(k).length<2)byVariant.get(k).push(h)}
  for(const rows of byVariant.values()){
    if(rows.length<2)continue;const [a,b]=rows;const dc=(a.production_cost_cents==null||b.production_cost_cents==null)?null:num(a.production_cost_cents)-num(b.production_cost_cents),dr=num(a.retail_cents)-num(b.retail_cents);
    if(dc||dr)priceAlerts.push({product_id:a.product_id,variant_id:a.variant_id,product_name:a.product_name,size:a.size,captured_at:a.captured_at,production_cost_change_cents:dc,retail_change_cents:dr,current_cost_cents:a.production_cost_cents,current_retail_cents:a.retail_cents,current_margin_cents:a.gross_margin_cents,changed_fields:a.changed_fields});
  }
  const fxRows=history.filter(h=>h.fx_usd_eur!=null).map(h=>({captured_at:h.captured_at,fx_usd_eur:Number(h.fx_usd_eur)}));
  const fxUnique=[];const seenFx=new Set();for(const r of fxRows){const k=String(r.captured_at)+"|"+r.fx_usd_eur;if(!seenFx.has(k)){seenFx.add(k);fxUnique.push(r)}}

  const comparison={
    range:prevRange,
    metrics:{
      visitors:metricDelta(snapshot?.events?.visitors,previousSnapshot?.events?.visitors),
      sessions:metricDelta(snapshot?.events?.sessions,previousSnapshot?.events?.sessions),
      product_views:metricDelta(snapshot?.events?.product_views,previousSnapshot?.events?.product_views),
      add_to_cart:metricDelta(snapshot?.events?.add_to_cart,previousSnapshot?.events?.add_to_cart),
      checkout_starts:metricDelta(snapshot?.events?.checkout_starts,previousSnapshot?.events?.checkout_starts),
      orders_created:metricDelta(snapshot?.orders?.orders_created,previousSnapshot?.orders?.orders_created),
      paid_orders:metricDelta(snapshot?.orders?.paid_orders,previousSnapshot?.orders?.paid_orders),
      recognized_sales_cents:metricDelta(snapshot?.orders?.recognized_sales_cents,previousSnapshot?.orders?.recognized_sales_cents),
      known_contribution_cents:metricDelta(knownContribution(snapshot),knownContribution(previousSnapshot)),
      repeat_customer_rate:metricDelta(operations?.repeat_customer_rate,previousOperations?.repeat_customer_rate)
    }
  };
  const recentWebhook=webhooks[0]||null,failedLogins=logins.filter(x=>!x.success),successfulLogins=logins.filter(x=>x.success);
  const dataQuality=[
    {key:"missing_product_cost",count:num(snapshot?.orders?.paid_missing_cost_units),severity:num(snapshot?.orders?.paid_missing_cost_units)?"medium":"ok"},
    {key:"missing_shipping_cost",count:num(snapshot?.orders?.paid_missing_shipping_cost_orders),severity:num(snapshot?.orders?.paid_missing_shipping_cost_orders)?"medium":"ok"},
    {key:"unattributed_orders",count:Math.max(0,num(snapshot?.orders?.orders_created)-num(intelligence?.attribution?.reduce((s,a)=>s+num(a.created_orders),0))),severity:"info"},
    {key:"orders_with_errors",count:orders.filter(o=>text(o.last_error)).length,severity:orders.some(o=>text(o.last_error))?"high":"ok"},
    {key:"stale_cost_cache",count:catalogCosts?.cache?.stale?1:0,severity:catalogCosts?.cache?.stale?"high":"ok"}
  ];
  const health={
    catalog_generated_at:catalogRes.data?.generated_at||null,catalog_error:catalogRes.data?.last_error||null,
    cost_cache_generated_at:catalogCosts?.cache?.generated_at||null,cost_cache_stale:!!catalogCosts?.cache?.stale,cost_cache_error:catalogCosts?.cache?.error||null,
    last_shop_event_at:intelligence?.last_shop_event_at||null,payment_provider:paymentRes.data?.provider||null,payment_enabled:paymentRes.data?.enabled===true,payment_updated_at:paymentRes.data?.updated_at||null,
    email_configured:!!text(Deno.env.get("RESEND_API_KEY"))&&!!text(Deno.env.get("RESEND_FROM_EMAIL")),
    production_connection_configured:!!text(Deno.env.get("PRINTIFY_API_TOKEN"))||!!text(Deno.env.get("SUPABASE_URL")),
    latest_webhook_at:recentWebhook?.created_at||null,latest_webhook_processed:recentWebhook?.processed??null,latest_webhook_error:recentWebhook?.last_error||null,
    active_admin_sessions:activeSessions.length,failed_admin_logins_30d:failedLogins.length,successful_admin_logins_30d:successfulLogins.length
  };
  return {
    comparison,
    product_opportunities:productOpportunities(snapshot,previousSnapshot,catalogCosts),
    device_funnel:deviceFunnel(events),
    source_funnel:sourceFunnel(events),
    country_funnel:countryFunnel(events),
    retention:retentionMetrics(allOrders),
    sla:slaMetrics(orders),
    shipping_leakage:shippingLeakage(orders),
    hour_day_heatmap:heatmap(events,orders),
    product_lifecycle:lifecycle(events,orders),
    forecast:forecast(orders,range),
    anomalies:anomalies(snapshot,previousSnapshot,events,intelligence?.last_shop_event_at),
    margin_simulator_products:marginSimulatorProducts(catalogCosts),
    bundle_suggestions:bundleSuggestions(intelligence?.basket_pairs,catalogCosts),
    campaign_spend:spend,
    campaign_performance:campaignMetrics(intelligence?.attribution,spend),
    goals:goalProgress(goals,snapshot,operations),
    annotations,
    price_cost_history:history.slice(0,1000),
    supplier_cost_alerts:priceAlerts.slice(0,200),
    fx_history:fxUnique.slice(0,365),
    health,
    data_quality:dataQuality,
    security:{active_sessions:activeSessions,recent_login_attempts:logins.slice(0,100),failed_logins_30d:failedLogins.length,successful_logins_30d:successfulLogins.length},
    summaries:weeklyMonthlySummary(allOrders,snapshot,operations)
  };
}
