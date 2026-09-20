import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import * as XLSX from "npm:xlsx@0.18.5";

const text=v=>String(v??"").trim();
const ALLOWED=new Set(["https://admin.kalenel.nl","https://kalenel.nl","https://www.kalenel.nl","https://jesperoaths.github.io"]);
function cors(req){
  const o=text(req.headers.get("origin"));
  const allow=ALLOWED.has(o)||/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(o)?o:"https://admin.kalenel.nl";
  return {"Access-Control-Allow-Origin":allow,"Vary":"Origin","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
}
const json=(req,b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:cors(req)});
function client(){
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)throw new Error("server_not_configured");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function isServiceRole(req){
  const key=text(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const bearer=text(req.headers.get("authorization")).replace(/^Bearer\s+/i,"");
  if(!key||!bearer||key.length!==bearer.length)return false;
  let diff=0;for(let i=0;i<key.length;i++)diff|=key.charCodeAt(i)^bearer.charCodeAt(i);
  return diff===0;
}
async function requireAdmin(sb,token){
  const {data,error}=await sb.rpc("_require_valid_admin_session",{admin_session_token:token});
  if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;
  if(!row?.ok)throw new Error("invalid_admin_session");
  return row;
}
function monthRange(raw){
  if(!/^\d{4}-\d{2}$/.test(raw))throw new Error("invalid_month");
  const [y,m]=raw.split("-").map(Number);
  const from=new Date(Date.UTC(y,m-1,1));
  const to=new Date(Date.UTC(y,m,1));
  return {from:from.toISOString(),to:to.toISOString()};
}
function flattenOrder(o){
  return {
    order_id:o.id,reference:o.payment_reference||"",created_at:o.created_at,status:o.status,
    customer_name:o.customer_name||"",customer_email:o.customer_email||"",
    subtotal_eur:Number(o.subtotal_cents||0)/100,shipping_eur:Number(o.shipping_cents||0)/100,
    total_eur:Number(o.total_cents||0)/100,paid_eur:Number(o.paid_amount_cents||0)/100,
    payment_provider:o.payment_provider||"",payment_fee_eur:o.payment_fee_cents==null?"":Number(o.payment_fee_cents)/100,
    payment_fee_source:o.payment_fee_source||"",invoice_number:o.invoice_number||"",
    payment_verified_at:o.payment_verified_at||"",submitted_to_production_at:o.submitted_to_printify_at||"",shipped_at:o.shipped_at||""
  };
}
function flattenLedger(x){
  return {id:x.id,date:x.occurred_on,direction:x.direction,category:x.category,amount_eur:Number(x.amount_cents||0)/100,order_id:x.order_id||"",product_name:x.product_name||"",note:x.note||""};
}
function flattenInvoice(x){
  return {invoice_number:x.invoice_number,order_id:x.order_id,issued_at:x.issued_at,tax_status:x.tax_status,gross_eur:Number(x.gross_total_cents||0)/100,net_eur:x.net_total_cents==null?"":Number(x.net_total_cents)/100,vat_eur:x.vat_total_cents==null?"":Number(x.vat_total_cents)/100,vat_rate_percent:x.vat_rate_bps==null?"":Number(x.vat_rate_bps)/100};
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method==="GET")return json(req,{ok:true,mode:"shop-admin-export-v847",formats:["xlsx"]});
  if(req.method!=="POST")return json(req,{ok:false,error:"method_not_allowed"},405);
  const sb=client();
  let body={};try{body=await req.json();}catch{return json(req,{ok:false,error:"invalid_json"},400);}
  try{
    const serviceSelfTest=isServiceRole(req)&&text(body?.action)==="self_test";
    if(!serviceSelfTest)await requireAdmin(sb,text(body?.admin_session_token));
    const month=text(body?.month),range=monthRange(month);
    const [orders,ledger,invoices,fees,tax]=await Promise.all([
      sb.from("shop_orders").select("id,payment_reference,created_at,status,customer_name,customer_email,subtotal_cents,shipping_cents,total_cents,paid_amount_cents,payment_provider,payment_fee_cents,payment_fee_source,invoice_number,payment_verified_at,submitted_to_printify_at,shipped_at").gte("created_at",range.from).lt("created_at",range.to).order("created_at"),
      sb.from("shop_finance_ledger_v841").select("*").gte("occurred_on",month+"-01").lt("occurred_on",new Date(range.to).toISOString().slice(0,10)).order("occurred_on"),
      sb.from("shop_invoices_v847").select("*").gte("issued_at",range.from).lt("issued_at",range.to).order("issued_at"),
      sb.from("shop_payment_fee_rules_v847").select("*").order("provider"),
      sb.from("shop_tax_invoice_settings_v847").select("*").eq("id",1).single()
    ]);
    for(const r of [orders,ledger,invoices,fees,tax])if(r.error)throw r.error;
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet((orders.data||[]).map(flattenOrder)),"Orders");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet((ledger.data||[]).map(flattenLedger)),"Ledger");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet((invoices.data||[]).map(flattenInvoice)),"Invoices");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet((fees.data||[]).map(x=>({provider:x.provider,enabled:x.enabled,rate_percent:Number(x.rate_bps||0)/100,fixed_fee_eur:Number(x.fixed_fee_cents||0)/100,note:x.note||""}))),"Fee rules");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{
      invoicing_enabled:tax.data?.invoicing_enabled===true,
      tax_calculation_enabled:tax.data?.tax_calculation_enabled===true,
      default_vat_rate_percent:tax.data?.default_vat_rate_bps==null?"":Number(tax.data.default_vat_rate_bps)/100,
      seller_name:tax.data?.seller_name||"",seller_country:tax.data?.seller_country||"",
      vat_number:tax.data?.vat_number||"",kvk_number:tax.data?.kvk_number||""
    }]),"Tax settings");
    const bytes=XLSX.write(wb,{type:"array",bookType:"xlsx"});
    const u8=new Uint8Array(bytes);
    const counts={orders:(orders.data||[]).length,ledger:(ledger.data||[]).length,invoices:(invoices.data||[]).length};
    if(serviceSelfTest){
      return json(req,{ok:true,self_test:true,valid_xlsx_header:u8[0]===0x50&&u8[1]===0x4b,byte_size:u8.length,counts});
    }
    let binary="";for(let i=0;i<u8.length;i+=0x8000)binary+=String.fromCharCode(...u8.subarray(i,i+0x8000));
    const base64=btoa(binary);
    return json(req,{ok:true,filename:"bruis-bookkeeping-"+month+".xlsx",mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",base64,counts});
  }catch(error){
    const msg=text(error instanceof Error?error.message:error);
    return json(req,{ok:false,error:/invalid_admin_session/i.test(msg)?"invalid_admin_session":"export_failed",detail:msg.slice(0,500)},/invalid_admin_session/i.test(msg)?401:502);
  }
});