"use strict";
const SOLO_RPC_BASE="https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/";
const SOLO_RPC_NAMES=Object.freeze({
  health:"tunerush_s21_health_v1",
  submit:"tunerush_s21_submit_v1",
  status:"tunerush_s21_status_v1"
});
const SOLO_RPC_KEY="sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA";
function randomSoloToken(){const bytes=crypto.getRandomValues(new Uint8Array(32));return Array.from(bytes).map(x=>x.toString(16).padStart(2,"0")).join("")}
async function hashSoloToken(key){
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(key));
 return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function soloRPC(endpoint,data){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),16000);
 try{
  const fn=SOLO_RPC_NAMES[endpoint];
  if(!fn)throw Error("Unsupported Solo RPC command");
  const res=await fetch(SOLO_RPC_BASE+fn,{
   method:"POST",mode:"cors",cache:"no-store",signal:controller.signal,
   headers:{"Content-Type":"application/json","apikey":SOLO_RPC_KEY},
   body:JSON.stringify(data)
  });
  const out=await res.json();
  if(!res.ok)throw Error(out.message||out.error||"Solo relay HTTP "+res.status);
  return out;
 }catch(e){
  if(e.name==="AbortError")throw Error("The game connection timed out. Reconnect to check your saved progress.");
  throw e;
 }finally{clearTimeout(timer)}
}
async function api(path,method="GET",data=null,authorized=true){
 if(path==="/api/health"){
  const h=await soloRPC("health",{});
  return {ready:!!h.online};
 }
 const command=path==="/api/session"?"session":path==="/api/state"?"state":path==="/api/action"?"action":null;
 if(!command)throw Error("Unknown solo game command.");
 if(command!=="session"&&!token)throw Error("Game session expired.");
 const key=randomSoloToken();
 const pollHash=await hashSoloToken(key);
 const submission=await soloRPC("submit",{
  p_command:command,p_session_token:command==="session"?null:token,
  p_data:data||{},p_poll_hash:pollHash
 });
 const until=Date.now()+(command==="session"?105000:50000);
 while(Date.now()<until){
  await new Promise(resolve=>setTimeout(resolve,500));
  const response=await soloRPC("status",{p_id:submission.id,p_poll_hash:pollHash});
  if(response.status==="done"){
   if(!response.result?.ok)throw Error(response.result?.error||"S21 rejected this request.");
   return response.result.body;
  }
  if(response.status==="missing")throw Error("The S21 game request expired.");
 }
 throw Error("The game connection is unavailable. Your progress is saved.");
}
