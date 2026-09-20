import { text,nowIso,hoursSince,daysSince,sha256,ensureAlert,resolveAlert,resolveKindExcept,saveState,sendEmail } from "./shop-ops-core-v847.mjs";

export function normalizeCatalog(payload){
  const out=[];
  for(const p of Array.isArray(payload?.products)?payload.products:[]){
    const variants=(Array.isArray(p?.variants)?p.variants:[]).map(v=>({
      id:text(v?.id),sku:text(v?.sku),size:text(v?.size),price:Number(v?.price||0),
      available:v?.is_available!==false,enabled:v?.is_enabled!==false
    })).sort((a,b)=>a.id.localeCompare(b.id));
    out.push({id:text(p?.id),name:text(p?.name),collection:text(p?.collection),price:Number(p?.price||0),priceMax:Number(p?.priceMax||0),variants});
  }
  return out.sort((a,b)=>a.id.localeCompare(b.id));
}
export function catalogDiff(previous,current){
  const changes=[],prev=new Map((previous||[]).map(p=>[p.id,p])),cur=new Map((current||[]).map(p=>[p.id,p]));
  for(const [id,p] of prev)if(!cur.has(id))changes.push({kind:"product_removed",severity:"high",product_id:id,product_name:p.name,previous_value:p,current_value:null,dedupe_key:"catalog:product_removed:"+id});
  for(const [id,p] of cur){
    const old=prev.get(id);
    if(!old){changes.push({kind:"product_added",severity:"info",product_id:id,product_name:p.name,previous_value:null,current_value:p,dedupe_key:"catalog:product_added:"+id});continue;}
    if(Number(old.price)!==Number(p.price)||Number(old.priceMax)!==Number(p.priceMax))changes.push({kind:"product_price_changed",severity:"medium",product_id:id,product_name:p.name,previous_value:{price:old.price,priceMax:old.priceMax},current_value:{price:p.price,priceMax:p.priceMax},dedupe_key:"catalog:price:"+id+":"+p.price+":"+p.priceMax});
    const ov=new Map((old.variants||[]).map(v=>[v.id,v])),nv=new Map((p.variants||[]).map(v=>[v.id,v]));
    for(const [vid,v] of ov)if(!nv.has(vid))changes.push({kind:"variant_removed",severity:"high",product_id:id,variant_id:vid,product_name:p.name,previous_value:v,current_value:null,dedupe_key:"catalog:variant_removed:"+id+":"+vid});
    for(const [vid,v] of nv){
      const before=ov.get(vid);
      if(!before){changes.push({kind:"variant_added",severity:"info",product_id:id,variant_id:vid,product_name:p.name,previous_value:null,current_value:v,dedupe_key:"catalog:variant_added:"+id+":"+vid});continue;}
      if(Number(before.price)!==Number(v.price))changes.push({kind:"variant_price_changed",severity:"medium",product_id:id,variant_id:vid,product_name:p.name,previous_value:{price:before.price},current_value:{price:v.price},dedupe_key:"catalog:variant_price:"+id+":"+vid+":"+v.price});
      if(before.available!==v.available||before.enabled!==v.enabled)changes.push({kind:"variant_availability_changed",severity:v.available&&v.enabled?"info":"high",product_id:id,variant_id:vid,product_name:p.name,previous_value:{available:before.available,enabled:before.enabled},current_value:{available:v.available,enabled:v.enabled},dedupe_key:"catalog:availability:"+id+":"+vid+":"+v.available+":"+v.enabled});
    }
  }
  return changes;
}
export async function refreshCatalogAndCheck(sb,state,catalogUrl){
  try{await fetch(catalogUrl+"?ops_refresh="+Date.now(),{headers:{"Cache-Control":"no-cache"}});}catch{}
  await new Promise(r=>setTimeout(r,3500));
  const {data:row,error}=await sb.from("shop_catalog_cache_v828").select("payload,generated_at,last_error").eq("id",1).single();
  if(error)throw error;
  const normalized=normalizeCatalog(row?.payload||{}),hash=await sha256(JSON.stringify(normalized));
  const previous=Array.isArray(state?.catalog_baseline)?state.catalog_baseline:[];
  const changes=previous.length&&state?.catalog_hash!==hash?catalogDiff(previous,normalized):[],created=[];
  for(const change of changes){
    await sb.from("shop_catalog_drift_v847").insert({...change,observed_at:nowIso()});
    const a=await ensureAlert(sb,{
      kind:"catalog_drift",severity:change.severity,title:"Catalog "+change.kind.replaceAll("_"," "),
      message:(change.product_name||change.product_id||"Product")+(change.variant_id?" / variant "+change.variant_id:"")+" changed in the live catalog.",
      entity_type:change.variant_id?"variant":"product",entity_id:change.variant_id||change.product_id,dedupe_key:change.dedupe_key,metadata:change
    });
    if(a.created)created.push(a.row);
  }
  await saveState(sb,{catalog_baseline:normalized,catalog_hash:hash,last_catalog_check_at:nowIso()});
  return {generated_at:row?.generated_at||null,last_error:row?.last_error||null,products:normalized.length,changes:changes.length,new_alerts:created};
}
export async function refreshCostsAndCheck(sb,settings,state,analyticsUrl,serviceKey){
  const response=await fetch(analyticsUrl,{method:"POST",headers:{Authorization:"Bearer "+serviceKey,apikey:serviceKey,"Content-Type":"application/json"},body:JSON.stringify({action:"refresh_costs_only"})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||payload?.ok!==true)throw new Error(payload?.detail||payload?.error||"cost_refresh_http_"+response.status);
  const products=Array.isArray(payload?.catalog_costs?.products)?payload.catalog_costs.products:[],created=[],lowRows=[];
  const threshold=Math.max(0,Math.min(10000,Number(settings.low_margin_bps||2000)));
  for(const p of products)for(const v of Array.isArray(p?.variants)?p.variants:[]){
    if(v?.available===false)continue;
    const retail=Number(v?.retail_cents),margin=Number(v?.gross_product_margin_cents);
    if(!(retail>0)||!Number.isFinite(margin))continue;
    const bps=Math.round(margin/retail*10000);
    if(bps<threshold){
      const explicitCost=Number(v?.production_cost_cents);
      const inferredCost=retail-margin;
      const cost=Number.isFinite(explicitCost)&&explicitCost>=0?explicitCost:(Number.isFinite(inferredCost)&&inferredCost>=0?inferredCost:null);
      const exactTarget=cost!=null&&threshold<10000?Math.ceil(cost*10000/(10000-threshold)):null;
      const wholeEuroTarget=exactTarget==null?null:Math.ceil(exactTarget/100)*100;
      lowRows.push({
        product_id:p.product_id,product_name:p.product_name,variant_id:v.id,size:v.size||String(v.id),
        retail_cents:retail,production_cost_cents:cost,margin_cents:margin,margin_bps:bps,
        threshold_bps:threshold,threshold_price_cents:exactTarget,whole_euro_threshold_price_cents:wholeEuroTarget,
        threshold_gap_cents:wholeEuroTarget==null?null:Math.max(0,wholeEuroTarget-retail)
      });
    }
  }
  if(lowRows.length){
    lowRows.sort((a,b)=>a.margin_bps-b.margin_bps||Number(b.threshold_gap_cents||0)-Number(a.threshold_gap_cents||0));
    const productsAffected=new Set(lowRows.map(x=>String(x.product_id))).size,worst=lowRows[0];
    const targetText=worst.whole_euro_threshold_price_cents==null
      ?" No finite target exists at a 100% threshold."
      :" At the current product cost, the configured threshold corresponds to a whole-euro price of EUR "+(worst.whole_euro_threshold_price_cents/100).toFixed(2)+".";
    const a=await ensureAlert(sb,{
      kind:"low_margin",severity:lowRows.some(x=>x.margin_bps<=0)?"high":"medium",title:"Low product margins",
      message:lowRows.length+" variants across "+productsAffected+" products are below "+(threshold/100).toFixed(1)+"% gross product margin. Worst: "+worst.product_name+" "+worst.size+" at "+(worst.margin_bps/100).toFixed(1)+"%."+targetText+" No prices were changed.",
      entity_type:"shop",entity_id:"margin",dedupe_key:"low_margin:aggregate",
      metadata:{
        threshold_bps:threshold,variant_count:lowRows.length,product_count:productsAffected,worst,
        diagnostic_basis:"gross product margin only; current retail minus current production cost; excludes shipping, payment fees, VAT and other ledger costs",
        pricing_action:"none",
        variants:lowRows.slice(0,100)
      }
    });
    if(a.created)created.push(a.row);
    await resolveKindExcept(sb,"low_margin",new Set(["low_margin:aggregate"]));
  }else{
    await resolveKindExcept(sb,"low_margin",new Set());
  }
  const since=state?.last_cost_refresh_at||new Date(Date.now()-12*3600000).toISOString();
  const {data:history}=await sb.from("shop_price_cost_history_v843").select("captured_at,product_id,variant_id,product_name,size,production_cost_cents").gte("captured_at",since).order("captured_at",{ascending:false}).limit(3000);
  const grouped=new Map();
  for(const h of history||[]){const k=String(h.product_id)+"|"+String(h.variant_id);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(h);}
  for(const rows of grouped.values()){
    if(rows.length<2)continue;
    const latest=rows[0],prior=rows.find(x=>Number(x.production_cost_cents)!==Number(latest.production_cost_cents));
    if(!prior||latest.production_cost_cents==null||prior.production_cost_cents==null)continue;
    const delta=Number(latest.production_cost_cents)-Number(prior.production_cost_cents);
    if(Math.abs(delta)<Number(settings.cost_change_alert_cents||100))continue;
    const key="cost_change:"+latest.product_id+":"+latest.variant_id+":"+latest.captured_at;
    const a=await ensureAlert(sb,{kind:"cost_change",severity:delta>0?"medium":"info",title:delta>0?"Production cost increased":"Production cost decreased",message:latest.product_name+" "+(latest.size||latest.variant_id)+": "+(delta>=0?"+":"")+"EUR "+(delta/100).toFixed(2)+".",entity_type:"variant",entity_id:String(latest.variant_id),dedupe_key:key,metadata:{delta_cents:delta,previous_cost_cents:prior.production_cost_cents,current_cost_cents:latest.production_cost_cents}});
    if(a.created)created.push(a.row);
  }
  await saveState(sb,{last_cost_refresh_at:nowIso()});
  return {refresh:payload.refresh||{},new_alerts:created};
}
export async function checkOrdersAndTelemetry(sb,settings){
  const {data:orders,error}=await sb.from("shop_orders").select("id,status,payment_reference,created_at,payment_verified_at,submitted_to_printify_at,shipped_at,tracking,last_error,total_cents,subtotal_cents,shipping_cents,payment_fee_cents,invoice_number,customer_name,customer_email,payment_provider,payment_request_url,order_confirmation_notified_at,shipment_notified_at,notification_error,notification_error_at").order("created_at",{ascending:false}).limit(2000);
  if(error)throw error;
  const active=new Map([["order_error",new Set()],["paid_not_submitted",new Set()],["production_stuck",new Set()],["shipped_no_tracking",new Set()]]),created=[],notificationFailures=[];
  for(const o of orders||[]){
    const ref=text(o.payment_reference)||String(o.id).slice(0,8);
    if(o.status==="pending"&&!o.order_confirmation_notified_at&&text(o.notification_error)&&text(o.customer_email)){
      const money=c=>"€"+(Number(c||0)/100).toFixed(2);
      const paymentLink=text(o.payment_request_url)?'<p><a href="'+text(o.payment_request_url).replace(/["<>]/g,"")+'">Pay order</a></p>':"";
      const html='<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111"><h2>We received your Bruis order</h2><p>Hi '+text(o.customer_name).replace(/[<>&]/g,"")+',</p><p>Your order <strong>'+ref+'</strong> is saved as <strong>Pending</strong>.</p><p><strong>Total: '+money(o.total_cents)+'</strong><br>Products: '+money(o.subtotal_cents)+'<br>Shipping: '+money(o.shipping_cents)+'<br>Payment reference: <strong>'+ref+'</strong></p>'+paymentLink+'<p>We only send the order to production after the payment has been verified.</p></div>';
      const plain='We received your Bruis order '+ref+'.\nStatus: Pending\nTotal: '+money(o.total_cents)+'\nShipping: '+money(o.shipping_cents)+'\nPayment reference: '+ref+(text(o.payment_request_url)?'\nPayment link: '+text(o.payment_request_url):'')+'\nWe only send the order to production after payment has been verified.';
      const mailed=await sendEmail(text(o.customer_email),'Bruis order '+ref+' received',html,plain);
      if(mailed.ok){
        await sb.from("shop_orders").update({order_confirmation_notified_at:nowIso(),notification_error:null,notification_error_at:null}).eq("id",o.id);
        o.notification_error=null;
      }else if(!mailed.skipped){
        await sb.from("shop_orders").update({notification_error:mailed.error,notification_error_at:nowIso()}).eq("id",o.id);
        o.notification_error=mailed.error;
      }
    }
    if(text(o.notification_error))notificationFailures.push({order_id:o.id,reference:ref,status:o.status,error:text(o.notification_error).slice(0,500),at:o.notification_error_at||null});
    if(o.payment_verified_at&&o.payment_fee_cents==null){
      const fee=await sb.rpc("shop_apply_payment_fee_v847",{order_id_input:o.id,admin_id_input:null});
      if(fee.error)console.warn("historical payment fee backfill failed",fee.error.message||fee.error);
    }
    if(o.payment_verified_at&&!text(o.invoice_number)){
      const invoice=await sb.rpc("shop_issue_invoice_v847",{order_id_input:o.id});
      if(invoice.error)console.warn("invoice backfill failed",invoice.error.message||invoice.error);
    }
    if(text(o.last_error)){
      const key="order_error:"+o.id;active.get("order_error").add(key);
      const a=await ensureAlert(sb,{kind:"order_error",severity:"high",title:"Order has an error",message:ref+": "+text(o.last_error).slice(0,500),entity_type:"order",entity_id:o.id,dedupe_key:key,metadata:{status:o.status}});if(a.created)created.push(a.row);
    }
    if(o.payment_verified_at&&!o.submitted_to_printify_at&&hoursSince(o.payment_verified_at)>=Number(settings.paid_not_submitted_hours||2)){
      const key="paid_not_submitted:"+o.id,h=hoursSince(o.payment_verified_at);active.get("paid_not_submitted").add(key);
      const a=await ensureAlert(sb,{kind:"paid_not_submitted",severity:h>=24?"high":"medium",title:"Paid order not in production",message:ref+" was paid "+h.toFixed(1)+" hours ago but has not been sent to production.",entity_type:"order",entity_id:o.id,dedupe_key:key,metadata:{hours:h}});if(a.created)created.push(a.row);
    }
    if(o.submitted_to_printify_at&&!o.shipped_at&&daysSince(o.submitted_to_printify_at)>=Number(settings.production_stuck_days||7)){
      const key="production_stuck:"+o.id,d=daysSince(o.submitted_to_printify_at);active.get("production_stuck").add(key);
      const a=await ensureAlert(sb,{kind:"production_stuck",severity:d>=Number(settings.production_stuck_days||7)*1.5?"high":"medium",title:"Production taking too long",message:ref+" has been in production for "+d.toFixed(1)+" days.",entity_type:"order",entity_id:o.id,dedupe_key:key,metadata:{days:d}});if(a.created)created.push(a.row);
    }
    if(o.shipped_at&&(!Array.isArray(o.tracking)||!o.tracking.length)){
      const key="shipped_no_tracking:"+o.id;active.get("shipped_no_tracking").add(key);
      const a=await ensureAlert(sb,{kind:"shipped_no_tracking",severity:"medium",title:"Shipped order has no tracking",message:ref+" is marked shipped but no tracking data is stored.",entity_type:"order",entity_id:o.id,dedupe_key:key,metadata:{}});if(a.created)created.push(a.row);
    }
  }
  for(const [kind,keys] of active)await resolveKindExcept(sb,kind,keys);
  if(notificationFailures.length){
    const commonResend=notificationFailures.every(x=>/^Resend\s/i.test(x.error));
    const a=await ensureAlert(sb,{kind:"notification_delivery",severity:"high",title:"Customer email delivery is failing",message:notificationFailures.length+" order notification"+(notificationFailures.length===1?"":"s")+" could not be delivered"+(commonResend?". Resend/domain configuration needs attention.":".")+"",entity_type:"shop",entity_id:"email",dedupe_key:"notification_delivery:aggregate",metadata:{count:notificationFailures.length,orders:notificationFailures}});
    if(a.created)created.push(a.row);
    await resolveKindExcept(sb,"notification_delivery",new Set(["notification_delivery:aggregate"]));
  }else{
    await resolveKindExcept(sb,"notification_delivery",new Set());
  }
  const {data:event}=await sb.from("site_visitor_events").select("created_at").like("page_path","/shop%").order("created_at",{ascending:false}).limit(1).maybeSingle();
  const staleHours=event?.created_at?hoursSince(event.created_at):Infinity,key="telemetry_stale:shop";
  if(staleHours>=Number(settings.telemetry_stale_hours||12)){
    const a=await ensureAlert(sb,{kind:"telemetry_stale",severity:staleHours>=48?"high":"medium",title:"Shop telemetry is stale",message:event?.created_at?"No shop analytics event has arrived for "+staleHours.toFixed(1)+" hours.":"No shop analytics event has been recorded.",entity_type:"shop",entity_id:"telemetry",dedupe_key:key,metadata:{last_event_at:event?.created_at||null,stale_hours:staleHours}});if(a.created)created.push(a.row);
  }else await resolveAlert(sb,key);
  await saveState(sb,{last_order_check_at:nowIso()});
  return {orders_checked:(orders||[]).length,last_shop_event_at:event?.created_at||null,new_alerts:created};
}
