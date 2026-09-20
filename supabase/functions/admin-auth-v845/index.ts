import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = new Set([
  "https://admin.kalenel.nl",
  "https://kalenel.nl",
  "https://www.kalenel.nl",
  "https://jesperoaths.github.io"
]);
const text=(v:unknown)=>String(v??"").trim();

function cors(req:Request){
  const origin=text(req.headers.get("origin"));
  const allow=ALLOWED_ORIGINS.has(origin)||/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)
    ? origin : "https://admin.kalenel.nl";
  return {
    "Access-Control-Allow-Origin":allow,
    "Vary":"Origin",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "Pragma":"no-cache",
    "Referrer-Policy":"no-referrer",
    "X-Content-Type-Options":"nosniff"
  };
}
const json=(req:Request,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors(req)});

function serviceClient(){
  const url=Deno.env.get("SUPABASE_URL");
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) throw new Error("server_not_configured");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors(req)});
  if(req.method==="GET") return json(req,{ok:true,mode:"admin-auth-v845",service_role_login:true});
  if(req.method!=="POST") return json(req,{ok:false,error:"method_not_allowed"},405);

  let body:any={};
  try{
    const raw=await req.text();
    if(raw.length>4096) return json(req,{ok:false,error:"request_too_large"},413);
    body=raw?JSON.parse(raw):{};
  }catch{
    return json(req,{ok:false,error:"invalid_request"},400);
  }

  const username=text(body?.username ?? body?.input_username);
  const password=String(body?.password ?? body?.input_password ?? "");
  const totp=String(body?.totp??"").replace(/\D/g,"");

  if(!username||username.length>160||!password||password.length>512||!/^\d{6}$/.test(totp)){
    return json(req,{ok:false,error:"invalid_credentials"},400);
  }

  try{
    const sb=serviceClient();
    const {data,error}=await sb.rpc("admin_login",{
      input_username:username,
      input_password:password,
      input_totp_code:totp
    });
    if(error){
      console.error("admin-auth-v845 login rpc failed",error.code||"rpc_error");
      return json(req,{ok:false,error:"authentication_service_unavailable"},503);
    }
    const row=Array.isArray(data)?data[0]:data;
    if(row?.ok!==true){
      if(row?.error==="too_many_attempts"){
        return json(req,{ok:false,error:"too_many_attempts",retry_after_seconds:Number(row?.retry_after_seconds||0)},429);
      }
      return json(req,{ok:false,error:"invalid_credentials"},401);
    }
    const token=text(row?.admin_session_token||row?.token);
    if(token.length<20||token.length>500){
      console.error("admin-auth-v845 login returned malformed session");
      return json(req,{ok:false,error:"authentication_service_unavailable"},503);
    }
    return json(req,{
      ok:true,
      admin_session_token:token,
      admin_username:text(row?.admin_username||row?.username),
      expires_at:row?.expires_at||null,
      trusted_device_available:row?.trusted_device_available===true
    });
  }catch(err){
    console.error("admin-auth-v845 unexpected failure",err instanceof Error?err.message:"unknown");
    return json(req,{ok:false,error:"authentication_service_unavailable"},503);
  }
});
