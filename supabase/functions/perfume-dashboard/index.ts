import postgres from "npm:postgres@3.4.7";

const DB_URL = Deno.env.get("SUPABASE_DB_URL");
if (!DB_URL) throw new Error("SUPABASE_DB_URL missing");
const sql = postgres(DB_URL,{max:2,prepare:false,idle_timeout:20});
const ALLOWED_ORIGINS=new Set(["https://kalenel.nl","https://www.kalenel.nl","https://admin.kalenel.nl"]);

function headers(origin:string|null){const h:Record<string,string>={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","pragma":"no-cache","x-content-type-options":"nosniff","vary":"Origin","access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"content-type, authorization, apikey","access-control-max-age":"600"};if(origin&&ALLOWED_ORIGINS.has(origin))h["access-control-allow-origin"]=origin;return h}
function json(data:unknown,status=200,origin:string|null=null){return new Response(JSON.stringify(data),{status,headers:headers(origin)})}
async function auth(token:string){if(token.length<20||token.length>500)return null;const rows=await sql`select public.admin_check_session(${token}) as data`;const checked=rows?.[0]?.data as Record<string,unknown>|undefined;if(!checked||checked.ok!==true)return null;const username=String(checked.username||"").slice(0,160);return username?{username,checked}:null}
function bool(v:unknown){return v===true}
function text(v:unknown,max=4000){return String(v??"").slice(0,max)}
function num(v:unknown,min:number,max:number){if(v===null||v===""||v===undefined)return null;const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max?n:null}

Deno.serve(async(req:Request)=>{const origin=req.headers.get("origin");if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(origin)});if(!origin||!ALLOWED_ORIGINS.has(origin))return json({ok:false,error:"origin_denied"},403,origin);if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405,origin);try{const body=await req.json().catch(()=>null) as Record<string,unknown>|null;if(!body)return json({ok:false,error:"invalid_request"},400,origin);const a=await auth(String(body.admin_session_token||"").trim());if(!a)return json({ok:false,error:"admin_session_invalid"},401,origin);const action=String(body.action||"list");
if(action==="list"){
  const rows=await sql`select c.rank,c.brand,c.perfume,c.ml,c.price_eur,c.price_per_ml,c.score,c.sentiment,c.lenez_code,
    coalesce(s.tried,false) tried,coalesce(s.bought,false) bought,coalesce(s.own,false) own,coalesce(s.finished,false) finished,
    coalesce(s.preference,'neutral') preference,coalesce(s.favourite,false) favourite,s.personal_rating,coalesce(s.wear_count,0) wear_count,
    s.purchase_date,s.price_paid,s.bottle_ml,s.amount_remaining_pct,coalesce(s.notes,'') notes,s.updated_at
    from perfume_private.catalog c left join perfume_private.user_state s on s.rank=c.rank and s.admin_username=${a.username}
    order by c.rank`;
  return json({ok:true,username:a.username,perfumes:rows},200,origin)
}
if(action==="save"){
  const rank=Number(body.rank);if(!Number.isInteger(rank)||rank<1||rank>102)return json({ok:false,error:"bad_rank"},400,origin);
  const preference=["neutral","liked","disliked"].includes(String(body.preference))?String(body.preference):"neutral";
  const rating=num(body.personal_rating,0,10), pricePaid=num(body.price_paid,0,100000), bottleMl=num(body.bottle_ml,1,5000), remaining=num(body.amount_remaining_pct,0,100);
  const wearCount=num(body.wear_count,0,1000000);
  const purchaseDate=body.purchase_date?text(body.purchase_date,10):null;
  await sql`insert into perfume_private.user_state(admin_username,rank,tried,bought,own,finished,preference,favourite,personal_rating,wear_count,purchase_date,price_paid,bottle_ml,amount_remaining_pct,notes,updated_at)
    values(${a.username},${rank},${bool(body.tried)},${bool(body.bought)},${bool(body.own)},${bool(body.finished)},${preference},${bool(body.favourite)},${rating},${wearCount===null?0:Math.trunc(wearCount)},${purchaseDate},${pricePaid},${bottleMl===null?null:Math.trunc(bottleMl)},${remaining===null?null:Math.trunc(remaining)},${text(body.notes,5000)},now())
    on conflict(admin_username,rank) do update set tried=excluded.tried,bought=excluded.bought,own=excluded.own,finished=excluded.finished,preference=excluded.preference,favourite=excluded.favourite,personal_rating=excluded.personal_rating,wear_count=excluded.wear_count,purchase_date=excluded.purchase_date,price_paid=excluded.price_paid,bottle_ml=excluded.bottle_ml,amount_remaining_pct=excluded.amount_remaining_pct,notes=excluded.notes,updated_at=now()`;
  return json({ok:true},200,origin)
}
if(action==="wear"){
  const rank=Number(body.rank);if(!Number.isInteger(rank)||rank<1||rank>102)return json({ok:false,error:"bad_rank"},400,origin);
  await sql.begin(async tx=>{await tx`insert into perfume_private.wears(admin_username,rank,note) values(${a.username},${rank},${text(body.note,1000)})`;await tx`insert into perfume_private.user_state(admin_username,rank,tried,wear_count,updated_at) values(${a.username},${rank},true,1,now()) on conflict(admin_username,rank) do update set tried=true,wear_count=perfume_private.user_state.wear_count+1,updated_at=now()`});
  return json({ok:true},200,origin)
}
return json({ok:false,error:"not_found"},404,origin)}catch(e){console.error(e);return json({ok:false,error:"internal"},500,origin)}});
