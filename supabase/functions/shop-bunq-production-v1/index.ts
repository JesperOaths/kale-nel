import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const BUNQ_BASE = String(Deno.env.get("BUNQ_API_BASE") || "https://api.bunq.com/v1").replace(/\/$/, "");
const UA = "Kalenel-Bunq-Production/1.0";
const text = (v:any) => String(v ?? "").trim();

function cors(req:Request){
  const origin=text(req.headers.get("origin"));
  const allowed=["https://kalenel.nl","https://www.kalenel.nl","https://admin.kalenel.nl","https://jesperoaths.github.io"];
  const value=allowed.includes(origin)||/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)?origin:"https://admin.kalenel.nl";
  return {
    "Access-Control-Allow-Origin":value,
    "Vary":"Origin",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "Referrer-Policy":"no-referrer"
  };
}
const json=(req:Request,body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:cors(req)});

async function requireAdmin(sb:any,token:string){
  const {data,error}=await sb.rpc("_require_valid_admin_session",{admin_session_token:token});
  if(error) throw new Error(error.message||String(error));
  const row=Array.isArray(data)?data[0]:data;
  if(!row?.ok) throw new Error("invalid_admin_session");
  return row;
}

async function getSecret(sb:any,name:string){
  const {data,error}=await sb.rpc("shop_bunq_get_secret_v1",{secret_name_input:name});
  if(error) throw new Error("bunq_secret_read_failed");
  return text(data);
}
async function setSecret(sb:any,name:string,value:string){
  const {error}=await sb.rpc("shop_bunq_set_secret_v1",{secret_name_input:name,secret_value_input:value});
  if(error) throw new Error("bunq_secret_write_failed");
}

