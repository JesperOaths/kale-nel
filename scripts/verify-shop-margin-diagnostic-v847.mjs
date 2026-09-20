#!/usr/bin/env node
const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'');
if(!base||!key)throw new Error('Missing Supabase runtime secrets');

const url=base+'/rest/v1/shop_alerts_v847?dedupe_key=eq.low_margin%3Aaggregate&resolved_at=is.null&select=id,severity,message,metadata,updated_at&limit=1';
const response=await fetch(url,{headers:{Authorization:'Bearer '+key,apikey:key,Accept:'application/json'}});
const rows=await response.json().catch(()=>null);
if(!response.ok)throw new Error('Margin diagnostic query failed with HTTP '+response.status);
if(!Array.isArray(rows))throw new Error('Margin diagnostic query did not return an array');

if(rows.length===0){
  console.log('margin-diagnostic-self-test '+JSON.stringify({ok:true,open_alert:false}));
  process.exit(0);
}

const row=rows[0]||{},meta=row.metadata||{},variants=Array.isArray(meta.variants)?meta.variants:[];
if(meta.pricing_action!=='none')throw new Error('Low-margin alert must declare pricing_action=none');
if(!Number.isFinite(Number(meta.threshold_bps)))throw new Error('Low-margin alert threshold_bps missing');
if(Number(meta.variant_count)!==variants.length&&variants.length<100)throw new Error('Low-margin alert variant_count does not match diagnostic rows');
if(variants.length===0)throw new Error('Low-margin alert has no variant diagnostics');

for(const v of variants){
  for(const field of ['retail_cents','margin_cents','margin_bps','threshold_bps']){
    if(!Number.isFinite(Number(v?.[field])))throw new Error('Low-margin diagnostic missing numeric '+field);
  }
  if(v.production_cost_cents!=null&&!Number.isFinite(Number(v.production_cost_cents)))throw new Error('Invalid production_cost_cents');
  if(v.whole_euro_threshold_price_cents!=null){
    const target=Number(v.whole_euro_threshold_price_cents);
    if(!Number.isFinite(target)||target<0||target%100!==0)throw new Error('Whole-euro threshold target is invalid');
  }
  if(v.threshold_gap_cents!=null&&(!Number.isFinite(Number(v.threshold_gap_cents))||Number(v.threshold_gap_cents)<0))throw new Error('Threshold gap is invalid');
}

const worst=variants.slice().sort((a,b)=>Number(a.margin_bps)-Number(b.margin_bps))[0];
console.log('margin-diagnostic-self-test '+JSON.stringify({
  ok:true,
  open_alert:true,
  severity:row.severity||null,
  threshold_percent:Number(meta.threshold_bps)/100,
  variant_count:Number(meta.variant_count||variants.length),
  product_count:Number(meta.product_count||0),
  worst:{
    product_name:String(worst?.product_name||''),
    size:String(worst?.size||''),
    margin_percent:Number(worst?.margin_bps||0)/100,
    current_price_cents:Number(worst?.retail_cents||0),
    production_cost_cents:worst?.production_cost_cents==null?null:Number(worst.production_cost_cents),
    whole_euro_threshold_price_cents:worst?.whole_euro_threshold_price_cents==null?null:Number(worst.whole_euro_threshold_price_cents),
    threshold_gap_cents:worst?.threshold_gap_cents==null?null:Number(worst.threshold_gap_cents)
  },
  updated_at:row.updated_at||null
}));
