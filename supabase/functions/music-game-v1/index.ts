// Kalenel Tune Rush v1. Public gateway, private database authority.
// Spotify playback is intentionally excluded: its developer policy prohibits trivia games.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const ALLOW = new Set(["https://kalenel.nl","https://www.kalenel.nl","http://localhost:8080","http://127.0.0.1:8080"]);
const BASE = Deno.env.get("SUPABASE_URL") || "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = BASE && KEY ? createClient(BASE,KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null;
const actions = new Set(["create","join","state","settings","start","next","play","pause","resume","buzz","steal","answer","skip"]);
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomHex(length=32) {
 const a=new Uint8Array(length);crypto.getRandomValues(a);
 return [...a].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function randomCode() {
 const a=new Uint8Array(6);crypto.getRandomValues(a);
 return [...a].map(x=>alphabet[x%alphabet.length]).join("");
}
async function sha256(s) {
 const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
 return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function response(data,status,origin="") {
 const headers={
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff",
  "Vary":"Origin"
 };
 if(ALLOW.has(origin)) Object.assign(headers,{
  "Access-Control-Allow-Origin":origin,
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type"
 });
 return new Response(status===204?null:JSON.stringify(data),{status,headers});
}
Deno.serve(async req=>{
 const origin=req.headers.get("origin")||"";
 if(origin && !ALLOW.has(origin))return response({error:"origin_forbidden"},403);
 if(req.method==="OPTIONS")return response({},204,origin);
 if(req.method!=="POST")return response({error:"method_not_allowed"},405,origin);
 if(!db)return response({error:"server_not_configured"},503,origin);
 if(Number(req.headers.get("content-length")||0)>4096) return response({error:"too_large"},413,origin);
 let input;
 try {
  const raw=await req.text();
  if(raw.length>4096) return response({error:"too_large"},413,origin);
  input=JSON.parse(raw);
 } catch {return response({error:"invalid_json"},400,origin);}
 const op=String(input?.action||"");
 if(!actions.has(op)) return response({error:"invalid_action"},400,origin);
 let code=String(input?.code||"").trim().toUpperCase();
 const token=op==="create"||op==="join"?randomHex():String(input?.token||"");
 if(!/^[0-9a-f]{64}$/.test(token))return response({error:"invalid_token"},401,origin);
 if(op==="create")code=randomCode();
 if(op!=="create"&&!/^[A-HJ-NP-Z2-9]{6}$/.test(code))return response({error:"invalid_code"},400,origin);
 const payload={
  name:String(input?.name||"").slice(0,20),
  song:String(input?.song||"").slice(0,100),
  artist:String(input?.artist||"").slice(0,100),
  genres:Array.isArray(input?.genres)?input.genres.slice(0,12):[]
 };
 const hash=await sha256(token);
 try {
  for(let attempt=0;attempt<(op==="create"?4:1);attempt++){
   const {data,error}=await db.rpc("musicquiz_v1",{
    p_action:op,p_code:code,p_hash:hash,p_data:payload
   });
   if(!error) return response({state:data,...((op==="create"||op==="join")?{token}:{})},200,origin);
   if(op==="create"&&String(error?.code)==="23505"&&attempt<3){code=randomCode();continue;}
   const msg=String(error?.message||"failed").split("\n")[0];
   const known=[
    "room_not_found","room_expired","unauthorized","invalid_token","invalid_code",
    "game_already_started","invalid_name","room_full","name_taken","host_lobby_only",
    "select_a_genre","host_only","not_in_lobby","round_not_solved","no_players",
    "no_licensed_songs_for_genres","room_capacity_reached","not_ready_for_clip","resume_unavailable","all_hints_used",
    "buzz_closed","steal_closed","steal_requires_remaining_answers","already_tried_this_clip","not_your_turn","skip_unavailable","unknown_action"
   ];
   return response({error:known.includes(msg)?msg:"request_failed"},known.includes(msg)?409:500,origin);
  }
  return response({error:"code_collision"},503,origin);
 } catch {
  return response({error:"temporary_failure"},503,origin);
 }
});
