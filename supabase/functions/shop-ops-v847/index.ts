import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { text,nowIso,validEmail,hoursSince,getSettings,getState,saveState,notifyNewAlerts,createBackup,generateBrief,localDate,localWeekKey,localHour } from "../_shared/shop-ops-core-v847.mjs";
import { refreshCatalogAndCheck,refreshCostsAndCheck,checkOrdersAndTelemetry } from "../_shared/shop-ops-checks-v847.mjs";

const PROJECT_URL=text(Deno.env.get("SUPABASE_URL"));
const SERVICE_KEY=text(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
const ANALYTICS_URL=PROJECT_URL?PROJECT_URL+"/functions/v1/shop-admin-analytics-v843":"";
const CATALOG_URL=PROJECT_URL?PROJECT_URL+"/functions/v1/shop-catalog-v828":"";
const ALLOWED_ORIGINS=new Set(["https://admin.kalenel.nl","https://kalenel.nl","https://www.kalenel.nl","https://jesperoaths.github.io"]);

function cors(req){
  const origin=text(req.headers.get("origin"));
  const allow=ALLOWED_ORIGINS.has(origin)||/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)?origin:"https://admin.kalenel.nl";
  return {
    "Access-Control-Allow-Origin":allow,"Vary":"Origin",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
    "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer"
  };
}
const json=(req,body,status=200)=>new Response(JSON.stringify(body),{status,headers:cors(req)});
function serviceClient(){
  if(!PROJECT_URL||!SERVICE_KEY)throw new Error("server_not_configured");
  return createClient(PROJECT_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function isServiceRole(req){
  const apiKey=text(req.headers.get("apikey"));
  const authorization=text(req.headers.get("authorization"));
  if(!apiKey&&!authorization)return false;
  try{
    const r=await fetch(PROJECT_URL+"/rest/v1/rpc/shop_ops_service_role_probe_v847",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "apikey":apiKey||authorization.replace(/^Bearer\s+/i,""),
        "Authorization":authorization||("Bearer "+apiKey)
      },
      body:"{}"
    });
    if(!r.ok)return false;
    const payload=await r.json().catch(()=>false);
    return payload===true;
  }catch{
    return false;
  }
}
async function requireAdmin(sb,token){
  const {data,error}=await sb.rpc("_require_valid_admin_session",{admin_session_token:token});
  if(error)throw new Error(error.message||String(error));
  const row=Array.isArray(data)?data[0]:data;
  if(!row?.ok)throw new Error("invalid_admin_session");
  return row;
}

async function runOperations(sb,force=false){
  const settings=await getSettings(sb),state=await getState(sb),newAlerts=[],result={started_at:nowIso()};
  try{
    if(force||hoursSince(state.last_cost_refresh_at)>=6){
      result.costs=await refreshCostsAndCheck(sb,settings,state,ANALYTICS_URL,SERVICE_KEY);
      newAlerts.push(...(result.costs.new_alerts||[]));
    }
    if(force||hoursSince(state.last_catalog_check_at)>=6){
      result.catalog=await refreshCatalogAndCheck(sb,state,CATALOG_URL);
      newAlerts.push(...(result.catalog.new_alerts||[]));
    }
    result.orders=await checkOrdersAndTelemetry(sb,settings);
    newAlerts.push(...(result.orders.new_alerts||[]));
    if(force||hoursSince(state.last_backup_at)>=23)result.backup=await createBackup(sb,settings,force?"manual_run":"scheduled");

    const hour=localHour();
    const day=localDate();
    if(force||(hour>=7&&state.last_daily_brief_date!==day)){
      result.daily_brief=await generateBrief(sb,settings,"daily",force);
      await saveState(sb,{last_daily_brief_date:day});
    }
    const week=localWeekKey();
    if(force||(hour>=7&&state.last_weekly_brief_key!==week)){
      result.weekly_brief=await generateBrief(sb,settings,"weekly",force);
      await saveState(sb,{last_weekly_brief_key:week});
    }

    result.alert_email=await notifyNewAlerts(sb,settings,newAlerts);
    result.new_alerts=newAlerts.length;
    result.completed_at=nowIso();
    await saveState(sb,{last_run_at:result.completed_at,last_error:null});
    return result;
  }catch(error){
    const msg=text(error instanceof Error?error.message:error).slice(0,1000);
    await saveState(sb,{last_run_at:nowIso(),last_error:msg});
    throw error;
  }
}

