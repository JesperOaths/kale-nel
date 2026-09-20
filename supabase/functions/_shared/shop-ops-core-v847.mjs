export const text=v=>String(v??"").trim();
export const nowIso=()=>new Date().toISOString();
export const hoursSince=v=>{const n=Date.parse(text(v));return Number.isFinite(n)?(Date.now()-n)/3600000:Infinity};
export const daysSince=v=>hoursSince(v)/24;
export const validEmail=v=>!v||(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<=254);

export async function sha256(value){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
export function localDate(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Amsterdam",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
export function localHour(){
  const raw=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Amsterdam",hour:"2-digit",hour12:false}).format(new Date());
  return Number(raw);
}
export function localWeekKey(){
  const p=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Amsterdam",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const get=t=>p.find(x=>x.type===t)?.value||"";
  const d=new Date(Date.UTC(Number(get("year")),Number(get("month"))-1,Number(get("day"))));
  d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));
  return d.toISOString().slice(0,10);
}
export async function getSettings(sb){
  const {data,error}=await sb.from("shop_ops_settings_v847").select("*").eq("id",1).single();
  if(error)throw error; return data;
}
export async function getState(sb){
  const {data,error}=await sb.from("shop_ops_state_v847").select("*").eq("id",1).single();
  if(error)throw error; return data;
}
export async function saveState(sb,patch){
  const {error}=await sb.from("shop_ops_state_v847").update({...patch,updated_at:nowIso()}).eq("id",1);
  if(error)throw error;
}
export async function ensureAlert(sb,row){
  const {data:existing,error:e}=await sb.from("shop_alerts_v847").select("id,notified_at").eq("dedupe_key",row.dedupe_key).is("resolved_at",null).maybeSingle();
  if(e)throw e;
  const patch={kind:row.kind,severity:row.severity,title:row.title,message:row.message,entity_type:row.entity_type||null,entity_id:row.entity_id||null,metadata:row.metadata||{},updated_at:nowIso()};
  if(existing){
    const {data,error}=await sb.from("shop_alerts_v847").update(patch).eq("id",existing.id).select().single();
    if(error)throw error; return {row:data,created:false};
  }
  const {data,error}=await sb.from("shop_alerts_v847").insert({...patch,dedupe_key:row.dedupe_key}).select().single();
  if(error)throw error; return {row:data,created:true};
}
export async function resolveAlert(sb,key){
  await sb.from("shop_alerts_v847").update({resolved_at:nowIso(),updated_at:nowIso()}).eq("dedupe_key",key).is("resolved_at",null);
}
export async function resolveKindExcept(sb,kind,active){
  const {data}=await sb.from("shop_alerts_v847").select("id,dedupe_key").eq("kind",kind).is("resolved_at",null).limit(1000);
  for(const row of data||[])if(!active.has(text(row.dedupe_key))){
    await sb.from("shop_alerts_v847").update({resolved_at:nowIso(),updated_at:nowIso()}).eq("id",row.id);
  }
}
export async function sendEmail(to,subject,html,plain){
  const key=text(Deno.env.get("RESEND_API_KEY")),from=text(Deno.env.get("RESEND_FROM_EMAIL"));
  if(!key||!from||!to)return {ok:false,skipped:true,error:"email_not_configured"};
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({from,to:[to],subject,html,text:plain})});
  const raw=await r.text();
  return r.ok?{ok:true,skipped:false}:{ok:false,skipped:false,error:"Resend "+r.status+": "+raw.slice(0,300)};
}
export async function notifyNewAlerts(sb,settings,alerts){
  if(!settings?.email_alerts_enabled||!text(settings?.owner_email)||!alerts.length)return {ok:true,skipped:true};
  const high=alerts.filter(a=>a.severity==="high").length;
  const subject="Bruis shop: "+alerts.length+" new alert"+(alerts.length===1?"":"s")+(high?" ("+high+" high)":"");
  const plain=alerts.map(a=>"["+String(a.severity).toUpperCase()+"] "+a.title+": "+a.message).join("\n");
  const html='<div style="font-family:Arial,sans-serif"><h2>'+subject+"</h2>"+alerts.map(a=>"<p><strong>"+String(a.severity).toUpperCase()+" - "+a.title+"</strong><br>"+a.message+"</p>").join("")+'<p><a href="https://admin.kalenel.nl/admin_shop_operations.html">Open shop operations</a></p></div>';
  const result=await sendEmail(text(settings.owner_email),subject,html,plain);
  if(result.ok){
    const ids=alerts.map(a=>a.id).filter(Boolean);
    if(ids.length)await sb.from("shop_alerts_v847").update({notified_at:nowIso(),updated_at:nowIso()}).in("id",ids);
  }
  return result;
}
export async function createBackup(sb,settings,reason="scheduled"){
  const tables=[
    ["orders","shop_orders"],["ledger","shop_finance_ledger_v841"],["campaign_spend","shop_campaign_spend_v843"],
    ["goals","shop_goals_v843"],["annotations","shop_annotations_v843"],["fee_rules","shop_payment_fee_rules_v847"],
    ["tax_settings","shop_tax_invoice_settings_v847"],["ops_settings","shop_ops_settings_v847"],["invoices","shop_invoices_v847"],
    ["alerts","shop_alerts_v847"],["catalog_drift","shop_catalog_drift_v847"],["briefs","shop_owner_briefs_v847"]
  ];
  const payload={created_at:nowIso(),schema_version:847},counts={};
  for(const [key,table] of tables){
    const {data,error}=await sb.from(table).select("*").limit(20000);
    if(error)throw error; payload[key]=data||[]; counts[key]=(data||[]).length;
  }
  const payload_sha256=await sha256(JSON.stringify(payload));
  const {data,error}=await sb.from("shop_backup_snapshots_v847").insert({reason,schema_version:847,counts,payload,payload_sha256}).select("id,created_at,counts,payload_sha256").single();
  if(error)throw error;
  const cutoff=new Date(Date.now()-Number(settings.backup_retention_days||90)*86400000).toISOString();
  await sb.from("shop_backup_snapshots_v847").delete().lt("created_at",cutoff);
  await saveState(sb,{last_backup_at:nowIso()});
  return data;
}
export async function generateBrief(sb,settings,type,force=false){
  const key=type==="weekly"?localWeekKey():localDate();
  if(!force){
    const {data:existing}=await sb.from("shop_owner_briefs_v847").select("id").eq("period_type",type).eq("period_key",key).maybeSingle();
    if(existing)return {existing:true,id:existing.id};
  }
  const end=new Date(),start=new Date(end.getTime()-(type==="weekly"?7:1)*86400000);
  const {data:orders}=await sb.from("shop_orders").select("id,status,total_cents,payment_verified_at,created_at").gte("created_at",start.toISOString()).lt("created_at",end.toISOString()).limit(10000);
  const rows=orders||[],paid=rows.filter(o=>o.payment_verified_at),sales=paid.reduce((s,o)=>s+Number(o.total_cents||0),0);
  const {data:alerts}=await sb.from("shop_alerts_v847").select("id,severity,title,message,created_at").is("resolved_at",null).order("created_at",{ascending:false}).limit(50);
  const summary={orders_created:rows.length,paid_orders:paid.length,recognized_sales_cents:sales,open_alerts:(alerts||[]).length,high_alerts:(alerts||[]).filter(a=>a.severity==="high").length,alerts:alerts||[]};
  const {data,error}=await sb.from("shop_owner_briefs_v847").upsert({period_type:type,period_key:key,period_start:start.toISOString(),period_end:end.toISOString(),generated_at:nowIso(),summary},{onConflict:"period_type,period_key"}).select().single();
  if(error)throw error;
  const enabled=type==="weekly"?settings.weekly_brief_enabled:settings.daily_brief_enabled;
  if(enabled&&text(settings.owner_email)){
    const subject="Bruis "+type+" shop brief: "+paid.length+" paid, EUR "+(sales/100).toFixed(2)+" sales";
    const plain=subject+"\nCreated orders: "+rows.length+"\nOpen alerts: "+(alerts||[]).length+"\nHigh alerts: "+(alerts||[]).filter(a=>a.severity==="high").length;
    const html='<div style="font-family:Arial,sans-serif"><h2>'+subject+"</h2><p>Created orders: <strong>"+rows.length+"</strong><br>Open alerts: <strong>"+(alerts||[]).length+"</strong><br>High alerts: <strong>"+(alerts||[]).filter(a=>a.severity==="high").length+"</strong></p></div>";
    const email=await sendEmail(text(settings.owner_email),subject,html,plain);
    await sb.from("shop_owner_briefs_v847").update({email_sent_at:email.ok?nowIso():null,email_error:email.ok?null:text(email.error)}).eq("id",data.id);
    return {...data,email};
  }
  return data;
}
