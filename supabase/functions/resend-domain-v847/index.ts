import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const text=v=>String(v??"").trim();
const PROJECT_URL=text(Deno.env.get("SUPABASE_URL"));
const SERVICE_KEY=text(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
const RESEND_KEY=text(Deno.env.get("RESEND_API_KEY"));
const DOMAIN="kalenel.nl";

function client(){
  if(!PROJECT_URL||!SERVICE_KEY)throw new Error("server_not_configured");
  return createClient(PROJECT_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function sha256(v){
  const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function consume(sb,req){
  const token=text(req.headers.get("x-shop-ops-token"));
  if(!/^[a-f0-9]{64}$/i.test(token))return false;
  const hash=await sha256(token),now=new Date().toISOString();
  const {data,error}=await sb.from("shop_ops_scheduler_tokens_v847")
    .update({consumed_at:now}).eq("token_hash",hash).is("consumed_at",null).gt("expires_at",now)
    .select("token_hash").maybeSingle();
  return !error&&!!data;
}
async function resend(path,init={}){
  if(!RESEND_KEY)throw new Error("resend_api_key_missing");
  const r=await fetch("https://api.resend.com"+path,{
    ...init,
    headers:{Authorization:"Bearer "+RESEND_KEY,"Content-Type":"application/json",...(init.headers||{})}
  });
  const raw=await r.text();
  let body=null;try{body=raw?JSON.parse(raw):null}catch{body={raw}};
  if(!r.ok){
    const msg=text(body?.message||body?.error||raw).slice(0,700);
    const e=new Error("resend_http_"+r.status+": "+msg);
    e.status=r.status;throw e;
  }
  return body;
}
async function findDomain(){
  const list=await resend("/domains");
  const rows=Array.isArray(list?.data)?list.data:Array.isArray(list)?list:[];
  return rows.find(x=>text(x?.name).toLowerCase()===DOMAIN)||null;
}
async function getDomain(id){
  return await resend("/domains/"+encodeURIComponent(id));
}
async function ensureDomain(){
  let d=await findDomain();
  if(!d){
    const created=await resend("/domains",{method:"POST",body:JSON.stringify({name:DOMAIN,region:"eu-west-1"})});
    d=created?.data||created;
  }
  const id=text(d?.id);
  if(!id)throw new Error("resend_domain_id_missing");
  return await getDomain(id);
}
async function verifyDomain(){
  let d=await findDomain();
  if(!d)d=await ensureDomain();
  const id=text(d?.id);
  await resend("/domains/"+encodeURIComponent(id)+"/verify",{method:"POST",body:"{}"});
  await new Promise(r=>setTimeout(r,1800));
  return await getDomain(id);
}
function safeDomain(d){
  return {
    id:text(d?.id),name:text(d?.name),status:text(d?.status),region:text(d?.region),
    records:(Array.isArray(d?.records)?d.records:[]).map(r=>({
      record:text(r?.record),name:text(r?.name),type:text(r?.type).toUpperCase(),
      value:text(r?.value),priority:r?.priority==null?null:Number(r.priority),status:text(r?.status)
    }))
  };
}
Deno.serve(async req=>{
  if(req.method==="GET")return new Response(JSON.stringify({ok:true,mode:"resend-domain-v847",domain:DOMAIN}),{headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  if(req.method!=="POST")return new Response(JSON.stringify({ok:false,error:"method_not_allowed"}),{status:405,headers:{"Content-Type":"application/json"}});
  const sb=client();
  if(!(await consume(sb,req)))return new Response(JSON.stringify({ok:false,error:"invalid_scheduler_token"}),{status:401,headers:{"Content-Type":"application/json"}});
  let body={};try{body=await req.json()}catch{}
  try{
    const action=text(body?.action||"status");
    let domain=null;
    if(action==="ensure")domain=await ensureDomain();
    else if(action==="verify")domain=await verifyDomain();
    else if(action==="status"){const d=await findDomain();domain=d?await getDomain(text(d.id)):null;}
    else if(action==="test_send"){
      const target="oathsreplays@gmail.com";
      const result=await resend("/emails",{method:"POST",body:JSON.stringify({
        from:"Bruis <orders@kalenel.nl>",to:[target],
        subject:"Bruis transactional email test",
        html:"<p>Bruis transactional email is configured correctly for <strong>kalenel.nl</strong>.</p>",
        text:"Bruis transactional email is configured correctly for kalenel.nl."
      })});
      return new Response(JSON.stringify({ok:true,test_sent:true,email_id:text(result?.id||result?.data?.id)}),{headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
    }
    else return new Response(JSON.stringify({ok:false,error:"unknown_action"}),{status:400,headers:{"Content-Type":"application/json"}});
    return new Response(JSON.stringify({ok:true,domain:domain?safeDomain(domain):null}),{headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  }catch(error){
    return new Response(JSON.stringify({ok:false,error:text(error instanceof Error?error.message:error).slice(0,900)}),{status:502,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  }
});