async function statusPayload(sb,adminToken){
  const [settings,state,alerts,backups,briefs,feeRules,tax,invoices,security]=await Promise.all([
    sb.from("shop_ops_settings_v847").select("*").eq("id",1).single(),
    sb.from("shop_ops_state_v847").select("*").eq("id",1).single(),
    sb.from("shop_alerts_v847").select("*").order("created_at",{ascending:false}).limit(200),
    sb.from("shop_backup_snapshots_v847").select("id,created_at,reason,schema_version,counts,payload_sha256").order("created_at",{ascending:false}).limit(50),
    sb.from("shop_owner_briefs_v847").select("*").order("generated_at",{ascending:false}).limit(30),
    sb.from("shop_payment_fee_rules_v847").select("*").order("provider"),
    sb.from("shop_tax_invoice_settings_v847").select("*").eq("id",1).single(),
    sb.from("shop_invoices_v847").select("id,invoice_number,order_id,issued_at,currency,gross_total_cents,net_total_cents,vat_total_cents,vat_rate_bps,tax_status").order("issued_at",{ascending:false}).limit(200),
    sb.rpc("admin_list_security_v847",{admin_session_token_input:adminToken})
  ]);
  for(const r of [settings,state,alerts,backups,briefs,feeRules,tax,invoices,security])if(r.error)throw r.error;
  return {settings:settings.data,state:state.data,alerts:alerts.data||[],backups:backups.data||[],briefs:briefs.data||[],fee_rules:feeRules.data||[],tax_settings:tax.data,invoices:invoices.data||[],security:security.data};
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method==="GET")return json(req,{ok:true,mode:"shop-ops-v847",scheduled_operations:true});
  if(req.method!=="POST")return json(req,{ok:false,error:"method_not_allowed"},405);

  const sb=serviceClient();
  let body={};try{body=await req.json();}catch{return json(req,{ok:false,error:"invalid_json"},400);}
  const service=await isServiceRole(req);
  let admin=null;
  if(!service){
    try{admin=await requireAdmin(sb,text(body?.admin_session_token));}
    catch{return json(req,{ok:false,error:"invalid_admin_session"},401);}
  }
  const action=text(body?.action||"status");

  try{
    if(service&&!["run","health"].includes(action))return json(req,{ok:false,error:"service_role_action_not_allowed"},403);
    if(action==="health")return json(req,{ok:true,mode:"shop-ops-v847"});
    if(action==="run"||action==="run_now")return json(req,{ok:true,result:await runOperations(sb,action==="run_now"||body?.force===true)});
    if(action==="status")return json(req,{ok:true,...await statusPayload(sb,text(body.admin_session_token))});

    if(action==="settings_save"){
      const email=text(body?.owner_email).toLowerCase();
      if(!validEmail(email))return json(req,{ok:false,error:"invalid_owner_email"},400);
      const patch={
        owner_email:email||null,email_alerts_enabled:body?.email_alerts_enabled===true,
        daily_brief_enabled:body?.daily_brief_enabled!==false,weekly_brief_enabled:body?.weekly_brief_enabled!==false,
        paid_not_submitted_hours:Math.max(1,Math.min(168,Number(body?.paid_not_submitted_hours||2))),
        production_stuck_days:Math.max(1,Math.min(60,Number(body?.production_stuck_days||7))),
        telemetry_stale_hours:Math.max(1,Math.min(168,Number(body?.telemetry_stale_hours||12))),
        cost_change_alert_cents:Math.max(1,Math.min(100000,Number(body?.cost_change_alert_cents||100))),
        low_margin_bps:Math.max(0,Math.min(10000,Number(body?.low_margin_bps||2000))),updated_at:nowIso()
      };
      const {data,error}=await sb.from("shop_ops_settings_v847").update(patch).eq("id",1).select().single();
      if(error)throw error;return json(req,{ok:true,settings:data});
    }

    if(action==="fee_rule_save"){
      const provider=text(body?.provider);
      if(!["bunq_me","tikkie","manual_transfer"].includes(provider))return json(req,{ok:false,error:"invalid_provider"},400);
      const patch={
        enabled:body?.enabled===true,
        rate_bps:Math.max(0,Math.min(10000,Math.round(Number(body?.rate_bps||0)))),
        fixed_fee_cents:Math.max(0,Math.min(100000,Math.round(Number(body?.fixed_fee_cents||0)))),
        note:text(body?.note).slice(0,1000)||null,updated_at:nowIso()
      };
      const {data,error}=await sb.from("shop_payment_fee_rules_v847").update(patch).eq("provider",provider).select().single();
      if(error)throw error;return json(req,{ok:true,rule:data});
    }

    if(action==="tax_settings_save"){
      const rate=body?.default_vat_rate_bps==null||body?.default_vat_rate_bps===""?null:Math.round(Number(body.default_vat_rate_bps));
      if(rate!=null&&(!Number.isFinite(rate)||rate<0||rate>10000))return json(req,{ok:false,error:"invalid_vat_rate"},400);
      const patch={
        invoicing_enabled:body?.invoicing_enabled!==false,tax_calculation_enabled:body?.tax_calculation_enabled===true,
        invoice_prefix:text(body?.invoice_prefix||"BRUIS").replace(/[^A-Za-z0-9_-]/g,"").slice(0,30)||"BRUIS",
        default_vat_rate_bps:rate,seller_name:text(body?.seller_name||"Bruis").slice(0,160)||"Bruis",
        seller_address:text(body?.seller_address).slice(0,240)||null,seller_postal_city:text(body?.seller_postal_city).slice(0,160)||null,
        seller_country:text(body?.seller_country||"NL").toUpperCase().slice(0,2),vat_number:text(body?.vat_number).slice(0,80)||null,
        kvk_number:text(body?.kvk_number).slice(0,80)||null,invoice_note:text(body?.invoice_note).slice(0,1000)||null,updated_at:nowIso()
      };
      const {data,error}=await sb.from("shop_tax_invoice_settings_v847").update(patch).eq("id",1).select().single();
      if(error)throw error;return json(req,{ok:true,tax_settings:data});
    }

    if(action==="alert_ack"){
      const {data,error}=await sb.from("shop_alerts_v847").update({acknowledged_at:nowIso(),updated_at:nowIso()}).eq("id",Number(body?.id)).select().maybeSingle();
      if(error)throw error;return json(req,{ok:true,alert:data});
    }

    if(action==="backup_now")return json(req,{ok:true,backup:await createBackup(sb,await getSettings(sb),"manual")});
    if(action==="backup_get"){
      const {data,error}=await sb.from("shop_backup_snapshots_v847").select("*").eq("id",text(body?.id)).single();
      if(error)throw error;return json(req,{ok:true,backup:data});
    }
    if(action==="restore_missing_orders"){
      if(text(body?.confirmation)!=="RESTORE_MISSING_ORDERS")return json(req,{ok:false,error:"confirmation_required"},400);
      const {data:backup,error}=await sb.from("shop_backup_snapshots_v847").select("payload").eq("id",text(body?.id)).single();
      if(error)throw error;
      const orders=Array.isArray(backup?.payload?.orders)?backup.payload.orders:[];let restored=0;
      for(const order of orders){
        const {data:existing}=await sb.from("shop_orders").select("id").eq("id",order.id).maybeSingle();
        if(!existing){const {error:insertError}=await sb.from("shop_orders").insert(order);if(insertError)throw insertError;restored++;}
      }
      return json(req,{ok:true,restored_orders:restored,backup_orders:orders.length});
    }

    if(action==="brief_generate"){
      const type=body?.period_type==="weekly"?"weekly":"daily";
      return json(req,{ok:true,brief:await generateBrief(sb,await getSettings(sb),type,true)});
    }

    if(action==="security_revoke_device"){
      const {data,error}=await sb.rpc("admin_revoke_trusted_device_v847",{admin_session_token_input:text(body.admin_session_token),device_id_input:Number(body.id)});
      if(error)throw error;return json(req,data);
    }
    if(action==="security_revoke_session"){
      const {data,error}=await sb.rpc("admin_revoke_session_v847",{admin_session_token_input:text(body.admin_session_token),session_id_input:Number(body.id)});
      if(error)throw error;return json(req,data);
    }
    if(action==="security_revoke_others"){
      const {data,error}=await sb.rpc("admin_revoke_other_sessions_v847",{admin_session_token_input:text(body.admin_session_token)});
      if(error)throw error;return json(req,data);
    }

    await sb.from("shop_admin_audit_v842").insert({
      admin_id:Number(admin?.admin_id)||null,admin_username:text(admin?.username)||null,surface:"shop_ops_v847",
      action,object_type:"shop_ops",object_id:null,success:false,metadata:{unknown_action:true}
    });
    return json(req,{ok:false,error:"unknown_action"},400);
  }catch(error){
    console.error("shop-ops-v847 failed",error instanceof Error?error.message:error);
    return json(req,{ok:false,error:"shop_ops_failed",detail:text(error instanceof Error?error.message:error).slice(0,500)},502);
  }
});