function bytesToBase64(bytes:Uint8Array){
  let binary="";
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk){
    binary+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+chunk)));
  }
  return btoa(binary);
}
function base64ToBytes(value:string){
  const binary=atob(value);
  const out=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) out[i]=binary.charCodeAt(i);
  return out;
}
function toPem(label:string,buffer:ArrayBuffer){
  const b64=bytesToBase64(new Uint8Array(buffer));
  return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g)?.join("\n")||b64}\n-----END ${label}-----`;
}
function fromPem(value:string){
  const b64=value.replace(/-----BEGIN [^-]+-----/g,"").replace(/-----END [^-]+-----/g,"").replace(/\s+/g,"");
  return base64ToBytes(b64);
}
async function generateKeyPair(){
  const pair=await crypto.subtle.generateKey(
    {name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},
    true,
    ["sign","verify"]
  );
  const pub=await crypto.subtle.exportKey("spki",pair.publicKey);
  const priv=await crypto.subtle.exportKey("pkcs8",pair.privateKey);
  return {publicPem:toPem("PUBLIC KEY",pub),privatePem:toPem("PRIVATE KEY",priv)};
}
async function signBody(body:string,privatePem:string){
  const key=await crypto.subtle.importKey(
    "pkcs8",
    fromPem(privatePem),
    {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},
    false,
    ["sign"]
  );
  const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(body));
  return bytesToBase64(new Uint8Array(sig));
}

function bunqError(payload:any,raw:string){
  const rows=Array.isArray(payload?.Error)?payload.Error:[];
  const msg=rows.map((x:any)=>text(x?.error_description||x?.error_description_translated||x?.error)).filter(Boolean).join(" | ");
  return (msg||text(payload?.error_description)||text(payload?.error)||raw||"bunq request failed").slice(0,600);
}
function bunqHeaders(authToken="",signature=""){
  const h:Record<string,string>={
    "Content-Type":"application/json",
    "Accept":"application/json",
    "Cache-Control":"no-cache",
    "User-Agent":UA,
    "X-Bunq-Language":"en_US",
    "X-Bunq-Region":"nl_NL",
    "X-Bunq-Geolocation":"0 0 0 0 000",
    "X-Bunq-Client-Request-Id":crypto.randomUUID()
  };
  if(authToken) h["X-Bunq-Client-Authentication"]=authToken;
  if(signature) h["X-Bunq-Client-Signature"]=signature;
  return h;
}
async function bunqRequest(path:string,opts:{method?:string,body?:any,authToken?:string,privatePem?:string,sign?:boolean}={}){
  const method=opts.method||"GET";
  const body=opts.body===undefined?"":JSON.stringify(opts.body);
  const signature=(opts.sign&&body&&opts.privatePem)?await signBody(body,opts.privatePem):"";
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const res=await fetch(`${BUNQ_BASE}${path}`,{
      method,
      headers:bunqHeaders(opts.authToken||"",signature),
      body:body||undefined,
      signal:controller.signal
    });
    const raw=await res.text();
    let payload:any={};
    try{payload=raw?JSON.parse(raw):{};}catch{payload={raw};}
    if(!res.ok) throw new Error(`bunq ${res.status}: ${bunqError(payload,raw)}`);
    return payload;
  }catch(error:any){
    if(error?.name==="AbortError") throw new Error("bunq request timed out");
    throw error;
  }finally{
    clearTimeout(timer);
  }
}

function responseEntries(payload:any){
  const rows=Array.isArray(payload?.Response)?payload.Response:[];
  const out:{type:string,value:any}[]=[];
  for(const row of rows){
    if(!row||typeof row!=="object") continue;
    for(const [type,value] of Object.entries(row)) out.push({type,value});
  }
  return out;
}
function wrapped(payload:any,names:string[]){
  const wanted=new Set(names);
  for(const row of responseEntries(payload)) if(wanted.has(row.type)) return row.value;
  return null;
}
function maskIban(raw:string){
  const v=text(raw).replace(/\s+/g,"");
  if(v.length<8) return v?"••••":"";
  return `${v.slice(0,4)}••••••${v.slice(-4)}`;
}
function aliasIban(value:any){
  const aliases=Array.isArray(value?.alias)?value.alias:value?.alias?[value.alias]:[];
  const hit=aliases.find((a:any)=>text(a?.type).toUpperCase()==="IBAN")||aliases[0];
  return text(hit?.value);
}
function accountFromWrapped(type:string,value:any){
  if(!/^MonetaryAccount/i.test(type)||!value||!Number.isFinite(Number(value.id))) return null;
  const balanceValue=Number(value?.balance?.value);
  return {
    id:Number(value.id),
    type,
    description:text(value.description)||type.replace(/^MonetaryAccount/,""),
    currency:text(value?.balance?.currency||"EUR"),
    balance:Number.isFinite(balanceValue)?balanceValue:null,
    iban_masked:maskIban(aliasIban(value)),
    status:text(value.status||"")
  };
}
function cardAccountIds(card:any){
  const ids=new Set<number>();
  for(const pan of Array.isArray(card?.primary_account_numbers)?card.primary_account_numbers:[]){
    const n=Number(pan?.monetary_account_id); if(Number.isFinite(n)) ids.add(n);
  }
  for(const pin of Array.isArray(card?.pin_code_assignment)?card.pin_code_assignment:[]){
    const n=Number(pin?.monetary_account_id); if(Number.isFinite(n)) ids.add(n);
  }
  const direct=Number(card?.monetary_account?.id); if(Number.isFinite(direct)) ids.add(direct);
  return [...ids];
}
function cardLast4(card:any){
  const pans=Array.isArray(card?.primary_account_numbers)?card.primary_account_numbers:[];
  const active=pans.find((p:any)=>text(p?.status).toUpperCase()==="ACTIVE")||pans[0];
  return text(active?.four_digit);
}
function cardFromWrapped(type:string,value:any){
  if(!/^Card/i.test(type)||!value||!Number.isFinite(Number(value.id))) return null;
  return {
    id:Number(value.id),
    type:text(value.type||type),
    sub_type:text(value.sub_type||value.product_type||""),
    label:text(value.second_line||value.preferred_name_on_card||value.name_on_card||`Card ${value.id}`),
    last4:cardLast4(value),
    status:text(value.status||""),
    current_account_ids:cardAccountIds(value),
    raw:value
  };
}

async function createApiContext(apiKey:string){
  if(apiKey.length<20) throw new Error("bunq_api_key_invalid");
  const keys=await generateKeyPair();
  const installation=await bunqRequest("/installation",{method:"POST",body:{client_public_key:keys.publicPem}});
  const installationToken=text(wrapped(installation,["Token"])?.token);
  const serverPublicKey=text(wrapped(installation,["ServerPublicKey"])?.server_public_key);
  if(!installationToken) throw new Error("bunq installation did not return a token");

  const deviceBody={description:"Kalenel Printify production funding",secret:apiKey,permitted_ips:["*"]};
  await bunqRequest("/device-server",{
    method:"POST",body:deviceBody,authToken:installationToken,privatePem:keys.privatePem,sign:true
  });

  const session=await bunqRequest("/session-server",{
    method:"POST",body:{secret:apiKey},authToken:installationToken,privatePem:keys.privatePem,sign:true
  });
  const sessionToken=text(wrapped(session,["Token"])?.token);
  const user=wrapped(session,["UserApiKey","UserPerson","UserCompany"]);
  const userId=Number(user?.id);
  if(!sessionToken||!Number.isFinite(userId)) throw new Error("bunq session did not return a usable user");

  return {apiKey,privatePem:keys.privatePem,publicPem:keys.publicPem,installationToken,serverPublicKey,userId,sessionToken};
}

async function openContext(sb:any){
  const [apiKey,privatePem,publicPem,installationToken,serverPublicKey]=await Promise.all([
    getSecret(sb,"kalenel_bunq_api_key"),
    getSecret(sb,"kalenel_bunq_private_key"),
    getSecret(sb,"kalenel_bunq_public_key"),
    getSecret(sb,"kalenel_bunq_installation_token"),
    getSecret(sb,"kalenel_bunq_server_public_key")
  ]);
  if(!apiKey||!privatePem||!installationToken) throw new Error("bunq_not_connected");
  const session=await bunqRequest("/session-server",{
    method:"POST",body:{secret:apiKey},authToken:installationToken,privatePem,sign:true
  });
  const sessionToken=text(wrapped(session,["Token"])?.token);
  const user=wrapped(session,["UserApiKey","UserPerson","UserCompany"]);
  const userId=Number(user?.id);
  if(!sessionToken||!Number.isFinite(userId)) throw new Error("bunq_session_unavailable");
  return {apiKey,privatePem,publicPem,installationToken,serverPublicKey,userId,sessionToken};
}

async function loadCatalog(ctx:any){
  const [accountsPayload,cardsPayload]=await Promise.all([
    bunqRequest(`/user/${ctx.userId}/monetary-account`,{authToken:ctx.sessionToken}),
    bunqRequest(`/user/${ctx.userId}/card`,{authToken:ctx.sessionToken})
  ]);
  const accounts=responseEntries(accountsPayload).map(r=>accountFromWrapped(r.type,r.value)).filter(Boolean);
  const cards=responseEntries(cardsPayload).map(r=>cardFromWrapped(r.type,r.value)).filter(Boolean);
  return {accounts,cards};
}

function sanitizedCardUpdate(card:any,accountId:number){
  const body:any={};
  if(Array.isArray(card?.primary_account_numbers)&&card.primary_account_numbers.length){
    body.primary_account_numbers=card.primary_account_numbers.map((p:any)=>({
      id:Number(p.id),
      description:text(p.description)||undefined,
      status:text(p.status)||undefined,
      monetary_account_id:accountId
    }));
  }
  if(Array.isArray(card?.pin_code_assignment)&&card.pin_code_assignment.length){
    body.pin_code_assignment=card.pin_code_assignment.map((p:any)=>({
      type:text(p.type)||undefined,
      routing_type:text(p.routing_type)||undefined,
      monetary_account_id:accountId,
      status:text(p.status)||undefined
    }));
  }
  if(!Object.keys(body).length) throw new Error("bunq_card_account_link_not_supported_for_this_card");
  return body;
}
async function fetchCard(ctx:any,cardId:number){
  const payload=await bunqRequest(`/user/${ctx.userId}/card/${cardId}`,{authToken:ctx.sessionToken});
  const entry=responseEntries(payload).find(r=>/^Card/i.test(r.type));
  if(!entry?.value) throw new Error("bunq_card_not_found");
  return entry.value;
}
async function ensureCardLinked(ctx:any,cardId:number,accountId:number){
  let card=await fetchCard(ctx,cardId);
  if(cardAccountIds(card).includes(accountId)) return card;
  const body=sanitizedCardUpdate(card,accountId);
  await bunqRequest(`/user/${ctx.userId}/card/${cardId}`,{
    method:"PUT",body,authToken:ctx.sessionToken,privatePem:ctx.privatePem,sign:true
  });
  card=await fetchCard(ctx,cardId);
  if(!cardAccountIds(card).includes(accountId)) throw new Error("bunq_card_link_verification_failed");
  return card;
}

async function settings(sb:any){
  const {data,error}=await sb.from("shop_bunq_production_settings_v1").select("*").eq("id",1).maybeSingle();
  if(error) throw error;
  return data||{id:1,enabled:false,api_context_ready:false};
}
function publicSettings(row:any){
  return {
    enabled:row?.enabled===true,
    api_context_ready:row?.api_context_ready===true,
    connected:row?.api_context_ready===true,
    bunq_user_id:row?.bunq_user_id||null,
    selected_account_id:row?.selected_account_id||null,
    selected_account_description:row?.selected_account_description||"",
    selected_account_iban_masked:row?.selected_account_iban_masked||"",
    selected_card_id:row?.selected_card_id||null,
    selected_card_label:row?.selected_card_label||"",
    selected_card_last4:row?.selected_card_last4||"",
    selected_card_type:row?.selected_card_type||"",
    printify_default_card_confirmed:row?.printify_default_card_confirmed===true,
    printify_bunq_only_confirmed:row?.printify_bunq_only_confirmed===true,
    bunq_manual_approval_confirmed:row?.bunq_manual_approval_confirmed===true,
    connected_at:row?.connected_at||null,
    last_checked_at:row?.last_checked_at||null,
    last_error:row?.last_error||null,
    ready_for_production:row?.enabled===true&&row?.api_context_ready===true&&!!row?.selected_account_id&&!!row?.selected_card_id&&row?.printify_default_card_confirmed===true&&row?.printify_bunq_only_confirmed===true&&row?.bunq_manual_approval_confirmed===true
  };
}

async function logEvent(sb:any,input:any){
  try{await sb.from("shop_bunq_production_events_v1").insert(input);}catch{}
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST") return json(req,{error:"method_not_allowed"},405);

  const supabaseUrl=Deno.env.get("SUPABASE_URL");
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!supabaseUrl||!serviceKey) return json(req,{error:"server_not_configured"},503);
  const sb=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

  try{
    const body=await req.json();
    const admin=await requireAdmin(sb,text(body?.admin_session_token));
    const action=text(body?.action||"status");

    if(action==="status"){
      const row=await settings(sb);
      return json(req,{ok:true,settings:publicSettings(row)});
    }

    if(action==="connect"){
      const apiKey=text(body?.api_key);
      if(apiKey.length<20||apiKey.length>500) return json(req,{error:"bunq_api_key_invalid"},400);
      try{
        const ctx=await createApiContext(apiKey);
        await Promise.all([
          setSecret(sb,"kalenel_bunq_api_key",ctx.apiKey),
          setSecret(sb,"kalenel_bunq_private_key",ctx.privatePem),
          setSecret(sb,"kalenel_bunq_public_key",ctx.publicPem),
          setSecret(sb,"kalenel_bunq_installation_token",ctx.installationToken),
          setSecret(sb,"kalenel_bunq_server_public_key",ctx.serverPublicKey||"not-returned")
        ]);
        const now=new Date().toISOString();
        const {error}=await sb.from("shop_bunq_production_settings_v1").update({
          enabled:false,
          api_context_ready:true,
          bunq_user_id:ctx.userId,
          selected_account_id:null,
          selected_account_description:null,
          selected_account_iban_masked:null,
          selected_card_id:null,
          selected_card_label:null,
          selected_card_last4:null,
          selected_card_type:null,
          printify_default_card_confirmed:false,
          printify_bunq_only_confirmed:false,
          bunq_manual_approval_confirmed:false,
          connected_at:now,
          last_checked_at:now,
          last_error:null,
          updated_at:now
        }).eq("id",1);
        if(error) throw error;
        await logEvent(sb,{action:"connect",ok:true,detail:"bunq API context connected",metadata:{admin_id:Number(admin?.admin_id)||null}});
        const catalog=await loadCatalog(ctx);
        return json(req,{ok:true,connected:true,settings:publicSettings(await settings(sb)),accounts:catalog.accounts,cards:catalog.cards.map((c:any)=>({...c,raw:undefined}))});
      }catch(error:any){
        const detail=text(error?.message||error).slice(0,600);
        await sb.from("shop_bunq_production_settings_v1").update({api_context_ready:false,enabled:false,last_error:detail,updated_at:new Date().toISOString()}).eq("id",1);
        await logEvent(sb,{action:"connect",ok:false,detail});
        return json(req,{error:"bunq_connect_failed",detail},502);
      }
    }

    if(action==="catalog"){
      const ctx=await openContext(sb);
      const catalog=await loadCatalog(ctx);
      const now=new Date().toISOString();
      await sb.from("shop_bunq_production_settings_v1").update({bunq_user_id:ctx.userId,last_checked_at:now,last_error:null,updated_at:now}).eq("id",1);
      return json(req,{ok:true,accounts:catalog.accounts,cards:catalog.cards.map((c:any)=>({...c,raw:undefined})),settings:publicSettings(await settings(sb))});
    }

    if(action==="save_selection"){
      const accountId=Number(body?.account_id),cardId=Number(body?.card_id);
      const confirmed=body?.printify_default_card_confirmed===true;
      const bunqOnlyConfirmed=body?.printify_bunq_only_confirmed===true;
      const manualApprovalConfirmed=body?.bunq_manual_approval_confirmed===true;
      if(!Number.isFinite(accountId)||!Number.isFinite(cardId)) return json(req,{error:"bunq_selection_invalid"},400);
      const ctx=await openContext(sb);
      const catalog=await loadCatalog(ctx);
      const account=catalog.accounts.find((x:any)=>x.id===accountId);
      const listedCard=catalog.cards.find((x:any)=>x.id===cardId);
      if(!account||!listedCard) return json(req,{error:"bunq_selection_not_found"},404);
      if(text(account.status).toUpperCase()&&text(account.status).toUpperCase()!=="ACTIVE") return json(req,{error:"bunq_account_not_active"},409);
      if(text(listedCard.status).toUpperCase()!=="ACTIVE") return json(req,{error:"bunq_card_not_active"},409);

      const linked=await ensureCardLinked(ctx,cardId,accountId);
      const now=new Date().toISOString();
      const {error}=await sb.from("shop_bunq_production_settings_v1").update({
        enabled:true,
        api_context_ready:true,
        bunq_user_id:ctx.userId,
        selected_account_id:accountId,
        selected_account_description:account.description,
        selected_account_iban_masked:account.iban_masked,
        selected_card_id:cardId,
        selected_card_label:listedCard.label,
        selected_card_last4:cardLast4(linked),
        selected_card_type:text(linked.type||listedCard.type),
        printify_default_card_confirmed:confirmed,
        printify_bunq_only_confirmed:bunqOnlyConfirmed,
        bunq_manual_approval_confirmed:manualApprovalConfirmed,
        last_checked_at:now,
        last_error:null,
        updated_at:now
      }).eq("id",1);
      if(error) throw error;
      await logEvent(sb,{action:"save_selection",ok:true,bunq_account_id:accountId,bunq_card_id:cardId,bunq_balance_eur:account.balance,detail:"bunq card linked to selected production account",metadata:{printify_default_card_confirmed:confirmed,printify_bunq_only_confirmed:bunqOnlyConfirmed,bunq_manual_approval_confirmed:manualApprovalConfirmed}});
      return json(req,{ok:true,settings:publicSettings(await settings(sb)),account,card:{...listedCard,raw:undefined}});
    }

    if(action==="prepare_charge"){
      const row=await settings(sb);
      if(!row?.enabled||!row?.api_context_ready) return json(req,{error:"bunq_funding_not_configured",detail:"Connect bunq and select a production account/card first."},409);
      if(!row?.selected_account_id||!row?.selected_card_id) return json(req,{error:"bunq_funding_selection_missing"},409);
      if(row?.printify_default_card_confirmed!==true) return json(req,{error:"printify_bunq_card_not_confirmed",detail:"Confirm that the selected bunq card is the default payment card in Printify before production."},409);
      if(row?.printify_bunq_only_confirmed!==true) return json(req,{error:"printify_bunq_only_not_confirmed",detail:"Confirm that Printify will not use Printify Balance or another fallback card for this production charge."},409);
      if(row?.bunq_manual_approval_confirmed!==true) return json(req,{error:"bunq_manual_approval_not_confirmed",detail:"Confirm that Printify is not in bunq Auto Accepted → Card Payments, so bunq can request manual approval when 3D Secure is required."},409);

      const ctx=await openContext(sb);
      const catalog=await loadCatalog(ctx);
      const account=catalog.accounts.find((x:any)=>x.id===Number(row.selected_account_id));
      const listedCard=catalog.cards.find((x:any)=>x.id===Number(row.selected_card_id));
      if(!account||!listedCard) return json(req,{error:"bunq_funding_source_missing"},409);
      if(text(listedCard.status).toUpperCase()!=="ACTIVE") return json(req,{error:"bunq_card_not_active"},409);
      if(Number.isFinite(Number(account.balance))&&Number(account.balance)<=0) return json(req,{error:"bunq_account_balance_empty",balance:account.balance},409);

      const linked=await ensureCardLinked(ctx,Number(row.selected_card_id),Number(row.selected_account_id));
      const linkedIds=cardAccountIds(linked);
      if(!linkedIds.includes(Number(row.selected_account_id))) return json(req,{error:"bunq_card_link_verification_failed"},409);

      const now=new Date().toISOString();
      const snapshot={
        provider:"bunq_card_via_printify",
        bunq_user_id:ctx.userId,
        account_id:Number(row.selected_account_id),
        account_description:account.description,
        account_iban_masked:account.iban_masked,
        account_balance_eur:account.balance,
        card_id:Number(row.selected_card_id),
        card_label:row.selected_card_label,
        card_last4:cardLast4(linked)||row.selected_card_last4,
        card_type:text(linked.type||row.selected_card_type),
        printify_default_card_confirmed:true,
        printify_bunq_only_confirmed:true,
        bunq_manual_approval_confirmed:true,
        verified_at:now
      };
      const orderId=text(body?.order_id);
      if(orderId){
        await sb.from("shop_orders").update({production_funding_preflight_at:now,production_funding_snapshot:snapshot,updated_at:now}).eq("id",orderId);
      }
      await sb.from("shop_bunq_production_settings_v1").update({last_checked_at:now,last_error:null,updated_at:now}).eq("id",1);
      await logEvent(sb,{order_id:orderId||null,action:"prepare_charge",ok:true,bunq_account_id:Number(row.selected_account_id),bunq_card_id:Number(row.selected_card_id),bunq_balance_eur:account.balance,detail:"bunq funding source verified before Printify production charge",metadata:{card_last4:snapshot.card_last4}});
      return json(req,{ok:true,ready:true,snapshot});
    }

    if(action==="disable"){
      const now=new Date().toISOString();
      await sb.from("shop_bunq_production_settings_v1").update({enabled:false,printify_default_card_confirmed:false,printify_bunq_only_confirmed:false,bunq_manual_approval_confirmed:false,updated_at:now}).eq("id",1);
      await logEvent(sb,{action:"disable",ok:true,detail:"bunq production funding disabled"});
      return json(req,{ok:true,settings:publicSettings(await settings(sb))});
    }

    return json(req,{error:"unknown_action"},400);
  }catch(error:any){
    const detail=text(error?.message||error).slice(0,600);
    console.error("shop-bunq-production-v1 failed",detail);
    return json(req,{error:/invalid_admin_session/i.test(detail)?"invalid_admin_session":"bunq_admin_failed",detail},/invalid_admin_session/i.test(detail)?401:502);
  }
});
